// Etapa 1 — api/chat.js
export default async function handler(req, res) {
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

    let body = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } catch {
      body = {};
    }

    return res.status(200).json({
      ok: true,
      stage: 1,
      echo: body,
      note: 'API viva y respondiendo 200',
    });
  } catch (e) {
    // NUNCA 500: siempre 200 con error
    return res.status(200).json({ ok: false, stage: 1, error: e?.message || 'server error' });
  }
}
