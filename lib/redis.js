// lib/redis.js
import { Redis } from '@upstash/redis';


// Si preferís Vercel KV, podés usar: import { createClient } from '@vercel/kv'
// y adaptar las llamadas (get, set, lpush, lrange, expire, ltrim) en api/chat.js.


if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
console.warn('[redis] Falta configurar UPSTASH_REDIS_* en variables de entorno');
}


export const redis = new Redis({
url: process.env.UPSTASH_REDIS_REST_URL,
token: process.env.UPSTASH_REDIS_REST_TOKEN
});
