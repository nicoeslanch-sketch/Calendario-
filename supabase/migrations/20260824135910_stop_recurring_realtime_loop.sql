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
        insert into public.tasks as target (
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
          preparation_business_days = excluded.preparation_business_days,
          estimated_minutes = excluded.estimated_minutes,
          position = excluded.position,
          metadata = excluded.metadata
        where target.title is distinct from excluded.title
          or target.description is distinct from excluded.description
          or target.start_time is distinct from excluded.start_time
          or target.deadline_time is distinct from excluded.deadline_time
          or target.responsible is distinct from excluded.responsible
          or target.notify_target is distinct from excluded.notify_target
          or target.priority is distinct from excluded.priority
          or target.category is distinct from excluded.category
          or target.reminder_minutes_before is distinct from excluded.reminder_minutes_before
          or target.reminder_minutes is distinct from excluded.reminder_minutes
          or target.preparation_business_days is distinct from excluded.preparation_business_days
          or target.estimated_minutes is distinct from excluded.estimated_minutes
          or target.position is distinct from excluded.position
          or target.metadata is distinct from excluded.metadata
        returning id into inserted_id;

        if inserted_id is not null then
          inserted_count := inserted_count + 1;
          insert into public.subtasks(task_id, title, completed, position)
          select inserted_id, source.title, false, source.position
          from public.subtasks source
          where source.task_id = template.id
            and not exists (select 1 from public.subtasks target_subtask where target_subtask.task_id = inserted_id and target_subtask.position = source.position);
        end if;
      end if;
    end loop;
  end loop;
  return inserted_count;
end;
$$;
