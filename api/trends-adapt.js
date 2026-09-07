import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { trend_video_id, project_id, brief } = req.body || {};
  if (!trend_video_id || !brief) {
    res.status(400).json({ error: 'trend_video_id and brief are required' });
    return;
  }

  try {
    const { data: video, error: fetchErr } = await supabase.from('trend_videos').select('*').eq('id', trend_video_id).single();
    if (fetchErr || !video) throw new Error('Видео не найдено');

    const prompt = `Вот вирусный видео-паттерн:
Название: ${video.title}
Анализ виральности: ${JSON.stringify(video.viral_analysis || {})}
Просмотры: ${video.views}

Адаптируй этот паттерн под бренд:
Ниша: ${brief.niche || 'не указана'}
Tone of voice: ${brief.tone_of_voice || 'не указан'}
Продукт: ${brief.product || 'не указан'}

Напиши готовый сценарий короткого видео (15-60 сек): хук в первые 3 секунды, структура по секундам, текст на экране, реплики. На русском.`;

    const r = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-5',
        max_tokens: 2048,
        messages: [
          { role: 'system', content: 'Ты — сценарист коротких вирусных видео (Reels/Shorts/Клипы).' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const script_text = data.choices?.[0]?.message?.content || '';

    const { data: saved, error: insErr } = await supabase
      .from('trend_scripts')
      .insert({ project_id: project_id || null, trend_video_id, brief, script_text, status: 'review' })
      .select('*')
      .single();
    if (insErr) throw new Error(insErr.message);

    res.status(200).json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
