// utils/session.js
export function ensureSessionId(idFromClient) {
const id = (idFromClient || '').trim();
if (!id || id.length < 8) {
return 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
return id;
}


export function redisKeyChat(sessionId) {
return `tc:chat:${sessionId}`; // lista historial
}


export function redisKeyFacts(sessionId) {
return `tc:mem:${sessionId}`; // blob de hechos
}


export function extractFactsHeuristics(userText = '') {
const facts = [];
const name = userText.match(/\bme llamo\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,})/i)?.[1]?.trim();
if (name) facts.push(`Nombre: ${name}`);


const like = userText.match(/\b(me gusta|prefiero|soy fan de)\s+([^.,;]+)/i)?.[2]?.trim();
if (like) facts.push(`Preferencias: ${like}`);


const goal = userText.match(/\b(mi objetivo|quiero lograr|necesito)\s+([^.,;]+)/i)?.[2]?.trim();
if (goal) facts.push(`Objetivo: ${goal}`);


const city = userText.match(/\bsoy de\s+([^.,;]+)/i)?.[1]?.trim();
if (city) facts.push(`Ciudad: ${city}`);


const deadline = userText.match(/\b(antes de|para el|hasta el)\s+([0-9]{1,2}\/[0-9]{1,2}|[A-Za-zÁÉÍÓÚÑ]+\s+\d{1,2})/i)?.[2]?.trim();
if (deadline) facts.push(`Deadline: ${deadline}`);


return facts;
}
