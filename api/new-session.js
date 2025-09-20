// Crea un token de sesión firmado que dura 10 minutos.
import jwt from 'jsonwebtoken';


const SESSION_SECONDS = 10 * 60; // 10 minutos


export default async function handler(req, res) {
if (req.method === 'OPTIONS') return res.status(200).end();
if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


const now = Math.floor(Date.now() / 1000);
const payload = { iat: now, // issued at
exp: now + SESSION_SECONDS, // vence en 10′
v: 1 };


try {
const secret = process.env.SESSION_JWT_SECRET;
if (!secret) return res.status(500).json({ error: 'Missing SESSION_JWT_SECRET' });


const token = jwt.sign(payload, secret, { algorithm: 'HS256' });
return res.status(201).json({ sessionToken: token, expiresIn: SESSION_SECONDS });
} catch (e) {
return res.status(500).json({ error: 'session_error', message: e.message });
}
}
