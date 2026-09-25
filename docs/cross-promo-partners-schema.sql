-- Модуль "Кросс-промо": поиск и учёт каналов для взаимного пиара постами (без денег), по проектам.
-- Уже применено к базе напрямую через Supabase MCP 2026-09-25 — этот файл хранится для истории/повторного применения на других окружениях.

create table if not exists cross_promo_partners (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,

  channel_name text not null,
  channel_username text,
  niche text,
  subscriber_count integer,
  contact_info text,

  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  source text,

  status text not null default 'new' check (status in ('new', 'pitch_drafted', 'contacted', 'negotiating', 'agreed', 'completed', 'rejected')),
  pitch_text text,
  exchange_format text,
  our_post_date date,
  their_post_date date,
  first_contact_at timestamptz,
  last_contact_at timestamptz,
  follow_up_at timestamptz,

  notes text,
  created_at timestamptz not null default now()
);

create index if not exists cross_promo_partners_project_id_idx on cross_promo_partners(project_id);
create index if not exists cross_promo_partners_status_idx on cross_promo_partners(status);

alter table cross_promo_partners enable row level security;

create policy "Owner full access to cross_promo_partners"
  on cross_promo_partners for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
