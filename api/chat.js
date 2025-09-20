// file: api/chat.js
import jwt from 'jsonwebtoken';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

// ===== Redis (Upstash REST) – sin dependencias =====
async function redisGet(key) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  }).catch((e) => {
    console.error('redis_get_error', e);
    return null;
  });
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  return json?.result ?? null; // string o null
}

async function redisSetEx(key, value, seconds) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return false;
  const val = encodeURIComponent(value);
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/set/${encodeURIComponent(key)}/${val}?EX=${seconds}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
  }).catch((e) => {
    console.error('redis_set_error', e);
    return null;
  });
  return !!(res && res.ok);
}
// (opcional)
async function redisDel(key) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return;
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/del/${encodeURIComponent(key)}`;
  await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` } }).catch((e) => {
    console.error('redis_del_error', e);
  });
}
// ====================================================

function ok(res, data) { return res.status(200).json(data); }
function bad(res, code, msg, status = 400) { return res.status(status).json({ error: code, message: msg }); }

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return bad(res, 'method_not_allowed', 'Method not allowed', 405);

    // Vars requeridas mínimas
    const secret = process.env.SESSION_JWT_SECRET;
    if (!secret) return bad(res, 'missing_secret', 'Missing SESSION_JWT_SECRET', 500);
    if (!process.env.OPENAI_API_KEY) return bad(res, 'missing_openai_key', 'Falta OPENAI_API_KEY', 500);

    const { message, sessionToken } = await readBody(req);
    if (!message || typeof message !== 'string') return bad(res, 'no_message', 'Falta message');
    if (!sessionToken) return bad(res, 'no_session', 'Falta sessionToken');

    // Valida JWT (10′)
    let decoded;
    try {
      decoded = jwt.verify(sessionToken, secret, { algorithms: ['HS256'] });
    } catch (e) {
      return bad(res, 'invalid_session', e.message.includes('expired') ? 'La sesión de 10 minutos terminó' : e.message);
    }
    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, (decoded.exp || 0) - now);
    if (remaining <= 0) return bad(res, 'session_expired', 'La sesión de 10 minutos terminó');

    // Prompt del sistema
    const sys = `
Sos TempoChat, un psicólogo experimentado, cercano y empático.
Objetivo: brindar apoyo emocional real en charlas privadas de ~10 minutos, con calidez humana y respeto.
Reglas de interacción:
- Presentate solo en tu primer mensaje con algo breve y cálido. Ej: "Hola, soy TempoChat, gracias por escribirme. ¿Cómo te llamás?"
- Pedí el nombre una sola vez (en ese primer mensaje). Si el usuario ya lo dijo antes, no lo vuelvas a pedir.
- Usá el nombre ocasionalmente y de forma natural (p. ej. "Nicolás, creo que..."), sin abusar.
- Validá emociones, hacé preguntas abiertas y devolvé reflejos breves de lo que la persona cuenta.
- Respuestas cortas, claras y profundas: 4 a 6 frases por mensaje. Evitá párrafos largos.
- Tono cálido, humano, sin juicios, con optimismo realista (reconocer el dolor y la posibilidad de crecer).
- Podés usar pausas y metáforas simples si ayudan a pensar; evitá jerga técnica.
- No des diagnósticos médicos/clinicos ni consejos financieros/legales. No pidas datos personales sensibles.
- Respondé en español rioplatense.
`.trim();

    // ===== Memoria de 10′ por sessionToken (Redis) con fallback =====
    let history = [];
    try {
      const stored = await redisGet(sessionToken); // string o null
      history = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(history)) history = [];
    } catch (e) {
      console.error('history_load_error', e);
      history = []; // fallback sin memoria
    }

    // Armar messages con historial
    const messages = [
      { role: 'system', content: sys },
      ...history,
      { role: 'user', content: message }
    ];

    // Llamada a OpenAI
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000); // 8s timeout
    const oaRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,
        max_tokens: 280,
        messages
      }),
      signal: controller.signal
    }).catch((e) => {
      if (e.name === 'AbortError') throw new Error('timeout_openai');
      throw e;
    });
    clearTimeout(t);

    if (!oaRes.ok) {
      const txt = await oaRes.text().catch(() => '');
      console.error('openai_bad_status', oaRes.status, txt);
      return bad(res, 'openai_error', txt || (`OpenAI status ${oaRes.status}`), 502);
    }

    const data = await oaRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim()
      || 'Hola, soy TempoChat. ¿Cómo te llamás? Contame qué te gustaría trabajar hoy.';

    // Actualizar historial (si Redis está ok) – si falla, seguimos igual
    try {
      history.push({ role: 'user', content: message });
      history.push({ role: 'assistant', content: reply });
      await redisSetEx(sessionToken, JSON.stringify(history), 600);
    } catch (e) {
      console.error('history_save_error', e);
    }

    return ok(res, { reply, remainingSeconds: remaining });
  } catch (e) {
    console.error('chat_handler_error', e);
    if (e.message === 'timeout_openai') return bad(res, 'timeout', 'El servicio está lento. Probá de nuevo.', 504);
    return bad(res, 'server_error', 'Error interno de servidor', 500);
  }
}
