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
  advertisers: '🤝 Реклама',
  ai: '🤖 Спросить AI'
};

function mainReplyKeyboard() {
  return Markup.keyboard([
    [MENU_LABELS.stats, MENU_LABELS.projects],
    [MENU_LABELS.tasks, MENU_LABELS.content],
    [MENU_LABELS.finance, MENU_LABELS.advertisers],
    [MENU_LABELS.ai]
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

const ADVERTISER_STATUS_EMOJI = {
  new: '🆕', pitch_drafted: '✍️', contacted: '📨', negotiating: '🤝', deal: '✅', rejected: '❌'
};

async function showAdvertisers(ctx) {
  const list = await execReadTool('list_advertisers', {});
  if (!list.length) return ctx.reply('🤝 Пока нет рекламодателей в воронке. Напишите мне, например: «найди рекламодателей для Вкусной географии».');
  const text = list.map(a => `${ADVERTISER_STATUS_EMOJI[a.status] || '•'} ${a.name}${a.niche ? ` (${a.niche})` : ''} — ${a.status}`).join('\n');
  await ctx.reply(`🤝 Рекламодатели:\n\n${text}`);
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
  { type: 'function', function: { name: 'get_tgstat_stats', description: 'Внешняя аналитика Telegram-канала от сервиса TGStat: число подписчиков по их данным, индекс цитируемости и охват (только для канала, привязанного к TGStat-аккаунту владельца, бесплатный тариф).', parameters: { type: 'object', properties: { channel: { type: 'string', description: 'Username канала, например @VkusnoZnatI' } }, required: [] } } },
  { type: 'function', function: { name: 'list_advertisers', description: 'Список потенциальных рекламодателей проекта, опционально по статусу воронки', parameters: { type: 'object', properties: { project_name: { type: 'string' }, status: { type: 'string', enum: ['new', 'pitch_drafted', 'contacted', 'negotiating', 'deal', 'rejected'] } }, required: [] } } },
  { type: 'function', function: { name: 'add_advertiser', description: 'Добавить нового кандидата в рекламодатели проекта (требует подтверждения)', parameters: { type: 'object', properties: { project_name: { type: 'string' }, name: { type: 'string' }, niche: { type: 'string' }, contact_info: { type: 'string' }, website: { type: 'string' }, relevance_score: { type: 'number', description: '1-5, насколько бренд подходит тематике канала' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, source: { type: 'string' }, notes: { type: 'string' } }, required: ['project_name', 'name'] } } },
  { type: 'function', function: { name: 'draft_advertiser_pitch', description: 'Сгенерировать питч-сообщение для конкретного рекламодателя и сохранить в его карточку (требует подтверждения)', parameters: { type: 'object', properties: { advertiser_name: { type: 'string' } }, required: ['advertiser_name'] } } },
  { type: 'function', function: { name: 'update_advertiser_status', description: 'Изменить статус рекламодателя в воронке, например после ответа или сделки (требует подтверждения)', parameters: { type: 'object', properties: { advertiser_name: { type: 'string' }, status: { type: 'string', enum: ['new', 'pitch_drafted', 'contacted', 'negotiating', 'deal', 'rejected'] }, notes: { type: 'string' } }, required: ['advertiser_name', 'status'] } } }
];

const WRITE_TOOLS = new Set(['create_task', 'complete_task', 'add_finance', 'add_advertiser', 'draft_advertiser_pitch', 'update_advertiser_status']);

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
    case 'list_advertisers': {
      let query = supabase.from('advertisers').select('name, niche, status, priority, relevance_score, contact_info').order('created_at', { ascending: false });
      if (args.status) query = query.eq('status', args.status);
      if (args.project_name) {
        const project = await findProjectByName(args.project_name);
        if (project) query = query.eq('project_id', project.id);
      }
      const { data } = await query.limit(30);
      return data || [];
    }
    default:
      return { error: 'Неизвестный инструмент' };
  }
}

async function findAdvertiserByName(name) {
  if (!name) return null;
  const { data } = await supabase.from('advertisers').select('*').ilike('name', `%${name}%`).limit(1);
  return data && data[0];
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
    case 'add_advertiser': {
      const project = await findProjectByName(args.project_name);
      if (!project) return { error: 'Проект не найден' };
      const { error } = await supabase.from('advertisers').insert({
        project_id: project.id,
        name: args.name,
        niche: args.niche || null,
        contact_info: args.contact_info || null,
        website: args.website || null,
        relevance_score: args.relevance_score || null,
        priority: args.priority || 'medium',
        source: args.source || null,
        notes: args.notes || null
      });
      if (error) return { error: error.message };
      return { ok: true };
    }
    case 'draft_advertiser_pitch': {
      const advertiser = await findAdvertiserByName(args.advertiser_name);
      if (!advertiser) return { error: 'Рекламодатель не найден' };
      const { data: project } = await supabase.from('projects').select('name').eq('id', advertiser.project_id).limit(1).single();
      const pitch = await askAI(`Напиши короткое дружелюбное питч-сообщение для бренда «${advertiser.name}» (ниша: ${advertiser.niche || 'не указана'}) с предложением рекламной интеграции в Telegram-канале «${project?.name || ''}». По делу, с конкретным предложением формата и без канцелярита.`);
      const { error } = await supabase.from('advertisers').update({ pitch_text: pitch, status: 'pitch_drafted' }).eq('id', advertiser.id);
      if (error) return { error: error.message };
      return { ok: true, pitch };
    }
    case 'update_advertiser_status': {
      const advertiser = await findAdvertiserByName(args.advertiser_name);
      if (!advertiser) return { error: 'Рекламодатель не найден' };
      const update = { status: args.status };
      if (args.notes) update.notes = args.notes;
      if (args.status === 'contacted' && !advertiser.first_contact_at) update.first_contact_at = new Date().toISOString();
      if (args.status === 'contacted' || args.status === 'negotiating') update.last_contact_at = new Date().toISOString();
      const { error } = await supabase.from('advertisers').update(update).eq('id', advertiser.id);
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
    case 'add_advertiser': return `Добавить рекламодателя «${args.name}»${args.niche ? ` (${args.niche})` : ''} в проект «${args.project_name}»`;
    case 'draft_advertiser_pitch': return `Сгенерировать питч для «${args.advertiser_name}» и сохранить в карточку`;
    case 'update_advertiser_status': return `Изменить статус «${args.advertiser_name}» на «${args.status}»`;
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
          { role: 'system', content: 'Ты — полноценный разговорный AI-агент PONA DIGITAL, отвечаешь буквально на любые вопросы в любой области (не только CRM). Для данных о проектах/задачах/финансах — свои инструменты. Для погоды и курсов валют — свои инструменты. Для поиска и учёта рекламодателей канала используй web_search, чтобы найти подходящие по нише бренды, затем add_advertiser, чтобы сохранить кандидата, draft_advertiser_pitch — чтобы написать питч, и update_advertiser_status — чтобы двигать по воронке (new → pitch_drafted → contacted → negotiating → deal/rejected). Никогда не отправляй сообщения рекламодателям сам — только готовь текст, отправляет владелец вручную. Для ВСЕГО остального, что требует актуальных или конкретных фактов (новости, «сколько/кто/когда/из чего», любая незнакомая тебе тема) — используй web_search вместо догадок, не отказывайся отвечать. Отвечай кратко и по-русски.' },
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
    case MENU_LABELS.advertisers: return showAdvertisers(ctx);
    case MENU_LABELS.ai: return ctx.reply('🤖 Напишите вопрос или пришлите голосовое сообщение — отвечу прямо здесь.');
  }

  await ctx.sendChatAction('typing');
  const thinking = await ctx.reply('🤔 Думаю...');
  await runAgent(ctx, text);
  try { await ctx.deleteMessage(thinking.message_id); } catch (_) {}
});


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

// Telegram's own bot API нередко не может забрать файл с телеграмовского же CDN (cdn*.telesco.pe)
// напрямую по URL при отправке ("Bad Request: failed to get HTTP URL content"), даже когда обычный
// HTTP-запрос к той же ссылке отрабатывает нормально. Поэтому любое изображение из внешнего
// источника (скриншот канала, og:image официальной страницы) сначала скачиваем сами и
// перезаливаем в своё хранилище — так публикация гарантированно не упадёт по этой причине.
async function downloadAndReupload(id, sourceUrl) {
  const res = await fetch(sourceUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const path = `${id}/src-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, buffer, { contentType });
  if (upErr) throw new Error(upErr.message);
  const { data: pub } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

let notifyInProgress = false;

const PER_PROJECT_MAX_PENDING = 5; // на проект отдельно — иначе один зависший проект блокирует все остальные
const MAX_NOTIFY_PER_CYCLE = 10; // общий предохранитель на один цикл (раз в минуту), чтобы не закинуть Telegram потоком

async function notifyNewDrafts() {
  if (!OWNER_CHAT_ID || notifyInProgress) return;
  notifyInProgress = true;
  try {
    // Лимит на утверждение — ПО КАЖДОМУ ПРОЕКТУ отдельно, а не один общий на всех. Иначе один
    // канал с большой неотвеченной очередью (как было с «Чемодан Историй») блокирует уведомления
    // вообще по всем остальным проектам, даже если там всего пара свежих черновиков.
    const { data: pendingRows } = await supabase
      .from('content_items')
      .select('project_id')
      .eq('platform', 'telegram')
      .eq('status', 'draft')
      .not('notified_at', 'is', null);
    const pendingByProject = {};
    (pendingRows || []).forEach(r => { pendingByProject[r.project_id] = (pendingByProject[r.project_id] || 0) + 1; });

    // release_at — проекты со своим ритмом подтверждения (напр. «Звёздный Компас», раз в сутки
    // одной пачкой в 23:00 МСК) помечают черновики так, чтобы этот общий цикл не забирал их
    // раньше времени. NULL — как раньше, без ограничения.
    const { data: candidates, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('platform', 'telegram')
      .eq('status', 'draft')
      .is('notified_at', null)
      .or(`release_at.is.null,release_at.lte.${new Date().toISOString()}`)
      .order('scheduled_at', { ascending: true })
      .limit(100);

    if (error || !candidates || candidates.length === 0) return;

    const items = [];
    for (const c of candidates) {
      const used = pendingByProject[c.project_id] || 0;
      if (used >= PER_PROJECT_MAX_PENDING) continue;
      items.push(c);
      pendingByProject[c.project_id] = used + 1;
      if (items.length >= MAX_NOTIFY_PER_CYCLE) break;
    }

    if (items.length === 0) return;

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
          await bot.telegram.sendAudio(OWNER_CHAT_ID, mediaUrl, { caption, parse_mode: 'HTML', reply_markup: keyboard });
        } else if (mediaUrl) {
          await bot.telegram.sendPhoto(OWNER_CHAT_ID, mediaUrl, { caption, parse_mode: 'HTML', reply_markup: keyboard });
        } else {
          await bot.telegram.sendMessage(OWNER_CHAT_ID, caption, { parse_mode: 'HTML', reply_markup: keyboard });
        }
      } catch (err) {
        console.log(`❌ Не удалось отправить на утверждение пост ${item.id}: ${err.message}`);
      }
    }
  } finally {
    notifyInProgress = false;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// «Чемодан Историй»: раз в 4 дня отправляем пачку сразу на 4 дня вперёд (16 постов) с готовыми
// картинками — не в общем непрерывном ритме (1 картинка/мин, до 12 в очереди), а отдельным разовым
// всплеском, потому что владелец явно попросил утверждать этот канал большими пачками раз в 4 дня.
let chemodanBatchInProgress = false;

// Картинки для «Чемодан Историй» — настоящие фото с Wikimedia Commons (подобраны заранее,
// хранятся в content_items.media_urls), а не AI-генерация. Экономит токены и точнее по содержанию.
async function notifyChemodanBatch() {
  if (!OWNER_CHAT_ID || chemodanBatchInProgress) return;
  chemodanBatchInProgress = true;
  try {
    const { data: project } = await supabase.from('projects').select('id').eq('name', 'Чемодан Историй').maybeSingle();
    if (!project) return;

    const { data: items, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('project_id', project.id)
      .eq('status', 'draft')
      .is('notified_at', null)
      .order('scheduled_at', { ascending: true })
      .limit(16);

    if (error || !items || items.length === 0) return;

    for (const item of items) {
      try {
        const { data: claimed } = await supabase
          .from('content_items')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', item.id)
          .is('notified_at', null)
          .select('id');
        if (!claimed || claimed.length === 0) continue;

        const when = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'без даты';
        const caption = `На утверждение (${item.topic || 'без темы'}), план на ${when} МСК:\n\n${item.body}`.slice(0, 1024);
        const keyboard = { inline_keyboard: [[
          { text: '✅ Утвердить', callback_data: `approve:${item.id}` },
          { text: '❌ Отклонить', callback_data: `reject:${item.id}` }
        ]] };
        const urls = item.media_urls && item.media_urls.length > 0 ? item.media_urls : (item.media_url ? [item.media_url] : []);

        if (urls.length > 1) {
          // Telegram не разрешает inline-кнопки на альбоме — шлём альбом, затем отдельным
          // сообщением текст с кнопками утверждения.
          await bot.telegram.sendMediaGroup(OWNER_CHAT_ID, urls.map((u, i) => ({ type: 'photo', media: u, caption: i === 0 ? caption : undefined, parse_mode: i === 0 ? 'HTML' : undefined })));
          await bot.telegram.sendMessage(OWNER_CHAT_ID, `👆 На утверждение (${item.topic || 'без темы'})`, { reply_markup: keyboard });
        } else if (urls.length === 1) {
          await bot.telegram.sendPhoto(OWNER_CHAT_ID, urls[0], { caption, parse_mode: 'HTML', reply_markup: keyboard });
        } else {
          await bot.telegram.sendMessage(OWNER_CHAT_ID, caption, { parse_mode: 'HTML', reply_markup: keyboard });
        }
      } catch (err) {
        console.log(`❌ Не удалось отправить на утверждение пост «Чемодан Историй» ${item.id}: ${err.message}`);
      }
      await sleep(1500);
    }
  } catch (err) {
    console.log(`⚠️ Ошибка пачки «Чемодан Историй»: ${err.message}`);
  } finally {
    chemodanBatchInProgress = false;
  }
}

// «Звёздный Компас»: раз в сутки, в 23:00 МСК, отправляем на утверждение до 3 черновиков следующего
// дня (общий/деловой/любовный), ЕСЛИ они есть в статусе draft. По факту с сентября 2026 контент для
// этого проекта грузится сразу в статусе 'scheduled' (владелец попросил публиковать без утверждения) —
// так что в обычной работе эта функция просто не находит черновиков и ничего не делает. Оставлена на
// случай, если для этого канала снова понадобится ручное утверждение постов.
let zvezdnyBatchInProgress = false;

async function notifyZvezdnyKompasBatch() {
  if (!OWNER_CHAT_ID || zvezdnyBatchInProgress) return;
  zvezdnyBatchInProgress = true;
  try {
    const { data: project } = await supabase.from('projects').select('id').eq('name', HOROSCOPE_PROJECT_NAME).maybeSingle();
    if (!project) return;

    const { data: items, error } = await supabase
      .from('content_items')
      .select('*')
      .eq('project_id', project.id)
      .eq('status', 'draft')
      .is('notified_at', null)
      .order('scheduled_at', { ascending: true })
      .limit(3);

    if (error || !items || items.length === 0) return;

    for (const item of items) {
      try {
        const { data: claimed } = await supabase
          .from('content_items')
          .update({ notified_at: new Date().toISOString() })
          .eq('id', item.id)
          .is('notified_at', null)
          .select('id');
        if (!claimed || claimed.length === 0) continue;

        let mediaUrl = item.media_url;
        if (!mediaUrl && item.image_prompt) {
          try {
            mediaUrl = await generateAndUploadImage(item.id, item.image_prompt);
            await supabase.from('content_items').update({ media_url: mediaUrl }).eq('id', item.id);
          } catch (imgErr) {
            console.log(`⚠️ Не удалось сгенерировать картинку для «Звёздный Компас» ${item.id}: ${imgErr.message}`);
          }
        }

        const when = item.scheduled_at ? new Date(item.scheduled_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : 'без даты';
        const caption = `На утверждение (${item.topic || 'без темы'}), план на ${when} МСК:\n\n${item.body}`.slice(0, 1024);
        const keyboard = { inline_keyboard: [[
          { text: '✅ Утвердить', callback_data: `approve:${item.id}` },
          { text: '❌ Отклонить', callback_data: `reject:${item.id}` }
        ]] };

        if (mediaUrl) {
          await bot.telegram.sendPhoto(OWNER_CHAT_ID, mediaUrl, { caption, parse_mode: 'HTML', reply_markup: keyboard });
        } else {
          await bot.telegram.sendMessage(OWNER_CHAT_ID, caption, { parse_mode: 'HTML', reply_markup: keyboard });
        }
      } catch (err) {
        console.log(`❌ Не удалось отправить на утверждение пост «Звёздный Компас» ${item.id}: ${err.message}`);
      }
      await sleep(1500);
    }
  } catch (err) {
    console.log(`⚠️ Ошибка пачки «Звёздный Компас»: ${err.message}`);
  } finally {
    zvezdnyBatchInProgress = false;
  }
}

const ZVEZDNY_BATCH_UTC_HOUR = 20; // 23:00 МСК (UTC+3)

function msUntilNextUtcHour(hour) {
  const now = new Date();
  const dayStartUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const dayOffset of [0, 1]) {
    const candidate = dayStartUTC + dayOffset * 86400000 + hour * 3600000;
    if (candidate > now.getTime()) return candidate - now.getTime();
  }
  return 86400000;
}

function scheduleZvezdnyKompasBatch() {
  setTimeout(async () => {
    await notifyZvezdnyKompasBatch();
    scheduleZvezdnyKompasBatch();
  }, msUntilNextUtcHour(ZVEZDNY_BATCH_UTC_HOUR));
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

// Раз в день проверяем, нет ли постов со статусом "ошибка" по любому проекту, и сразу пишем
// владельцу — иначе о сломанной публикации узнаём только если он сам случайно заметит в CRM.
const FAILED_POSTS_CHECK_UTC_HOUR = 6; // 09:00 МСК

function scheduleFailedPostsCheck() {
  setTimeout(async () => {
    await checkFailedPosts();
    scheduleFailedPostsCheck();
  }, msUntilNextUtcHour(FAILED_POSTS_CHECK_UTC_HOUR));
}

async function checkFailedPosts() {
  if (!OWNER_CHAT_ID) return;
  try {
    const { data: failed } = await supabase
      .from('content_items')
      .select('id, topic, error, project_id')
      .eq('platform', 'telegram')
      .eq('status', 'failed');
    if (!failed || failed.length === 0) return;

    const { data: projects } = await supabase.from('projects').select('id, name');
    const nameById = Object.fromEntries((projects || []).map(p => [p.id, p.name]));

    const lines = failed.slice(0, 20).map(f => `• ${nameById[f.project_id] || '?'} — ${f.topic || 'без темы'}: ${f.error || 'без описания ошибки'}`);
    const extra = failed.length > 20 ? `\n…и ещё ${failed.length - 20}` : '';
    await bot.telegram.sendMessage(OWNER_CHAT_ID, `⚠️ Посты со статусом «ошибка» (${failed.length}), не опубликованы:\n\n${lines.join('\n')}${extra}`);
  } catch (e) {
    console.log(`⚠️ Ошибка проверки failed-постов: ${e.message}`);
  }
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
      const caption = text.length > 1024 ? text.slice(0, 1021) + '...' : text;
      const urls = item.media_urls && item.media_urls.length > 0 ? item.media_urls : (item.media_url ? [item.media_url] : []);
      if (urls.length > 0 && item.media_type === 'audio') {
        await bot.telegram.sendAudio(channelId, urls[0], { caption, parse_mode: 'HTML', title: item.title || undefined });
      } else if (urls.length > 1) {
        await bot.telegram.sendMediaGroup(channelId, urls.map((u, i) => ({ type: 'photo', media: u, caption: i === 0 ? caption : undefined, parse_mode: i === 0 ? 'HTML' : undefined })));
      } else if (urls.length === 1) {
        await bot.telegram.sendPhoto(channelId, urls[0], { caption, parse_mode: 'HTML' });
      } else {
        await bot.telegram.sendMessage(channelId, text, { parse_mode: 'HTML' });
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

// ===== Ежедневный дайджест «Цифровой Разум»: мониторинг Telegram-каналов про ИИ =====

const DIGITAL_MIND_PROJECT_NAME = 'Цифровой Разум';
const DIGITAL_MIND_DIGEST_UTC_HOUR = 3; // 06:00 МСК — за 2.5 часа до первого слота публикации (08:30 МСК)
// Слоты публикации — 08:30 / 12:35 / 19:30 / 21:30 МСК (UTC+3), совпадают с api/generate-content.js
const POST_SLOTS_UTC = [{ h: 5, m: 30 }, { h: 9, m: 35 }, { h: 16, m: 30 }, { h: 18, m: 30 }];
const DIGITAL_MIND_CHANNELS = [
  'gptpublic', 'hiaimedia', 'ai_newz', 'TochkiNadAI', 'misha_davai_po_novoi',
  'Castalia_Ai', 'NeuralShit', 'gpt_news', 'neuralpony', 'neuraldvig',
  'neural_braining', 'notboring_tech', 'nsekt', 'n_nagornova', 'incubeai_pro'
];

function stripTelegramHtml(raw) {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#0?36;/g, '$')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

async function fetchChannelPosts(username, limit = 5) {
  try {
    const res = await fetch(`https://t.me/s/${username}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const html = await res.text();
    // Каждое сообщение — отдельный <div class="tgme_widget_message ..." data-post="channel/id">,
    // разбиваем по этой границе, чтобы точно связать текст и фото ОДНОГО поста, а не всей страницы разом.
    const chunks = html.split('<div class="tgme_widget_message ');
    const results = [];
    for (let i = 1; i < chunks.length; i++) {
      const chunk = chunks[i];
      const textMatch = chunk.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<div class="tgme_widget_message_meta|<\/div>\s*<\/div>)/);
      if (!textMatch) continue;
      const text = stripTelegramHtml(textMatch[1]);
      if (text.length < 40) continue;
      const photoMatch = chunk.match(/tgme_widget_message_photo_wrap[^"]*"[^>]*style="[^"]*background-image:url\('([^']+)'\)/);
      results.push({ username, text, photoUrl: photoMatch ? photoMatch[1] : null });
    }
    return results.slice(-limit);
  } catch (e) {
    console.log(`⚠️ Не удалось получить посты из @${username}: ${e.message}`);
    return [];
  }
}

const PEXELS_KEY = process.env.PEXELS_API_KEY;
const UNSPLASH_KEY = process.env.UNSPLASH_ACCESS_KEY;

async function pexelsPhoto(query) {
  if (!PEXELS_KEY) return null;
  try {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`, { headers: { Authorization: PEXELS_KEY } });
    if (!r.ok) return null;
    const d = await r.json();
    const p = d.photos?.[0];
    return p ? `https://images.pexels.com/photos/${p.id}/pexels-photo-${p.id}.jpeg?auto=compress&cs=tinysrgb&h=650&w=940` : null;
  } catch { return null; }
}
async function unsplashPhoto(query) {
  if (!UNSPLASH_KEY) return null;
  try {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`, { headers: { Authorization: 'Client-ID ' + UNSPLASH_KEY } });
    if (!r.ok) return null;
    const d = await r.json();
    return d.results?.[0]?.urls?.regular || null;
  } catch { return null; }
}
async function fetchAbstractTechPhoto(query) {
  return (await pexelsPhoto(query)) || (await unsplashPhoto(query)) || null;
}

async function verifyLiveImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return false;
    const len = Number(res.headers.get('content-length') || 0);
    // Отсекаем маленькие иконки/фавиконки og:image (обычно < 15КБ) — нужна полноценная обложка, не логотип
    return len === 0 || len >= 15000;
  } catch { return false; }
}

// Ищем официальный скриншот через реальный веб-поиск (Perplexity Sonar), но НИКОГДА не доверяем
// прямой ссылке на картинку от модели — она часто выдумывает правдоподобный, но несуществующий
// путь к файлу. Доверяем только найденной странице (с реальной цитатой), а картинку достаём сами
// через og:image и обязательно проверяем, что она живая, прежде чем использовать.
async function findOfficialScreenshot(searchQuery) {
  try {
    const res = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'perplexity/sonar-pro',
        messages: [{ role: 'user', content: `Find the single most relevant official page (official product/company site, blog post, or documentation — not a news aggregator) about: ${searchQuery}. Return ONLY a JSON object: {"page_url": "..."}` }]
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const citations = (data.choices?.[0]?.message?.annotations || []).map(a => a.url_citation?.url).filter(Boolean);
    const raw = data.choices?.[0]?.message?.content || '';
    const m = raw.match(/"page_url"\s*:\s*"([^"]+)"/);
    const claimedUrl = m ? m[1] : null;
    // доверяем странице только если она реально была в списке цитат (значит поиск её правда нашёл)
    const pageUrl = claimedUrl && citations.includes(claimedUrl) ? claimedUrl : citations[0];
    if (!pageUrl) return null;

    const pageRes = await fetch(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (!ogMatch) return null;
    const imageUrl = ogMatch[1];
    return (await verifyLiveImage(imageUrl)) ? { imageUrl, pageUrl } : null;
  } catch (e) {
    console.log(`⚠️ findOfficialScreenshot ошибка: ${e.message}`);
    return null;
  }
}

let digitalMindInProgress = false;

async function generateDigitalMindDigest() {
  if (digitalMindInProgress) return;
  digitalMindInProgress = true;
  try {
    const { data: project } = await supabase.from('projects').select('id').eq('name', DIGITAL_MIND_PROJECT_NAME).maybeSingle();
    if (!project) { console.log('⚠️ Проект «Цифровой Разум» не найден, пропуск дайджеста'); return; }

    // Идемпотентность: не генерируем повторно, если сегодня уже был дайджест
    const todayStartUTC = new Date();
    todayStartUTC.setUTCHours(0, 0, 0, 0);
    const { data: already } = await supabase
      .from('content_items')
      .select('id')
      .eq('project_id', project.id)
      .gte('created_at', todayStartUTC.toISOString())
      .limit(1);
    if (already && already.length > 0) { console.log('🤖 Дайджест «Цифровой Разум» на сегодня уже создан'); return; }

    const { data: agent } = await supabase.from('agents').select('id').eq('name', 'Копирайтер').maybeSingle();
    const agentId = agent?.id || null;

    console.log('🤖 Собираю свежие посты из', DIGITAL_MIND_CHANNELS.length, 'каналов про ИИ...');
    const collected = [];
    for (const ch of DIGITAL_MIND_CHANNELS) {
      const posts = await fetchChannelPosts(ch, 5);
      collected.push(...posts);
      await new Promise(r => setTimeout(r, 300));
    }

    if (collected.length === 0) { console.log('⚠️ Не удалось собрать ни одного поста, пропуск дайджеста'); return; }

    const trimmed = collected.slice(0, 100);
    const digest = trimmed.map((item, i) => `[${i}]${item.photoUrl ? ' 📷' : ''} @${item.username}: ${item.text}`).join('\n\n---\n\n').slice(0, 40000);

    const prompt = `Вот свежие посты из ${DIGITAL_MIND_CHANNELS.length} Telegram-каналов про нейросети и ИИ, каждый с номером в квадратных скобках (📷 значит у поста есть картинка/скриншот):\n\n${digest}\n\nНа основе ЭТОЙ реальной информации напиши 4 поста для Telegram-канала "Цифровой Разум" на сегодня, по одному на каждую рубрику:\n1. "Нейросеть дня" — про конкретный инструмент/модель/релиз из новостей: что нового, чем полезен, как попробовать.\n2. "Факт о технологиях" — удивительный факт или открытие из новостей.\n3. "Лайфхак с ИИ" — практический совет, как использовать что-то из этих новостей в жизни или работе.\n4. "Мысль дня" — короткая мысль о том, куда движутся технологии, на основе трендов из новостей.\n\nПиши живо, с HTML-разметкой Telegram (<b>, <i>, <u> — используй по смыслу, не в каждом предложении), эмодзи к месту, реальными деталями из новостей (названия моделей, цифры, конкретные факты). НЕ выдумывай ничего, чего нет в источниках — если для какой-то рубрики мало материала, бери самое интересное, что есть. Разбивай текст на короткие абзацы пустой строкой.\n\nДля каждого поста укажи поле "source_index" — номер поста из списка выше (в квадратных скобках), на котором ЭТОТ пост в основном базируется, ПРЕДПОЧТИТЕЛЬНО тот, что помечен 📷 (реальный скриншот всегда лучше сгенерированной картинки). Если пост синтезирован из нескольких источников без одного явного лидера — верни null.\n\nДобавь поле "search_query" — короткий запрос на английском для поиска ОФИЦИАЛЬНОЙ страницы по теме поста (например "Claude Opus 5.5 official announcement Anthropic", "Qwen3.8-LiveTranslate official page Alibaba") — используется, если у source_index нет своей картинки, чтобы найти официальный скриншот/обложку.\n\nДобавь также поле "image_prompt" — подробный промпт на английском для генерации иллюстрации (последний фолбэк, если и официальную страницу найти не удалось). Единый стиль НЕ обязателен — главное, чтобы изображение максимально точно передавало СМЫСЛ поста: если новость про робота — покажи робота, если про мозг — что-то анатомически похожее на мозг, если про экономику/цены — что-то про деньги/графики. Без текста, без букв, без логотипов компаний.\n\nВерни СТРОГО валидный JSON-массив из 4 объектов вида {"rubric": "Нейросеть дня", "text": "готовый текст поста", "source_index": 3, "search_query": "...", "image_prompt": "..."}, без markdown-обёртки и пояснений.`;

    const response = await fetch(`${ROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ROUTER_KEY}` },
      body: JSON.stringify({
        model: 'anthropic/claude-sonnet-5',
        max_tokens: 8192,
        messages: [
          { role: 'system', content: 'Ты — контент-редактор Telegram-канала про нейросети и технологии. Отвечай СТРОГО валидным JSON-массивом, без markdown и пояснений.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || JSON.stringify(data));
    const raw = data.choices?.[0]?.message?.content || '[]';
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const posts = JSON.parse(cleaned);
    if (!Array.isArray(posts) || posts.length === 0) throw new Error('AI вернул не массив постов');

    const now = new Date();
    const usedPhotoUrls = new Set();
    const rows = [];
    for (let idx = 0; idx < posts.length; idx++) {
      const p = posts[idx];
      const slot = POST_SLOTS_UTC[idx % POST_SLOTS_UTC.length];
      const scheduledAt = new Date(now);
      scheduledAt.setUTCHours(slot.h, slot.m, 0, 0);
      if (scheduledAt <= now) scheduledAt.setUTCDate(scheduledAt.getUTCDate() + 1);

      let photo = null;
      let sourceUsername = null;
      let sourcePageUrl = null;
      const src = (typeof p.source_index === 'number') ? trimmed[p.source_index] : null;
      if (src && src.photoUrl && !usedPhotoUrls.has(src.photoUrl)) {
        try {
          photo = await downloadAndReupload(`digitalmind-${Date.now()}-${idx}`, src.photoUrl);
          sourceUsername = src.username;
        } catch (dlErr) {
          console.log(`⚠️ Не удалось перезалить скриншот из @${src.username}: ${dlErr.message}`);
        }
      }
      if (!photo && p.search_query) {
        const found = await findOfficialScreenshot(p.search_query);
        if (found && !usedPhotoUrls.has(found.imageUrl)) {
          try {
            photo = await downloadAndReupload(`digitalmind-${Date.now()}-${idx}`, found.imageUrl);
            sourcePageUrl = found.pageUrl;
          } catch (dlErr) {
            console.log(`⚠️ Не удалось перезалить официальный скриншот: ${dlErr.message}`);
          }
        }
      }
      if (!photo && p.image_prompt) {
        try {
          photo = await generateAndUploadImage(`digitalmind-${Date.now()}-${idx}`, p.image_prompt);
        } catch (genErr) {
          console.log(`⚠️ Генерация фото не удалась для «${p.rubric}», фолбэк на Pexels/Unsplash: ${genErr.message}`);
        }
      }
      if (!photo) photo = await fetchAbstractTechPhoto('neural network glowing abstract technology');
      if (photo && usedPhotoUrls.has(photo)) photo = await fetchAbstractTechPhoto('artificial intelligence abstract digital');
      if (photo) usedPhotoUrls.add(photo);

      let body = p.text;
      if (sourceUsername) body += `\n\n📸 Источник: @${sourceUsername}`;
      else if (sourcePageUrl) body += `\n\n📸 Источник: <a href="${sourcePageUrl}">официальная страница</a>`;

      rows.push({
        project_id: project.id,
        agent_id: agentId,
        platform: 'telegram',
        topic: `${DIGITAL_MIND_PROJECT_NAME} — ${p.rubric || 'Нейросеть дня'}`,
        body,
        media_urls: photo ? [photo] : null,
        status: 'draft',
        scheduled_at: scheduledAt.toISOString()
      });
    }

    const { error: insErr } = await supabase.from('content_items').insert(rows);
    if (insErr) throw new Error(insErr.message);
    console.log(`✅ Дайджест «Цифровой Разум» создан: ${rows.length} постов на основе ${collected.length} новостей`);
  } catch (e) {
    console.log(`⚠️ Ошибка генерации дайджеста «Цифровой Разум»: ${e.message}`);
  } finally {
    digitalMindInProgress = false;
  }
}

function scheduleDigitalMindDigest() {
  setTimeout(async () => {
    await generateDigitalMindDigest();
    scheduleDigitalMindDigest();
  }, msUntilNextUtcHour(DIGITAL_MIND_DIGEST_UTC_HOUR));
}

// ===== Отдельный публичный бот «Звёздный Компас»: гороскоп по знаку зодиака по запросу =====

const HOROSCOPE_BOT_TOKEN = process.env.HOROSCOPE_BOT_TOKEN;
const HOROSCOPE_PROJECT_NAME = 'Звёздный Компас';
// Рубрики дня — используются и тут (чтобы найти нужный пост), и в generate-horoscope-content.js
// (чтобы промаркировать посты при создании). Совпадают с topic каждого content_item.
const HOROSCOPE_TOPICS = {
  general: `${HOROSCOPE_PROJECT_NAME} — Общий`,
  business: `${HOROSCOPE_PROJECT_NAME} — Деловой`,
  love: `${HOROSCOPE_PROJECT_NAME} — Любовь`
};

if (HOROSCOPE_BOT_TOKEN) {
  const horoscopeBot = new Telegraf(HOROSCOPE_BOT_TOKEN);

  const ZODIAC_SIGNS = [
    { key: 'aries', label: '♈ Овен' },
    { key: 'taurus', label: '♉ Телец' },
    { key: 'gemini', label: '♊ Близнецы' },
    { key: 'cancer', label: '♋ Рак' },
    { key: 'leo', label: '♌ Лев' },
    { key: 'virgo', label: '♍ Дева' },
    { key: 'libra', label: '♎ Весы' },
    { key: 'scorpio', label: '♏ Скорпион' },
    { key: 'sagittarius', label: '♐ Стрелец' },
    { key: 'capricorn', label: '♑ Козерог' },
    { key: 'aquarius', label: '♒ Водолей' },
    { key: 'pisces', label: '♓ Рыбы' }
  ];

  function zodiacKeyboard() {
    const rows = [];
    for (let i = 0; i < ZODIAC_SIGNS.length; i += 3) {
      rows.push(ZODIAC_SIGNS.slice(i, i + 3).map(s => ({ text: s.label, callback_data: `zodiac:${s.key}` })));
    }
    return { inline_keyboard: rows };
  }

  horoscopeBot.start((ctx) => {
    ctx.reply('🔮 Привет! Выбери свой знак зодиака — пришлю прогноз на ближайшие 10 дней.', { reply_markup: zodiacKeyboard() });
  });

  horoscopeBot.command('menu', (ctx) => {
    ctx.reply('Выбери знак зодиака:', { reply_markup: zodiacKeyboard() });
  });

  horoscopeBot.action(/^zodiac:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const sign = ZODIAC_SIGNS.find(s => s.key === ctx.match[1]);
    if (!sign) return;

    try {
      // "Сегодня" по московскому времени (00:00 МСК), не по UTC — иначе смена дня съезжала бы на 3 часа.
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });

      // Индивидуальный гороскоп на знак — отдельная таблица (не парсим строку из поста канала).
      // Только сегодняшний день, не всю пачку вперёд.
      const { data: entry } = await supabase
        .from('zodiac_daily_horoscopes')
        .select('date, text')
        .eq('sign_key', sign.key)
        .eq('date', todayStr)
        .maybeSingle();

      if (!entry) {
        await ctx.reply('Гороскоп на сегодня ещё не готов, загляните чуть позже 🔮');
        return;
      }

      const dateLabel = new Date(entry.date).toLocaleDateString('ru-RU', {
        day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow'
      });

      await ctx.reply(`${sign.label} — гороскоп на ${dateLabel}\n\n${entry.text}`, {
        reply_markup: zodiacKeyboard()
      });
    } catch (err) {
      console.log(`⚠️ Ошибка гороскоп-бота: ${err.message}`);
      await ctx.reply('Не получилось получить гороскоп, попробуйте ещё раз чуть позже.');
    }
  });

  horoscopeBot.catch((err, ctx) => {
    console.error(`❌ Ошибка гороскоп-бота (${ctx.updateType}):`, err.message);
  });

  function startHoroscopeBot() {
    horoscopeBot.launch({ allowedUpdates: ['message', 'callback_query'] }).catch(err => {
      console.error('❌ Ошибка поллинга гороскоп-бота, повтор через 5с:', err.message);
      setTimeout(startHoroscopeBot, 5000);
    });
  }
  startHoroscopeBot();
  console.log('🔮 Бот «Звёздный Компас» запущен!');
} else {
  console.log('⚠️ HOROSCOPE_BOT_TOKEN не задан — бот «Звёздный Компас» отключён');
}

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

  checkFailedPosts();
  scheduleFailedPostsCheck();
  console.log('⚠️ Проверка постов со статусом «ошибка» включена (раз в сутки, в 09:00 МСК)');

  // Без немедленного запуска при старте — иначе каждый передеплой слал бы новую пачку.
  // Первую пачку с настоящими фото отправляем один раз вручную отдельным скриптом.
  setInterval(notifyChemodanBatch, 4 * 24 * 60 * 60 * 1000);
  console.log('🧳 Пачка «Чемодан Историй» на утверждение включена (раз в 4 дня, настоящие фото)');

  scheduleZvezdnyKompasBatch();
  console.log('🔮 Пачка «Звёздный Компас» на утверждение включена (раз в сутки, в 23:00 МСК, 3 поста)');

  generateDigitalMindDigest();
  scheduleDigitalMindDigest();
  console.log('🤖 Ежедневный дайджест «Цифровой Разум» включён (06:00 МСК, мониторинг 15 AI-каналов)');
} else {
  console.log('⚠️ OWNER_CHAT_ID не задан — черновики не будут приходить на утверждение в личку');
}