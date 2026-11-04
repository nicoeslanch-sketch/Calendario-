-- Restrict the actual RPC result, not only the browser tabs.
create or replace function public.pdr_workspace(p_action text,p_token text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_owner text; v_id uuid; v_result jsonb; v_h pdr_private.milestones%rowtype;
 v_tasks jsonb; v_task jsonb; v_version integer;
begin
 select profile_id into v_owner from pdr_private.sessions
 where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida. Vuelve a entrar al perfil.' using errcode='28000'; end if;
 if octet_length(p_payload::text)>300000 then raise exception 'El contenido es demasiado extenso.'; end if;
 v_id=nullif(p_payload->>'id','')::uuid;
 if p_action in ('task_status','delete_assignment') and not exists (
   select 1 from pdr_private.assignments a where a.id=v_id
     and (v_owner in ('nicolas','benjamin') or a.assignee in(v_owner,'ambos'))
 ) then raise exception 'No tienes acceso a esta tarea.' using errcode='42501'; end if;
 if p_action='save_milestone' then
   if octet_length(p_payload::text)>100000 then raise exception 'El hito es demasiado extenso.'; end if;
   v_id=coalesce(v_id,gen_random_uuid());
   select * into v_h from pdr_private.milestones where id=v_id for update;
   if found and v_h.owner_id<>v_owner then raise exception 'Este hito pertenece a otro perfil.' using errcode='42501'; end if;
   if v_h.id is not null and v_h.version<>coalesce((p_payload->>'version')::integer,0) then
     raise exception 'El hito cambió en otro dispositivo. Recarga antes de editar.'; end if;
   v_tasks=coalesce(p_payload->'tasks',v_h.tasks,'[]'::jsonb);
   if jsonb_typeof(v_tasks)<>'array' or jsonb_array_length(v_tasks)>300 then raise exception 'Lista de tareas inválida.'; end if;
   if (select count(*)<>count(distinct x->>'id') from jsonb_array_elements(v_tasks) x) then raise exception 'Hay tareas duplicadas.'; end if;
   for v_task in select * from jsonb_array_elements(v_tasks) loop
     if jsonb_typeof(v_task)<>'object' or nullif(v_task->>'id','') is null or
       coalesce(char_length(trim(v_task->>'title')),0) not between 1 and 2000 or
       jsonb_typeof(v_task->'completed') is distinct from 'boolean' then raise exception 'Cada tarea necesita texto y estado realizado o pendiente.'; end if;
     perform (v_task->>'id')::uuid;
     if coalesce(char_length(v_task->>'notes'),0)>4000 then raise exception 'La observación de una tarea admite hasta 4000 caracteres.'; end if;
   end loop;
   insert into pdr_private.milestones(id,owner_id,title,year,purpose,guidelines,plan,learnings,tasks)
   values(v_id,v_owner,trim(p_payload->>'title'),(p_payload->>'year')::integer,
    coalesce(p_payload->>'purpose',''),coalesce(p_payload->>'guidelines',''),coalesce(p_payload->>'plan',''),coalesce(p_payload->>'learnings',''),v_tasks)
   on conflict(id) do update set title=excluded.title,year=excluded.year,purpose=excluded.purpose,
    guidelines=excluded.guidelines,plan=excluded.plan,learnings=excluded.learnings,tasks=excluded.tasks,
    version=milestones.version+1,updated_at=now()
   returning to_jsonb(milestones.*) into v_result;
   return v_result;
 elsif p_action='delete_minute' then
   select version into v_version from pdr_private.minutes where id=v_id and owner_id=v_owner for update;
   if not found then raise exception 'No puedes eliminar esta minuta.' using errcode='42501'; end if;
   if v_version<>coalesce((p_payload->>'version')::integer,0) then raise exception 'La minuta cambió. Recarga antes de eliminarla.'; end if;
   delete from pdr_private.minutes where id=v_id and owner_id=v_owner;
   -- ON DELETE CASCADE removes this minute's distributed assignments.
   return '{"ok":true}';
 elsif p_action='delete_milestone' then
   select version into v_version from pdr_private.milestones where id=v_id and owner_id=v_owner for update;
   if not found then raise exception 'No puedes eliminar este hito.' using errcode='42501'; end if;
   if v_version<>coalesce((p_payload->>'version')::integer,0) then raise exception 'El hito cambió. Recarga antes de eliminarlo.'; end if;
   delete from pdr_private.milestones where id=v_id and owner_id=v_owner;
   return '{"ok":true}';
 elsif p_action='delete_folder' then
   delete from pdr_private.folders where id=v_id and owner_id=v_owner;
   if not found then raise exception 'No puedes eliminar esta carpeta.' using errcode='42501'; end if;
   -- Minutes retain snapshots: removing a library entry does not destroy history.
   return '{"ok":true}';
 elsif p_action='delete_assignment' then
   update pdr_private.assignments set deleted_at=now(),updated_at=now()
    where id=v_id and deleted_at is null and (owner_id=v_owner or assignee=v_owner);
   if not found then raise exception 'Solo el responsable o creador puede eliminar esta tarea.' using errcode='42501'; end if;
   -- A tombstone prevents save_minute's stable upsert recreating a deleted task.
   return '{"ok":true}';
 elsif p_action='load' then
   v_result=pdr_private.workspace_base(p_action,p_token,p_payload);
   return jsonb_set(v_result,'{tasks}',coalesce((select jsonb_agg(x) from jsonb_array_elements(v_result->'tasks') x
     where x->>'deleted_at' is null and (v_owner in ('nicolas','benjamin') or x->>'assignee' in(v_owner,'ambos'))),'[]'::jsonb));
 elsif p_action='task_status' and exists(select 1 from pdr_private.assignments where id=v_id and deleted_at is not null) then
   raise exception 'Esta tarea fue eliminada. Recarga el tablero.';
 end if;
 return pdr_private.workspace_base(p_action,p_token,p_payload);
end;
$$;
revoke all on function public.pdr_workspace(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pdr_workspace(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
