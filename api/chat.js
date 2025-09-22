// api/chat.js
import { createClient } from '@supabase/supabase-js';

const VERSION = 'v-2025-09-22-compat';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_HISTORY_MESSAGES = 20;
const MAX_RESPONSE_TOKENS = 400;
const TEMPERATURE = 0.7;

const SYSTEM_PROMPT = `
Eres TempoChat: un asistente breve, cálido y directo.
- Responde en español rioplatense.
- Sé empático y práctico: da pasos claros o síntesis accionable.
- Si el usuario divaga, ayudalo a ordenar ideas en bullets.
- Evitá rodeos y respuestas demasiado largas.
`;

function setCommonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // CORS permisivo para testear desde cualquier origen
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  try {
    setCommonHeaders(res);

    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({
        ok: false,
        version: VERSION,
        error: 'method_not_allowed',
        message: 'Usá POST en /api/chat',
        assistant: 'Usá POST en /api/chat',
        debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(SUPABASE_URL && SERVICE_KEY) }
      });
    }

    // Body robusto (acepta userText | message | text)
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const userText = (body?.userText ?? body?.message ?? body?.text ?? '').toString().trim();
    let sessionId = (body?.sessionId ?? '').toString().trim();

    if (!userText) {
      return res.status(400).json({
        ok: false,
        version: VERSION,
        error: 'no_text',
        message: 'Falta texto',
        assistant: 'Falta texto',
        debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(SUPABASE_URL && SERVICE_KEY) }
      });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({
        ok: false,
        version: VERSION,
        error: 'no_api_key',
        message: 'Falta OPENAI_API_KEY',
        assistant: 'Falta OPENAI_API_KEY',
        debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(SUPABASE_URL && SERVICE_KEY) }
      });
    }

    const supabase = (SUPABASE_URL && SERVICE_KEY)
      ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
      : null;

    // sessionId si no vino del cliente
    if (!sessionId) {
      const { randomUUID } = await import('crypto');
      sessionId = randomUUID();
    }

    // 1) Guardar mensaje del usuario
    if (supabase) {
      await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content: userText });
    }

    // 2) Cargar historial (limitado)
    let history = [];
    if (supabase) {
      const { data, error } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(MAX_HISTORY_MESSAGES);

      if (!error && data) {
        history = data.map(m => ({ role: m.role, content: m.content }));
      } else {
        console.warn('[chat] supabase history error:', error);
      }
    }

    // 3) Armar messages[] para OpenAI (system + history + user actual)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: userText },
    ];

    // 4) Llamar a OpenAI
    const openaiResp = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_RESPONSE_TOKENS
      })
    });

    const rawText = await openaiResp.text();
    console.log('OpenAI raw response:', rawText);

    if (!openaiResp.ok) {
      // Guardar fallback corto para que el hilo no quede sin cierre
      const fallback = 'Hubo un problema generando la respuesta. Probá de nuevo en un momento.';
      if (supabase) {
        await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: fallback });
      }
      return res.status(502).json({
        ok: false,
        version: VERSION,
        sessionId,
        error: 'openai_error',
        message: fallback,
        assistant: fallback,
        body: rawText,
        debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(supabase) }
      });
    }

    let json;
    try {
      json = JSON.parse(rawText);
    } catch (err) {
      const fallback = 'Respuesta inválida del proveedor de IA.';
      if (supabase) {
        await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: fallback });
      }
      return res.status(502).json({
        ok: false,
        version: VERSION,
        sessionId,
        error: 'invalid_json',
        message: fallback,
        assistant: fallback,
        body: rawText,
        debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(supabase) }
      });
    }

    const assistantText = json?.choices?.[0]?.message?.content?.trim();
    if (!assistantText) {
      const fallback = 'No llegó contenido desde el modelo.';
      if (supabase) {
        await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: fallback });
      }
      return res.status(502).json({
        ok: false,
        version: VERSION,
        sessionId,
        error: 'no_content',
        message: fallback,
        assistant: fallback,
        body: json,
        debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(supabase) }
      });
    }

    // 5) Guardar respuesta del asistente
    if (supabase) {
      await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: assistantText });
    }

    // 6) Responder (compat: message + assistant)
    return res.status(200).json({
      ok: true,
      version: VERSION,
      sessionId,
      message: assistantText,
      assistant: assistantText,
      debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(supabase) }
    });
  } catch (e) {
    console.error('[chat handler]', e);
    const msg = 'Error interno del servidor.';
    return res.status(500).json({
      ok: false,
      version: VERSION,
      error: 'server_error',
      message: msg,
      assistant: msg,
      detail: e?.message || String(e),
      debug: { usedModel: OPENAI_MODEL, hasSupabase: Boolean(SUPABASE_URL && SERVICE_KEY) }
    });
  }
}
