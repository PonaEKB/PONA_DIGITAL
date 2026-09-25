# PONA DIGITAL — AI-управляемая бизнес-экосистема

## Vision
Единая система управления бизнесом, где 90% процессов автоматизировано через AI-ассистентов, а 10% ключевых решений принимает владелец. Интерфейс в стиле современных CRM с управлением через Telegram-бота.

## Core Concept
Claude Code — мозг системы. Он оркестрирует экосистему нейросетей, распределяет задачи оптимальным моделям, контролирует качество и общается с владельцем через CRM и Telegram-бота.

## Tech Stack
- Frontend: React 18 + Vite
- Styling: CSS (Dosis font)
- Backend: Supabase (PostgreSQL + Auth + Storage)
- AI: Claude Code + DeepSeek через OpenRouter
- Telegram-бот: Telegraf

## Модули
1. Dashboard — общая статистика
2. Projects — 7 подразделов (Идеи, Анализ, Контент-план, Контент, Постинг, Статистика, Финансы)
3. Analytics — прогресс по проектам
4. Finance — доходы/расходы
5. AI Assistants — чат с ИИ
6. Advertisers — воронка поиска рекламодателей по проектам (таблица `advertisers`, схема в `docs/advertisers-schema.sql`). Агент в bot.cjs ищет бренды по нише через web_search, сохраняет кандидатов (`add_advertiser`), готовит питч (`draft_advertiser_pitch`) и двигает статус по воронке `new → pitch_drafted → contacted → negotiating → deal/rejected` (`update_advertiser_status`). Агент никогда не отправляет сообщения рекламодателям сам — только готовит текст, отправка вручную владельцем.
7. Cross-promo — воронка поиска партнёров для взаимного пиара постами без денег (таблица `cross_promo_partners`, схема в `docs/cross-promo-partners-schema.sql`). Та же логика, что у Advertisers, но отдельная сущность: агент ищет каналы похожей тематики/размера через web_search (`add_partner`), готовит предложение обмена (`draft_partner_pitch`) и двигает статус по воронке `new → pitch_drafted → contacted → negotiating → agreed → completed/rejected` (`update_partner_status`). Важно: агент никогда не пишет и не комментирует в чужих каналах/чатах сам — это было бы спамом и нарушением правил Telegram; только готовит текст для ручной отправки владельцем.

## Content Factory
- Площадки: Дзен, VK, Telegram, MAX, Instagram
- 25 постов в день (5 постов × 5 площадок)
- Автопостинг по расписанию
- Генерация через AI

## Database (Supabase)
- projects (id, name, description, status, priority, color, deadline)
- tasks (id, project_id, title, description, status, priority, deadline)
- finances (id, type, amount, description, date)

## Telegram Bot
- /stats — статистика
- /projects — список проектов
- /tasks — задачи
- /report — отчёт
- /ai — вопрос AI
- /idea — генерация идеи
- /post — генерация поста

## Development Roadmap
- ✅ MVP: Dashboard, Projects, Analytics, Finance
- ✅ Telegram-бот
- ✅ AI-чат (DeepSeek через OpenRouter)
- ⏳ Деплой на Vercel
- ⏳ Claude API подключение
- ⏳ Контент-завод
- ⏳ Автопостинг

## Budget
- 50 000 ₽/мес на старте
- Оплата API: OpenRouter (криптовалюта)

## Ключевые ссылки
- Supabase: https://uvzbhdxgijqxstompgus.supabase.co
- Telegram bot token: у владельца
- OpenRouter key: у владельца
