// api/chat.js
import { createClient } from '@supabase/supabase-js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ---- Configuración de memoria y generación ----
const MAX_HISTORY_MESSAGES = 20;          // cuántos mensajes anteriores reenvías a OpenAI
const MAX_RESPONSE_TOKENS = 400;          // tope de tokens de salida del modelo
const TEMPERATURE = 0.7;

// Prompt de sistema para “marcar” el tono de TempoChat
const SYSTEM_PROMPT = `
Eres TempoChat: un asistente breve, cálido y directo.
- Responde en español rioplatense.
- Sé empático y práctico: da pasos claros o síntesis accionable.
- Si el usuario divaga, ayudalo a ordenar ideas en bullets.
- Evitá rodeos y respuestas demasiado largas.
`;

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    // Body robusto (acepta userText | message | text)
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    const userText = (body?.userText ?? body?.message ?? body?.text ?? '').toString().trim();
    let sessionId = (body?.sessionId ?? '').toString().trim();

    if (!userText) {
      return res.status(400).json({ ok: false, error: 'no_text', message: 'Falta texto' });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ ok: false, error: 'no_api_key', message: 'Falta OPENAI_API_KEY' });
    }

    // Supabase opcional (si falta env, responde sin memoria persistente)
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
      }
    }

    // 3) Armar messages[] para OpenAI (system + history + user actual)
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,                                      // ya incluye los user/assistant previos
      { role: 'user', content: userText },             // mensaje actual
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

    // Manejo de errores de OpenAI (cuota, etc.)
    if (!openaiResp.ok) {
      const errText = await openaiResp.text().catch(() => '');
      // Guardar un “fallback” corto para que el usuario no quede sin respuesta
      const fallback = 'Perdón, hubo un problema al generar la respuesta. Probá de nuevo en un momento.';
      if (supabase) {
        await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: fallback });
      }
      return res.status(502).json({
        ok: false,
        error: 'openai_error',
        detail: errText || `HTTP ${openaiResp.status}`,
        message: fallback,
        sessionId
      });
    }

    const json = await openaiResp.json();
    const assistantText = json?.choices?.[0]?.message?.content?.trim() || '...';

    // 5) Guardar respuesta del asistente
    if (supabase) {
      await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: assistantText });
    }

    // 6) Devolver al frontend
    return res.status(200).json({ ok: true, sessionId, message: assistantText });
  } catch (e) {
    console.error('[chat handler]', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
