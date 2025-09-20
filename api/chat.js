// file: api/chat.js
import jwt from 'jsonwebtoken';

function demoReply(text) {
  const t = (text || '').toLowerCase();
  if (t.includes('ansio') || t.includes('nerv')) {
    return 'Respiremos juntos: inhalá 4, retené 4, exhalá 6. Repetilo 3 veces. ¿Querés un mini plan de 10 minutos?';
  }
  if (t.includes('dorm') || t.includes('sueñ')) {
    return 'Probemos higiene de sueño: 1) Pantallas off 30′ antes, 2) Luz tenue, 3) Respiración 4-4-6, 4) Pensamiento ancla.';
  }
  if (t.includes('discus') || t.includes('enojo') || t.includes('pelea')) {
    return 'Es normal quedar removido. ¿Preferís desahogarte o buscar palabras para reparar cuando estés listo?';
  }
  if (t.includes('soltar') || t.includes('triste') || t.includes('dolor')) {
    return 'Nombrar la emoción ayuda. ¿Dónde la sentís en el cuerpo? Si querés, hacemos un ejercicio breve ahora.';
  }
  if (t.includes('precio') || t.includes('pagar') || t.includes('mercado pago')) {
    return 'Pronto activamos pagos por Mercado Pago para sesiones de 10 minutos. Por ahora, demo gratuita.';
  }
  return 'Te leo. ¿Qué te gustaría que cambie en los próximos 10 minutos?';
}

function ok(res, data) {
  res.status(200).json(data);
}
function bad(res, code, msg, status = 400) {
  res.status(status).json({ error: code, message: msg });
}

// Lee y parsea el body robustamente (JSON o string)
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { /* sigue */ }
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return bad(res, 'method_not_allowed', 'Method not allowed', 405);

    const secret = process.env.SESSION_JWT_SECRET;
    if (!secret) return bad(res, 'missing_secret', 'Missing SESSION_JWT_SECRET', 500);

    const body = await readBody(req);
    const { message, sessionToken } = body || {};

    if (!message || typeof message !== 'string') return bad(res, 'no_message', 'Falta message');
    if (!sessionToken) return bad(res, 'no_session', 'Falta sessionToken');

    let decoded;
    try {
      decoded = jwt.verify(sessionToken, secret, { algorithms: ['HS256'] });
    } catch (e) {
      return bad(res, 'invalid_session', e.message.includes('expired') ? 'La sesión de 10 minutos terminó' : e.message);
    }

    const now = Math.floor(Date.now() / 1000);
    const remaining = Math.max(0, (decoded.exp || 0) - now);
    if (remaining <= 0) return bad(res, 'session_expired', 'La sesión de 10 minutos terminó');

    const reply = demoReply(message);
    return ok(res, { reply, remainingSeconds: remaining });
  } catch (e) {
    // Log interno y respuesta clara al cliente
    console.error('chat_handler_error', e);
    return bad(res, 'server_error', 'Error interno de servidor', 500);
  }
}
