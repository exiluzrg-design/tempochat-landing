// api/env-check.js — verifica si el runtime VE las envs (no muestra valores)
export default function handler(req, res) {
  const keys = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'OPENAI_API_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'SESSION_JWT_SECRET'
  ];
  const seen = Object.fromEntries(keys.map(k => [k, !!process.env[k]]));
  // extra: chequeo de formato de URL (solo valida que empiece con https:// y termine en .supabase.co)
  const url = process.env.SUPABASE_URL || '';
  const looksLikeUrl = /^https:\/\/.+\.supabase\.co$/.test(url);
  return res.status(200).json({
    env_seen_by_runtime: seen,
    supabase_url_looks_ok: looksLikeUrl,
    note: 'Si cambiaste variables, es obligatorio un Redeploy del proyecto en Vercel (Production).'
  });
}
