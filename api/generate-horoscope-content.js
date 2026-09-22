import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const TEXT_MODEL = 'anthropic/claude-opus-5';
const IMAGE_MODEL = 'krea/krea-2-medium-turbo';
const MEDIA_BUCKET = 'content-media';
const PROJECT_NAME = 'Звёздный Компас';

// 3 поста в день, публикуются автоматически без утверждения владельцем.
const SLOTS_UTC = [
  { h: 5, m: 30, key: 'general' },   // 08:30 МСК — общий гороскоп на все знаки
  { h: 9, m: 30, key: 'business' },  // 12:30 МСК — деловой гороскоп
  { h: 17, m: 0, key: 'love' }       // 20:00 МСК — любовный гороскоп
];

const TOPICS = {
  general: `${PROJECT_NAME} — Общий`,
  business: `${PROJECT_NAME} — Деловой`,
  love: `${PROJECT_NAME} — Любовь`
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
          `2. "business" — деловой гороскоп, тот же формат (строка на каждый знак, начинается с эмодзи), но про работу, карьеру, деньги, деловые решения и переговоры.\n\n` +
          `3. "love" — любовный гороскоп, тот же формат (строка на каждый знак, начинается с эмодзи), но про отношения и личную жизнь.\n\n` +
          `Для каждого поста также дай "image_prompt" — подробный промпт на английском для мистической астрологической иллюстрации (созвездия, ночное небо, магический стиль), без текста и букв на изображении, единый визуальный стиль для всех трёх.\n\n` +
          `Верни JSON вида: {"general": {"text": "...", "image_prompt": "..."}, "business": {"text": "...", "image_prompt": "..."}, "love": {"text": "...", "image_prompt": "..."}}`
      }
    ]
  });
  const raw = data.choices?.[0]?.message?.content || '{}';
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

// Публикация автоматическая (status: 'scheduled' сразу), поэтому картинку — в отличие от
// проектов с утверждением — генерируем здесь и сейчас, а не «на лету» перед отправкой владельцу:
// для уже-запланированных постов такого отдельного шага больше нет.
async function generateAndUploadImage(idHint, prompt) {
  const genRes = await fetch(`${ROUTER_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
    body: JSON.stringify({ model: IMAGE_MODEL, prompt, n: 1, size: '1024x1024' })
  });
  const genData = await genRes.json();
  if (!genRes.ok) throw new Error(genData.error?.message || JSON.stringify(genData));
  const item = genData.data?.[0];
  if (!item?.b64_json) throw new Error('Пустой ответ генератора изображений');

  const mediaType = item.media_type || 'image/png';
  const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
  const path = `${idHint}/zvezdny-${Date.now()}.${ext}`;
  const buffer = Buffer.from(item.b64_json, 'base64');
  const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: mediaType });
  if (upErr) throw new Error(upErr.message);
  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { days = 1, dayOffset = 0 } = req.body || {};
  // Каждый день теперь стоит 1 текстовый вызов + 3 генерации картинок — держим чанк небольшим,
  // чтобы не упереться в лимит времени серверлесс-функции (300с).
  if (days < 1 || days > 5) {
    res.status(400).json({ error: 'days must be between 1 and 5 per request (chunk a month across ~6 calls)' });
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
    const imageErrors = [];

    for (let i = 0; i < days; i++) {
      const dayIndex = dayOffset + i;
      const posts = await generateDayPosts(dayIndex);

      for (const slot of SLOTS_UTC) {
        const post = posts[slot.key];
        if (!post || !post.text) continue;

        const scheduledAt = new Date(now);
        scheduledAt.setUTCDate(scheduledAt.getUTCDate() + dayIndex + 1);
        scheduledAt.setUTCHours(slot.h, slot.m, 0, 0);

        let mediaUrl = null;
        if (post.image_prompt) {
          try {
            mediaUrl = await generateAndUploadImage(`${project.id}-d${dayIndex}-${slot.key}`, post.image_prompt);
          } catch (imgErr) {
            imageErrors.push(`день ${dayIndex + 1} (${slot.key}): ${imgErr.message}`);
          }
        }

        rows.push({
          project_id: project.id,
          platform: 'telegram',
          topic: TOPICS[slot.key],
          body: post.text,
          image_prompt: post.image_prompt || null,
          media_url: mediaUrl,
          status: 'scheduled',
          scheduled_at: scheduledAt.toISOString()
        });
      }
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error } = await supabase.from('content_items').insert(rows).select('id');
      if (error) throw new Error(error.message);
      inserted = data?.length || 0;
    }

    res.status(200).json({ inserted, daysRequested: days, dayOffset, imageErrors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
