require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const bot = new Telegraf(TOKEN);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function askAI(question) {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OPENROUTER_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek/deepseek-r1',
        messages: [
          { role: 'system', content: 'Ты — AI-ассистент PONA DIGITAL. Отвечай на русском.' },
          { role: 'user', content: question }
        ],
        max_tokens: 1000
      })
    });
    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content;
    }
    return 'Ошибка: ' + (data.error?.message || 'неизвестно');
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

bot.launch();
console.log('🤖 Бот PONA DIGITAL + OpenRouter запущен!');