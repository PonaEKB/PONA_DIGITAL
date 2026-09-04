import { createClient } from '@supabase/supabase-js';

const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const TEXT_MODEL = 'anthropic/claude-opus-5';
const IMAGE_MODEL = 'krea/krea-2-medium-turbo';
const BUCKET = 'content-media';
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
      { role: 'user', content: `Проект: "${projectName}".\n\n${context}\n\nСгенерируй ${total} постов для Telegram-канала на ${days} дня вперёд, по ${postsPerDay} поста в день. Для каждого поста верни объект: {"day": номер дня от 1 до ${days}, "text": готовый текст поста с эмодзи (3-8 предложений), "image_prompt": подробный промпт на английском для генерации иллюстрации к посту, без текста и букв на изображении, в едином визуальном стиле}. Верни ТОЛЬКО JSON-массив из ${total} объектов, без обёртки и без markdown.` }
    ]
  });
  const raw = data.choices?.[0]?.message?.content || '[]';
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error('AI вернул не массив постов');
  return parsed;
}

async function generateImage(prompt) {
  const data = await callRouter('/images/generations', {
    model: IMAGE_MODEL,
    prompt,
    n: 1,
    size: '1024x1024'
  });
  const item = data.data?.[0];
  if (!item?.b64_json) throw new Error('Пустой ответ генератора изображений');
  return { base64: item.b64_json, mediaType: item.media_type || 'image/png' };
}

async function uploadImage(projectId, index, base64, mediaType) {
  const ext = mediaType.includes('png') ? 'png' : mediaType.includes('webp') ? 'webp' : 'jpg';
  const path = `${projectId}/${Date.now()}-${index}.${ext}`;
  const buffer = Buffer.from(base64, 'base64');
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: mediaType, upsert: false });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const current = cursor++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(new Array(Math.min(limit, items.length)).fill(0).map(worker));
  return results;
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
    const posts = await generatePostsText({ projectName, context: context || '', days, postsPerDay });

    const results = await mapWithConcurrency(posts, 4, async (post) => {
      try {
        const { base64, mediaType } = await generateImage(post.image_prompt);
        const mediaUrl = await uploadImage(projectId, Math.random().toString(36).slice(2), base64, mediaType);
        return { ok: true, post, mediaUrl };
      } catch (err) {
        return { ok: false, post, error: err.message };
      }
    });

    const grouped = {};
    for (const r of results.filter(r => r.ok)) {
      const day = r.post.day >= 1 ? r.post.day : 1;
      (grouped[day] = grouped[day] || []).push(r);
    }

    const now = new Date();
    const rows = [];
    for (const [dayStr, items] of Object.entries(grouped)) {
      const day = parseInt(dayStr, 10);
      items.forEach((r, idx) => {
        const scheduledAt = new Date(now);
        scheduledAt.setUTCDate(scheduledAt.getUTCDate() + day);
        scheduledAt.setUTCHours(POST_HOURS_UTC[idx % POST_HOURS_UTC.length], 0, 0, 0);
        rows.push({
          project_id: projectId,
          platform: 'telegram',
          topic: projectName,
          body: r.post.text,
          media_url: r.mediaUrl,
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

    const failed = results.filter(r => !r.ok).map(r => r.error);
    res.status(200).json({ inserted, failed, totalRequested: posts.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
