alter table public.tasks
  add column reminder_minutes integer[] not null default '{}'::integer[];

update public.tasks
set reminder_minutes = case
  when reminder_minutes_before > 0 then array[reminder_minutes_before]
  else '{}'::integer[]
end;

alter table public.tasks
  add constraint tasks_reminder_minutes_valid check (
    cardinality(reminder_minutes) <= 8
    and reminder_minutes <@ array[5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080]::integer[]
  );

create or replace function public.sync_preparation_task()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prep_date date;
begin
  if new.preparation_business_days > 0 and not new.is_recurring_template and new.preparation_source_id is null then
    prep_date := public.previous_business_date(new.date, new.preparation_business_days);
    insert into public.tasks (
      title, description, date, responsible, notify_target, priority, category,
      reminder_minutes_before, reminder_minutes, recurrence_rule, preparation_source_id, estimated_minutes, metadata
    ) values (
      'Preparar ' || new.title,
      'Preparación generada automáticamente para “' || new.title || '”.',
      prep_date, new.responsible, new.notify_target, new.priority, 'preparacion',
      0, '{}'::integer[], '{"frequency":"none"}'::jsonb, new.id, greatest(15, least(new.estimated_minutes, 120)),
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
          priority, category, reminder_minutes_before, reminder_minutes, recurrence_rule, is_recurring_template,
          recurrence_source_id, recurrence_date, preparation_business_days, estimated_minutes, position, metadata
        ) values (
          template.title, template.description, occurrence, template.start_time, template.deadline_time,
          template.responsible, template.notify_target, template.priority, template.category,
          template.reminder_minutes_before, template.reminder_minutes, '{"frequency":"none"}'::jsonb, false,
          template.id, occurrence, template.preparation_business_days, template.estimated_minutes,
          template.position, template.metadata
        )
        on conflict (recurrence_source_id, recurrence_date) where recurrence_source_id is not null do update set
          title = excluded.title, description = excluded.description, start_time = excluded.start_time,
          deadline_time = excluded.deadline_time, responsible = excluded.responsible,
          notify_target = excluded.notify_target, priority = excluded.priority, category = excluded.category,
          reminder_minutes_before = excluded.reminder_minutes_before,
          reminder_minutes = excluded.reminder_minutes,
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

create or replace function public.notification_candidates()
returns table (
  task_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  kind text,
  scheduled_for timestamptz,
  task_title text,
  deadline_time time
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with tasks_with_due as (
    select
      t.*,
      ((t.date + t.deadline_time) at time zone 'America/Santiago') as due_at
    from public.tasks t
    where not t.completed and not t.is_recurring_template and t.deadline_time is not null
  ), reminders as (
    select distinct
      t.id as task_id,
      'reminder'::text as kind,
      t.due_at - make_interval(mins => offsets.minutes) as scheduled_for,
      t.title,
      t.deadline_time,
      t.responsible,
      t.notify_target
    from tasks_with_due t
    cross join lateral unnest(t.reminder_minutes) as offsets(minutes)
    where offsets.minutes > 0
  ), candidates as (
    select r.*
    from reminders r
    where r.scheduled_for <= now() and r.scheduled_for > now() - interval '20 minutes'
    union all
    select t.id, 'overdue', t.due_at, t.title, t.deadline_time, t.responsible, t.notify_target
    from tasks_with_due t
    where t.due_at <= now() and t.due_at > now() - interval '20 minutes'
    union all
    select t.id, 'snooze', s.scheduled_for, t.title, t.deadline_time, t.responsible, t.notify_target
    from public.reminder_snoozes s join public.tasks t on t.id = s.task_id
    where not t.completed and s.scheduled_for <= now() and s.scheduled_for > now() - interval '20 minutes'
  )
  select c.task_id, s.id, s.endpoint, s.p256dh, s.auth, c.kind, c.scheduled_for, c.title, c.deadline_time
  from candidates c
  join public.notification_subscriptions s on s.active
    and (
      c.notify_target = 'ambos'
      or c.responsible = 'ambos'
      or s.person = 'ambos'
      or s.person = c.responsible
    )
  where not exists (
    select 1 from public.notification_log l
    where l.task_id = c.task_id and l.subscription_id = s.id and l.kind = c.kind and l.scheduled_for = c.scheduled_for
  );
$$;

revoke all on function public.notification_candidates() from public, anon, authenticated;
grant execute on function public.notification_candidates() to service_role;
