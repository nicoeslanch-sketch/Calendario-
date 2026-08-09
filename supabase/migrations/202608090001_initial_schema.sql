create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  date date not null,
  start_time time,
  deadline_time time,
  responsible text not null default 'ambos' check (responsible in ('nicolas', 'benjamin', 'ambos')),
  notify_target text not null default 'responsable' check (notify_target in ('responsable', 'ambos')),
  priority text not null default 'media' check (priority in ('baja', 'media', 'alta', 'urgente')),
  category text not null default 'otro' check (category in ('reunion', 'deadline', 'preparacion', 'seguimiento', 'administracion', 'otro')),
  completed boolean not null default false,
  completed_at timestamptz,
  reminder_minutes_before integer not null default 60 check (reminder_minutes_before between 0 and 10080),
  recurrence_rule jsonb not null default '{"frequency":"none"}'::jsonb,
  is_recurring_template boolean not null default false,
  recurrence_source_id uuid references public.tasks(id) on delete cascade,
  recurrence_date date,
  preparation_business_days integer not null default 0 check (preparation_business_days between 0 and 30),
  preparation_source_id uuid references public.tasks(id) on delete cascade,
  estimated_minutes integer not null default 30 check (estimated_minutes between 5 and 1440),
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completed_timestamp_consistency check (
    (completed and completed_at is not null) or (not completed and completed_at is null)
  ),
  constraint recurrence_instance_consistency check (
    (recurrence_source_id is null and recurrence_date is null) or
    (recurrence_source_id is not null and recurrence_date is not null)
  )
);

create unique index tasks_recurrence_instance_unique on public.tasks(recurrence_source_id, recurrence_date) where recurrence_source_id is not null;
create unique index tasks_preparation_unique on public.tasks(preparation_source_id) where preparation_source_id is not null;
create index tasks_date_responsible_idx on public.tasks(date, responsible) where not is_recurring_template;
create index tasks_due_idx on public.tasks(date, deadline_time) where not completed and deadline_time is not null and not is_recurring_template;
create index tasks_completed_idx on public.tasks(completed_at desc) where completed;

create table public.recurrence_exclusions (
  source_id uuid not null references public.tasks(id) on delete cascade,
  occurrence_date date not null,
  created_at timestamptz not null default now(),
  primary key (source_id, occurrence_date)
);

create table public.subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  completed boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index subtasks_task_position_idx on public.subtasks(task_id, position);

create table public.birthdays (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  month smallint not null check (month between 1 and 12),
  day smallint not null check (day between 1 and 31),
  description text not null default '' check (char_length(description) <= 200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (char_length(endpoint) between 20 and 2000),
  p256dh text not null check (char_length(p256dh) between 20 and 500),
  auth text not null check (char_length(auth) between 8 and 500),
  device_name text not null default 'Dispositivo' check (char_length(device_name) between 1 and 100),
  person text not null check (person in ('nicolas', 'benjamin', 'ambos')),
  user_agent text not null default '' check (char_length(user_agent) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  subscription_id uuid not null references public.notification_subscriptions(id) on delete cascade,
  kind text not null check (kind in ('reminder', 'overdue', 'snooze')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'expired')),
  error text check (char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  unique(task_id, subscription_id, kind, scheduled_for)
);
create index notification_log_status_idx on public.notification_log(status, scheduled_for);

create table public.reminder_snoozes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  scheduled_for timestamptz not null,
  created_at timestamptz not null default now()
);
create index reminder_snoozes_due_idx on public.reminder_snoozes(scheduled_for);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_touch_updated_at before update on public.tasks for each row execute function public.touch_updated_at();
create trigger birthdays_touch_updated_at before update on public.birthdays for each row execute function public.touch_updated_at();
create trigger subscriptions_touch_updated_at before update on public.notification_subscriptions for each row execute function public.touch_updated_at();

create or replace function public.remember_deleted_occurrence()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if pg_trigger_depth() = 1 and old.recurrence_source_id is not null and old.recurrence_date is not null then
    insert into public.recurrence_exclusions(source_id, occurrence_date)
    values (old.recurrence_source_id, old.recurrence_date)
    on conflict do nothing;
  end if;
  return old;
end;
$$;
create trigger tasks_remember_deleted_occurrence before delete on public.tasks for each row execute function public.remember_deleted_occurrence();
revoke execute on function public.remember_deleted_occurrence() from public;

create or replace function public.previous_business_date(p_date date, p_days integer)
returns date language plpgsql immutable set search_path = '' as $$
declare
  result date := p_date;
  remaining integer := greatest(p_days, 0);
begin
  while remaining > 0 loop
    result := result - 1;
    if extract(isodow from result) between 1 and 5 then
      remaining := remaining - 1;
    end if;
  end loop;
  return result;
end;
$$;

create or replace function public.sync_preparation_task()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prep_date date;
begin
  if new.preparation_business_days > 0 and not new.is_recurring_template and new.preparation_source_id is null then
    prep_date := public.previous_business_date(new.date, new.preparation_business_days);
    insert into public.tasks (
      title, description, date, responsible, notify_target, priority, category,
      reminder_minutes_before, recurrence_rule, preparation_source_id, estimated_minutes, metadata
    ) values (
      'Preparar ' || new.title,
      'Preparación generada automáticamente para “' || new.title || '”.',
      prep_date, new.responsible, new.notify_target, new.priority, 'preparacion',
      0, '{"frequency":"none"}'::jsonb, new.id, greatest(15, least(new.estimated_minutes, 120)),
      jsonb_build_object('generated', true, 'source_date', new.date)
    )
    on conflict (preparation_source_id) where preparation_source_id is not null do update set
      title = excluded.title,
      description = excluded.description,
      date = excluded.date,
      responsible = excluded.responsible,
      notify_target = excluded.notify_target,
      priority = excluded.priority,
      updated_at = now();
  elsif new.preparation_business_days = 0 then
    delete from public.tasks where preparation_source_id = new.id;
  end if;
  return new;
end;
$$;
create trigger tasks_sync_preparation after insert or update of title, date, responsible, notify_target, priority, preparation_business_days on public.tasks for each row execute function public.sync_preparation_task();
revoke execute on function public.sync_preparation_task() from public;

create or replace function public.materialize_recurring_tasks(p_start date, p_end date)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  template public.tasks%rowtype;
  occurrence date;
  inserted_id uuid;
  inserted_count integer := 0;
  weekdays integer[];
begin
  if p_end < p_start or p_end - p_start > 731 then
    raise exception 'Invalid recurrence range';
  end if;

  for template in select * from public.tasks where is_recurring_template and date <= p_end loop
    weekdays := coalesce(array(select jsonb_array_elements_text(template.recurrence_rule -> 'weekdays')::integer), array[extract(isodow from template.date)::integer]);
    if cardinality(weekdays) = 0 then
      weekdays := array[extract(isodow from template.date)::integer];
    end if;
    for occurrence in select day::date from generate_series(greatest(p_start, template.date)::timestamp, p_end::timestamp, interval '1 day') day loop
      if (template.recurrence_rule ->> 'frequency' = 'daily')
        or (template.recurrence_rule ->> 'frequency' = 'weekly' and extract(isodow from occurrence)::integer = any(weekdays))
        or (template.recurrence_rule ->> 'frequency' = 'monthly' and extract(day from occurrence) = extract(day from template.date)) then
        if exists (select 1 from public.recurrence_exclusions e where e.source_id = template.id and e.occurrence_date = occurrence) then
          continue;
        end if;
        inserted_id := null;
        insert into public.tasks (
          title, description, date, start_time, deadline_time, responsible, notify_target,
          priority, category, reminder_minutes_before, recurrence_rule, is_recurring_template,
          recurrence_source_id, recurrence_date, preparation_business_days, estimated_minutes, position, metadata
        ) values (
          template.title, template.description, occurrence, template.start_time, template.deadline_time,
          template.responsible, template.notify_target, template.priority, template.category,
          template.reminder_minutes_before, '{"frequency":"none"}'::jsonb, false,
          template.id, occurrence, template.preparation_business_days, template.estimated_minutes,
          template.position, template.metadata
        )
        on conflict (recurrence_source_id, recurrence_date) where recurrence_source_id is not null do update set
          title = excluded.title, description = excluded.description, start_time = excluded.start_time,
          deadline_time = excluded.deadline_time, responsible = excluded.responsible,
          notify_target = excluded.notify_target, priority = excluded.priority, category = excluded.category,
          reminder_minutes_before = excluded.reminder_minutes_before,
          preparation_business_days = excluded.preparation_business_days, estimated_minutes = excluded.estimated_minutes
        returning id into inserted_id;

        if inserted_id is not null then
          inserted_count := inserted_count + 1;
          insert into public.subtasks(task_id, title, completed, position)
          select inserted_id, source.title, false, source.position
          from public.subtasks source
          where source.task_id = template.id
            and not exists (select 1 from public.subtasks target where target.task_id = inserted_id and target.position = source.position);
        end if;
      end if;
    end loop;
  end loop;
  return inserted_count;
end;
$$;

alter table public.tasks enable row level security;
alter table public.recurrence_exclusions enable row level security;
alter table public.subtasks enable row level security;
alter table public.birthdays enable row level security;
alter table public.notification_subscriptions enable row level security;
alter table public.notification_log enable row level security;
alter table public.reminder_snoozes enable row level security;

create policy tasks_shared_calendar on public.tasks for all to anon, authenticated using (true) with check (true);
create policy subtasks_shared_calendar on public.subtasks for all to anon, authenticated using (true) with check (true);
create policy birthdays_shared_calendar on public.birthdays for all to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.tasks, public.subtasks, public.birthdays to anon, authenticated;
revoke all on function public.materialize_recurring_tasks(date, date) from public;
grant execute on function public.materialize_recurring_tasks(date, date) to anon, authenticated;
revoke all on public.notification_subscriptions from anon, authenticated;
revoke all on public.notification_log from anon, authenticated;
revoke all on public.reminder_snoozes from anon, authenticated;

alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.subtasks;
alter publication supabase_realtime add table public.birthdays;
