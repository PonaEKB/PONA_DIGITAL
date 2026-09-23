-- Модуль "Рекламодатели": CRM-воронка поиска и учёта рекламных интеграций по проектам.
-- Выполнить один раз в Supabase SQL Editor.

create table if not exists advertisers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  -- Идентификация
  name text not null,
  niche text,
  website text,
  contact_info text,

  -- Оценка
  relevance_score smallint check (relevance_score between 1 and 5),
  budget_tier text check (budget_tier in ('small', 'medium', 'large')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  source text,

  -- Воронка
  status text not null default 'new' check (status in ('new', 'pitch_drafted', 'contacted', 'negotiating', 'deal', 'rejected')),
  pitch_text text,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  follow_up_at timestamptz,

  -- Условия сделки
  ad_format text,
  proposed_price numeric,
  agreed_price numeric,
  deal_type text check (deal_type in ('money', 'barter')),
  publish_date date,
  post_url text,

  -- Результаты
  reach integer,
  payment_received boolean not null default false,

  notes text,
  created_at timestamptz not null default now()
);

create index if not exists advertisers_project_id_idx on advertisers(project_id);
create index if not exists advertisers_status_idx on advertisers(status);

alter table advertisers enable row level security;

-- Владелец (авторизованная сессия в дашборде) видит и правит всё.
-- Бот работает через service_role и обходит RLS, отдельная политика ему не нужна.
create policy "Owner full access to advertisers"
  on advertisers for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
