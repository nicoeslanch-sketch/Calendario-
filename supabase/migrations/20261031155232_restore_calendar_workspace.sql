-- Restore calendar capabilities without reopening anonymous access to profiles.
alter table public.tasks drop constraint if exists tasks_responsible_check;
alter table public.projects drop constraint if exists projects_responsible_check;
alter table public.notification_subscriptions drop constraint if exists notification_subscriptions_person_check;
alter table public.tasks add constraint tasks_profile_fk foreign key(responsible) references pdr_private.profiles(id);
alter table public.projects add constraint projects_profile_fk foreign key(responsible) references pdr_private.profiles(id);
alter table public.notification_subscriptions add constraint subscriptions_profile_fk foreign key(person) references pdr_private.profiles(id);

revoke all on public.tasks,public.subtasks,public.projects,public.birthdays from anon,authenticated;
revoke execute on function public.register_notification_subscription(text,text,text,text,text,text),
 public.disable_notification_subscription(text),public.schedule_task_snooze(uuid,integer) from public,anon,authenticated;

create or replace function public.pdr_calendar(p_action text,p_token text,p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner text; v_id uuid; v_result jsonb; v_input jsonb; v_data jsonb;
 v_task public.tasks%rowtype; v_project public.projects%rowtype;
 v_start date; v_end date; v_existing boolean; v_responsible text;
begin
 select profile_id into v_owner from pdr_private.sessions
 where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida. Vuelve a entrar a tu perfil.' using errcode='28000'; end if;
 if octet_length(p_payload::text)>100000 then raise exception 'El contenido es demasiado extenso.'; end if;
 v_id=nullif(p_payload->>'id','')::uuid;
 v_input=coalesce(p_payload->'input','{}');
 if p_action='load' then
   v_start=(p_payload->>'start')::date; v_end=(p_payload->>'end')::date;
   if v_start is null or v_end is null or v_end<v_start or v_end-v_start>100 then raise exception 'Rango de fechas inválido.'; end if;
   perform public.materialize_recurring_tasks(v_start,v_end);
   return jsonb_build_object('tasks',coalesce((select jsonb_agg(to_jsonb(t)||jsonb_build_object('subtasks',
     coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from public.subtasks s where s.task_id=t.id),'[]'::jsonb))
     order by t.date,t.position,t.start_time) from public.tasks t where t.date between v_start and v_end
       and not t.is_recurring_template and t.responsible in(v_owner,'ambos')),'[]'::jsonb),
     'birthdays',coalesce((select jsonb_agg(to_jsonb(b) order by b.month,b.day) from public.birthdays b where b.active),'[]'::jsonb));
 elsif p_action='history' then
   return coalesce((select jsonb_agg(to_jsonb(t) order by t.completed_at desc) from
     (select * from public.tasks where completed and responsible in(v_owner,'ambos')
      and completed_at>=now()-make_interval(days=>least(365,greatest(1,coalesce((p_payload->>'days')::integer,30))))
      order by completed_at desc limit 200) t),'[]'::jsonb);
 elsif p_action='projects' then
   return coalesce((select jsonb_agg(to_jsonb(p) order by p.updated_at desc) from public.projects p
     where p.responsible in(v_owner,'ambos')),'[]'::jsonb);
 elsif p_action in('save_task','patch_task','delete_task','snooze') then
   if v_id is not null then
     select * into v_task from public.tasks where id=v_id for update;
     if not found or v_task.responsible not in(v_owner,'ambos') then
       raise exception 'No tienes acceso a esta tarea.' using errcode='42501'; end if;
   elsif p_action<>'save_task' then raise exception 'Falta la tarea.'; end if;
   if p_action='delete_task' then delete from public.tasks where id=v_id; return '{}'::jsonb; end if;
   if p_action='snooze' then
     perform public.schedule_task_snooze(v_id,(p_payload->>'minutes')::integer); return '{}'::jsonb;
   end if;
   v_existing=v_task.id is not null;
   if not v_existing then
     v_task.id=gen_random_uuid(); v_task.description=''; v_task.responsible=v_owner;
     v_task.notify_target='responsable'; v_task.priority='media'; v_task.category='otro';
     v_task.completed=false; v_task.reminder_minutes_before=60; v_task.reminder_minutes=array[60];
     v_task.recurrence_rule='{"frequency":"none"}'; v_task.is_recurring_template=false;
     v_task.preparation_business_days=0; v_task.estimated_minutes=30; v_task.position=0;
     v_task.metadata='{}'; v_task.created_at=now(); v_task.updated_at=now(); v_task.is_secondary=false;
   end if;
   select coalesce(jsonb_object_agg(key,value),'{}') into v_data from jsonb_each(v_input)
    where key=any(array['title','description','date','start_time','deadline_time','responsible','notify_target',
      'priority','category','completed','reminder_minutes_before','reminder_minutes','recurrence_rule',
      'preparation_business_days','estimated_minutes','position','is_secondary']);
   v_task=jsonb_populate_record(v_task,v_data);
   if v_task.responsible is null or v_task.responsible not in(v_owner,'ambos') then
     raise exception 'Usa tu perfil o Compartido para esta tarea.' using errcode='42501'; end if;
   if v_task.completed then v_task.completed_at=coalesce(v_task.completed_at,now()); else v_task.completed_at=null; end if;
   if v_task.recurrence_rule->>'frequency' not in('none','daily','weekly','monthly') or v_task.recurrence_rule->>'frequency' is null then
     raise exception 'Recurrencia inválida.'; end if;
   v_task.is_recurring_template=v_task.recurrence_source_id is null and v_task.recurrence_rule->>'frequency'<>'none';
   if v_task.reminder_minutes is null or cardinality(v_task.reminder_minutes)>8 or
     exists(select 1 from unnest(v_task.reminder_minutes) m where m<1 or m>10080) then raise exception 'Avisos inválidos.'; end if;
   v_task.reminder_minutes_before=coalesce((select max(m) from unnest(v_task.reminder_minutes) m),0);
   if v_existing then
     update public.tasks set title=v_task.title,description=v_task.description,date=v_task.date,start_time=v_task.start_time,
      deadline_time=v_task.deadline_time,responsible=v_task.responsible,notify_target=v_task.notify_target,
      priority=v_task.priority,category=v_task.category,completed=v_task.completed,completed_at=v_task.completed_at,
      reminder_minutes_before=v_task.reminder_minutes_before,reminder_minutes=v_task.reminder_minutes,
      recurrence_rule=v_task.recurrence_rule,is_recurring_template=v_task.is_recurring_template,
      preparation_business_days=v_task.preparation_business_days,estimated_minutes=v_task.estimated_minutes,
      position=v_task.position,is_secondary=v_task.is_secondary where id=v_id;
   else insert into public.tasks select v_task.*; end if;
   if p_action='save_task' then
     if jsonb_typeof(coalesce(v_input->'subtasks','[]'))<>'array' or jsonb_array_length(coalesce(v_input->'subtasks','[]'))>100 then
       raise exception 'Subtareas inválidas.'; end if;
     delete from public.subtasks where task_id=v_task.id;
     insert into public.subtasks(task_id,title,completed,position)
      select v_task.id,trim(s->>'title'),coalesce((s->>'completed')::boolean,false),pos::integer
      from jsonb_array_elements(coalesce(v_input->'subtasks','[]')) with ordinality as x(s,pos) where trim(s->>'title')<>'';
   end if;
   return to_jsonb(v_task);
 elsif p_action='subtask' then
   update public.subtasks s set completed=(p_payload->>'completed')::boolean where s.id=v_id
     and exists(select 1 from public.tasks t where t.id=s.task_id and t.responsible in(v_owner,'ambos'));
   if not found then raise exception 'No tienes acceso a esta subtarea.' using errcode='42501'; end if;
   return '{}'::jsonb;
 elsif p_action in('save_project','delete_project') then
   if v_id is not null then
     select * into v_project from public.projects where id=v_id for update;
     if not found or v_project.responsible not in(v_owner,'ambos') then raise exception 'No tienes acceso a este proyecto.' using errcode='42501'; end if;
   end if;
   if p_action='delete_project' then delete from public.projects where id=v_id; return '{}'::jsonb; end if;
   v_existing=v_project.id is not null;
   if not v_existing then
     v_project.id=gen_random_uuid(); v_project.description='';v_project.purpose='';v_project.kpis='';
     v_project.responsible=v_owner;v_project.status='sin_iniciar';v_project.priority='amarillo';
     v_project.created_at=now();v_project.updated_at=now();
   end if;
   select coalesce(jsonb_object_agg(key,value),'{}') into v_data from jsonb_each(v_input)
     where key=any(array['idea','description','purpose','kpis','responsible','status','priority']);
   v_project=jsonb_populate_record(v_project,v_data);
   if v_project.responsible is null or v_project.responsible not in(v_owner,'ambos') then
     raise exception 'Usa tu perfil o Compartido para este proyecto.' using errcode='42501'; end if;
   v_project.completed_at=case when v_project.status='completado' then coalesce(v_project.completed_at,now()) else null end;
   if v_existing then
     update public.projects set idea=v_project.idea,description=v_project.description,purpose=v_project.purpose,
       kpis=v_project.kpis,responsible=v_project.responsible,status=v_project.status,priority=v_project.priority,
       completed_at=v_project.completed_at where id=v_id;
   else insert into public.projects select v_project.*; end if;
   return to_jsonb(v_project);
 elsif p_action='save_birthday' then
   if v_id is null then
     insert into public.birthdays(name,month,day,description,active)
     values(trim(v_input->>'name'),(v_input->>'month')::integer,(v_input->>'day')::integer,coalesce(v_input->>'description',''),true)
     returning to_jsonb(birthdays.*) into v_result;
   else
     update public.birthdays set name=trim(v_input->>'name'),month=(v_input->>'month')::integer,
       day=(v_input->>'day')::integer,description=coalesce(v_input->>'description','') where id=v_id
       returning to_jsonb(birthdays.*) into v_result;
     if not found then raise exception 'Cumpleaños no encontrado.'; end if;
   end if;
   return v_result;
 elsif p_action='delete_birthday' then
   delete from public.birthdays where id=v_id; return '{}'::jsonb;
 elsif p_action='subscribe' then
   if p_payload->>'person' is distinct from v_owner then raise exception 'El dispositivo debe asociarse al perfil abierto.' using errcode='42501'; end if;
   insert into public.notification_subscriptions(endpoint,p256dh,auth,device_name,person,user_agent,active)
    values(p_payload->>'endpoint',p_payload->>'p256dh',p_payload->>'auth',p_payload->>'device_name',v_owner,coalesce(p_payload->>'user_agent',''),true)
    on conflict(endpoint) do update set p256dh=excluded.p256dh,auth=excluded.auth,device_name=excluded.device_name,
      person=excluded.person,user_agent=excluded.user_agent,active=true;
   return '{}'::jsonb;
 elsif p_action='unsubscribe' then
   update public.notification_subscriptions set active=false where endpoint=p_payload->>'endpoint' and person=v_owner;
   return '{}'::jsonb;
 end if;
 raise exception 'Acción de calendario no válida.';
end;
$$;
revoke all on function public.pdr_calendar(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdr_calendar(text,text,jsonb) to anon,authenticated;

-- The open Shared profile must not receive notifications from private calendars.
alter function public.notification_candidates() rename to calendar_notification_candidates_raw;
create function public.notification_candidates()
returns table(task_id uuid,subscription_id uuid,endpoint text,p256dh text,auth text,kind text,
 scheduled_for timestamptz,task_title text,deadline_time time)
language sql security definer set search_path='' as $$
 select c.* from public.calendar_notification_candidates_raw() c
 join public.tasks t on t.id=c.task_id join public.notification_subscriptions s on s.id=c.subscription_id
 where t.responsible='ambos' or t.notify_target='ambos' or s.person=t.responsible;
$$;
alter function public.project_notification_candidates() rename to calendar_project_candidates_raw;
create function public.project_notification_candidates()
returns table(project_id uuid,subscription_id uuid,endpoint text,p256dh text,auth text,
 scheduled_for timestamptz,project_idea text,project_responsible text)
language sql security definer set search_path='' as $$
 select c.* from public.calendar_project_candidates_raw() c join public.notification_subscriptions s on s.id=c.subscription_id
 where c.project_responsible='ambos' or s.person=c.project_responsible;
$$;
revoke all on function public.notification_candidates(),public.project_notification_candidates() from public,anon,authenticated;
grant execute on function public.notification_candidates(),public.project_notification_candidates() to service_role;

-- Resume the previously configured dispatch without reading or changing secrets.
select cron.schedule('pdr-push-dispatch','*/2 * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='pdr_project_url' order by created_at desc limit 1)||'/functions/v1/push-dispatch',
  headers := jsonb_build_object('Content-Type','application/json','apikey',
   (select decrypted_secret from vault.decrypted_secrets where name='pdr_secret_key' order by created_at desc limit 1)),
  body := jsonb_build_object('scheduled_at',now()));
$job$);
notify pgrst,'reload schema';
