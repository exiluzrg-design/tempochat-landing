// api/chat.js — Etapa 3.5 con memoria + clear endpoint
export const config = { runtime: 'nodejs' };

import { randomUUID } from 'crypto';

const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

// ---------- utils básicos ----------
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch {} }
  return await new Promise((resolve) => {
    let data = ''; req.on('data', c => data += c); req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}
function respond(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}
async function insertMessages(rows) {
  if (!SB_URL || !SB_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const resp = await fetch(`${SB_URL}/rest/v1/messages`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(rows)
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`insertMessages ${resp.status}: ${t}`);
  }
}

// ---------- Redis (Upstash REST) ----------
async function redis(command, ...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Missing Upstash credentials');
  const body = { command, args };
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`Redis ${command} ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return j.result;
}
async function pushHistory(sessionId, role, content) {
  const key = `chat:${sessionId}`;
  const item = JSON.stringify({ role, content, t: Date.now() });
  await redis('LPUSH', key, item);
  await redis('LTRIM', key, 0, 11); // máx 12 items
}
async function getHistory(sessionId, max = 12) {
  const key = `chat:${sessionId}`;
  const arr = await redis('LRANGE', key, 0, max - 1);
  return arr.reverse().map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
}
async function clearHistory(sessionId) {
  const key = `chat:${sessionId}`;
  return await redis('DEL', key);
}

// ---------- Prompt ----------
const SYSTEM_PROMPT = `
Sos un psicólogo con mucha calle y años de experiencia.
No sos tibio: decís lo que nadie se anima a decir, con honestidad brutal para que la persona despierte.
Hablás directo, frases cortas, cero tecnicismos. Si hay autoengaño, lo marcás al toque.
Nunca cierres siempre igual: remate breve, filoso y conectado al tema.
Cuando respondas para el sistema, devolveme SOLO un JSON con:
{
  "reply": "máx 6 frases, tono callejero y claro",
  "user_tags": ["3-5 tags en minúsculas"],
  "assistant_tags": ["3-5 tags en minúsculas"]
}
NO agregues explicación fuera del JSON.
`;

export default async function handler(req, res) {
  const url = req.url || '';

  // ---- endpoint de limpieza de memoria ----
  if (url.includes('memory-clear') && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const sessionId = (body.sessionId || '').toString().trim();
      if (!sessionId) return respond(res, 400, { error: 'no_session', message: 'Falta sessionId' });
      await clearHistory(sessionId);
      return respond(res, 200, { ok: true, cleared: sessionId });
    } catch (e) {
      console.error('[memory_clear_error]', e);
      return respond(res, 500, { error: 'server_error', message: String(e) });
    }
  }

  // ---- endpoint principal de chat ----
  if (req.method === 'GET') {
    return respond(res, 200, { ok: true, stage: 'etapa3.5-memory', hint: 'Usá POST para chatear' });
  }
  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'method_not_allowed', message: 'Use POST' });
  }

  try {
    if (!OPENAI_KEY) return respond(res, 500, { error: 'no_openai_key', message: 'Falta OPENAI_API_KEY' });

    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error: 'no_text', message: 'Falta "text"' });

    const sessionId = body.sessionId || randomUUID();

    // 1) Historial desde Redis
    let history = [];
    try { history = await getHistory(sessionId, 12); } catch (e) { console.error('[redis_read_error]', e); }

    const contextMessages = history.map(h => ({
      role: h.role === 'assistant' ? 'assistant' : 'user',
      content: h.content || ''
    }));

    // 2) OpenAI: reply + tags
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...contextMessages,
          { role: 'user', content: text }
        ],
        temperature: 0.9,
        max_tokens: 400
      })
    });

    if (!r.ok) {
      const t = await r.text();
      console.error('[openai_error]', r.status, t);
      return respond(res, 200, { sessionId, message: `⚠️ OpenAI ${r.status}: ${t}` });
    }

    const j = await r.json();
    let payload = {};
    try { payload = JSON.parse(j?.choices?.[0]?.message?.content || '{}'); } catch {}
    const reply = (payload.reply || 'Decime en claro qué pasa y vamos al grano.').trim();
    const user_tags = Array.isArray(payload.user_tags) ? payload.user_tags : [];
    const assistant_tags = Array.isArray(payload.assistant_tags) ? payload.assistant_tags : [];

    // 3) Guardar memoria en Redis
    try {
      await Promise.all([
        pushHistory(sessionId, 'user', text),
        pushHistory(sessionId, 'assistant', reply)
      ]);
    } catch (e) { console.error('[redis_write_error]', e); }

    // 4) Guardar solo tags en Supabase
    try {
      await insertMessages([
        { session_id: sessionId, role: 'user',      content: null, tags: user_tags,      meta: { src: 'api' } },
        { session_id: sessionId, role: 'assistant', content: null, tags: assistant_tags, meta: { src: 'api' } }
      ]);
    } catch (dbErr) { console.error('[supabase_insert_error]', dbErr); }

    return respond(res, 200, { sessionId, message: reply });
  } catch (e) {
    console.error('[chat_handler_error]', e);
    return respond(res, 500, { error: 'server_error', message: String(e) });
  }
}
