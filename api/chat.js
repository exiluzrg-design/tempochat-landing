// file: api/chat.js
// ============================================================================
// 🛡️ NO TOCAR – ZONA BLINDADA DE FUNCIONAMIENTO / MEMORIA / PRIVACIDAD
// Este endpoint:
// 1) Mantiene la memoria basada en sessionId + context SIN cambios.
// 2) NUNCA guarda texto completo del usuario ni del asistente.
// 3) Solo loguea TAGS (categorías) derivadas del texto del usuario.
// 4) Responde primero al cliente y luego loguea en background (menor latencia).
// ============================================================================

import crypto from 'node:crypto';

const OPENAI_URL   = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

// ============================================================================
// 🏷️ EXTRACCIÓN DE TAGS (simple y determinista)
// - Editá el listado TAGS si querés ampliar categorías.
// - Jamás devuelve el texto original, solo categorías detectadas.
// ============================================================================
const TAGS = [
  'ansiedad','estrés','angustia','soledad','tristeza','autoestima',
  'pareja','infidelidad','ruptura','divorcio','celos','amor',
  'familia','amigos','conflicto','duelo',
  'trabajo','dinero','deudas','ahorro','desempleo',
  'proyectos','motivación','hábitos','salud','sueño','adicciones',
  'futuro','decisiones','miedo','culpa','vergüenza','ira'
];

function extractTags(text = '') {
  const lower = String(text).toLowerCase();
  const found = TAGS.filter(tag => lower.includes(tag));
  // eliminamos duplicados por si hay solapamientos
  return Array.from(new Set(found));
}

// ============================================================================
// 🔒 LOG ASÍNCRONO (NO BLOQUEANTE) A SUPABASE
// - Si no hay credenciales, no hace nada (NO-OP).
// - Guarda SOLO tags en el campo `content` para compatibilidad con `public.messages`.
//   Si preferís una tabla `public.tags` con columna `tags jsonb`, adaptá aquí.
// ============================================================================
async function logToSupabaseSafe(payload) {
  try {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return; // No-op si faltan credenciales

    await fetch(`${url}/rest/v1/messages`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(payload)
    }).then(r => r.text()).catch(()=>{});
  } catch {}
}

// ============================================================================
// 🧱 UTILIDADES
// ============================================================================
function bad(res, code, msg, status = 400) {
  return res.status(status).json({ error: code, message: msg });
}

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

// ============================================================================
// 🚀 HANDLER
// ============================================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return bad(res, 'method_not_allowed', 'Use POST', 405);
  }

  try {
    const { text, sessionId, context } = await readBody(req);
    const userText = (text ?? '').toString().trim();
    if (!userText) return bad(res, 'no_text', 'Falta el texto del usuario.');

    // 🛡️ NO TOCAR – SESIÓN / MEMORIA (cliente + backend con sessionId)
    const sid = sessionId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    const safeContext = Array.isArray(context) ? context.slice(-12) : [];

    const messages = [
      { role: 'system', content: 'Sos TempoChat: breve, empático y claro.' },
      ...safeContext,
      { role: 'user', content: userText }
    ];

    // Llamada a OpenAI (sin streaming; endpoint clásico)
    const r = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages
      })
    });

    if (!r.ok) {
      const body = await r.text();
      // Respondemos rápido con error del modelo
      res.status(502).json({ error: 'openai_error', message: body, sessionId: sid });

      // Log asíncrono de error: NUNCA guarda texto; solo marca error
      setTimeout(() => {
        logToSupabaseSafe({
          session_id: sid,
          role: 'error',
          // Guardamos una etiqueta de error en content (sin texto de usuario)
          content: 'openai_error',
          created_at: new Date().toISOString()
        }).catch(()=>{});
      }, 0);
      return;
    }

    const json = await r.json();
    const answer = json?.choices?.[0]?.message?.content?.trim() || '…';

    // ✨ Respondemos de inmediato (mejor TTFB)
    res.status(200).json({ message: answer, sessionId: sid });

    // 📝 Log en background: SOLO TAGS (NUNCA texto)
    setTimeout(() => {
      // 1) Extraemos tags del texto del usuario
      const tags = extractTags(userText);
      const contentForDB = tags.length ? tags.join(',') : null; // sin corchetes, sin texto

      // 2) Registramos el "turno" del usuario con tags
      logToSupabaseSafe({
        session_id: sid,
        role: 'user',
        content: contentForDB,               // ← SOLO TAGS o null
        created_at: new Date().toISOString()
      }).catch(()=>{});

      // 3) (Opcional) Registrar respuesta del assistant SIN texto.
      //    Si querés una marca mínima, dejamos una etiqueta fija:
      logToSupabaseSafe({
        session_id: sid,
        role: 'assistant',
        content: 'respuesta_generada',       // ← marcador genérico, sin contenido
        created_at: new Date().toISOString()
      }).catch(()=>{});

    }, 0);

  } catch (e) {
    console.error(e);
    return bad(res, 'server_error', 'Hubo un problema del lado del servidor.', 500);
  }
}

// ============================================================================
// FIN – 🛡️ NO TOCAR – ZONA BLINDADA DE FUNCIONAMIENTO / MEMORIA / PRIVACIDAD
// ============================================================================
