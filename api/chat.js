// api/chat.js — Node runtime (no Edge)
import { randomUUID } from 'crypto';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY; // opcional

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
      content: row.content ?? null,           // tu columna acepta NULL
      tags: Array.isArray(row.tags) ? row.tags : (row.tags ? [row.tags] : []),
      meta: row.meta ?? {}
    })
  });

  const text = await resp.text();
  console.log('[saveMessage]', row.role, resp.status, resp.ok, text);
  if (!resp.ok) throw new Error(`saveMessage failed ${resp.status}: ${text}`);
  try { return JSON.parse(text)[0]; } catch { return text; }
}

async function callOpenAI(prompt) {
  if (!OPENAI_KEY) {
    // Fallback sin costo para probar guardado
    return 'Hola, ¿cómo andás? (respuesta de prueba — sin OPENAI_API_KEY)';
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'Sos un asistente breve y empático.' },
        { role: 'user', content: prompt || 'Hola' }
      ]
    })
  });
  if (!r.ok) {
    const t = await r.text();
    console.log('[openai_error]', r.status, t);
    return 'Perdón, hubo un problema de conexión. Probá de nuevo.';
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content?.trim() || '...';
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return bad(res, 'method_not_allowed', 'Use POST', 405);

    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return bad(res, 'no_text', 'Falta "text"');

    const session_id = resolveSessionId(body, req.headers);

    // 1) Guarda USER
    await saveMessage({ session_id, role: 'user', content: text, tags: body.tags, meta: { src: 'api' } });

    // 2) Obtiene respuesta
    const assistantText = await callOpenAI(text);

    // 3) Guarda ASSISTANT
    await saveMessage({ session_id, role: 'assistant', content: assistantText, meta: { src: 'api' } });

    // 4) Responde a la web
    return ok(res, { sessionId: session_id, message: assistantText });
  } catch (e) {
    console.log('[chat_handler_error]', e);
    return bad(res, 'server_error', String(e), 500);
  }
}
