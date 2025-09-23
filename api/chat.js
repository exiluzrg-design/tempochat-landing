// api/chat.js — Etapa 1 (mock, responde directo al front)
export const config = { runtime: 'nodejs' };

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

function mockReply(userText = '') {
  const t = (userText || '').toLowerCase();

  if (t.includes('infiel')) {
    return "Uhh, te la mandaste. No estuvo bien y lo sabés. O lo contás y bancás las consecuencias, o lo callás y cargás la mochila solo. Elegí.";
  }
  if (t.includes('ansiedad')) {
    return "La ansiedad te come la cabeza. Dos pasos: hoy respirá 4-6 por 3 minutos; mañana 20’ de caminata sin pantalla. Corto y al pie.";
  }
  if (t.includes('pareja') || t.includes('separar')) {
    return "Si la relación está floja, hay dos caminos: hablar en serio y ver si hay arreglo, o cortar por lo sano. Aferrarte por miedo no sirve.";
  }
  return "Te escucho. Decime en una línea qué te preocupa y vamos directo a opciones.";
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'method_not_allowed', message: 'Use POST' });
  }

  try {
    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error: 'no_text', message: 'Falta \"text\"' });

    const reply = mockReply(text);

    // Devolvemos lo que tu front espera (sessionId + message)
    return respond(res, 200, {
      sessionId: "mock-session",
      message: reply
    });
  } catch (e) {
    console.log('[chat_mock_error]', e);
    return respond(res, 500, { error: 'server_error', message: String(e) });
  }
}
