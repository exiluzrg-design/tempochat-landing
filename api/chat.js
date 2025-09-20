// api/chat.js
}


export default async function handler(req, res) {
if (req.method !== 'POST') return bad(res, 'method_not_allowed', 'Solo POST', 405);
if (!OPENAI_KEY) return bad(res, 'config', 'Falta OPENAI_API_KEY');


try {
const body = await readBody(req);
const { message, sessionId: clientSessionId, system, jwtToken } = body || {};


if (!message || typeof message !== 'string') {
return bad(res, 'invalid_input', 'Falta "message"');
}


if (jwtToken) {
try { jwt.verify(jwtToken, process.env.JWT_SECRET); }
catch { return bad(res, 'auth', 'JWT inválido', 401); }
}


const sessionId = ensureSessionId(clientSessionId);
const keyChat = redisKeyChat(sessionId);
const keyFacts = redisKeyFacts(sessionId);


// 1) Actualizar memoria de hechos (barata, heurística)
await upsertFacts(sessionId, message);


// 2) Cargar memoria de hechos y el historial
const mem = await redis.get(keyFacts);
const history = await loadHistory(keyChat);


// 3) Componer mensaje system con memoria inyectada
const memoryPrefix = mem ? `\n[MEMORIA (datos relevantes, no inventes)]:\n${mem}\n` : '';
const messages = [];
messages.push({
role: 'system',
content: (system || 'Sos TempoChat: una sesión privada y efímera de 10 minutos. Sé claro y práctico.') + memoryPrefix
});


for (const m of history) messages.push(m);
messages.push({ role: 'user', content: message });


// 4) Llamar a OpenAI
const r = await fetch(OPENAI_URL, {
method: 'POST',
headers: {
'Authorization': `Bearer ${OPENAI_KEY}`,
'Content-Type': 'application/json'
},
body: JSON.stringify({
model: OPENAI_MODEL,
messages,
temperature: 0.7
})
});


const data = await r.json();
if (!r.ok) {
return bad(res, 'openai_error', JSON.stringify(data, null, 2), r.status);
}


const assistant = data.choices?.[0]?.message?.content?.trim() || '…';
const assistantMsg = { role: 'assistant', content: assistant };
const userMsg = { role: 'user', content: message };


// 5) Guardar historial y renovar TTL (sliding)
await appendToHistory(keyChat, [assistantMsg, userMsg]);


return ok(res, { sessionId, reply: assistant, ttl: TTL_SECONDS });
} catch (e) {
console.error(e);
return bad(res, 'server_error', e?.message || 'Error inesperado', 500);
}
}
