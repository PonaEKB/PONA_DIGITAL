require('dotenv').config();
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
// service_role, не anon — content_items разрешён на запись/чтение только authenticated-сессиям,
// а бот работает без пользовательской сессии, поэтому ему нужен ключ, который обходит RLS.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const MODEL = 'anthropic/claude-opus-5';

const bot = new Telegraf(TOKEN);
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

bot.start((ctx) => ctx.reply('🚀 Привет! Я бот PONA DIGITAL с AI!\n\n/ai [вопрос] — спросить AI\n/idea [тема] — идея проекта\n/post [тема] — написать пост\n/stats — статистика\n/projects — проекты\n/report — отчёт\n/myid — узнать свой chat_id'));

bot.command('myid', (ctx) => ctx.reply(`Ваш chat_id: ${ctx.chat.id}`));

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

const MAX_PENDING_APPROVAL = 12; // держим в очереди на утверждение не больше ~3 дней контента разом

async function notifyNewDrafts() {
  if (!OWNER_CHAT_ID) return;

  const { count: pendingCount } = await supabase
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'telegram')
    .eq('status', 'draft')
    .not('notified_at', 'is', null);

  const freeSlots = MAX_PENDING_APPROVAL - (pendingCount || 0);
  if (freeSlots <= 0) return;

  const { data: items, error } = await supabase
    .from('content_items')
    .select('*')
    .eq('platform', 'telegram')
    .eq('status', 'draft')
    .is('notified_at', null)
    .order('scheduled_at', { ascending: true })
    .limit(freeSlots);

  if (error || !items || items.length === 0) return;

  for (const item of items) {
    try {
      const when = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'без даты';
      const caption = `На утверждение (${item.topic || 'без темы'}), план на ${when} МСК:\n\n${item.body}`.slice(0, 1024);
      const keyboard = { inline_keyboard: [[
        { text: '✅ Утвердить', callback_data: `approve:${item.id}` },
        { text: '❌ Отклонить', callback_data: `reject:${item.id}` }
      ]] };
      if (item.media_url) {
        await bot.telegram.sendPhoto(OWNER_CHAT_ID, item.media_url, { caption, reply_markup: keyboard });
      } else {
        await bot.telegram.sendMessage(OWNER_CHAT_ID, caption, { reply_markup: keyboard });
      }
      await supabase.from('content_items').update({ notified_at: new Date().toISOString() }).eq('id', item.id);
    } catch (err) {
      console.log(`❌ Не удалось отправить на утверждение пост ${item.id}: ${err.message}`);
    }
  }
}

bot.action(/^approve:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const { error } = await supabase.from('content_items').update({ status: 'scheduled' }).eq('id', id).eq('status', 'draft');
  if (error) {
    await ctx.answerCbQuery('Ошибка: ' + error.message, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery('Утверждено ✅');
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Утверждено', callback_data: 'noop' }]] }); } catch (_) {}
});

bot.action(/^reject:(.+)$/, async (ctx) => {
  const id = ctx.match[1];
  const { error } = await supabase.from('content_items').delete().eq('id', id).eq('status', 'draft');
  if (error) {
    await ctx.answerCbQuery('Ошибка: ' + error.message, { show_alert: true });
    return;
  }
  await ctx.answerCbQuery('Отклонено ❌');
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ Отклонено', callback_data: 'noop' }]] }); } catch (_) {}
});

bot.action('noop', (ctx) => ctx.answerCbQuery());

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
      if (item.media_url) {
        const caption = text.length > 1024 ? text.slice(0, 1021) + '...' : text;
        await bot.telegram.sendPhoto(CHANNEL_ID, item.media_url, { caption });
      } else {
        await bot.telegram.sendMessage(CHANNEL_ID, text);
      }
      await supabase.from('content_items').update({ status: 'published', published_at: new Date().toISOString(), error: null }).eq('id', item.id);
      console.log(`✅ Опубликован пост "${item.title || item.id}" в Telegram`);
    } catch (err) {
      await supabase.from('content_items').update({ status: 'failed', error: err.message }).eq('id', item.id);
      console.log(`❌ Ошибка публикации поста "${item.title || item.id}": ${err.message}`);
    }
  }
}

bot.catch((err, ctx) => {
  console.error(`❌ Ошибка обработчика (${ctx.updateType}):`, err.message);
});

function startBot() {
  bot.launch().catch(err => {
    console.error('❌ Ошибка поллинга бота, повтор через 5с:', err.message);
    setTimeout(startBot, 5000);
  });
}
startBot();
console.log('🤖 Бот PONA DIGITAL + Claude запущен!');

if (CHANNEL_ID) {
  setInterval(publishScheduledContent, 60 * 1000);
  publishScheduledContent();
  console.log('📤 Планировщик контент-завода запущен (проверка очереди раз в минуту)');
} else {
  console.log('⚠️ TELEGRAM_CHANNEL_ID не задан — автопубликация в Telegram отключена');
}

if (OWNER_CHAT_ID) {
  setInterval(notifyNewDrafts, 60 * 1000);
  notifyNewDrafts();
  console.log('📝 Отправка черновиков на утверждение владельцу включена');
} else {
  console.log('⚠️ OWNER_CHAT_ID не задан — черновики не будут приходить на утверждение в личку');
}