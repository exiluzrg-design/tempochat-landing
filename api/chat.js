// api/chat.js — Etapa 3 (OpenAI + Supabase con tags automáticos)
export const config = { runtime: 'nodejs' };

import { randomUUID } from 'crypto';

const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const STAGE = 'etapa3-openai-supabase-tags';

// Prompt picante
const SYSTEM_PROMPT = `
Sos un psicólogo con mucha calle y años de experiencia escuchando de todo.
No sos tibio: decís lo que nadie se anima a decir, sin filtro, con brutal honestidad pero siempre para que la persona despierte.
Hablás directo, con frases cortas y contundentes. Usás un tono callejero, irónico cuando hace falta, como alguien que mezcla sabiduría de vida y psicología real.
No usás tecnicismos. No sos académico. Sos crudo y frontal.
Si alguien se está autoengañando, lo marcás al toque.
Nunca cierres todas las respuestas igual: variá los remates, que sean filosos y ajustados al contexto.
`;

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch {} }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respond(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function saveMessage(row) {
  if (!SB_URL || !SB_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const resp = await fetch(`${SB_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row)
  });
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`saveMessage failed ${resp.status}: ${txt}`);
  return txt;
}

// Llama a OpenAI para generar tags a partir del texto
async function extractTags(content) {
  if (!OPENAI_KEY || !content) return [];
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Extraé solo 3 a 5 tags en minúsculas, sin frases largas, del siguiente texto. Devolvé un JSON array.' },
        { role: 'user', content: content }
      ],
      temperature: 0.3,
      max_tokens: 50
    })
  });
  if (!r.ok) return [];
  const j = await r.json();
  try {
    const raw = j?.choices?.[0]?.message?.content?.trim();
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return respond(res, 200, { ok: true, stage: STAGE, hint: 'Usá POST para chatear' });
  }
  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'method_not_allowed', message: 'Use POST', stage: STAGE });
  }

  try {
    if (!OPENAI_KEY) {
      return respond(res, 500, { error: 'no_openai_key', message: 'Falta OPENAI_API_KEY', stage: STAGE });
    }

    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error: 'no_text', message: 'Falta "text"', stage: STAGE });

    const sessionId = body.sessionId || randomUUID();

    // Generar tags del input
    const userTags = await extractTags(text);

    // Guardar user en Supabase sin content (solo tags/meta)
    await saveMessage({
      session_id: sessionId,
      role: 'user',
      content: null,
      tags: userTags,
      meta: { src: 'api' }
    });

    // Llamada a OpenAI para la respuesta
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: 0.9,
        max_tokens: 350
      })
    });

    let reply = '⚠️ Error inesperado con OpenAI.';
    if (r.ok) {
      const j = await r.json();
      reply = j?.choices?.[0]?.message?.content?.trim() || reply;
    } else {
      const t = await r.text();
      console.error('[openai_error]', r.status, t);
      reply = `⚠️ OpenAI ${r.status}: ${t}`;
    }

    // Generar tags de la respuesta también
    const asstTags = await extractTags(reply);

    // Guardar assistant en Supabase sin content (solo tags/meta)
    await saveMessage({
      session_id: sessionId,
      role: 'assistant',
      content: null,
      tags: asstTags,
      meta: { src: 'api' }
    });

    return respond(res, 200, { sessionId, message: `[${STAGE}] ${reply}` });
  } catch (e) {
    console.error('[chat_handler_error]', e);
    return respond(res, 500, { error: 'server_error', message: String(e), stage: STAGE });
  }
}
