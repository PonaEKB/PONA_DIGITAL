import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const TEXT_MODEL = 'anthropic/claude-opus-5';
const MEDIA_BUCKET = 'content-media';
// Слоты публикации — 08:30 / 12:35 / 19:30 / 21:30 МСК (UTC+3), пересчитано в UTC.
const POST_SLOTS_UTC = [
  { h: 5, m: 30 },
  { h: 9, m: 35 },
  { h: 16, m: 30 },
  { h: 18, m: 30 }
];

// «Звёздный Компас» — отдельная ветка ниже (handleHoroscope): свои рубрики/слоты и
// автопубликация без утверждения, вместо общей generatePostsText/POST_SLOTS_UTC логики.
const HOROSCOPE_PROJECT_NAME = 'Звёздный Компас';
const HOROSCOPE_SLOTS_UTC = [
  { h: 5, m: 30, key: 'general' },   // 08:30 МСК — общий гороскоп на все знаки
  { h: 9, m: 30, key: 'business' },  // 12:30 МСК — деловой гороскоп
  { h: 17, m: 0, key: 'love' }       // 20:00 МСК — любовный гороскоп
];
const HOROSCOPE_TOPICS = {
  general: `${HOROSCOPE_PROJECT_NAME} — Общий`,
  business: `${HOROSCOPE_PROJECT_NAME} — Деловой`,
  love: `${HOROSCOPE_PROJECT_NAME} — Любовь`
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

async function getRubricGuidance(projectId) {
  const { data: rated } = await supabase
    .from('content_items')
    .select('topic, rating')
    .eq('project_id', projectId)
    .not('rating', 'is', null);
  if (!rated || rated.length === 0) return '';

  const byRubric = {};
  for (const r of rated) {
    const rubric = (r.topic && r.topic.includes(' — ')) ? r.topic.split(' — ')[1] : 'Кухня мира';
    byRubric[rubric] = byRubric[rubric] || { good: 0, bad: 0 };
    byRubric[rubric][r.rating]++;
  }
  const ranked = Object.entries(byRubric).map(([rubric, r]) => ({ rubric, score: r.good - r.bad })).sort((a, b) => b.score - a.score);
  const top = ranked.filter(r => r.score > 0).slice(0, 3).map(r => r.rubric);
  const worst = ranked.filter(r => r.score < 0).slice(-2).map(r => r.rubric);

  let guidance = '';
  if (top.length) guidance += `\n\nПо реакциям пользователя лучше всего заходят рубрики: ${top.join(', ')} — используй их почаще.`;
  if (worst.length) guidance += `\n\nЭти рубрики заходят хуже, используй их реже: ${worst.join(', ')}.`;
  return guidance;
}

async function generatePostsText({ projectId, projectName, context, days, postsPerDay, dayOffset = 0 }) {
  const total = days * postsPerDay;
  const rubricGuidance = await getRubricGuidance(projectId);
  const data = await callRouter('/chat/completions', {
    model: TEXT_MODEL,
    max_tokens: 8192,
    messages: [
      { role: 'system', content: 'Ты — контент-стратег Telegram-канала. Отвечай СТРОГО валидным JSON-массивом, без markdown-разметки и пояснений.' },
      { role: 'user', content: `Проект: "${projectName}".\n\n${context}${rubricGuidance}\n\nСгенерируй ${total} постов для Telegram-канала на ${days} дня вперёд, по ${postsPerDay} поста в день. Для каждого поста верни объект: {"day": номер дня от 1 до ${days}, "text": готовый текст поста (3-8 предложений), "image_prompt": подробный промпт на английском для генерации иллюстрации к посту, без текста и букв на изображении, в едином визуальном стиле}.\n\nТребования к "text": НЕ сплошной абзац — разбивай мысли на короткие абзацы пустой строкой между ними (2-4 строки на абзац), к месту используй эмодзи (не в каждом предложении, а как акценты у ключевых мыслей), при уместности заверши цепляющим вопросом или лёгкой интригой для вовлечения. Текст должен визуально хорошо смотреться в Telegram, а не выглядеть плотной стеной текста.\n\nВерни ТОЛЬКО JSON-массив из ${total} объектов, без обёртки и без markdown.` }
    ]
  });
  const raw = data.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('AI вернул не массив постов');
  return parsed;
}

// Один AI-вызов на один день — возвращает 3 готовых поста «Звёздного Компаса» (по одному на рубрику).
async function generateHoroscopeDayPosts(dayIndex) {
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

// Публикация «Звёздного Компаса» автоматическая (status: 'scheduled' сразу), поэтому картинку —
// в отличие от проектов с утверждением — генерируем здесь и сейчас, а не «на лету» перед отправкой
// владельцу: для уже-запланированных постов такого отдельного шага больше нет.
// Картинки — через Pollinations.ai (бесплатно, без ключа), а не через платный Router AI.
async function generateAndUploadImage(idHint, prompt) {
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&nologo=true`;
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new Error(`Pollinations вернул ошибку: ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());

  const path = `${idHint}/zvezdny-${Date.now()}.jpg`;
  const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: 'image/jpeg' });
  if (upErr) throw new Error(upErr.message);
  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

async function handleHoroscope(req, res) {
  const { days = 1, dayOffset = 0 } = req.body || {};
  // Каждый день — 1 текстовый вызов + 3 генерации картинок — держим чанк небольшим, чтобы не
  // упереться в лимит времени серверлесс-функции (300с).
  if (days < 1 || days > 5) {
    res.status(400).json({ error: 'days must be between 1 and 5 per request (chunk a month across ~6 calls)' });
    return;
  }

  try {
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('name', HOROSCOPE_PROJECT_NAME)
      .maybeSingle();
    if (projectError) throw new Error(projectError.message);
    if (!project) throw new Error(`Проект "${HOROSCOPE_PROJECT_NAME}" не найден в CRM`);

    const now = new Date();
    const rows = [];
    const imageErrors = [];

    for (let i = 0; i < days; i++) {
      const dayIndex = dayOffset + i;
      const posts = await generateHoroscopeDayPosts(dayIndex);

      for (const slot of HOROSCOPE_SLOTS_UTC) {
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
          topic: HOROSCOPE_TOPICS[slot.key],
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (req.body?.horoscope) {
    await handleHoroscope(req, res);
    return;
  }

  const { projectId, projectName, context, days = 3, postsPerDay = 4, dayOffset = 0 } = req.body || {};
  if (!projectId || !projectName) {
    res.status(400).json({ error: 'projectId and projectName are required' });
    return;
  }

  try {
    // Генерируем только текст и промпт для картинки. Сама картинка создаётся
    // не здесь, а в bot.cjs — прямо перед отправкой поста владельцу на
    // утверждение (и только для ближайшей пачки, а не для всех разом).
    const posts = await generatePostsText({ projectId, projectName, context: context || '', days, postsPerDay });

    const grouped = {};
    for (const post of posts) {
      const day = post.day >= 1 ? post.day : 1;
      (grouped[day] = grouped[day] || []).push(post);
    }

    const now = new Date();
    const rows = [];
    for (const [dayStr, items] of Object.entries(grouped)) {
      const day = parseInt(dayStr, 10) + dayOffset;
      items.forEach((post, idx) => {
        const scheduledAt = new Date(now);
        scheduledAt.setUTCDate(scheduledAt.getUTCDate() + day);
        const slot = POST_SLOTS_UTC[idx % POST_SLOTS_UTC.length];
        scheduledAt.setUTCHours(slot.h, slot.m, 0, 0);
        rows.push({
          project_id: projectId,
          platform: 'telegram',
          topic: projectName,
          body: post.text,
          image_prompt: post.image_prompt || null,
          status: 'draft',
          scheduled_at: scheduledAt.toISOString()
        });
      });
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { data, error } = await supabase.from('content_items').insert(rows).select('id');
      if (error) throw new Error(error.message);
      inserted = data?.length || 0;
    }

    res.status(200).json({ inserted, totalRequested: posts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
