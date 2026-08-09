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
  with task_due as (
    select
      t.*,
      ((t.date + t.deadline_time) at time zone 'America/Santiago') as due_at,
      (((t.date + t.deadline_time) at time zone 'America/Santiago') - make_interval(mins => t.reminder_minutes_before)) as reminder_at
    from public.tasks t
    where not t.completed and not t.is_recurring_template and t.deadline_time is not null
  ), candidates as (
    select t.id as task_id, 'reminder'::text as kind, t.reminder_at as scheduled_for, t.title, t.deadline_time, t.responsible, t.notify_target
    from task_due t
    where t.reminder_minutes_before > 0 and t.reminder_at <= now() and t.reminder_at > now() - interval '20 minutes'
    union all
    select t.id, 'overdue', t.due_at, t.title, t.deadline_time, t.responsible, t.notify_target
    from task_due t
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

create or replace function public.configure_push_cron(p_project_url text, p_publishable_key text)
returns void
language plpgsql
security definer
set search_path = public, cron, net, vault, pg_temp
as $$
begin
  if p_project_url !~ '^https://[a-z0-9]+\.supabase\.co$' then
    raise exception 'Invalid Supabase project URL';
  end if;
  perform vault.create_secret(p_project_url, 'pdr_project_url');
  perform vault.create_secret(p_publishable_key, 'pdr_publishable_key');
  perform cron.unschedule(jobid) from cron.job where jobname = 'pdr-push-dispatch';
  perform cron.schedule(
    'pdr-push-dispatch',
    '*/2 * * * *',
    $job$
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'pdr_project_url' order by created_at desc limit 1) || '/functions/v1/push-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'pdr_publishable_key' order by created_at desc limit 1),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'pdr_publishable_key' order by created_at desc limit 1)
        ),
        body := jsonb_build_object('scheduled_at', now())
      );
    $job$
  );
end;
$$;
revoke all on function public.configure_push_cron(text, text) from public, anon, authenticated;

