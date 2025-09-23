// api/chat.js — Etapa 2
export const config = { runtime: 'nodejs' };

import { randomUUID } from 'crypto';

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const STAGE = 'etapa2-openai';

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

// Prompt con tono “psicólogo directo”
const SYSTEM_PROMPT = `
Sos un psicólogo experto que habla directo, sin vueltas, como alguien que canta las 40.
Usá frases cortas y claras, máximo 5–6 frases. No repitas siempre el mismo cierre: adaptalo a la conversación.
`;

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return respond(res, 200, { ok: true, stage: STAGE, hint: 'Usá POST para chatear' });
  }
  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'method_not_allowed', message: 'Use POST', stage: STAGE });
  }

  try {
    if (!OPENAI_KEY) {
      return respond(res, 500, { error: 'no_openai_key', message: 'Falta OPENAI_API_KEY en Vercel', stage: STAGE });
    }

    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error: 'no_text', message: 'Falta "text"', stage: STAGE });

    // Generar sessionId si no hay
    const sessionId = body.sessionId || randomUUID();

    // Llamada a OpenAI
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',  // si da 404 probá 'gpt-4o' o 'gpt-4o-mini-2024-07-18'
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
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

    return respond(res, 200, { sessionId, message: `[${STAGE}] ${reply}` });
  } catch (e) {
    console.error('[chat_handler_error]', e);
    return respond(res, 500, { error: 'server_error', message: String(e), stage: STAGE });
  }
}
