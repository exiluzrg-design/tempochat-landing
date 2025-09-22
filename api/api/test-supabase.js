// api/test-supabase.js
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  try {
    if (!url || !serviceKey) {
      return res.status(500).json({ ok: false, error: 'missing_env', url: !!url, serviceKey: !!serviceKey });
    }

    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

    const payload = {
      session_id: `test-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      content: 'ping supabase',
    };

    const { data, error } = await supabase
      .from('messages')
      .insert(payload)
      .select('id, session_id, role, content, created_at')
      .single();

    if (error) {
      console.error('[test-supabase insert error]', error);
      return res.status(500).json({ ok: false, error: 'insert_failed', details: error });
    }

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error('[test-supabase fatal]', e);
    return res.status(500).json({ ok: false, error: 'fatal', details: String(e) });
  }
}
