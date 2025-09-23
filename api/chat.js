import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  try {
    const { text, sessionId } = JSON.parse(req.body || '{}');
    if (!text || !sessionId) return res.status(400).json({ error: 'missing text/sessionId' });

    // 1) (Opcional) Generar tags automáticos
    // Podés reemplazar esto por regex/tu lógica si preferís no usar modelo acá.
    const tagPrompt = [
      'Dame entre 2 y 4 tags (una palabra cada uno) del siguiente texto.',
      'Sólo minúsculas, sin espacios, sin datos sensibles.',
      `Texto: """${text}"""`
    ].join('\n');

    const tagResp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: tagPrompt }]
    });

    const tagsLine = tagResp.choices?.[0]?.message?.content?.trim() || '';
    // Normalizar: separar por comas/espacios
    const tags = Array.from(new Set(
      tagsLine.toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 4)
    ));

    // 2) Insertar el mensaje del usuario (content se nullea por trigger)
    await supabase.from('messages').insert([
      { session_id: sessionId, role: 'user', tags, content: text }
    ]);

    // 3) Armar contexto en memoria (RAM/Redis) y pedir respuesta al modelo
    //    (acá usá tu flujo actual; ejemplo mínimo:)
    const reply = 'Gracias por compartir. Contame un poco más de eso.'; // reemplazá por respuesta real del modelo

    // 4) Guardar respuesta del asistente (también sin content legible)
    await supabase.from('messages').insert([
      { session_id: sessionId, role: 'assistant', tags: [], content: reply }
    ]);

    // 5) Devolver al frontend
    return res.status(200).json({ sessionId, message: reply });

  } catch (e) {
    return res.status(500).json({ error: e?.message || 'server error' });
  }
}
