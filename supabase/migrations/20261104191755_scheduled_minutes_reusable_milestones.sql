-- One assignment, two views: the calendar projects assignments instead of
-- copying them into public.tasks. Dates are optional and scoped to a profile.
alter table pdr_private.assignments add column scheduled_date date
 check(scheduled_date between date '2000-01-01' and date '2200-12-31');
create index assignments_calendar_idx on pdr_private.assignments(assignee,scheduled_date)
 where deleted_at is null and scheduled_date is not null;

create function pdr_private.optional_calendar_date(p_value text) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare v_date date;
begin
 if nullif(p_value,'') is null then return null; end if;
 if p_value !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha inválida.' using errcode='22023'; end if;
 begin v_date=p_value::date;
 exception when others then raise exception 'Fecha inválida.' using errcode='22023'; end;
 if v_date not between date '2000-01-01' and date '2200-12-31' then
   raise exception 'La fecha debe estar entre 2000 y 2200.' using errcode='22023'; end if;
 return v_date;
end;
$$;
revoke all on function pdr_private.optional_calendar_date(text) from public,anon,authenticated;

create or replace function pdr_private.validate_minute_priorities() returns trigger
language plpgsql security invoker set search_path='' as $$
declare x jsonb;
begin
 for x in select * from jsonb_array_elements(new.notes) loop
  if x ? 'priority' and (jsonb_typeof(x->'priority')<>'string' or x->>'priority' not in('alta','media','baja')) then
   raise exception 'Prioridad inválida. Selecciona alta, media o baja.' using errcode='22023'; end if;
  if coalesce(x->>'schedule_mode','folder') not in('folder','custom','none') then
   raise exception 'Modo de fecha inválido.' using errcode='22023'; end if;
  perform pdr_private.optional_calendar_date(x->>'scheduled_date');
 end loop;
 for x in select * from jsonb_array_elements(new.folders) loop
  perform pdr_private.optional_calendar_date(x->>'scheduled_date');
 end loop;
 return new;
end;
$$;
-- Folder-only edits also need validation.
drop trigger validate_minute_priorities on pdr_private.minutes;
create trigger validate_minute_priorities before insert or update of notes,folders
 on pdr_private.minutes for each row execute function pdr_private.validate_minute_priorities();

create or replace function pdr_private.assignment_priority_from_minute() returns trigger
language plpgsql security invoker set search_path='' as $$
declare n jsonb; f jsonb;
begin
 select x into n from pdr_private.minutes m cross join lateral jsonb_array_elements(m.notes) x
  where m.id=new.minute_id and x->>'id'=new.source_id::text;
 select x into f from pdr_private.minutes m cross join lateral jsonb_array_elements(m.folders) x
  where m.id=new.minute_id and x->>'id'=n->>'folder_id';
 new.priority=coalesce(n->>'priority','media');
 new.scheduled_date=case coalesce(n->>'schedule_mode','folder') when 'none' then null
  when 'custom' then pdr_private.optional_calendar_date(n->>'scheduled_date')
  else pdr_private.optional_calendar_date(f->>'scheduled_date') end;
 return new;
end;
$$;

create function pdr_private.assignment_calendar_json(a pdr_private.assignments,p_viewer text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',a.id,'title',a.title,'description','Minuta: '||a.minute_title||E'\nCarpeta: '||a.folder_name,
  'date',a.scheduled_date,'responsible',a.assignee,'priority',a.priority,'category','reunion',
  'completed',a.status='terminada','completed_at',a.completed_at,'updated_at',a.updated_at,
  'position',0,'start_time',null,'deadline_time',null,'is_secondary',false,'estimated_minutes',30,
  'reminder_minutes','[]'::jsonb,'recurrence_rule','{"frequency":"none"}'::jsonb,'subtasks','[]'::jsonb,
  'metadata',jsonb_build_object('assignment_id',a.id,'minute_id',a.minute_id,'minute_title',a.minute_title,
    'folder_name',a.folder_name,'status',a.status,'read_only',p_viewer not in(a.owner_id,a.assignee)));
$$;
revoke all on function pdr_private.assignment_calendar_json(pdr_private.assignments,text) from public,anon,authenticated;

-- Preserve the existing calendar implementation privately, including birthdays,
-- recurrence and native calendar tasks. Only linked-assignment actions differ.
alter function public.pdr_calendar(text,text,jsonb) set schema pdr_private;
alter function pdr_private.pdr_calendar(text,text,jsonb) rename to calendar_base;
revoke all on function pdr_private.calendar_base(text,text,jsonb) from public,anon,authenticated;
create function public.pdr_calendar(p_action text,p_token text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner text; v_result jsonb; v_extra jsonb; v_id uuid; a pdr_private.assignments%rowtype;
 m pdr_private.minutes%rowtype; v_input jsonb; v_note jsonb; v_status text; v_days integer;
begin
 select profile_id into v_owner from pdr_private.sessions
  where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida. Vuelve a entrar al perfil.' using errcode='28000'; end if;
 if octet_length(p_payload::text)>100000 then raise exception 'El contenido es demasiado extenso.'; end if;
 v_id=nullif(p_payload->>'id','')::uuid;
 if p_action in('load','history') then
  v_result=pdr_private.calendar_base(p_action,p_token,p_payload);
  v_days=least(365,greatest(1,coalesce((p_payload->>'days')::int,30)));
  select coalesce(jsonb_agg(pdr_private.assignment_calendar_json(t,v_owner) order by t.scheduled_date,t.id),'[]') into v_extra
   from pdr_private.assignments t where t.deleted_at is null and t.assignee in(v_owner,'ambos') and t.scheduled_date is not null
   and ((p_action='load' and t.scheduled_date between (p_payload->>'start')::date and (p_payload->>'end')::date)
     or (p_action='history' and t.status='terminada' and t.completed_at>=now()-make_interval(days=>v_days)));
  if p_action='load' then return jsonb_set(v_result,'{tasks}',v_result->'tasks'||v_extra); end if;
  return v_result||v_extra;
 end if;
 select * into a from pdr_private.assignments where id=v_id;
 if found and p_action in('save_task','patch_task','delete_task','snooze') then
  if a.deleted_at is not null or a.assignee not in(v_owner,'ambos') or v_owner not in(a.owner_id,a.assignee) then
   raise exception 'No puedes modificar esta tarea de minuta.' using errcode='42501'; end if;
  if p_action='delete_task' then return public.pdr_workspace('delete_assignment',p_token,jsonb_build_object('id',v_id)); end if;
  if p_action='snooze' then raise exception 'Esta tarea proviene de una minuta y no tiene avisos horarios.'; end if;
  -- Consistent lock order: minute first, assignment second, as in save_minute.
  select * into m from pdr_private.minutes where id=a.minute_id for update;
  select * into a from pdr_private.assignments where id=v_id for update;
  if not found or a.deleted_at is not null or a.assignee not in(v_owner,'ambos') or v_owner not in(a.owner_id,a.assignee) then
   raise exception 'La tarea cambió. Recarga antes de editar.' using errcode='42501'; end if;
  v_input=coalesce(p_payload->'input','{}');
  if v_input ? 'expected_updated_at' and (v_input->>'expected_updated_at')::timestamptz is distinct from a.updated_at then
   raise exception 'La tarea cambió en otro dispositivo. Recarga antes de editar.'; end if;
  if exists(select 1 from jsonb_object_keys(v_input) k where k not in('date','title','priority','completed','status','expected_updated_at')) then
   raise exception 'Edita solo título, fecha, prioridad y estado de esta tarea de minuta.'; end if;
  select x into v_note from jsonb_array_elements(m.notes) x where x->>'id'=a.source_id::text;
  if v_input ? 'title' then
   if coalesce(char_length(trim(v_input->>'title')),0) not between 1 and 2000 then raise exception 'Título inválido.'; end if;
   v_note=jsonb_set(v_note,'{text}',to_jsonb(trim(v_input->>'title')));
  end if;
  if v_input ? 'priority' then v_note=jsonb_set(v_note,'{priority}',v_input->'priority'); end if;
  if v_input ? 'date' then
   perform pdr_private.optional_calendar_date(v_input->>'date');
   v_note=v_note||jsonb_build_object('schedule_mode',case when nullif(v_input->>'date','') is null then 'none' else 'custom' end,
    'scheduled_date',v_input->>'date');
  end if;
  if v_input ?| array['title','priority','date'] then
   update pdr_private.minutes set notes=(select jsonb_agg(case when x->>'id'=a.source_id::text then v_note else x end order by pos)
    from jsonb_array_elements(m.notes) with ordinality as z(x,pos)),analysis='{}',version=version+1,updated_at=now() where id=m.id;
   update pdr_private.assignments set title=v_note->>'text',updated_at=now() where id=v_id;
  end if;
  if v_input ? 'status' then v_status=v_input->>'status';
  elsif v_input ? 'completed' then v_status=case when (v_input->>'completed')::boolean then 'terminada' else 'sin_iniciar' end;
  end if;
  if v_status is not null then perform public.pdr_workspace('task_status',p_token,jsonb_build_object('id',v_id,'status',v_status)); end if;
  select * into a from pdr_private.assignments where id=v_id;
  return pdr_private.assignment_calendar_json(a,v_owner);
 end if;
 return pdr_private.calendar_base(p_action,p_token,p_payload);
end;
$$;
revoke all on function public.pdr_calendar(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdr_calendar(text,text,jsonb) to anon,authenticated;

-- Keep lineage snapshots even if a source edition is later deleted.
alter table pdr_private.milestones add column source_hito_id uuid;
alter table pdr_private.milestones add column source_snapshot jsonb not null default '{}';
create index milestones_source_idx on pdr_private.milestones(source_hito_id) where source_hito_id is not null;

-- Attachments stay private; only the authenticated file service touches Storage.
insert into storage.buckets(id,name,public,file_size_limit) values('pdr-hito-documents','pdr-hito-documents',false,5242880);
create table pdr_private.milestone_files(
 id uuid primary key default gen_random_uuid(), milestone_id uuid references pdr_private.milestones(id) on delete set null,
 owner_id text not null references pdr_private.profiles(id), storage_path text not null unique,
 name text not null check(char_length(name) between 1 and 180), mime text not null,
 size integer not null check(size between 1 and 5242880), ready boolean not null default false,
 source_file_id uuid, created_at timestamptz not null default now()
);
create index milestone_files_hito_idx on pdr_private.milestone_files(milestone_id);
create index milestone_files_owner_idx on pdr_private.milestone_files(owner_id);
create unique index milestone_files_copy_idx on pdr_private.milestone_files(milestone_id,source_file_id) where source_file_id is not null;
alter table pdr_private.milestone_files enable row level security;
revoke all on pdr_private.milestone_files from public,anon,authenticated;

create function public.pdr_milestone_documents(p_token text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner text;
begin
 select profile_id into v_owner from pdr_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida.' using errcode='28000'; end if;
 return coalesce((select jsonb_agg(to_jsonb(f)-'storage_path'-'owner_id'-'ready') from pdr_private.milestone_files f
  join pdr_private.milestones h on h.id=f.milestone_id where f.owner_id=v_owner and h.owner_id=v_owner and f.ready),'[]');
end;
$$;
revoke all on function public.pdr_milestone_documents(text) from public,anon,authenticated;
grant execute on function public.pdr_milestone_documents(text) to anon,authenticated;

-- The existing save_milestone uses explicit columns. A trigger reads only a
-- transaction-local context supplied by its validated public workspace wrapper.
create function pdr_private.hito_lineage() returns trigger
language plpgsql security invoker set search_path='' as $$
declare origin pdr_private.milestones%rowtype; src uuid;
begin
 if tg_op='UPDATE' then new.source_hito_id=old.source_hito_id; new.source_snapshot=old.source_snapshot; return new; end if;
 src=nullif(current_setting('pdr.source_hito_id',true),'')::uuid;
 if src is not null then
  select * into origin from pdr_private.milestones where id=src and owner_id=new.owner_id;
  if not found then raise exception 'El hito de origen no pertenece a este perfil.' using errcode='42501'; end if;
  new.source_hito_id=src;
  new.source_snapshot=(to_jsonb(origin)-'owner_id'-'source_snapshot')||jsonb_build_object('documents',coalesce((
    select jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'size',f.size)) from pdr_private.milestone_files f
    where f.milestone_id=src and f.ready),'[]'::jsonb));
 end if;
 return new;
end;
$$;
revoke all on function pdr_private.hito_lineage() from public,anon,authenticated;
create trigger hito_lineage before insert or update on pdr_private.milestones for each row execute function pdr_private.hito_lineage();

-- Add lineage context without changing any existing owner/session/version guard.
alter function public.pdr_workspace(text,text,jsonb) set schema pdr_private;
alter function pdr_private.pdr_workspace(text,text,jsonb) rename to workspace_guarded;
revoke all on function pdr_private.workspace_guarded(text,text,jsonb) from public,anon,authenticated;
create function public.pdr_workspace(p_action text,p_token text,p_payload jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform set_config('pdr.source_hito_id',coalesce(p_payload->>'source_hito_id',''),true);
 return pdr_private.workspace_guarded(p_action,p_token,p_payload);
end;
$$;
-- SECURITY DEFINER is needed only for entering the private guarded API.
alter function public.pdr_workspace(text,text,jsonb) security definer;
revoke all on function public.pdr_workspace(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdr_workspace(text,text,jsonb) to anon,authenticated;

create function public.pdr_hito_file(p_token text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner text; h uuid; fid uuid; f pdr_private.milestone_files%rowtype; v_result jsonb;
begin
 select profile_id into v_owner from pdr_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida.' using errcode='28000'; end if;
 h=nullif(p_payload->>'milestone_id','')::uuid; fid=nullif(p_payload->>'file_id','')::uuid;
 if p_action='cleanup' then
  return coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pdr_private.milestone_files where owner_id=v_owner
   and (milestone_id is null or (not ready and created_at<now()-interval '1 hour')) limit 100) x),'[]');
 elsif p_action='purge' then
  delete from pdr_private.milestone_files where id=fid and owner_id=v_owner and (milestone_id is null or (not ready and created_at<now()-interval '1 hour'));
  return '{}';
 elsif p_action='reserve' then
  perform 1 from pdr_private.milestones where id=h and owner_id=v_owner for update;
  if not found then raise exception 'No tienes acceso a este hito.' using errcode='42501'; end if;
  if (select count(*) from pdr_private.milestone_files where milestone_id=h)>=10 then raise exception 'El hito admite hasta 10 archivos.'; end if;
  fid=gen_random_uuid();
  insert into pdr_private.milestone_files(id,milestone_id,owner_id,storage_path,name,mime,size,source_file_id)
   values(fid,h,v_owner,v_owner||'/'||h::text||'/'||fid::text,trim(p_payload->>'name'),p_payload->>'mime',
    (p_payload->>'size')::integer,nullif(p_payload->>'source_file_id','')::uuid) returning * into f;
  return to_jsonb(f);
 end if;
 select * into f from pdr_private.milestone_files where id=fid and owner_id=v_owner and milestone_id is not null for update;
 if not found or not exists(select 1 from pdr_private.milestones where id=f.milestone_id and owner_id=v_owner) then
  raise exception 'No tienes acceso a este archivo.' using errcode='42501'; end if;
 if p_action='get' then return to_jsonb(f);
 elsif p_action='ready' then update pdr_private.milestone_files set ready=true where id=fid returning to_jsonb(milestone_files.*) into v_result; return v_result;
 elsif p_action='remove' then update pdr_private.milestone_files set milestone_id=null where id=fid; return to_jsonb(f);
 end if;
 raise exception 'Acción de archivo inválida.';
end;
$$;
revoke all on function public.pdr_hito_file(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdr_hito_file(text,text,jsonb) to service_role;
notify pgrst,'reload schema';
