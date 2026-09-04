import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const TEXT_MODEL = 'anthropic/claude-opus-5';
const POST_HOURS_UTC = [9, 13, 17, 21];

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

async function generatePostsText({ projectName, context, days, postsPerDay }) {
  const total = days * postsPerDay;
  const data = await callRouter('/chat/completions', {
    model: TEXT_MODEL,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: 'Ты — контент-стратег Telegram-канала. Отвечай СТРОГО валидным JSON-массивом, без markdown-разметки и пояснений.' },
      { role: 'user', content: `Проект: "${projectName}".\n\n${context}\n\nСгенерируй ${total} постов для Telegram-канала на ${days} дня вперёд, по ${postsPerDay} поста в день. Для каждого поста верни объект: {"day": номер дня от 1 до ${days}, "text": готовый текст поста (3-8 предложений), "image_prompt": подробный промпт на английском для генерации иллюстрации к посту, без текста и букв на изображении, в едином визуальном стиле}.\n\nТребования к "text": НЕ сплошной абзац — разбивай мысли на короткие абзацы пустой строкой между ними (2-4 строки на абзац), к месту используй эмодзи (не в каждом предложении, а как акценты у ключевых мыслей), при уместности заверши цепляющим вопросом или лёгкой интригой для вовлечения. Текст должен визуально хорошо смотреться в Telegram, а не выглядеть плотной стеной текста.\n\nВерни ТОЛЬКО JSON-массив из ${total} объектов, без обёртки и без markdown.` }
    ]
  });
  const raw = data.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('AI вернул не массив постов');
  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { projectId, projectName, context, days = 3, postsPerDay = 4 } = req.body || {};
  if (!projectId || !projectName) {
    res.status(400).json({ error: 'projectId and projectName are required' });
    return;
  }

  try {
    // Генерируем только текст и промпт для картинки. Сама картинка создаётся
    // не здесь, а в bot.cjs — прямо перед отправкой поста владельцу на
    // утверждение (и только для ближайшей пачки, а не для всех разом).
    const posts = await generatePostsText({ projectName, context: context || '', days, postsPerDay });

    const grouped = {};
    for (const post of posts) {
      const day = post.day >= 1 ? post.day : 1;
      (grouped[day] = grouped[day] || []).push(post);
    }

    const now = new Date();
    const rows = [];
    for (const [dayStr, items] of Object.entries(grouped)) {
      const day = parseInt(dayStr, 10);
      items.forEach((post, idx) => {
        const scheduledAt = new Date(now);
        scheduledAt.setUTCDate(scheduledAt.getUTCDate() + day);
        scheduledAt.setUTCHours(POST_HOURS_UTC[idx % POST_HOURS_UTC.length], 0, 0, 0);
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
