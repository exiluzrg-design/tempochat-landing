// Etapa 2 — api/chat.js
export default async function handler(req, res) {
  const response = (obj) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(obj);
  };

  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method not allowed' });
    }

    // Parseo defensivo
    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch { body = {}; }

    const text = (body.text || '').toString();
    let sessionId = (body.sessionId || '').toString().trim();
    if (!sessionId) {
      sessionId = (globalThis.crypto?.randomUUID?.() || 'sid-' + Math.random().toString(36).slice(2));
    }

    // Respuesta local simple (sin OpenAI todavía)
    const reply = text
      ? 'Te leo. Si lo decís en una oración, ¿qué te gustaría cambiar primero?'
      : 'Estoy acá. Contame en una oración qué te preocupa y vemos un paso chiquito para hoy.';

    return response({ ok: true, stage: 2, sessionId, message: reply });
  } catch (e) {
    return res.status(200).json({ ok: false, stage: 2, error: e?.message || 'server error' });
  }
}
