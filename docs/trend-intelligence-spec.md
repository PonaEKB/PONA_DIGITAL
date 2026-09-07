# Модуль "Trend Intelligence" — техническая спецификация

## 0. Реальность доступов (проверено перед проектированием)

| Платформа | Что нужно | Доступно бизнесу? |
|---|---|---|
| **TikTok Research API** | Поиск/метрики по хэштегам | ❌ **Нет.** Только для университетов/НКО/академических исследователей с одобренной заявкой. «Creators, advertisers, and commercial users are not eligible» — прямая цитата из документации TikTok. |
| **TikTok for Developers** (Display/Content Posting API) | — | Есть, но это про постинг СВОИХ видео и логин через TikTok, не про поиск/анализ чужих трендов. Для этой задачи бесполезен. |
| **YouTube Data API v3** — `search.list`, `videos.list` | Поиск по ключевым словам, метрики (просмотры/лайки/комментарии) | ✅ Да, для ЛЮБЫХ публичных видео, без владения каналом. Стандартный API-ключ. |
| **YouTube Data API v3** — `captions.download` | Транскрипт ролика | ❌ Только для видео, которыми вы владеете (OAuth от владельца канала). Субтитры ЧУЖИХ вирусных роликов через официальный API получить нельзя — 403. |
| **VK API** — `video.search` | Поиск клипов, метрики | ✅ Да, через access-токен сообщества/пользователя. Российский VK в этом смысле открытее. |

**Вывод**: чисто на официальных API можно построить полноценный модуль для **YouTube (поиск+метрики) и VK (поиск+метрики)**. Транскрипция ЧУЖИХ роликов (и TikTok целиком) официальным путём недоступна — это либо отдельное решение с осознанным риском (скачивание через yt-dlp + Whisper, не "официальный API"), либо платный сторонний агрегатор данных (не Trendsee, но того же класса), либо отказ от этой части. Нужно ваше решение перед тем, как строить Этап 2/3 (см. план ниже).

---

## 1. Схема БД (Supabase/Postgres — под существующий стек проекта)

```sql
-- Найденные трендовые видео
create table trend_videos (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('youtube', 'vk', 'tiktok')),
  external_id text not null,
  url text not null,
  title text,
  channel_name text,
  published_at timestamptz,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  duration_seconds int,
  niche text,                    -- поисковый запрос/ниша, по которой найдено
  transcript text,
  transcript_source text check (transcript_source in ('official_caption', 'whisper', 'none')),
  viral_analysis jsonb,          -- {hook, structure, pacing, on_screen_text, emotion}
  velocity_status text check (velocity_status in ('rising', 'stable', 'declining', 'unknown')),
  project_id uuid references projects(id),
  first_seen_at timestamptz default now(),
  last_checked_at timestamptz default now(),
  unique(platform, external_id)
);

-- Снимки метрик во времени — для расчёта динамики (rising/stable/declining)
create table trend_video_snapshots (
  id uuid primary key default gen_random_uuid(),
  trend_video_id uuid references trend_videos(id) on delete cascade,
  views bigint,
  likes bigint,
  comments bigint,
  captured_at timestamptz default now()
);

-- Сценарии, адаптированные под бренд клиента на основе тренда
create table trend_scripts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id),
  trend_video_id uuid references trend_videos(id),
  brief jsonb,                   -- {niche, tone_of_voice, product}
  script_text text,
  status text default 'review' check (status in ('review', 'in_production', 'filmed', 'published', 'rejected')),
  tags text[],
  created_at timestamptz default now()
);

-- Сохранённые поисковые задания (для cron или ручного повтора)
create table trend_search_jobs (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  platforms text[] default array['youtube', 'vk'],
  project_id uuid references projects(id),
  schedule text,                 -- cron-выражение, null = разовый/ручной запуск
  last_run_at timestamptz,
  active boolean default true,
  created_at timestamptz default now()
);
```

## 2. API-контракт (Vercel serverless-функции — тот же паттерн, что уже используется в `api/*.js` проекта)

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/api/trends/search` | body `{query, platforms: ['youtube','vk'], project_id}` — ищет по официальным API, сохраняет в `trend_videos`, возвращает список |
| `GET` | `/api/trends/list` | query `?project_id=&status=&platform=` — список найденных трендов с фильтрами |
| `POST` | `/api/trends/:id/analyze` | Транскрипция (если доступна) + LLM-анализ виральности (хук/структура/темп/текст на экране/эмоция) → заполняет `transcript`, `viral_analysis`, `velocity_status` |
| `POST` | `/api/trends/:id/adapt` | body `{brief: {niche, tone_of_voice, product}}` → LLM генерирует сценарий, создаёт запись в `trend_scripts` |
| `PATCH` | `/api/trends/scripts/:id` | Смена статуса (`review`/`in_production`/`filmed`/`published`/`rejected`), тегов |
| `GET` | `/api/trends/scripts` | query `?project_id=` — сценарии по карточке клиента/кампании |
| `POST` | `/api/trends/jobs` | Создать сохранённое поисковое задание (для регулярного отслеживания ниши) |
| `GET/POST` | `/api/cron/trends-refresh` | Vercel Cron: обновляет метрики отслеживаемых видео → пишет в `trend_video_snapshots`, пересчитывает `velocity_status` |
| `GET/POST` | `/api/cron/trends-scheduled-search` | Vercel Cron: выполняет активные `trend_search_jobs` по расписанию |

Уведомление в CRM/бота о "горячем" тренде — переиспользуем уже существующий канал: бот `bot.cjs` уже умеет присылать сообщения владельцу (`OWNER_CHAT_ID`), значит вебхук — это просто вызов `bot.telegram.sendMessage` из cron-функции при обнаружении резкого роста просмотров.

## 3. Технологический выбор (под существующий стек, не Python)

- **Поиск/метрики**: прямые HTTP-запросы к YouTube Data API v3 и VK API — без доп. библиотек, как уже сделано с TGStat/CBR/wttr.in в проекте
- **Транскрипция**: переиспользовать уже рабочий пайплайн `openai/gpt-transcribe` через Router AI (тот же, что для голосовых сообщений бота) — не поднимать отдельный self-hosted Whisper
- **LLM-анализ виральности и генерация сценария**: тот же Router AI / `anthropic/claude-opus-5`, что уже используется во всём проекте

## 4. План поэтапной реализации

### MVP (Этап 1) — только официальные API, без рисков
- YouTube + VK: поиск по ключевым словам, сбор метрик (просмотры/лайки/комментарии/дата)
- Анализ виральности LLM — на основе **заголовка, описания и метрик** (без транскрипта — его пока нет)
- Простой экран в CRM: список найденных трендов, ручная простановка статуса/тегов
- Ручной запуск поиска из CRM (без cron)
- TikTok — не подключаем (см. раздел 0)

### Этап 2 — расширение
- Периодические снимки метрик (cron) → расчёт `velocity_status` (растущий/стабильный/угасающий)
- Адаптация под бренд: бриф клиента → сценарий через LLM
- Уведомление в Telegram-бота при обнаружении "горячего" тренда
- **Решение по транскрипции чужих роликов**: либо скачивание аудио через yt-dlp (не официальный API — юридически серая зона, ваше явное согласие нужно) + Whisper, либо остаёмся без транскрипта и работаем по метаданным

### Этап 3 — TikTok (только по вашему решению)
- Вариант А: заявка на Research API — по факту не пройдёт (коммерческое использование прямо исключено)
- Вариант Б: платный сторонний агрегатор TikTok-данных (не Trendsee, но того же класса — например RapidAPI-провайдеры) — платно, не "официальный API", но легальнее скрейпинга
- Вариант В: пропустить TikTok полностью, строить контент-стратегию по паттернам из YouTube Shorts + VK Клипы (они пересекаются по формату с TikTok на 80%+)
