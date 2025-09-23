// api/chat.js — Memoria "como antes" (context desde el front) + fallback a Redis + tags en Supabase
export const config = { runtime: 'nodejs' };

import { randomUUID } from 'crypto';

const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';

/* -------------------- utils -------------------- */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') { try { return JSON.parse(req.body); } catch {} }
  return await new Promise((resolve) => {
    let data=''; req.on('data', c=>data+=c); req.on('end', ()=>{ try{ resolve(JSON.parse(data||'{}')); }catch{ resolve({}); } });
  });
}
function respond(res, status, data) { res.status(status).setHeader('Content-Type','application/json'); res.end(JSON.stringify(data)); }

async function insertMessages(rows) {
  if (!SB_URL || !SB_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${SB_URL}/rest/v1/messages`, {
    method:'POST',
    headers:{ apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!r.ok) throw new Error(`insertMessages ${r.status}: ${await r.text()}`);
}

/* -------------------- Redis (fallback) -------------------- */
async function redis(command, ...args) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) throw new Error('Missing Upstash credentials');
  const r = await fetch(UPSTASH_URL, {
    method:'POST',
    headers:{ Authorization:`Bearer ${UPSTASH_TOKEN}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ command, args })
  });
  if (!r.ok) throw new Error(`Redis ${command} ${r.status}: ${await r.text()}`);
  const j = await r.json(); return j.result;
}
async function pushHistory(sessionId, role, content) {
  try {
    const key = `chat:${sessionId}`;
    const item = JSON.stringify({ role, content, t: Date.now() });
    await redis('LPUSH', key, item);
    await redis('LTRIM', key, 0, 11); // máx 12 items
  } catch(e) { /* si falla Redis, no frenamos el chat */ }
}
async function getHistory(sessionId, max=12) {
  try {
    const key = `chat:${sessionId}`;
    const arr = await redis('LRANGE', key, 0, max-1);
    return arr.reverse().map(s => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean);
  } catch(e) {
    return []; // sin Redis o error → sin historial
  }
}

/* -------------------- prompt -------------------- */
const SYSTEM_PROMPT = `
Sos un psicólogo con mucha calle y años de experiencia.
No sos tibio: decís lo que nadie se anima a decir, con honestidad brutal para que la persona despierte.
Hablás directo, frases cortas, cero tecnicismos. Si hay autoengaño, lo marcás al toque.
Nunca cierres siempre igual: remate breve, filoso y conectado al tema.
Cuando respondas para el sistema, devolveme SOLO un JSON con:
{
  "reply": "máx 6 frases, tono callejero y claro",
  "user_tags": ["3-5 tags en minúsculas"],
  "assistant_tags": ["3-5 tags en minúsculas"]
}
NO agregues explicación fuera del JSON.
`;

/* -------------------- handler -------------------- */
export default async function handler(req, res) {
  if (req.method === 'GET') {
    return respond(res, 200, {
      ok: true,
      stage: 'memoria-front+redis',
      env: {
        openai: !!OPENAI_KEY,
        supabase: !!(SB_URL && SB_KEY),
        upstash_url: !!UPSTASH_URL,
        upstash_token: !!UPSTASH_TOKEN
      },
      hint: 'POST /api/chat con { text, sessionId, context? }'
    });
  }
  if (req.method !== 'POST') return respond(res, 405, { error:'method_not_allowed', message:'Use POST' });

  try {
    if (!OPENAI_KEY) return respond(res, 500, { error:'no_openai_key', message:'Falta OPENAI_API_KEY' });

    const body = await readBody(req);

    // 1) inputs
    const text = (body.text ?? '').toString().trim();
    if (!text) return respond(res, 400, { error:'no_text', message:'Falta "text"' });

    const sessionId = (body.sessionId || '').toString().trim() || randomUUID();

    // 2) MEMORIA: primero usamos el "método anterior": context desde el FRONT
    //    body.context = [{role:'user'|'assistant', content:'...'}, ...]
    let contextFromFront = Array.isArray(body.context) ? body.context : [];
    // saneamos y acotamos (máx 12)
    contextFromFront = contextFromFront
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12);

    let contextMessages = contextFromFront.map(m => ({ role: m.role, content: m.content }));

    // 3) Si el front NO mandó contexto, probamos Redis (fallback)
    if (contextMessages.length === 0 && UPSTASH_URL && UPSTASH_TOKEN) {
      const history = await getHistory(sessionId, 12);
      contextMessages = history.map(h => ({
        role: h.role === 'assistant' ? 'assistant' : 'user',
        content: h.content || ''
      }));
    }

    // 4) OpenAI (pedimos JSON: reply + tags)
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model:'gpt-4o-mini',                // si tu cuenta lo pide, podés usar 'gpt-4o'
        response_format:{ type:'json_object' },
        messages:[
          { role:'system', content: SYSTEM_PROMPT },
          ...contextMessages,
          { role:'user', content: text }
        ],
        temperature:0.9,
        max_tokens:400
      })
    });

    if (!r.ok) {
      const t = await r.text();
      console.error('[openai_error]', r.status, t);
      return respond(res, 200, { sessionId, message: `⚠️ OpenAI ${r.status}: ${t}` });
    }

    const j = await r.json();
    let payload = {};
    try { payload = JSON.parse(j?.choices?.[0]?.message?.content || '{}'); } catch {}
    const reply = (payload.reply || 'Decime en claro qué pasa y vamos al grano.').trim();
    const user_tags = Array.isArray(payload.user_tags) ? payload.user_tags : [];
    const assistant_tags = Array.isArray(payload.assistant_tags) ? payload.assistant_tags : [];

    // 5) Persistencia de memoria (solo si NO vino del front, así no duplicamos)
    //    - Si el front ya mantiene y envía contexto, no hace falta guardar en Redis.
    if (contextFromFront.length === 0 && UPSTASH_URL && UPSTASH_TOKEN) {
      await Promise.allSettled([
        pushHistory(sessionId, 'user', text),
        pushHistory(sessionId, 'assistant', reply)
      ]);
    }

    // 6) Guardar SOLO TAGS en Supabase (sin texto)
    if (SB_URL && SB_KEY) {
      await insertMessages([
        { session_id: sessionId, role:'user',      content:null, tags:user_tags,      meta:{ src:'api' } },
        { session_id: sessionId, role:'assistant', content:null, tags:assistant_tags, meta:{ src:'api' } }
      ]);
    }

    // 7) Respuesta al front (sin corchetes)
    return respond(res, 200, { sessionId, message: reply });
  } catch (e) {
    console.error('[chat_handler_error]', e);
    return respond(res, 500, { error:'server_error', message:String(e) });
  }
}
