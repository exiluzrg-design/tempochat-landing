// api/chat.js — ETAPA 1 (MOCK) — sin OpenAI ni Supabase
export const config = { runtime: 'nodejs' };

const STAGE = 'etapa1-mock';

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch {} }
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

function respond(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

// Respuesta simple en tono directo (mock)
function mockReply(userText = '') {
  const t = (userText || '').toLowerCase();
  if (t.includes('infiel')) return 'Uhh, te la mandaste. O lo contás y bancás la tormenta, o lo callás y cargás la mochila vos solo. Elegí.';
  if (t.includes('ansiedad')) return 'La ansiedad te come la cabeza. Hoy 3 minutos de respiración 4-6; mañana 20’ de caminata sin pantalla.';
  if (t.includes('pareja') || t.includes('separar')) return 'Si está floja, dos caminos: hablar en serio y buscar arreglo, o cortar por lo sano. Aferrarte por miedo no sirve.';
  return 'Te escucho. Decime en una línea qué te preocupa y vamos directo a opciones.';
}

export default async function handler(req, res) {
  // GET: mostrar “banner” de versión para confirmar que este archivo está vivo
  if (req.method === 'GET') {
    return respond(res, 200, { ok: true, stage: STAGE, hint: 'Usá POST para chatear' });
  }

  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'method_not_allowed', message: 'Use POST', stage: STAGE });
  }

  try {
    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error: 'no_text', message: 'Falta "text"', stage: STAGE });

    const reply = mockReply(text);

    // Respuesta que tu front ya espera
    return respond(res, 200, { sessionId: 'mock-session', message: reply, stage: STAGE });
  } catch (e) {
    console.log('[chat_mock_error]', e);
    return respond(res, 500, { error: 'server_error', message: String(e), stage: STAGE });
  }
}
