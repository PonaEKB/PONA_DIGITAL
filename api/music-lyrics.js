import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { track_id, theme } = req.body || {};
  if (!track_id || !theme) {
    res.status(400).json({ error: 'track_id and theme are required' });
    return;
  }

  try {
    const { data: track, error: fetchErr } = await supabase.from('music_tracks').select('*').eq('id', track_id).single();
    if (fetchErr || !track) throw new Error('Трек не найден');

    const analysisNote = track.analysis
      ? `Ориентируйся на стилистику референса: ${JSON.stringify(track.analysis)}.`
      : 'Анализ референса ещё не сделан — ориентируйся только на тему.';

    const r = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'anthropic/claude-opus-5',
        max_tokens: 2048,
        messages: [
          { role: 'system', content: 'Ты — автор песен. Пишешь текст песни на русском языке: куплеты, припев, при необходимости бридж. Формат — обычный текст с пометками [Куплет 1], [Припев] и т.д., без лишних комментариев.' },
          { role: 'user', content: `${analysisNote}\n\nТема/настроение песни: ${theme}\n\nНапиши текст песни.` }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const lyrics = data.choices?.[0]?.message?.content || '';

    const { data: updated, error: updErr } = await supabase
      .from('music_tracks')
      .update({ lyrics, lyrics_theme: theme, status: 'lyrics_ready', updated_at: new Date().toISOString() })
      .eq('id', track_id)
      .select('*')
      .single();
    if (updErr) throw new Error(updErr.message);

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
