// file: api/chat.js
import jwt from 'jsonwebtoken';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // podés cambiarlo por env

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

    // Llamada a OpenAI (solo el mensaje actual, sin historial)
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 8000); // 8s
    const sys = "Sos Tempo, un acompañante emocional y espiritual breve, respetuoso, sin juicios. Respondé en español rioplatense, con frases cortas y pasos prácticos. Evitá consejos médicos.";

    const oaRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.7,
        max_tokens: 220,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: message }
        ]
      }),
      signal: controller.signal
    }).catch((e) => {
      if (e.name === 'AbortError') throw new Error('timeout_openai');
      throw e;
    });
    clearTimeout(t);

    if (!oaRes.ok) {
      const txt = await oaRes.text().catch(() => '');
      return bad(res, 'openai_error', txt || (`OpenAI status ${oaRes.status}`), 502);
    }

    const data = await oaRes.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'Estoy para acompañarte.';
    return ok(res, { reply, remainingSeconds: remaining });
  } catch (e) {
    console.error('chat_handler_error', e);
    if (e.message === 'timeout_openai') return bad(res, 'timeout', 'El servicio está lento. Probá de nuevo.', 504);
    return bad(res, 'server_error', 'Error interno de servidor', 500);
  }
}
