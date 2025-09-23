// api/chat.js — Etapa 1 (mock)
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

// Respuesta “psicólogo directo” en mock, sin OpenAI
function mockReply(userText = '') {
  const t = (userText || '').toLowerCase();

  if (t.includes('infiel') || t.includes('enga')) {
    return "Uhh, te la mandaste. No está bien y lo sabés. O lo contás y te bancás la tormenta, o lo callás y cargás la mochila vos solo. Elegí qué peso podés llevar.";
  }
  if (t.includes('ansiedad') || t.includes('ansioso')) {
    return "Sí, la ansiedad te come la cabeza. Dos pasos: hoy respirá 4–6 por 3 minutos; mañana 20’ de caminata sin pantalla. Corto y al pie.";
  }
  if (t.includes('pareja') || t.includes('separ') || t.includes('dejar')) {
    return "Si la relación está floja, hay dos caminos: hablar en serio y ver si hay arreglo, o cortar por lo sano. Aferrarte por miedo no es plan.";
  }
  return "Te escucho. Decime en una línea qué te preocupa y vamos directo a opciones. Sin vueltas.";
}

export default async function handler(req, res) {
  // Solo POST
  if (req.method !== 'POST') {
    return respond(res, 405, { error: 'method_not_allowed', message: 'Use POST' });
  }

  try {
    const body = await readBody(req);
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error: 'no_text', message: 'Falta "text"' });

    const reply = mockReply(text);

    // En Etapa 1 no hay session ni storage: devolvemos solo el mensaje
    return respond(res, 200, { message: reply });
  } catch (e) {
    console.log('[chat_mock_error]', e);
    return respond(res, 500, { error: 'server_error', message: String(e) });
  }
}
