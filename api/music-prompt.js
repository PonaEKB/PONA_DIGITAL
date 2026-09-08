import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { track_id } = req.body || {};
  if (!track_id) {
    res.status(400).json({ error: 'track_id is required' });
    return;
  }

  try {
    const { data: track, error: fetchErr } = await supabase.from('music_tracks').select('*').eq('id', track_id).single();
    if (fetchErr || !track) throw new Error('Трек не найден');
    if (!track.lyrics) throw new Error('Сначала сгенерируйте текст песни');

    const prompt = `Собери готовый промпт для Suno AI (генератор музыки по текстовому промпту со стилевыми тегами) по этим данным.

Анализ референс-трека: ${JSON.stringify(track.analysis || {})}
Тема песни: ${track.lyrics_theme || 'не указана'}

Верни ТОЛЬКО сам промпт для поля "Style of Music" в Suno — короткую строку через запятую с жанром, настроением, темпом, вокалом, инструментами и стилистическими тегами. Без пояснений, без markdown, только сам промпт.`;

    const r = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-5',
        max_tokens: 512,
        messages: [
          { role: 'system', content: 'Ты — эксперт по промптам для Suno AI. Отвечаешь только готовой строкой промпта, без пояснений.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const suno_prompt = (data.choices?.[0]?.message?.content || '').trim();

    const { data: updated, error: updErr } = await supabase
      .from('music_tracks')
      .update({ suno_prompt, status: 'prompt_ready', updated_at: new Date().toISOString() })
      .eq('id', track_id)
      .select('*')
      .single();
    if (updErr) throw new Error(updErr.message);

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
