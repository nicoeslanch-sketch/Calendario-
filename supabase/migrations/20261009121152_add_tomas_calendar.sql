alter table public.tasks
  drop constraint if exists tasks_responsible_check;

alter table public.tasks
  add constraint tasks_responsible_check
  check (responsible in ('nicolas', 'benjamin', 'tomas', 'ambos'));

alter table public.notification_subscriptions
  drop constraint if exists notification_subscriptions_person_check;

alter table public.notification_subscriptions
  add constraint notification_subscriptions_person_check
  check (person in ('nicolas', 'benjamin', 'tomas', 'ambos'));

alter table public.projects
  drop constraint if exists projects_responsible_check;

alter table public.projects
  add constraint projects_responsible_check
  check (responsible in ('nicolas', 'benjamin', 'tomas', 'ambos'));

create or replace function public.register_notification_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_name text,
  p_person text,
  p_user_agent text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if char_length(p_endpoint) not between 20 and 2000
    or char_length(p_p256dh) not between 20 and 500
    or char_length(p_auth) not between 8 and 500
    or char_length(p_device_name) not between 1 and 100
    or char_length(p_user_agent) > 1000
    or p_person not in ('nicolas', 'benjamin', 'tomas', 'ambos') then
    raise exception 'Invalid push subscription';
  end if;

  insert into public.notification_subscriptions(endpoint, p256dh, auth, device_name, person, user_agent, active)
  values (p_endpoint, p_p256dh, p_auth, p_device_name, p_person, p_user_agent, true)
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    device_name = excluded.device_name,
    person = excluded.person,
    user_agent = excluded.user_agent,
    active = true,
    updated_at = now();
end;
$$;

revoke all on function public.register_notification_subscription(text, text, text, text, text, text) from public;
grant execute on function public.register_notification_subscription(text, text, text, text, text, text) to anon, authenticated;
