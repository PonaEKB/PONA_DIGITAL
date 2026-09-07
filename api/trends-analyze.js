import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }

  try {
    const { data: video, error: fetchErr } = await supabase.from('trend_videos').select('*').eq('id', id).single();
    if (fetchErr || !video) throw new Error('Видео не найдено');

    const prompt = `Проанализируй потенциальную виральность этого видео по доступным данным (транскрипта нет, только метаданные):

Платформа: ${video.platform}
Название: ${video.title}
Канал: ${video.channel_name}
Просмотры: ${video.views}, лайки: ${video.likes}, комментарии: ${video.comments}
Длительность: ${video.duration_seconds} сек
Ниша поиска: ${video.niche}

Верни ТОЛЬКО JSON без markdown: {"hook_guess": "предположение о хуке по названию/теме", "likely_structure": "вероятная структура ролика", "engagement_rate_note": "оценка вовлечённости по соотношению лайков/комментариев к просмотрам", "emotional_tone": "эмоциональный посыл"}`;

    const r = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-5',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: 'Ты — аналитик виральных видео. Отвечай СТРОГО валидным JSON без markdown.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const raw = data.choices?.[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    const { data: updated, error: updErr } = await supabase
      .from('trend_videos')
      .update({ viral_analysis: analysis, last_checked_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (updErr) throw new Error(updErr.message);

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
