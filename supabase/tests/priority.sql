begin;
do $$
declare
 n text; t text; mid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid();
 ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 payload jsonb; doc jsonb; notes jsonb; aid uuid; started timestamptz; invalid text;
begin
 n=public.pdr_sign_in('nicolas','1234')->>'token';
 t=public.pdr_sign_in('tomas','')->>'token';
 notes=jsonb_build_array(
  jsonb_build_object('id',ids[1],'text','__PRIORITY_HIGH__','folder_id',fid,'priority','alta'),
  jsonb_build_object('id',ids[2],'text','__PRIORITY_LOW__','folder_id',fid,'priority','baja'),
  jsonb_build_object('id',ids[3],'text','__PRIORITY_LEGACY__','folder_id',fid),
  jsonb_build_object('id',ids[4],'text','__PRIORITY_CONTEXT__','folder_id',fid,'priority','alta','actionable',false));
 payload=jsonb_build_object('id',mid,'title','__PRIORITY_TEST__','state','published','notes',notes,
  'folders',jsonb_build_array(jsonb_build_object('id',fid,'name','__PRIORITY_TEST__','assignee','tomas')),
  'analysis','{"folders":[],"priority":"baja"}'::jsonb);
 doc=public.pdr_workspace('save_minute',n,payload);
 if (select count(*) from pdr_private.assignments where minute_id=mid)<>3 then raise exception 'Distribution count changed'; end if;
 if not exists(select 1 from pdr_private.assignments where minute_id=mid and source_id=ids[1] and priority='alta') then raise exception 'High priority not persisted'; end if;
 if not exists(select 1 from pdr_private.assignments where minute_id=mid and source_id=ids[2] and priority='baja') then raise exception 'Low priority not persisted'; end if;
 if not exists(select 1 from pdr_private.assignments where minute_id=mid and source_id=ids[3] and priority='media') then raise exception 'Legacy default missing'; end if;
 if not exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',t)->'tasks') x where x->>'source_id'=ids[1]::text and x->>'priority'='alta') then raise exception 'API did not return priority'; end if;
 select id into aid from pdr_private.assignments where minute_id=mid and source_id=ids[1];
 perform public.pdr_workspace('task_status',t,jsonb_build_object('id',aid,'status','iniciada'));
 select started_at into started from pdr_private.assignments where id=aid;
 notes=jsonb_set(notes,'{0,priority}','"baja"');
 payload=payload||jsonb_build_object('notes',notes,'version',(doc->>'version')::int);
 doc=public.pdr_workspace('save_minute',n,payload);
 if not exists(select 1 from pdr_private.assignments where id=aid and priority='baja' and status='iniciada' and started_at=started) then raise exception 'Editing priority reset identity/status/timestamp'; end if;
 begin
  perform public.pdr_workspace('save_minute',t,payload||jsonb_build_object('version',(doc->>'version')::int));
  raise exception 'Non-owner edited priority';
 exception when insufficient_privilege then null; end;
 foreach invalid in array array['"urgente"','null','4','{}'] loop
  begin
   perform public.pdr_workspace('save_minute',n,payload||jsonb_build_object('notes',jsonb_set(notes,'{0,priority}',invalid::jsonb),'version',(doc->>'version')::int));
   raise exception 'Invalid priority accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 perform public.pdr_workspace('delete_assignment',t,jsonb_build_object('id',aid));
 doc=public.pdr_workspace('save_minute',n,payload||jsonb_build_object('version',(doc->>'version')::int));
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',t)->'tasks') x where x->>'id'=aid::text) then raise exception 'Priority edit resurrected deleted task'; end if;
 if has_function_privilege('anon','pdr_private.assignment_priority_from_minute()','execute') then raise exception 'Trigger exposed'; end if;
end;
$$;
select 'PASS: priorities persist through RPC, legacy defaults, edits preserve state, invalid values and non-owner blocked, deleted tasks stay hidden' as result;
rollback;
