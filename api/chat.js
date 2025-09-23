// api/chat.js — Etapa 4 + Prompt estilo psicólogo directo
export const config = { runtime: 'nodejs' };

import { randomUUID } from 'crypto';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

function ok(res, data) { return res.status(200).json(data); }
function bad(res, code, msg, status = 400) { return res.status(status).json({ error: code, message: msg }); }

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch {} }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function resolveSessionId(body, headers) {
  return body.sessionId || headers['x-session-id'] || headers['x-sessionid'] || randomUUID();
}

async function saveMessage(row) {
  if (!SB_URL || !SB_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  if (!row.session_id) throw new Error('Missing session_id');
  if (!row.role) throw new Error('Missing role');
  if (row.role !== 'user' && row.role !== 'assistant') throw new Error('Invalid role (must be user|assistant)');

  const resp = await fetch(`${SB_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({
      session_id: row.session_id,
      role: row.role,
      content: row.content ?? null,
      tags: Array.isArray(row.tags) ? row.tags : (row.tags ? [row.tags] : []),
      meta: row.meta ?? {}
    })
  });

  const text = await resp.text();
  console.log('[saveMessage]', row.role, resp.status, resp.ok, text);
  if (!resp.ok) throw new Error(`saveMessage failed ${resp.status}: ${text}`);
  try { return JSON.parse(text)[0]; } catch { return text; }
}

// --- Nuevo Prompt (psicólogo directo, estilo “cantar las 40”)
const SYSTEM_PROMPT = `
Sos un psicólogo experto, pero hablás directo, sin vueltas, como alguien que canta las 40. Usá un tono humano, rioplatense, con frases cortas y claras. Validá la emoción en una línea, pero después tirá la posta: decí lo que está mal, lo que está bien y las opciones concretas que tiene la persona. No adornes con palabras técnicas ni condescendencia. 

Reglas:
1. Máximo 5–6 frases.
2. Siempre nombrá las opciones como caminos concretos (“o hacés esto… o hacés lo otro…”).
3. Mantené el equilibrio: firme pero empático, con un toque irónico si sirve.
4. Cerrá con una frase que le devuelva la responsabilidad al usuario: “la decisión es tuya” o similar.
`;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 'method_not_allowed', 'Use POST', 405);

    const body = await readBody(req);
    const session_id = resolveSessionId(body, req.headers);

    const text = (body.text ?? '').toString().trim();
    if (!text) return bad(res, 'no_text', 'Falta "text"');

    // Guardar mensaje del usuario
    await saveMessage({ session_id, role: 'user', content: text, tags: body.tags, meta: { src: 'api' } });

    // Respuesta IA (o fallback si no hay API Key)
    let assistantText = 'Hola, te escucho. (respuesta de prueba — falta OPENAI_API_KEY)';
    if (OPENAI_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: text }
          ],
          temperature: 0.7,
          max_tokens: 350
        })
      });
      if (r.ok) {
        const j = await r.json();
        assistantText = j?.choices?.[0]?.message?.content?.trim() || assistantText;
      } else {
        const t = await r.text(); console.log('[openai_error:chat]', r.status, t);
        assistantText = 'Perdón, hubo un problema de conexión. Probá de nuevo.';
      }
    }

    // Guardar respuesta del asistente
    await saveMessage({ session_id, role: 'assistant', content: assistantText, meta: { src: 'api' } });

    return ok(res, { sessionId: session_id, message: assistantText });
  } catch (e) {
    console.log('[chat_handler_error]', e);
    return bad(res, 'server_error', String(e), 500);
  }
}
