begin;
do $$
declare n text; t text; b text; doc jsonb; again jsonb; payload jsonb; task_id uuid; hid uuid; folder_id uuid := gen_random_uuid(); note_id uuid := gen_random_uuid(); mid uuid := gen_random_uuid();
begin
 if public.pdr_sign_in('nicolas','')->>'error' is null then raise exception 'Password required'; end if;
 if public.pdr_sign_in('benjamin','wrong')->>'error' is null then raise exception 'Wrong password accepted'; end if;
 n := public.pdr_sign_in('nicolas','1234')->>'token';
 t := public.pdr_sign_in('tomas','')->>'token';
 b := public.pdr_sign_in('benjamin','1234')->>'token';
 if n is null or t is null or b is null then raise exception 'Login failed'; end if;
 begin
  perform public.pdr_workspace('load','invalid','{}');
  raise exception 'Invalid token accepted';
 exception when invalid_authorization_specification then null; end;
 if has_schema_privilege('anon','pdr_private','usage') then raise exception 'Private schema exposed'; end if;
 if has_table_privilege('anon','pdr_private.minutes','select') then raise exception 'Private table exposed'; end if;
 payload := jsonb_build_object('id',mid,'title','__TEST_ONLY__','state','published','notes',jsonb_build_array(jsonb_build_object('id',note_id,'text','Confirmar recinto','folder_id',folder_id,'actionable',true)),'folders',jsonb_build_array(jsonb_build_object('id',folder_id,'name','Logística','assignee','tomas')));
 doc := public.pdr_workspace('save_minute',n,payload);
 if (select count(*) from pdr_private.assignments where minute_id=mid)<>1 then raise exception 'Task distribution failed'; end if;
 select id into task_id from pdr_private.assignments where minute_id=mid;
 perform public.pdr_workspace('task_status',t,jsonb_build_object('id',task_id,'status','iniciada'));
 if not exists(select 1 from pdr_private.assignments where id=task_id and started_at is not null and status='iniciada') then raise exception 'Start timestamp missing'; end if;
 again := public.pdr_workspace('save_minute',n,payload||jsonb_build_object('version',(doc->>'version')::integer));
 if (select count(*) from pdr_private.assignments where minute_id=mid)<>1 then raise exception 'Duplicate tasks'; end if;
 if not exists(select 1 from pdr_private.assignments where id=task_id and status='iniciada') then raise exception 'Resaving reset status'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',t)->'minutes') m where m->>'id'=mid::text) then raise exception 'Private minute leaked'; end if;
 if not exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',b)->'tasks') m where m->>'id'=task_id::text and m->>'status'='iniciada') then raise exception 'Team visibility failed'; end if;
 begin
   perform public.pdr_workspace('save_minute',t,payload||jsonb_build_object('version',(again->>'version')::integer));
   raise exception 'Non-owner modified minute';
 exception when insufficient_privilege then null; end;
 begin
   perform public.pdr_workspace('task_status',b,jsonb_build_object('id',task_id,'status','terminada'));
   raise exception 'Observer modified task';
 exception when insufficient_privilege then null; end;
 hid := (public.pdr_workspace('save_milestone',n,'{"title":"__TEST_ONLY__","year":2026,"guidelines":"Directrices","plan":"Plan","learnings":"Aprendizajes"}')->>'id')::uuid;
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',t)->'milestones') m where m->>'id'=hid::text) then raise exception 'Private milestone leaked'; end if;
 perform public.pdr_workspace('task_status',t,jsonb_build_object('id',task_id,'status','terminada'));
 if not exists(select 1 from pdr_private.assignments where id=task_id and completed_at is not null) then raise exception 'Completion timestamp missing'; end if;
 perform public.pdr_workspace('logout',n);
 begin
   perform public.pdr_workspace('load',n,'{}');
   raise exception 'Logout failed';
 exception when invalid_authorization_specification then null; end;
end;
$$;
select 'PASS: PIN, session, ownership, task assignment, shared status, timestamps, no duplication, milestones, logout' as result;
rollback;
