// api/chat.js
export default async function handler(req, res) {
  const diag = {
    ok: false,
    step: undefined,
    errors: [],
    env: {
      OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      SUPABASE_ANON_KEY: Boolean(process.env.SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
  };

  try {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      return res.status(204).end();
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'method not allowed' });
    }

    // Parseo seguro del body
    diag.step = 'parse_body';
    let body = {};
    try {
      body =
        typeof req.body === 'string'
          ? JSON.parse(req.body || '{}')
          : req.body || {};
    } catch {
      body = {};
      diag.errors.push('Body vacío o JSON inválido');
    }
    diag.requestEcho = body;

    const text = (body?.text ?? '').toString();
    const doOpenAI = Boolean(body?.diag?.openai);
    const doSupabase = Boolean(body?.diag?.supabase);

    // Check Supabase opcional
    if (doSupabase) {
      diag.step = 'supabase_check';
      try {
        const url = process.env.SUPABASE_URL;
        const key =
          process.env.SUPABASE_SERVICE_ROLE_KEY ||
          process.env.SUPABASE_ANON_KEY;
        if (!url || !key) throw new Error('Faltan SUPABASE_URL o KEY');

        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(url, key);
        const { error } = await sb.from('messages').select('id').limit(1);
        if (error) throw error;
        diag.supabase = { ok: true };
      } catch (e) {
        diag.supabase = { ok: false, error: e.message };
        diag.errors.push(`Supabase: ${e.message}`);
      }
    }

    // Check OpenAI opcional
    if (doOpenAI) {
      diag.step = 'openai_check';
      try {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error('Falta OPENAI_API_KEY');

        const OpenAI = (await import('openai')).default;
        const openai = new OpenAI({ apiKey });
        const r = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 10,
          messages: [{ role: 'user', content: text || 'ping' }],
        });
        if (!r?.choices?.[0]?.message?.content)
          throw new Error('Respuesta vacía de OpenAI');
        diag.openai = { ok: true };
      } catch (e) {
        diag.openai = { ok: false, error: e.message };
        diag.errors.push(`OpenAI: ${e.message}`);
      }
    }

    diag.step = 'done';
    diag.ok = diag.errors.length === 0;
    return res.status(200).json(diag);
  } catch (e) {
    diag.errors.push(e?.message || 'server error');
    return res.status(200).json(diag);
  }
}
