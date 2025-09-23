// Etapa 4 — api/chat.js
export default async function handler(req, res) {
  const respond = (obj) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(obj);
  };

  try {
    // CORS + preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method not allowed' });
    }

    // Parseo defensivo del body
    let body = {};
    try {
      body = typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});
    } catch { body = {}; }

    const text = (body.text || '').toString();
    let sessionId = (body.sessionId || '').toString().trim();
    if (!sessionId) {
      sessionId = (globalThis.crypto?.randomUUID?.() || 'sid-' + Math.random().toString(36).slice(2));
    }

    // Respuesta base (fallback local)
    let reply = text
      ? 'Te sigo. Si tuvieras que nombrar el obstáculo en una frase, ¿cuál sería?'
      : 'Arranquemos con lo que te preocupa en una oración.';

    // ----- OpenAI opcional (con timeout + fallback) -----
    let usedOpenAI = false;
    let openai_error = null;

    if (process.env.OPENAI_API_KEY) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 15000); // 15s

        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 220,
            messages: [
              { role: 'system', content: 'Hablá con conocimiento psicológico y olfato de calle; tono cálido rioplatense, directo y cercano. No digas tu profesión.' },
              { role: 'user', content: text || 'ping' },
            ],
          }),
          signal: ctrl.signal,
        });

        clearTimeout(to);

        const raw = await r.text();
        let data; try { data = JSON.parse(raw); } catch { data = { raw }; }

        if (r.ok && data?.choices?.[0]?.message?.content) {
          reply = String(data.choices[0].message.content).trim();
          usedOpenAI = true;
        } else {
          usedOpenAI = false;
          openai_error = data?.error?.message || r.statusText || 'openai not ok';
        }
      } catch (e) {
        usedOpenAI = false;
        openai_error = e?.message || 'openai timeout/network';
      }
    }

    // ----- Supabase opcional (privacy-first) -----
    // Por defecto NO guardamos texto: SAVE_TEXT=false
    const SAVE_TEXT = String(process.env.SAVE_TEXT || 'false').toLowerCase() === 'true';
    const hasSbUrl = !!process.env.SUPABASE_URL;
    const hasSbKey = !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);
    let saved = false;
    let supabase_error = null;

    // Pequeño extractor de tags (muy simple, para demo)
    function extractTags(s) {
      const tags = [];
      const lower = (s || '').toLowerCase();
      if (!lower) return tags;
      if (/\btrabajo|laburo|oficina|jefe|empleo\b/.test(lower)) tags.push('trabajo');
      if (/\bpareja|relación|amor|separación|novia|novio\b/.test(lower)) tags.push('vínculos');
      if (/\bansiedad|estrés|miedo|angustia|enojo\b/.test(lower)) tags.push('emociones');
      if (/\bdecisión|dudar|elección\b/.test(lower)) tags.push('decisiones');
      if (tags.length === 0) tags.push('general');
      return Array.from(new Set(tags)).slice(0, 3);
    }

    const userTags = extractTags(text);
    const assistantTags = extractTags(reply);

    if (hasSbUrl && hasSbKey) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(
          process.env.SUPABASE_URL,
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
        );

        // Estructura sugerida de tabla `messages`:
        // id uuid default gen_random_uuid(), session_id text, role text, content text nullable, tags jsonb, meta jsonb, created_at timestamptz default now()
        const inserts = [];

        inserts.push({
          session_id: sessionId,
          role: 'user',
          content: SAVE_TEXT ? text : null,      // 🔒 NO guardamos texto si SAVE_TEXT=false
          tags: userTags,
          meta: { len: text?.length || 0 }
        });

        inserts.push({
          session_id: sessionId,
          role: 'assistant',
          content: SAVE_TEXT ? reply : null,     // 🔒 idem
          tags: assistantTags,
          meta: { usedOpenAI, openai_error, len: reply?.length || 0 }
        });

        const { error } = await sb.from('messages').insert(inserts);
        if (error) throw error;

        saved = true;
      } catch (e) {
        saved = false;
        supabase_error = e?.message || 'supabase error';
        // No rompemos
        // console.error('supabase error:', supabase_error);
      }
    }

    // Respuesta final (nunca 500)
    return respond({
      ok: true,
      stage: 4,
      sessionId,
      message: reply,
      usedOpenAI,
      openai_error,
      saved,
      supabase_error,
      privacy: { savedText: SAVE_TEXT }
    });
  } catch (e) {
    return res.status(200).json({ ok: false, stage: 4, error: e?.message || 'server error' });
  }
}
