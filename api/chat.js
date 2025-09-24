// file: api/chat.js
// ESM compatible con Vercel (Node 20)
import crypto from 'node:crypto';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

function bad(res, code, msg, status = 400) {
  return res.status(status).json({ error: code, message: msg });
}

// --- LOG ASÍNCRONO (fuera del camino crítico) ---
async function logToSupabaseSafe(payload) {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return; // No-op si no hay credenciales

    const resp = await fetch(`${url}/rest/v1/messages`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    // Ignoramos resultado; no queremos bloquear ni arrojar error
    await resp.text().catch(()=>{});
  } catch {}
}

// --- Cuerpo en JSON robusto ---
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch {}
  }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); }
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return bad(res, 'method_not_allowed', 'Use POST', 405);
  }

  try {
    const { text, sessionId, context } = await readBody(req);
    const userText = (text ?? '').toString().trim();
    if (!userText) return bad(res, 'no_text', 'Falta el texto del usuario.');

    // ⚠️ ZONA BLINDADA: sesión/memoria
    const sid = sessionId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const safeContext = Array.isArray(context) ? context.slice(-12) : [];
    const messages = [
      // Podés mantener tu prompt de sistema tal cual lo tengas.
      { role: 'system', content: 'Sos TempoChat: breve, empático y claro.' },
      ...safeContext,
      { role: 'user', content: userText }
    ];

    // Llamada a OpenAI
    const r = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        // sin streaming; endpoint clásico
      })
    });

    if (!r.ok) {
      const body = await r.text();
      // Respondemos rápido con el error del modelo
      res.status(502).json({ error: 'openai_error', message: body, sessionId: sid });
      // Log asíncrono del error
      setTimeout(() => {
        logToSupabaseSafe({
          session_id: sid,
          role: 'error',
          content: body.slice(0, 8000),
          meta: 'openai_error',
        });
      }, 0);
      return;
    }

    const json = await r.json();
    const answer = json?.choices?.[0]?.message?.content?.trim() || '…';

    // === Respondemos AL INSTANTE al cliente (no esperar logs) ===
    res.status(200).json({ message: answer, sessionId: sid });

    // === Punto 2: logging en background (no bloqueante) ===
    // Mover CUALQUIER escritura (user msg / assistant msg) acá abajo:
    setTimeout(() => {
      // Log de turno del usuario
      logToSupabaseSafe({
        session_id: sid,
        role: 'user',
        content: userText,
        created_at: new Date().toISOString()
      }).catch(()=>{});

      // Log de respuesta del assistant
      logToSupabaseSafe({
        session_id: sid,
        role: 'assistant',
        content: answer,
        created_at: new Date().toISOString()
      }).catch(()=>{});
    }, 0);

  } catch (e) {
    console.error(e);
    return bad(res, 'server_error', 'Hubo un problema del lado del servidor.', 500);
  }
}
