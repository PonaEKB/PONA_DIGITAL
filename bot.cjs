require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const MODEL = 'anthropic/claude-opus-5';

const bot = new Telegraf(TOKEN);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function askAI(question) {
  try {
    const response = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ROUTER_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          { role: 'system', content: 'Ты — AI-ассистент PONA DIGITAL. Отвечай на русском.' },
          { role: 'user', content: question }
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) return 'Ошибка: ' + (data.error?.message || JSON.stringify(data));
    return data.choices?.[0]?.message?.content || 'Ошибка: пустой ответ';
  } catch (err) {
    return 'Ошибка: ' + err.message;
  }
}

bot.start((ctx) => ctx.reply('🚀 Привет! Я бот PONA DIGITAL с AI!\n\n/ai [вопрос] — спросить AI\n/idea [тема] — идея проекта\n/post [тема] — написать пост\n/stats — статистика\n/projects — проекты\n/report — отчёт'));

bot.command('stats', async (ctx) => {
  const { data: projects } = await supabase.from('projects').select('*');
  const { data: tasks } = await supabase.from('tasks').select('*');
  const done = tasks.filter(t => t.status === 'done').length;
  ctx.reply(`📊 СТАТИСТИКА\n\n📁 Проектов: ${projects.length}\n📝 Задач: ${tasks.length}\n✅ Готово: ${done}`);
});

bot.command('projects', async (ctx) => {
  const { data: projects } = await supabase.from('projects').select('*');
  if (projects.length === 0) return ctx.reply('📁 Нет проектов');
  let text = '📁 ПРОЕКТЫ:\n\n';
  projects.forEach((p, i) => { text += `${i + 1}. ${p.name}\n`; });
  ctx.reply(text);
});

bot.command('report', async (ctx) => {
  const { data: tasks } = await supabase.from('tasks').select('*');
  const done = tasks.filter(t => t.status === 'done').length;
  ctx.reply(`📋 ОТЧЁТ\n\n✅ Выполнено: ${done}\n📝 Всего: ${tasks.length}`);
});

bot.command('ai', async (ctx) => {
  const question = ctx.message.text.replace('/ai', '').trim();
  if (!question) return ctx.reply('Пример: /ai Как дела?');
  ctx.reply('🤔 Думаю...');
  const answer = await askAI(question);
  ctx.reply(`🤖 Ответ:\n\n${answer}`);
});

bot.command('idea', async (ctx) => {
  const topic = ctx.message.text.replace('/idea', '').trim();
  if (!topic) return ctx.reply('Пример: /idea блог о еде');
  ctx.reply('💡 Генерирую...');
  const answer = await askAI(`Разработай концепцию проекта: ${topic}. Опиши идею, стратегию, монетизацию.`);
  ctx.reply(`💡 ИДЕЯ:\n\n${answer}`);
});

bot.command('post', async (ctx) => {
  const topic = ctx.message.text.replace('/post', '').trim();
  if (!topic) return ctx.reply('Пример: /post борщ');
  ctx.reply('✍️ Пишу...');
  const answer = await askAI(`Напиши пост для Telegram на тему: ${topic}. С эмодзи, структурировано.`);
  ctx.reply(`📝 ПОСТ:\n\n${answer}`);
});

async function publishScheduledContent() {
  if (!CHANNEL_ID) return;
  const { data: items, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('platform', 'telegram')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error || !items || items.length === 0) return;

  for (const item of items) {
    try {
      const text = item.title ? `${item.title}\n\n${item.body}` : item.body;
      await bot.telegram.sendMessage(CHANNEL_ID, text);
      await supabase.from('content_items').update({ status: 'published', published_at: new Date().toISOString(), error: null }).eq('id', item.id);
      console.log(`✅ Опубликован пост "${item.title || item.id}" в Telegram`);
    } catch (err) {
      await supabase.from('content_items').update({ status: 'failed', error: err.message }).eq('id', item.id);
      console.log(`❌ Ошибка публикации поста "${item.title || item.id}": ${err.message}`);
    }
  }
}

bot.launch();
console.log('🤖 Бот PONA DIGITAL + Claude запущен!');

if (CHANNEL_ID) {
  setInterval(publishScheduledContent, 60 * 1000);
  publishScheduledContent();
  console.log('📤 Планировщик контент-завода запущен (проверка очереди раз в минуту)');
} else {
  console.log('⚠️ TELEGRAM_CHANNEL_ID не задан — автопубликация в Telegram отключена');
}