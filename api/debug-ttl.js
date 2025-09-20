// api/debug-ttl.js
import { redis } from '../lib/redis.js';
import { redisKeyChat, redisKeyFacts } from '../utils/session.js';


export default async function handler(req, res) {
const { sessionId } = req.query || {};
if (!sessionId) return res.status(400).json({ error: 'Falta sessionId' });


try {
const ttlChat = await redis.ttl(redisKeyChat(sessionId));
const ttlFacts = await redis.ttl(redisKeyFacts(sessionId));
return res.status(200).json({ sessionId, ttlChat, ttlFacts });
} catch (e) {
console.error(e);
return res.status(500).json({ error: e?.message || 'Error' });
}
}
