require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(require('@ffmpeg-installer/ffmpeg').path);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Легаси-дефолт для инструментов агента (напр. get_tgstat_stats), где канал явно не указан.
// Публикация/статистика по проектам теперь берут канал из projects.telegram_channel_id, не отсюда.
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const supabaseUrl = process.env.VITE_SUPABASE_URL;
// service_role, не anon — content_items разрешён на запись/чтение только authenticated-сессиям,
// а бот работает без пользовательской сессии, поэтому ему нужен ключ, который обходит RLS.
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;
const ROUTER_BASE_URL = process.env.ROUTER_AI_BASE_URL;
const ROUTER_KEY = process.env.ROUTER_AI_KEY;
const MODEL = 'anthropic/claude-opus-5';
const IMAGE_MODEL = 'krea/krea-2-medium-turbo';
const MEDIA_BUCKET = 'content-media';
const TGSTAT_TOKEN = process.env.TGSTAT_API_TOKEN;

const TRANSCRIBE_MODEL = 'openai/gpt-transcribe';

const bot = new Telegraf(TOKEN);
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function isOwner(ctx) {
  return Boolean(OWNER_CHAT_ID) && String(ctx.chat.id) === String(OWNER_CHAT_ID);
}

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

// ===== Личный кабинет: закреплённая клавиатура внизу экрана (как в интернет-магазине) =====

const MENU_LABELS = {
  stats: '📊 Статистика',
  projects: '📁 Проекты',
  tasks: '✅ Задачи',
  content: '🎨 На утверждение',
  finance: '💰 Финансы',
  ai: '🤖 Спросить AI'
};

function mainReplyKeyboard() {
  return Markup.keyboard([
    [MENU_LABELS.stats, MENU_LABELS.projects],
    [MENU_LABELS.tasks, MENU_LABELS.content],
    [MENU_LABELS.finance, MENU_LABELS.ai]
  ]).resize();
}

bot.start((ctx) => {
  if (!isOwner(ctx)) return sendPublicWelcome(ctx);
  ctx.reply('🚀 Привет! Я PONA DIGITAL — твой личный кабинет и AI-агент.\n\nВнизу — постоянное меню на кнопках. Можно также написать вопрос текстом или прислать голосовое сообщение — отвечу и могу выполнить действие (с подтверждением).', mainReplyKeyboard());
});

// ===== Приём заявок на трек от подписчиков МузыкAI (публичная часть бота, без доступа к CRM) =====

const orderFlow = new Map(); // chat_id -> { step: 'description' | 'contact', description }

function sendPublicWelcome(ctx) {
  return ctx.reply(
    '🎵 Привет! Здесь можно заказать персональный AI-трек — джингл, промо-ролик, подарок под ваш повод.',
    { reply_markup: { inline_keyboard: [[{ text: '🎵 Заказать трек', callback_data: 'order_track:start' }]] } }
  );
}

bot.action('order_track:start', async (ctx) => {
  await ctx.answerCbQuery();
  orderFlow.set(ctx.chat.id, { step: 'description' });
  await ctx.reply('Опишите, какой трек хотите: тема, повод, настроение, стиль музыки. Чем подробнее — тем точнее получится.');
});

async function handlePublicText(ctx, textOverride) {
  const text = textOverride ?? ctx.message.text;
  if (text.startsWith('/')) return sendPublicWelcome(ctx);

  const state = orderFlow.get(ctx.chat.id);
  if (!state) return sendPublicWelcome(ctx);

  if (state.step === 'description') {
    state.description = text;
    state.step = 'contact';
    orderFlow.set(ctx.chat.id, state);
    return ctx.reply('Оставьте контакт для связи (телефон или username), либо напишите «пропустить».');
  }

  if (state.step === 'contact') {
    const contact = /^пропустить$/i.test(text.trim()) ? null : text.trim();
    orderFlow.delete(ctx.chat.id);
    const { error } = await supabase.from('music_orders').insert({
      telegram_user_id: ctx.chat.id,
      telegram_username: ctx.chat.username || null,
      description: state.description,
      contact
    });
    if (error) {
      console.log(`⚠️ Не удалось сохранить заявку на трек: ${error.message}`);
      return ctx.reply('Не получилось сохранить заявку, попробуйте ещё раз чуть позже.');
    }
    await ctx.reply('✅ Заявка принята! Мы посмотрим и свяжемся с вами.');
    if (OWNER_CHAT_ID) {
      const who = ctx.chat.username ? `@${ctx.chat.username}` : `id ${ctx.chat.id}`;
      await bot.telegram.sendMessage(
        OWNER_CHAT_ID,
        `🎵 Новая заявка на трек от ${who}:\n\n${state.description}${contact ? `\n\nКонтакт: ${contact}` : ''}`
      );
    }
  }
}

bot.command('menu', (ctx) => {
  if (!isOwner(ctx)) return;
  ctx.reply('📋 Меню внизу 👇', mainReplyKeyboard());
});

async function showStats(ctx) {
  const projects = await execReadTool('list_projects', {});
  if (!projects.length) return ctx.reply('Нет проектов.');
  let text = '📊 Статистика:\n\n';
  for (const p of projects) {
    const s = await execReadTool('get_project_stats', { project_name: p.name });
    text += `${p.name}: 👥 ${s.subscribers}, ⏳ на утверждении: ${s.pending_approval}\n`;
  }
  await ctx.reply(text);
}

async function showProjects(ctx) {
  const projects = await execReadTool('list_projects', {});
  await ctx.reply(projects.length ? '📁 Проекты:\n\n' + projects.map(p => `• ${p.name} (${p.status})`).join('\n') : 'Нет проектов.');
}

async function showTasks(ctx) {
  const tasks = await execReadTool('list_tasks', {});
  await ctx.reply(tasks.length ? '✅ Задачи:\n\n' + tasks.map(t => `${t.status === 'done' ? '✅' : '⬜'} ${t.title}`).join('\n') : 'Нет задач.');
}

async function showPendingContent(ctx) {
  const items = await execReadTool('list_pending_content', {});
  await ctx.reply(items.length ? '🎨 На утверждении:\n\n' + items.map(i => `• ${i.topic}: ${i.preview}...`).join('\n\n') : 'Нет постов на утверждении.');
}

async function showFinance(ctx) {
  const s = await execReadTool('get_finance_summary', {});
  await ctx.reply(`💰 Финансы:\n\nДоходы: ${s.income}₽\nРасходы: ${s.expense}₽\nБаланс: ${s.balance}₽`);
}

bot.command('myid', (ctx) => ctx.reply(`Ваш chat_id: ${ctx.chat.id}`));

bot.command('ai', async (ctx) => {
  if (!isOwner(ctx)) return;
  const question = ctx.message.text.replace('/ai', '').trim();
  if (!question) return ctx.reply('Пример: /ai Как дела?');
  ctx.reply('🤔 Думаю...');
  const answer = await askAI(question);
  ctx.reply(`🤖 Ответ:\n\n${answer}`);
});

bot.command('idea', async (ctx) => {
  if (!isOwner(ctx)) return;
  const topic = ctx.message.text.replace('/idea', '').trim();
  if (!topic) return ctx.reply('Пример: /idea блог о еде');
  ctx.reply('💡 Генерирую...');
  const answer = await askAI(`Разработай концепцию проекта: ${topic}. Опиши идею, стратегию, монетизацию.`);
  ctx.reply(`💡 ИДЕЯ:\n\n${answer}`);
});

bot.command('post', async (ctx) => {
  if (!isOwner(ctx)) return;
  const topic = ctx.message.text.replace('/post', '').trim();
  if (!topic) return ctx.reply('Пример: /post борщ');
  ctx.reply('✍️ Пишу...');
  const answer = await askAI(`Напиши пост для Telegram на тему: ${topic}. С эмодзи, структурировано.`);
  ctx.reply(`📝 ПОСТ:\n\n${answer}`);
});

// ===== Инструменты агента =====

async function findProjectByName(name) {
  if (!name) return null;
  const { data } = await supabase.from('projects').select('*').ilike('name', `%${name}%`).limit(1);
  return data && data[0];
}

const TOOLS = [
  { type: 'function', function: { name: 'list_projects', description: 'Получить список всех проектов пользователя', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'get_project_stats', description: 'Статистика по проекту: подписчики, черновики на утверждение', parameters: { type: 'object', properties: { project_name: { type: 'string' } }, required: ['project_name'] } } },
  { type: 'function', function: { name: 'list_tasks', description: 'Список задач, опционально по проекту и статусу', parameters: { type: 'object', properties: { project_name: { type: 'string' }, status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] } }, required: [] } } },
  { type: 'function', function: { name: 'create_task', description: 'Создать новую задачу в проекте (требует подтверждения пользователя)', parameters: { type: 'object', properties: { project_name: { type: 'string' }, title: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] } }, required: ['project_name', 'title'] } } },
  { type: 'function', function: { name: 'complete_task', description: 'Отметить задачу выполненной по названию (требует подтверждения)', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'add_finance', description: 'Добавить доход или расход (требует подтверждения)', parameters: { type: 'object', properties: { type: { type: 'string', enum: ['income', 'expense'] }, amount: { type: 'number' }, description: { type: 'string' } }, required: ['type', 'amount'] } } },
  { type: 'function', function: { name: 'get_finance_summary', description: 'Сводка по финансам: доходы, расходы, баланс', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_pending_content', description: 'Список постов, ожидающих утверждения', parameters: { type: 'object', properties: { project_name: { type: 'string' } }, required: [] } } },
  { type: 'function', function: { name: 'get_weather', description: 'Текущая погода в городе. Если пользователь не назвал город — используй Москву.', parameters: { type: 'object', properties: { city: { type: 'string', description: 'Город, например Moscow' } }, required: [] } } },
  { type: 'function', function: { name: 'get_currency_rate', description: 'Официальный курс валюты к рублю (ЦБ РФ) — доллар, евро и др.', parameters: { type: 'object', properties: { currency_code: { type: 'string', description: 'Код валюты, например USD, EUR, CNY' } }, required: ['currency_code'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Поиск актуальной информации в интернете по ЛЮБОЙ теме, не связанной с CRM/погодой/курсами валют — факты, новости, «сколько», «кто», «из чего», любые общие вопросы. Используй это вместо догадок, если не уверен в ответе.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Поисковый запрос' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_tgstat_stats', description: 'Внешняя аналитика Telegram-канала от сервиса TGStat: число подписчиков по их данным, индекс цитируемости и охват (только для канала, привязанного к TGStat-аккаунту владельца, бесплатный тариф).', parameters: { type: 'object', properties: { channel: { type: 'string', description: 'Username канала, например @VkusnoZnatI' } }, required: [] } } }
];

const WRITE_TOOLS = new Set(['create_task', 'complete_task', 'add_finance']);

async function execReadTool(name, args) {
  switch (name) {
    case 'list_projects': {
      const { data } = await supabase.from('projects').select('name, status').order('created_at', { ascending: false });
      return data || [];
    }
    case 'get_project_stats': {
      const project = await findProjectByName(args.project_name);
      if (!project) return { error: 'Проект не найден' };
      const { data: snapshots } = await supabase.from('channel_stats_snapshots').select('*').eq('project_id', project.id).order('captured_at', { ascending: false }).limit(1);
      const { count: pending } = await supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('project_id', project.id).eq('status', 'draft');
      return { project: project.name, subscribers: snapshots?.[0]?.subscriber_count ?? 'нет данных', pending_approval: pending || 0 };
    }
    case 'list_tasks': {
      let query = supabase.from('tasks').select('title, status, priority, project_id');
      if (args.status) query = query.eq('status', args.status);
      if (args.project_name) {
        const project = await findProjectByName(args.project_name);
        if (project) query = query.eq('project_id', project.id);
      }
      const { data } = await query.limit(30);
      return data || [];
    }
    case 'get_finance_summary': {
      const { data } = await supabase.from('finances').select('type, amount');
      const income = (data || []).filter(f => f.type === 'income').reduce((s, f) => s + Number(f.amount), 0);
      const expense = (data || []).filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.amount), 0);
      return { income, expense, balance: income - expense };
    }
    case 'list_pending_content': {
      let query = supabase.from('content_items').select('topic, body, project_id').eq('status', 'draft');
      if (args.project_name) {
        const project = await findProjectByName(args.project_name);
        if (project) query = query.eq('project_id', project.id);
      }
      const { data } = await query.limit(10);
      return (data || []).map(d => ({ topic: d.topic, preview: (d.body || '').slice(0, 80) }));
    }
    case 'get_weather': {
      const city = args.city || 'Moscow';
      try {
        const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=%C+%t,+ощущается+как+%f&m&lang=ru`);
        if (!r.ok) return { error: 'Сервис погоды недоступен' };
        const text = (await r.text()).trim();
        return { city, weather: text };
      } catch (err) {
        return { error: 'Не удалось получить погоду: ' + err.message };
      }
    }
    case 'get_currency_rate': {
      try {
        const r = await fetch('https://www.cbr-xml-daily.ru/daily_json.js');
        if (!r.ok) return { error: 'Сервис курсов валют недоступен' };
        const data = await r.json();
        const code = (args.currency_code || 'USD').toUpperCase();
        const rate = data.Valute?.[code];
        if (!rate) return { error: `Валюта ${code} не найдена` };
        return { currency: code, name: rate.Name, rate_rub: rate.Value, date: data.Date };
      } catch (err) {
        return { error: 'Не удалось получить курс: ' + err.message };
      }
    }
    case 'web_search': {
      try {
        const r = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
          body: JSON.stringify({
            model: 'perplexity/sonar',
            max_tokens: 800,
            messages: [{ role: 'user', content: args.query }]
          })
        });
        const data = await r.json();
        if (!r.ok) return { error: data.error?.message || 'Поиск недоступен' };
        const msg = data.choices?.[0]?.message;
        const sources = (msg?.annotations || [])
          .filter(a => a.type === 'url_citation')
          .slice(0, 3)
          .map(a => a.url_citation.url);
        return { answer: msg?.content || 'Ничего не найдено', sources };
      } catch (err) {
        return { error: 'Не удалось выполнить поиск: ' + err.message };
      }
    }
    case 'get_tgstat_stats': {
      if (!TGSTAT_TOKEN) return { error: 'TGStat ещё не подключён' };
      try {
        const channel = args.channel || CHANNEL_ID;
        const r = await fetch(`https://api.tgstat.ru/channels/get?token=${TGSTAT_TOKEN}&channelId=${encodeURIComponent(channel)}`);
        const data = await r.json();
        if (data.status !== 'ok') {
          return { error: data.error === 'channel_not_found' ? 'TGStat пока не проиндексировал этот канал (обычно занимает время для новых/маленьких каналов)' : data.error };
        }
        return {
          title: data.response.title,
          subscribers_tgstat: data.response.participants_count,
          citation_index: data.response.ci_index
        };
      } catch (err) {
        return { error: 'TGStat недоступен: ' + err.message };
      }
    }
    default:
      return { error: 'Неизвестный инструмент' };
  }
}

async function execWriteTool(name, args) {
  switch (name) {
    case 'create_task': {
      const project = await findProjectByName(args.project_name);
      if (!project) return { error: 'Проект не найден' };
      const { error } = await supabase.from('tasks').insert({ project_id: project.id, title: args.title, priority: args.priority || 'medium' });
      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'complete_task': {
      const { data } = await supabase.from('tasks').select('id').ilike('title', `%${args.title}%`).limit(1);
      if (!data || data.length === 0) return { error: 'Задача не найдена' };
      const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', data[0].id);
      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'add_finance': {
      const { error } = await supabase.from('finances').insert({ type: args.type, amount: args.amount, description: args.description || null });
      if (error) return { error: error.message };
      return { ok: true };
    }
    default:
      return { error: 'Неизвестный инструмент' };
  }
}

function describeAction(name, args) {
  switch (name) {
    case 'create_task': return `Создать задачу «${args.title}» в проекте «${args.project_name}»${args.priority ? ` (приоритет: ${args.priority})` : ''}`;
    case 'complete_task': return `Отметить задачу «${args.title}» выполненной`;
    case 'add_finance': return `Добавить ${args.type === 'income' ? 'доход' : 'расход'}: ${args.amount}₽${args.description ? ` (${args.description})` : ''}`;
    default: return `${name}(${JSON.stringify(args)})`;
  }
}

const pendingActions = new Map();

const TTS_MODEL = 'minimax/speech-2.8-turbo';

async function synthesizeSpeech(text) {
  const r = await fetch(`${ROUTER_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
    body: JSON.stringify({ model: TTS_MODEL, input: text.slice(0, 2000), voice: 'alloy', response_format: 'mp3' })
  });
  if (!r.ok) throw new Error(await r.text());
  return Buffer.from(await r.arrayBuffer());
}

// Router AI TTS отдаёт только mp3/pcm, а нативные голосовые сообщения Telegram требуют OGG/Opus — конвертируем через ffmpeg.
function convertMp3ToOggOpus(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const tmpId = Math.random().toString(36).slice(2);
    const mp3Path = path.join(os.tmpdir(), `tts_${tmpId}.mp3`);
    const oggPath = path.join(os.tmpdir(), `tts_${tmpId}.ogg`);
    fs.writeFileSync(mp3Path, mp3Buffer);
    ffmpeg(mp3Path)
      .audioCodec('libopus')
      .audioBitrate('32k')
      .format('ogg')
      .on('error', (err) => {
        try { fs.unlinkSync(mp3Path); } catch (_) {}
        reject(err);
      })
      .on('end', () => {
        try {
          const oggBuffer = fs.readFileSync(oggPath);
          fs.unlinkSync(mp3Path);
          fs.unlinkSync(oggPath);
          resolve(oggBuffer);
        } catch (err) { reject(err); }
      })
      .save(oggPath);
  });
}

// Отвечаем текстом всегда; если запрос пришёл голосом — дополнительно озвучиваем ответ настоящим голосовым сообщением.
async function replyWithOptionalVoice(ctx, text, voiceReply) {
  await ctx.reply(text);
  if (voiceReply) {
    try {
      await ctx.sendChatAction('record_voice');
      const mp3 = await synthesizeSpeech(text);
      const ogg = await convertMp3ToOggOpus(mp3);
      await ctx.replyWithVoice({ source: ogg, filename: 'reply.ogg' });
    } catch (err) {
      console.log(`⚠️ Не удалось озвучить ответ: ${err.message}`);
    }
  }
}

async function runAgent(ctx, userText, voiceReply = false) {
  try {
    const response = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        messages: [
          { role: 'system', content: 'Ты — полноценный разговорный AI-агент PONA DIGITAL, отвечаешь буквально на любые вопросы в любой области (не только CRM). Для данных о проектах/задачах/финансах — свои инструменты. Для погоды и курсов валют — свои инструменты. Для ВСЕГО остального, что требует актуальных или конкретных фактов (новости, «сколько/кто/когда/из чего», любая незнакомая тебе тема) — используй web_search вместо догадок, не отказывайся отвечать. Отвечай кратко и по-русски.' },
          { role: 'user', content: userText }
        ],
        tools: TOOLS
      })
    });
    const data = await response.json();
    if (!response.ok) {
      await ctx.reply('Ошибка: ' + (data.error?.message || JSON.stringify(data)));
      return;
    }
    const message = data.choices[0].message;
    const toolCalls = message.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      await replyWithOptionalVoice(ctx, message.content || 'Не понял, уточните запрос.', voiceReply);
      return;
    }

    for (const call of toolCalls) {
      const name = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) {}

      if (WRITE_TOOLS.has(name)) {
        const actionId = Math.random().toString(36).slice(2, 10);
        pendingActions.set(actionId, { name, args });
        await ctx.reply(`❓ ${describeAction(name, args)}?`, {
          reply_markup: { inline_keyboard: [[
            { text: '✅ Да', callback_data: `confirm:${actionId}` },
            { text: '❌ Отмена', callback_data: `cancel:${actionId}` }
          ]] }
        });
      } else {
        const result = await execReadTool(name, args);
        const followUp = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 1024,
            messages: [
              { role: 'system', content: 'Ты — AI-агент PONA DIGITAL. Кратко и по-русски перескажи результат пользователю, без лишней воды.' },
              { role: 'user', content: userText },
              { role: 'assistant', content: null, tool_calls: [call] },
              { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) }
            ]
          })
        });
        const followData = await followUp.json();
        await replyWithOptionalVoice(ctx, followData.choices?.[0]?.message?.content || JSON.stringify(result), voiceReply);
      }
    }
  } catch (err) {
    await ctx.reply('Ошибка агента: ' + err.message);
  }
}

bot.action(/^confirm:(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const id = ctx.match[1];
  const action = pendingActions.get(id);
  if (!action) return ctx.answerCbQuery('Действие устарело');
  pendingActions.delete(id);
  const result = await execWriteTool(action.name, action.args);
  await ctx.answerCbQuery(result.error ? 'Ошибка' : 'Готово ✅');
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: result.error ? `❌ ${result.error}` : '✅ Выполнено', callback_data: 'noop' }]] }); } catch (_) {}
});

bot.action(/^cancel:(.+)$/, async (ctx) => {
  if (!isOwner(ctx)) return ctx.answerCbQuery();
  const id = ctx.match[1];
  pendingActions.delete(id);
  await ctx.answerCbQuery('Отменено');
  try { await ctx.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ Отменено', callback_data: 'noop' }]] }); } catch (_) {}
});

// Инлайн-варианты меню оставлены на случай старых сообщений — дублируют кнопки внизу экрана.
bot.action('menu:stats', async (ctx) => { if (!isOwner(ctx)) return ctx.answerCbQuery(); await ctx.answerCbQuery(); await showStats(ctx); });
bot.action('menu:projects', async (ctx) => { if (!isOwner(ctx)) return ctx.answerCbQuery(); await ctx.answerCbQuery(); await showProjects(ctx); });
bot.action('menu:tasks', async (ctx) => { if (!isOwner(ctx)) return ctx.answerCbQuery(); await ctx.answerCbQuery(); await showTasks(ctx); });
bot.action('menu:content', async (ctx) => { if (!isOwner(ctx)) return ctx.answerCbQuery(); await ctx.answerCbQuery(); await showPendingContent(ctx); });
bot.action('menu:finance', async (ctx) => { if (!isOwner(ctx)) return ctx.answerCbQuery(); await ctx.answerCbQuery(); await showFinance(ctx); });
bot.action('menu:ai', async (ctx) => { if (!isOwner(ctx)) return ctx.answerCbQuery(); await ctx.answerCbQuery(); await ctx.reply('🤖 Напишите вопрос текстом или пришлите голосовое сообщение.'); });

// ===== Голосовые сообщения =====

async function transcribeVoice(fileUrl) {
  const audioRes = await fetch(fileUrl);
  const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', TRANSCRIBE_MODEL);
  const r = await fetch(`${ROUTER_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ROUTER_KEY}` },
    body: form
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data.text;
}

bot.on('voice', async (ctx) => {
  if (!isOwner(ctx)) {
    if (!orderFlow.has(ctx.chat.id)) return;
    try {
      const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
      const text = await transcribeVoice(fileLink.href);
      await handlePublicText(ctx, text);
    } catch (err) {
      await ctx.reply('Не удалось распознать голос, напишите текстом, пожалуйста.');
    }
    return;
  }
  try {
    await ctx.sendChatAction('typing');
    const fileLink = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const text = await transcribeVoice(fileLink.href);
    await ctx.reply(`🎙 Распознано: «${text}»`);
    await runAgent(ctx, text, true);
  } catch (err) {
    await ctx.reply('Не удалось распознать голос: ' + err.message);
  }
});

bot.on('text', async (ctx) => {
  if (!isOwner(ctx)) return handlePublicText(ctx);
  const text = ctx.message.text;
  if (text.startsWith('/')) return;

  switch (text) {
    case MENU_LABELS.stats: return showStats(ctx);
    case MENU_LABELS.projects: return showProjects(ctx);
    case MENU_LABELS.tasks: return showTasks(ctx);
    case MENU_LABELS.content: return showPendingContent(ctx);
    case MENU_LABELS.finance: return showFinance(ctx);
    case MENU_LABELS.ai: return ctx.reply('🤖 Напишите вопрос или пришлите голосовое сообщение — отвечу прямо здесь.');
  }

  await ctx.sendChatAction('typing');
  const thinking = await ctx.reply('🤔 Думаю...');
  await runAgent(ctx, text);
  try { await ctx.deleteMessage(thinking.message_id); } catch (_) {}
});

const MAX_PENDING_APPROVAL = 12; // держим в очереди на утверждение не больше ~3 дней контента разом

async function generateAndUploadImage(id, prompt) {
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
  const path = `${id}/jit-${Date.now()}.${ext}`;
  const buffer = Buffer.from(item.b64_json, 'base64');
  const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType: mediaType });
  if (upErr) throw new Error(upErr.message);
  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

let notifyInProgress = false;

async function notifyNewDrafts() {
  if (!OWNER_CHAT_ID || notifyInProgress) return;
  notifyInProgress = true;
  try {
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

    // Генерация картинки — тяжёлый запрос к тому же AI-провайдеру, что и живой чат с
    // владельцем; если гнать их пачкой, конкурентный чат-запрос может встать в очередь
    // на десятки секунд-минуты. Поэтому на один цикл (раз в минуту) — не больше одной
    // новой генерации картинки, остальные посты дождутся следующих циклов.
    const MAX_IMAGES_PER_CYCLE = 1;
    let imagesGenerated = 0;

    for (const item of items) {
      if (!item.media_url && item.image_prompt && imagesGenerated >= MAX_IMAGES_PER_CYCLE) continue;

      try {
        // Сразу помечаем как "в обработке" (условно, по notified_at IS NULL) — если строку уже
        // забрал другой запуск, claimed.length будет 0 и мы просто пропустим пост, не отправляя дубль.
        const { data: claimed } = await supabase
          .from('content_items')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', item.id)
          .is('notified_at', null)
          .select('id');
        if (!claimed || claimed.length === 0) continue;

        let mediaUrl = item.media_url;
        if (!mediaUrl && item.image_prompt && item.media_type !== 'audio') {
          try {
            mediaUrl = await generateAndUploadImage(item.id, item.image_prompt);
            imagesGenerated++;
            await supabase.from('content_items').update({ media_url: mediaUrl }).eq('id', item.id);
          } catch (imgErr) {
            console.log(`⚠️ Не удалось сгенерировать картинку для ${item.id}: ${imgErr.message}`);
          }
        }

        const when = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'без даты';
        const caption = `На утверждение (${item.topic || 'без темы'}), план на ${when} МСК:\n\n${item.body}`.slice(0, 1024);
        const keyboard = { inline_keyboard: [[
          { text: '✅ Утвердить', callback_data: `approve:${item.id}` },
          { text: '❌ Отклонить', callback_data: `reject:${item.id}` }
        ]] };
        if (mediaUrl && item.media_type === 'audio') {
          await bot.telegram.sendAudio(OWNER_CHAT_ID, mediaUrl, { caption, reply_markup: keyboard });
        } else if (mediaUrl) {
          await bot.telegram.sendPhoto(OWNER_CHAT_ID, mediaUrl, { caption, reply_markup: keyboard });
        } else {
          await bot.telegram.sendMessage(OWNER_CHAT_ID, caption, { reply_markup: keyboard });
        }
      } catch (err) {
        console.log(`❌ Не удалось отправить на утверждение пост ${item.id}: ${err.message}`);
      }
    }
  } finally {
    notifyInProgress = false;
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

async function checkFinanceAccounts() {
  if (!OWNER_CHAT_ID) return;
  try {
    const { data: accounts } = await supabase.from('finance_accounts').select('*');
    if (!accounts) return;

    for (const acc of accounts) {
      if (acc.balance_provider === 'router_ai') {
        try {
          const r = await fetch(`${ROUTER_BASE_URL}/credits`, { headers: { Authorization: `Bearer ${ROUTER_KEY}` } });
          const data = await r.json();
          const balance = data?.data?.credits;
          if (typeof balance === 'number') {
            await supabase.from('finance_accounts').update({ last_balance: balance, last_checked_at: new Date().toISOString() }).eq('id', acc.id);
            if (acc.low_balance_threshold != null && balance < acc.low_balance_threshold) {
              await bot.telegram.sendMessage(OWNER_CHAT_ID, `⚠️ Низкий баланс на «${acc.name}»: ${balance.toFixed(2)} ₽ (порог ${acc.low_balance_threshold} ₽). Пополните: ${acc.url}`);
            }
          }
        } catch (err) {
          console.log(`⚠️ Не удалось проверить баланс ${acc.name}: ${err.message}`);
        }
      }
    }

    // Ручное напоминание по сервисам без авто-проверки — раз в неделю, по понедельникам.
    if (new Date().getDay() === 1) {
      const manual = accounts.filter(a => !a.balance_provider && a.reminder_schedule === 'weekly');
      if (manual.length > 0) {
        const list = manual.map(a => `• ${a.name}: ${a.url}`).join('\n');
        await bot.telegram.sendMessage(OWNER_CHAT_ID, `🔔 Еженедельное напоминание — проверьте балансы:\n\n${list}`);
      }
    }
  } catch (err) {
    console.log(`⚠️ Ошибка проверки финансовых кабинетов: ${err.message}`);
  }
}

// Проверяем напоминания дважды в сутки: 06:00 и 22:00 по Екатеринбургу (UTC+5, без перевода времени) — 01:00 и 17:00 UTC.
const REMINDER_CHECK_UTC_HOURS = [1, 17];

function msUntilNextReminderCheck() {
  const now = new Date();
  const dayStartUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = null;
  for (const dayOffset of [0, 1]) {
    for (const hour of REMINDER_CHECK_UTC_HOURS) {
      const candidate = dayStartUTC + dayOffset * 86400000 + hour * 3600000;
      if (candidate > now.getTime() && (next === null || candidate < next)) next = candidate;
    }
  }
  return next - now.getTime();
}

function scheduleReminderChecks() {
  setTimeout(async () => {
    await checkReminders();
    scheduleReminderChecks();
  }, msUntilNextReminderCheck());
}

async function checkReminders() {
  if (!OWNER_CHAT_ID) return;
  try {
    const { data: due } = await supabase
      .from('reminders')
      .select('*')
      .eq('status', 'pending')
      .is('notified_at', null)
      .lte('remind_at', new Date().toISOString());
    if (!due || due.length === 0) return;

    for (const reminder of due) {
      const claimed = await supabase
        .from('reminders')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', reminder.id)
        .is('notified_at', null)
        .select('id');
      if (!claimed.data || claimed.data.length === 0) continue;

      await bot.telegram.sendMessage(OWNER_CHAT_ID, `🔔 Напоминание: ${reminder.title}`);
    }
  } catch (err) {
    console.log(`⚠️ Ошибка проверки напоминаний: ${err.message}`);
  }
}

// Каждый проект может вести свой Telegram-канал — храним numeric chat_id (не @username: chat_member
// апдейты приходят только с numeric id, а numeric id одинаково работает и для sendMessage/getChatMembersCount).
async function getChannelProjects() {
  const { data } = await supabase.from('projects').select('id, telegram_channel_id').not('telegram_channel_id', 'is', null);
  return data || [];
}

async function captureSubscriberSnapshot() {
  const channelProjects = await getChannelProjects();
  for (const proj of channelProjects) {
    try {
      const count = await bot.telegram.getChatMembersCount(proj.telegram_channel_id);

      const { data: prev } = await supabase
        .from('channel_stats_snapshots')
        .select('subscriber_count')
        .eq('project_id', proj.id)
        .order('captured_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      await supabase.from('channel_stats_snapshots').insert({ project_id: proj.id, subscriber_count: count });

      if (prev && OWNER_CHAT_ID) {
        const drop = prev.subscriber_count - count;
        const threshold = Math.max(2, Math.round(prev.subscriber_count * 0.05));
        if (drop >= threshold) {
          await bot.telegram.sendMessage(OWNER_CHAT_ID, `📉 Резкое падение подписчиков (канал ${proj.telegram_channel_id}): было ${prev.subscriber_count}, стало ${count} (−${drop}).`);
        }
      }
    } catch (err) {
      console.log(`⚠️ Не удалось снять снимок подписчиков для канала ${proj.telegram_channel_id}: ${err.message}`);
    }
  }
}

const MEMBER_STATUSES = ['member', 'administrator', 'creator', 'restricted'];

bot.on('chat_member', async (ctx) => {
  const update = ctx.update.chat_member;
  const channelProjects = await getChannelProjects();
  const project = channelProjects.find(p => p.telegram_channel_id === String(ctx.chat.id));
  if (!project) return;

  const wasMember = MEMBER_STATUSES.includes(update.old_chat_member.status);
  const isMember = MEMBER_STATUSES.includes(update.new_chat_member.status);
  if (wasMember === isMember) return;

  const eventType = isMember ? 'joined' : 'left';
  await supabase.from('channel_member_events').insert({
    project_id: project.id,
    telegram_user_id: update.new_chat_member.user.id,
    event_type: eventType,
    occurred_at: new Date(update.date * 1000).toISOString()
  });
});

let publishInProgress = false;

async function publishScheduledContent() {
  if (publishInProgress) return;
  publishInProgress = true;
  try {
  const { data: items, error } = await supabase
    .from('content_items')
    .select('*, projects(telegram_channel_id)')
    .eq('platform', 'telegram')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error || !items || items.length === 0) return;

  for (const item of items) {
    try {
      const channelId = item.projects?.telegram_channel_id;
      if (!channelId) {
        await supabase.from('content_items').update({ status: 'failed', error: 'У проекта не задан telegram_channel_id' }).eq('id', item.id);
        continue;
      }

      // Атомарно "забираем" пост (scheduled -> publishing) — если строку уже забрал
      // другой запуск (перекрытие интервалов), claimed.length будет 0 и мы её пропустим.
      const { data: claimed } = await supabase
        .from('content_items')
        .update({ status: 'publishing' })
        .eq('id', item.id)
        .eq('status', 'scheduled')
        .select('id');
      if (!claimed || claimed.length === 0) continue;

      const text = item.title ? `${item.title}\n\n${item.body}` : item.body;
      if (item.media_url && item.media_type === 'audio') {
        const caption = text.length > 1024 ? text.slice(0, 1021) + '...' : text;
        await bot.telegram.sendAudio(channelId, item.media_url, { caption, title: item.title || undefined });
      } else if (item.media_url) {
        const caption = text.length > 1024 ? text.slice(0, 1021) + '...' : text;
        await bot.telegram.sendPhoto(channelId, item.media_url, { caption });
      } else {
        await bot.telegram.sendMessage(channelId, text);
      }
      await supabase.from('content_items').update({ status: 'published', published_at: new Date().toISOString(), error: null }).eq('id', item.id);
      console.log(`✅ Опубликован пост "${item.title || item.id}" в Telegram (канал ${channelId})`);
    } catch (err) {
      await supabase.from('content_items').update({ status: 'failed', error: err.message }).eq('id', item.id);
      console.log(`❌ Ошибка публикации поста "${item.title || item.id}": ${err.message}`);
    }
  }
  } finally {
    publishInProgress = false;
  }
}

bot.catch((err, ctx) => {
  console.error(`❌ Ошибка обработчика (${ctx.updateType}):`, err.message);
});

function startBot() {
  bot.launch({ allowedUpdates: ['message', 'callback_query', 'chat_member'] }).catch(err => {
    console.error('❌ Ошибка поллинга бота, повтор через 5с:', err.message);
    setTimeout(startBot, 5000);
  });
}
startBot();
console.log('🤖 Бот PONA DIGITAL + Claude запущен!');

setInterval(captureSubscriberSnapshot, 60 * 60 * 1000);
captureSubscriberSnapshot();
console.log('📈 Снимки числа подписчиков включены (раз в час, по всем проектам с telegram_channel_id) + учёт вступлений/выходов');

setInterval(publishScheduledContent, 60 * 1000);
publishScheduledContent();
console.log('📤 Планировщик контент-завода запущен (проверка очереди раз в минуту, публикует в канал своего проекта)');

if (OWNER_CHAT_ID) {
  setInterval(notifyNewDrafts, 60 * 1000);
  notifyNewDrafts();
  console.log('📝 Отправка черновиков на утверждение владельцу включена');

  setInterval(checkFinanceAccounts, 24 * 60 * 60 * 1000);
  checkFinanceAccounts();
  console.log('💰 Проверка балансов и напоминания по финансовым кабинетам включены (раз в сутки)');

  checkReminders();
  scheduleReminderChecks();
  console.log('🔔 Проверка напоминаний включена (дважды в сутки: 06:00 и 22:00 по Екатеринбургу)');
} else {
  console.log('⚠️ OWNER_CHAT_ID не задан — черновики не будут приходить на утверждение в личку');
}