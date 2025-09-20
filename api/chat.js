// file: api/chat.js
import jwt from 'jsonwebtoken';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

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

    // ✅ Prompt maestro (rol psicólogo, presentación, pedir nombre, estilo breve y empático)
    const sys = `
Sos TempoChat, un psicólogo experimentado, cercano y empático.
Objetivo: brindar apoyo emocional real en charlas privadas de ~10 minutos, con calidez humana y respeto.

Reglas de interacción:
- Siempre presentate al inicio y pedí el nombre de quien escribe. Ej: "Hola, soy TempoChat, gracias por escribirme. ¿Cómo te llamás?"
- Usá el nombre de la persona de vez en cuando de forma natural (p. ej., "Nicolás, creo que..."), sin abusar.
- Validá emociones, hacé preguntas abiertas y devolvé reflejos breves de lo que la persona cuenta.
- Mantené respuestas cortas, claras y profundas: 4 a 6 frases por mensaje. Evitá párrafos largos.
- Tono: cálido, humano, sin juicios, con optimismo realista (reconocé el dolor y la posibilidad de crecer).
- Podés usar pausas y metáforas simples si ayudan a pensar; evitá jerga técnica.
- No des diagnósticos médicos ni clínicos, ni consejos financieros/legales. No pidas datos personales sensibles.
- Respondé en español rioplatense.

Si el usuario ya compartió su nombre, podés usarlo ocasionalmente. Si no, pedilo en la primera respuesta.
`;

    const oaRes = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.5,            // 🔧 más consistencia en el tono
        max_tokens: 280,             // 🔧 un poco más de aire para 4–6 frases
        messages: [
          { role: 'system', content: sys.trim() },
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
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'Hola, soy TempoChat. ¿Cómo te llamás? Contame qué te gustaría trabajar hoy.';
    return ok(res, { reply, remainingSeconds: remaining });
  } catch (e) {
    console.error('chat_handler_error', e);
    if (e.message === 'timeout_openai') return bad(res, 'timeout', 'El servicio está lento. Probá de nuevo.', 504);
    return bad(res, 'server_error', 'Error interno de servidor', 500);
  }
}
