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
    if (!track.reference_url) throw new Error('Сначала загрузите референс-трек');

    const audioRes = await fetch(track.reference_url);
    if (!audioRes.ok) throw new Error('Не удалось скачать референс-трек по ссылке');
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());
    const base64 = audioBuf.toString('base64');
    const format = track.reference_url.toLowerCase().endsWith('.wav') ? 'wav' : 'mp3';

    // gpt-audio зависает на открытых "опиши" промптах — строгий JSON-формат с закрытыми полями работает надёжно (проверено живым тестом).
    const r = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'openai/gpt-audio',
        messages: [
          { role: 'system', content: 'Ты отвечаешь СТРОГО валидным JSON без markdown и без вводных фраз. Никаких "сейчас проанализирую" — сразу готовый JSON.' },
          { role: 'user', content: [
            { type: 'text', text: 'Заполни JSON по этому аудиотреку: {"genre_guess": "жанр/поджанр", "vocal": "мужской/женский/дуэт/нет", "tempo_feel": "медленный/средний/быстрый", "energy": "низкая/средняя/высокая", "mood": "настроение", "instrumentation": "ключевые инструменты/звучание", "era_style": "эпоха или стилистический референс в общих терминах"}' },
            { type: 'input_audio', input_audio: { data: base64, format } }
          ] }
        ]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const raw = data.choices?.[0]?.message?.content || '{}';
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const analysis = JSON.parse(cleaned);

    const { data: updated, error: updErr } = await supabase
      .from('music_tracks')
      .update({ analysis, status: 'analyzed', updated_at: new Date().toISOString() })
      .eq('id', track_id)
      .select('*')
      .single();
    if (updErr) throw new Error(updErr.message);

    res.status(200).json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
