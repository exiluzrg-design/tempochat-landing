// Etapa 3 — api/chat.js
export default async function handler(req, res) {
  const respond = (obj) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(obj);
  };

  try {
    // CORS y preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method not allowed' });
    }

    // Parseo defensivo del body
    let body = {};
    try {
      body = typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});
    } catch {
      body = {};
    }

    const text = (body.text || '').toString();
    let sessionId = (body.sessionId || '').toString().trim();
    if (!sessionId) {
      sessionId = (globalThis.crypto?.randomUUID?.() || 'sid-' + Math.random().toString(36).slice(2));
    }

    // Respuesta base (por si no hay OpenAI o falla)
    let reply = text
      ? 'Te sigo. Si tuvieras que nombrar el obstáculo en una frase, ¿cuál sería?'
      : 'Arranquemos con lo que te preocupa en una oración.';

    // ----- OpenAI opcional con timeout + fallback -----
    if (process.env.OPENAI_API_KEY) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 15000); // 15s de timeout

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 220,
            messages: [
              { role: 'system', content: 'Hablá con conocimiento psicológico y olfato de calle; tono cálido rioplatense, directo y cercano. No digas tu profesión.' },
              { role: 'user', content: text || 'ping' },
            ],
          }),
          signal: ctrl.signal,
        });

        clearTimeout(to);

        // Intentamos parsear con cuidado (puede venir HTML en errores)
        const raw = await r.text();
        let data; try { data = JSON.parse(raw); } catch { data = { raw }; }

        if (r.ok && data?.choices?.[0]?.message?.content) {
          reply = String(data.choices[0].message.content).trim();
        } else {
          // No rompemos: dejamos el reply base y agregamos pista de error en debug opcional
          // console.log('openai not ok:', data?.error || data?.raw || r.statusText);
        }
      } catch (e) {
        // Timeout o red: mantenemos reply base
        // console.log('openai error:', e?.message || e);
      }
    }

    return respond({ ok: true, stage: 3, sessionId, message: reply });
  } catch (e) {
    // Nunca 500
    return res.status(200).json({ ok: false, stage: 3, error: e?.message || 'server error' });
  }
}
