import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const TEXT_MODEL = 'anthropic/claude-opus-5';
const PROJECT_NAME = 'Звёздный Компас';

// 3 поста в день: общий гороскоп на все знаки (утро) / финансовый (день) / любовный (вечер).
const SLOTS_UTC = [
  { h: 5, m: 30, key: 'general' },  // 08:30 МСК
  { h: 9, m: 35, key: 'finance' },  // 12:35 МСК
  { h: 16, m: 30, key: 'love' }     // 19:30 МСК
];

const TOPICS = {
  general: `${PROJECT_NAME} — Общий`,
  love: `${PROJECT_NAME} — Любовь`,
  finance: `${PROJECT_NAME} — Финансы`
};

const ZODIAC_SIGNS = [
  '♈ Овен', '♉ Телец', '♊ Близнецы', '♋ Рак', '♌ Лев', '♍ Дева',
  '♎ Весы', '♏ Скорпион', '♐ Стрелец', '♑ Козерог', '♒ Водолей', '♓ Рыбы'
];

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function callRouter(path, body) {
  const response = await fetch(`${ROUTER_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

// Один AI-вызов на один день — возвращает 3 готовых поста (по одному на рубрику).
async function generateDayPosts(dayIndex) {
  const signsList = ZODIAC_SIGNS.join(', ');
  const data = await callRouter('/chat/completions', {
    model: TEXT_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'system',
        content: 'Ты — астролог, ведёшь Telegram-канал «Звёздный Компас». Отвечай СТРОГО валидным JSON-объектом, без markdown-разметки и пояснений.'
      },
      {
        role: 'user',
        content: `Составь контент для канала на день №${dayIndex + 1} вперёд от сегодня. Нужно 3 поста, каждый — отдельный объект в JSON:\n\n` +
          `1. "general" — гороскоп на день сразу для ВСЕХ 12 знаков зодиака: ${signsList}. Для каждого знака — отдельная строка, начинающаяся РОВНО с эмодзи знака (как в списке выше), затем название жирным через Markdown и одно ёмкое предложение-прогноз (15-20 слов), без общих шаблонных фраз. В начале поста — короткий заголовок.\n\n` +
          `2. "love" — любовный гороскоп, тот же формат (строка на каждый знак, начинается с эмодзи), но про отношения и личную жизнь.\n\n` +
          `3. "finance" — финансовый гороскоп, тот же формат (строка на каждый знак, начинается с эмодзи), но про деньги, работу, карьеру.\n\n` +
          `Для каждого поста также дай "image_prompt" — подробный промпт на английском для мистической астрологической иллюстрации (созвездия, ночное небо, магический стиль), без текста и букв на изображении, единый визуальный стиль для всех трёх.\n\n` +
          `Верни JSON вида: {"general": {"text": "...", "image_prompt": "..."}, "love": {"text": "...", "image_prompt": "..."}, "finance": {"text": "...", "image_prompt": "..."}}`
      }
    ]
  });
  const raw = data.choices?.[0]?.message?.content || '{}';
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { days = 1, dayOffset = 0 } = req.body || {};
  if (days < 1 || days > 10) {
    res.status(400).json({ error: 'days must be between 1 and 10 per request (chunk larger backlogs across multiple calls)' });
    return;
  }

  try {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('name', PROJECT_NAME)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error(`Проект "${PROJECT_NAME}" не найден в CRM`);

    const now = new Date();
    const rows = [];

    for (let i = 0; i < days; i++) {
      const dayIndex = dayOffset + i;
      const posts = await generateDayPosts(dayIndex);

      for (const slot of SLOTS_UTC) {
        const post = posts[slot.key];
        if (!post || !post.text) continue;

        const scheduledAt = new Date(now);
        scheduledAt.setUTCDate(scheduledAt.getUTCDate() + dayIndex + 1);
        scheduledAt.setUTCHours(slot.h, slot.m, 0, 0);

        rows.push({
          project_id: project.id,
          platform: 'telegram',
          topic: TOPICS[slot.key],
          body: post.text,
          image_prompt: post.image_prompt || null,
          status: 'draft',
          scheduled_at: scheduledAt.toISOString(),
          // Не показывать владельцу на утверждение раньше 23:00 МСК (20:00 UTC) накануне дня публикации —
          // иначе общий цикл notifyNewDrafts заберёт черновик сразу после генерации, а не по расписанию.
          release_at: new Date(Date.UTC(
            scheduledAt.getUTCFullYear(), scheduledAt.getUTCMonth(), scheduledAt.getUTCDate() - 1, 20, 0, 0
          )).toISOString()
        });
      }
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error } = await supabase.from('content_items').insert(rows).select('id');
      if (error) throw new Error(error.message);
      inserted = data?.length || 0;
    }

    res.status(200).json({ inserted, daysRequested: days, dayOffset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
