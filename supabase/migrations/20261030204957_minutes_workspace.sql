-- PDR: minutes, assignments and reusable milestones, with server-side profile sessions.
create schema if not exists pdr_private;
revoke all on schema pdr_private from public, anon, authenticated;

create table pdr_private.profiles (
  id text primary key, name text not null check (char_length(name) between 2 and 100),
  color text not null default '#2f8659', pin_hash text,
  failed_attempts integer not null default 0, locked_until timestamptz,
  created_at timestamptz not null default now()
);
insert into pdr_private.profiles(id,name,color,pin_hash) values
 ('nicolas','Nicolás Albornoz','#3e6b8c','$2a$06$8STRZ/mXUv0oslhzIswiCuV0LikykvoHkGrrT5trDjM60p8iQRqti'),
 ('benjamin','Benjamín Hernández','#a94f86','$2a$06$8STRZ/mXUv0oslhzIswiCuV0LikykvoHkGrrT5trDjM60p8iQRqti'),
 ('tomas','Tomás Espinoza','#b56a16',null),
 ('ambos','Compartido','#2f8659',null);

create table pdr_private.sessions (
 token_hash text primary key, profile_id text not null references pdr_private.profiles(id),
 expires_at timestamptz not null default now()+interval '12 hours'
);
create index on pdr_private.sessions(profile_id);
create table pdr_private.folders (
 id uuid primary key default gen_random_uuid(), owner_id text not null references pdr_private.profiles(id),
 name text not null check (char_length(name) between 1 and 100),
 assignee text not null references pdr_private.profiles(id), created_at timestamptz not null default now()
);
create index on pdr_private.folders(owner_id);
create table pdr_private.minutes (
 id uuid primary key default gen_random_uuid(), owner_id text not null references pdr_private.profiles(id),
 title text not null check(char_length(title) between 1 and 180),
 notes jsonb not null default '[]', folders jsonb not null default '[]', analysis jsonb not null default '{}',
 state text not null default 'draft' check(state in ('draft','published')), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on pdr_private.minutes(owner_id,updated_at desc);
create table pdr_private.assignments (
 id uuid primary key default gen_random_uuid(), minute_id uuid not null references pdr_private.minutes(id) on delete cascade,
 source_id uuid not null, owner_id text not null references pdr_private.profiles(id),
 assignee text not null references pdr_private.profiles(id),
 title text not null check(char_length(title) between 1 and 2000),
 folder_name text not null, minute_title text not null,
 status text not null default 'sin_iniciar' check(status in ('sin_iniciar','iniciada','terminada')),
 started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now(),
 unique(minute_id,source_id)
);
create index on pdr_private.assignments(assignee,status);
create index on pdr_private.assignments(owner_id);
create table pdr_private.milestones (
 id uuid primary key default gen_random_uuid(), owner_id text not null references pdr_private.profiles(id),
 title text not null check(char_length(title) between 1 and 180),
 year integer not null check(year between 2000 and 2200),
 purpose text not null default '', guidelines text not null default '', plan text not null default '',
 learnings text not null default '', version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on pdr_private.milestones(owner_id,year desc);
create table pdr_private.legacy_archive (
 id uuid primary key default gen_random_uuid(), archived_at timestamptz not null default now(),
 kind text not null, records jsonb not null
);
alter table pdr_private.profiles enable row level security;
alter table pdr_private.sessions enable row level security;
alter table pdr_private.folders enable row level security;
alter table pdr_private.minutes enable row level security;
alter table pdr_private.assignments enable row level security;
alter table pdr_private.milestones enable row level security;
alter table pdr_private.legacy_archive enable row level security;
revoke all on all tables in schema pdr_private from public,anon,authenticated;
revoke all on all sequences in schema pdr_private from public,anon,authenticated;

create function public.pdr_profiles() returns jsonb
language sql security definer set search_path = '' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'color',color,'locked',pin_hash is not null)
 order by case id when 'nicolas' then 0 when 'benjamin' then 1 when 'tomas' then 2 when 'ambos' then 4 else 3 end,created_at),'[]'::jsonb)
 from pdr_private.profiles;
$$;

create function public.pdr_sign_in(p_profile text,p_pin text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_profile pdr_private.profiles%rowtype; v_token text;
begin
 select * into v_profile from pdr_private.profiles where id=p_profile for update;
 if not found then return jsonb_build_object('error','Perfil no encontrado.'); end if;
 if v_profile.locked_until > now() then return jsonb_build_object('error','Demasiados intentos. Vuelve a intentar en 5 minutos.'); end if;
 if v_profile.pin_hash is not null and (p_pin is null or extensions.crypt(p_pin,v_profile.pin_hash) <> v_profile.pin_hash) then
   update pdr_private.profiles set failed_attempts=case when failed_attempts>=9 then 0 else failed_attempts+1 end,
     locked_until=case when failed_attempts>=9 then now()+interval '5 minutes' else null end where id=p_profile;
   return jsonb_build_object('error','Contraseña incorrecta.');
 end if;
 update pdr_private.profiles set failed_attempts=0,locked_until=null where id=p_profile;
 delete from pdr_private.sessions where expires_at < now();
 v_token=encode(extensions.gen_random_bytes(32),'hex');
 insert into pdr_private.sessions(token_hash,profile_id) values (encode(extensions.digest(v_token,'sha256'),'hex'),p_profile);
 return jsonb_build_object('token',v_token,'profile',p_profile,'expires_at',now()+interval '12 hours');
end;
$$;

-- These RPCs intentionally use a separate random, hashed profile session. No table is accessible to API roles.
create function public.pdr_workspace(p_action text,p_token text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
 v_owner text; v_id uuid; v_doc pdr_private.minutes%rowtype; v_milestone pdr_private.milestones%rowtype;
 v_note jsonb; v_folder jsonb; v_notes jsonb; v_folders jsonb; v_result jsonb; v_status text; v_assignee text;
begin
 select profile_id into v_owner from pdr_private.sessions
 where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida. Vuelve a entrar al perfil.' using errcode='28000'; end if;
 if p_action='logout' then
   delete from pdr_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
   return '{"ok":true}';
 elsif p_action='load' then
   return jsonb_build_object(
    'minutes',coalesce((select jsonb_agg(to_jsonb(m) order by updated_at desc) from pdr_private.minutes m where owner_id=v_owner),'[]'::jsonb),
    'folders',coalesce((select jsonb_agg(to_jsonb(f) order by created_at) from pdr_private.folders f where owner_id=v_owner),'[]'::jsonb),
    'milestones',coalesce((select jsonb_agg(to_jsonb(h) order by year desc,updated_at desc) from pdr_private.milestones h where owner_id=v_owner),'[]'::jsonb),
    'tasks',coalesce((select jsonb_agg(to_jsonb(t) order by updated_at desc) from pdr_private.assignments t),'[]'::jsonb)
   );
 elsif p_action='add_profile' then
   if v_owner not in ('nicolas','benjamin') then raise exception 'Solo Nicolás o Benjamín pueden agregar perfiles.'; end if;
   if char_length(trim(p_payload->>'name')) not between 2 and 100 then raise exception 'Escribe un nombre válido.'; end if;
   insert into pdr_private.profiles(id,name,color) values ('p_'||gen_random_uuid()::text,trim(p_payload->>'name'),'#6b5b95');
   return '{"ok":true}';
 elsif p_action='add_folder' then
   insert into pdr_private.folders(owner_id,name,assignee)
   values(v_owner,trim(p_payload->>'name'),coalesce(p_payload->>'assignee',v_owner)) returning to_jsonb(folders.*) into v_result;
   return v_result;
 elsif p_action='save_minute' then
   if octet_length(p_payload::text)>300000 then raise exception 'La minuta es demasiado extensa.'; end if;
   v_id=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
   select * into v_doc from pdr_private.minutes where id=v_id for update;
   if found and v_doc.owner_id<>v_owner then raise exception 'Esta minuta pertenece a otro perfil.' using errcode='42501'; end if;
   if v_doc.id is not null and v_doc.version<>coalesce((p_payload->>'version')::integer,0) then raise exception 'La minuta cambió en otro dispositivo. Recarga antes de editar.'; end if;
   v_notes=coalesce(p_payload->'notes','[]'::jsonb); v_folders=coalesce(p_payload->'folders','[]'::jsonb);
   if jsonb_typeof(v_notes)<>'array' or jsonb_array_length(v_notes)>300 or jsonb_typeof(v_folders)<>'array' or jsonb_array_length(v_folders)>100 then raise exception 'Punteo o carpetas inválidos.'; end if;
   if (select count(*)<>count(distinct n->>'id') from jsonb_array_elements(v_notes) n) then raise exception 'Hay puntos duplicados.'; end if;
   for v_note in select * from jsonb_array_elements(v_notes) loop
     if nullif(v_note->>'id','') is null or char_length(trim(v_note->>'text')) not between 1 and 2000 then raise exception 'Cada punto debe tener entre 1 y 2000 caracteres.'; end if;
   end loop;
   insert into pdr_private.minutes(id,owner_id,title,notes,folders,analysis,state)
   values(v_id,v_owner,trim(p_payload->>'title'),v_notes,v_folders,coalesce(p_payload->'analysis','{}'),
     case when p_payload->>'state'='published' then 'published' else 'draft' end)
   on conflict(id) do update set title=excluded.title,notes=excluded.notes,folders=excluded.folders,
      analysis=excluded.analysis,state=excluded.state,version=minutes.version+1,updated_at=now()
   returning to_jsonb(minutes.*) into v_result;
   if p_payload->>'state'='published' then
     if jsonb_array_length(v_notes)=0 then raise exception 'Agrega puntos antes de distribuir.'; end if;
     for v_note in select * from jsonb_array_elements(v_notes) loop
       select f into v_folder from jsonb_array_elements(v_folders) f where f->>'id'=v_note->>'folder_id';
       if v_folder is null then raise exception 'Agrupa todos los puntos en carpetas.'; end if;
       if not exists(select 1 from pdr_private.profiles where id=v_folder->>'assignee') then raise exception 'Selecciona un responsable válido por carpeta.'; end if;
       if coalesce((v_note->>'actionable')::boolean,true) then
         v_assignee=coalesce(nullif(v_note->>'assignee',''),v_folder->>'assignee');
         insert into pdr_private.assignments(minute_id,source_id,owner_id,assignee,title,folder_name,minute_title)
         values(v_id,(v_note->>'id')::uuid,v_owner,v_assignee,trim(v_note->>'text'),v_folder->>'name',trim(p_payload->>'title'))
         on conflict(minute_id,source_id) do update set assignee=excluded.assignee,title=excluded.title,
          folder_name=excluded.folder_name,minute_title=excluded.minute_title,updated_at=now();
       end if;
     end loop;
     delete from pdr_private.assignments a where minute_id=v_id and not exists(
       select 1 from jsonb_array_elements(v_notes) n where n->>'id'=a.source_id::text and coalesce((n->>'actionable')::boolean,true));
   end if;
   return v_result;
 elsif p_action='task_status' then
   v_status=p_payload->>'status';
   if v_status not in ('sin_iniciar','iniciada','terminada') then raise exception 'Estado inválido.'; end if;
   update pdr_private.assignments set status=v_status,
    started_at=case when v_status='sin_iniciar' then null else coalesce(started_at,now()) end,
    completed_at=case when v_status='terminada' then coalesce(completed_at,now()) else null end,updated_at=now()
   where id=(p_payload->>'id')::uuid and (assignee=v_owner or owner_id=v_owner)
   returning to_jsonb(assignments.*) into v_result;
   if v_result is null then raise exception 'Solo el responsable o creador puede cambiar esta tarea.' using errcode='42501'; end if;
   return v_result;
 elsif p_action='save_milestone' then
   if octet_length(p_payload::text)>100000 then raise exception 'El hito es demasiado extenso.'; end if;
   v_id=coalesce(nullif(p_payload->>'id','')::uuid,gen_random_uuid());
   select * into v_milestone from pdr_private.milestones where id=v_id for update;
   if found and v_milestone.owner_id<>v_owner then raise exception 'Este hito pertenece a otro perfil.' using errcode='42501'; end if;
   if v_milestone.id is not null and v_milestone.version<>coalesce((p_payload->>'version')::integer,0) then raise exception 'El hito cambió en otro dispositivo. Recarga antes de editar.'; end if;
   insert into pdr_private.milestones(id,owner_id,title,year,purpose,guidelines,plan,learnings)
   values(v_id,v_owner,trim(p_payload->>'title'),(p_payload->>'year')::integer,
     coalesce(p_payload->>'purpose',''),coalesce(p_payload->>'guidelines',''),coalesce(p_payload->>'plan',''),coalesce(p_payload->>'learnings',''))
   on conflict(id) do update set title=excluded.title,year=excluded.year,purpose=excluded.purpose,
     guidelines=excluded.guidelines,plan=excluded.plan,learnings=excluded.learnings,version=milestones.version+1,updated_at=now()
   returning to_jsonb(milestones.*) into v_result;
   return v_result;
 else raise exception 'Acción no válida.';
 end if;
end;
$$;
revoke all on function public.pdr_profiles() from public,anon,authenticated;
revoke all on function public.pdr_sign_in(text,text) from public,anon,authenticated;
revoke all on function public.pdr_workspace(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdr_profiles(),public.pdr_sign_in(text,text),public.pdr_workspace(text,text,jsonb) to anon,authenticated;

-- Reset explicitly requested: retain a private administrative recovery snapshot.
insert into pdr_private.legacy_archive(kind,records) select 'tasks',coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.tasks t;
insert into pdr_private.legacy_archive(kind,records) select 'projects',coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.projects p;
insert into pdr_private.legacy_archive(kind,records) select 'subtasks',coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.subtasks s;
select cron.unschedule(jobid) from cron.job where jobname='pdr-push-dispatch';
alter table public.tasks disable trigger tasks_remember_deleted_occurrence;
delete from public.tasks;
alter table public.tasks enable trigger tasks_remember_deleted_occurrence;
delete from public.projects;
-- Prevent old clients recreating recurring tasks after reset.
revoke all on public.tasks, public.projects, public.subtasks from anon,authenticated;
revoke execute on function public.materialize_recurring_tasks(date,date) from public,anon,authenticated;
notify pgrst,'reload schema';
