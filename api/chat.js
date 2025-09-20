// Endpoint de chat DEMO: valida sesión de 10′ y responde con reglas locales.
return 'Respiremos juntos: inhalá 4, retené 4, exhalá 6. Repetilo 3 veces. ¿Querés un mini plan de 10 minutos?';
}
if (t.includes('dorm') || t.includes('sueñ')) {
return 'Probemos una higiene de sueño: 1) Pantallas off 30′ antes, 2) Luz tenue, 3) Respiración 4-4-6, 4) Pensamiento ancla amable.';
}
if (t.includes('discus') || t.includes('enojo') || t.includes('pelea')) {
return 'Es normal quedar removido. ¿Preferís desahogarte o buscar palabras para reparar cuando estés listo?';
}
if (t.includes('soltar') || t.includes('triste') || t.includes('dolor')) {
return 'Nombrar la emoción ayuda. ¿Dónde la sentís en el cuerpo? Te acompaño con un ejercicio breve si querés.';
}
if (t.includes('precio') || t.includes('pagar') || t.includes('mercado pago')) {
return 'Pronto activamos pagos por Mercado Pago para sesiones de 10 minutos. Por ahora, esta es una demo gratuita.';
}
return 'Te leo. ¿Qué querés que cambie en los próximos 10 minutos?';
}


function ok(res, data) { return res.status(200).json(data); }
function bad(res, code, msg) { return res.status(400).json({ error: code, message: msg }); }


export default async function handler(req, res) {
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


const { message, sessionToken } = req.body || {};
if (!message || typeof message !== 'string') return bad(res, 'no_message', 'Falta message');
if (!sessionToken) return bad(res, 'no_session', 'Falta sessionToken');


const secret = process.env.SESSION_JWT_SECRET;
if (!secret) return res.status(500).json({ error: 'Missing SESSION_JWT_SECRET' });


try {
const decoded = jwt.verify(sessionToken, secret, { algorithms: ['HS256'] });
const now = Math.floor(Date.now() / 1000);
const remaining = Math.max(0, decoded.exp - now);
if (remaining <= 0) return bad(res, 'session_expired', 'La sesión de 10 minutos terminó');


// Aquí iría la IA real (OpenAI, etc.). DEMO:
const reply = demoReply(message);
return ok(res, { reply, remainingSeconds: remaining });
} catch (e) {
return bad(res, 'invalid_session', e.message);
}
}
