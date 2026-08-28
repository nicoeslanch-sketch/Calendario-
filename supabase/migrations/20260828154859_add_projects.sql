create table public.projects (
  id uuid primary key default gen_random_uuid(),
  idea text not null check (char_length(idea) between 1 and 180),
  description text not null default '' check (char_length(description) <= 4000),
  purpose text not null default '' check (char_length(purpose) <= 2000),
  kpis text not null default '' check (char_length(kpis) <= 2000),
  responsible text not null default 'ambos' check (responsible in ('nicolas', 'benjamin', 'ambos')),
  status text not null default 'sin_iniciar' check (status in ('sin_iniciar', 'iniciado', 'completado')),
  priority text not null default 'amarillo' check (priority in ('rojo', 'amarillo', 'verde')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_completed_timestamp_consistency check (
    (status = 'completado' and completed_at is not null)
    or (status <> 'completado' and completed_at is null)
  )
);

create index projects_priority_status_idx on public.projects(priority, status, updated_at desc);
create index projects_responsible_idx on public.projects(responsible, status);

create trigger projects_touch_updated_at
before update on public.projects
for each row execute function public.touch_updated_at();

alter table public.projects enable row level security;

create policy projects_shared_calendar
on public.projects
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.projects to anon, authenticated;
alter publication supabase_realtime add table public.projects;

create table public.project_notification_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  subscription_id uuid not null references public.notification_subscriptions(id) on delete cascade,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'expired')),
  error text check (char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  unique(project_id, subscription_id, scheduled_for)
);

create index project_notification_log_status_idx
on public.project_notification_log(status, scheduled_for);

create index project_notification_log_subscription_idx
on public.project_notification_log(subscription_id);

alter table public.project_notification_log enable row level security;
revoke all on public.project_notification_log from anon, authenticated;

create or replace function public.project_notification_candidates()
returns table (
  project_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  scheduled_for timestamptz,
  project_idea text,
  project_responsible text
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with notification_time as (
    select (
      ((now() at time zone 'America/Santiago')::date + time '09:00')
      at time zone 'America/Santiago'
    ) as scheduled_for
  )
  select
    p.id,
    s.id,
    s.endpoint,
    s.p256dh,
    s.auth,
    n.scheduled_for,
    p.idea,
    p.responsible
  from public.projects p
  cross join notification_time n
  join public.notification_subscriptions s
    on s.active
    and (
      p.responsible = 'ambos'
      or s.person = 'ambos'
      or s.person = p.responsible
    )
  where p.priority = 'rojo'
    and p.status <> 'completado'
    and now() >= n.scheduled_for
    and now() < n.scheduled_for + interval '4 hours'
    and not exists (
      select 1
      from public.project_notification_log l
      where l.project_id = p.id
        and l.subscription_id = s.id
        and l.scheduled_for = n.scheduled_for
    );
$$;

revoke all on function public.project_notification_candidates() from public, anon, authenticated;
grant execute on function public.project_notification_candidates() to service_role;
