
// api/chat.js
import { createClient } from '@supabase/supabase-js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    // Supabase opcionalmente activo (si faltara env, igual responde el chat sin memoria)
    const supabase = (SUPABASE_URL && SERVICE_KEY)
      ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
      : null;

    // Generar sessionId si no vino del cliente
    if (!sessionId) {
      const { randomUUID } = await import('crypto');
      sessionId = randomUUID();
    }

    // 1) Guardar mensaje del usuario
    if (supabase) {
      await supabase.from('messages').insert({ session_id: sessionId, role: 'user', content: userText });
    }

    // 2) Cargar historial (últimos 30)
    let history = [];
    if (supabase) {
      const { data, error } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(30);
      if (!error && data) {
        history = data.map(m => ({ role: m.role, content: m.content }));
      }
    }


    // 3) TEMP: saltear OpenAI y responder fijo para aislar el problema
const assistantText = `Test OK: recibí "${userText}" y quedó guardado.`;


    // 4) Guardar respuesta del asistente
    if (supabase) {
      await supabase.from('messages').insert({ session_id: sessionId, role: 'assistant', content: assistantText });
    }

    // 5) Devolver al frontend
    return res.status(200).json({ ok: true, sessionId, message: assistantText });
  } catch (e) {
    console.error('[chat handler]', e);
    return res.status(500).json({ ok: false, error: 'server_error' });
  }
}
