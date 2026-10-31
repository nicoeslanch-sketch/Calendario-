begin;
do $$
declare n text; t text; shared text; task jsonb; project jsonb; recur jsonb; sid uuid; bid uuid;
begin
 n=public.pdr_sign_in('nicolas','1234')->>'token';
 t=public.pdr_sign_in('tomas','')->>'token';
 shared=public.pdr_sign_in('ambos','')->>'token';
 begin
  perform public.pdr_calendar('load','invalid',jsonb_build_object('start',current_date,'end',current_date));
  raise exception 'Invalid token accepted';
 exception when invalid_authorization_specification then null; end;
 if has_table_privilege('anon','public.tasks','select') or has_table_privilege('anon','public.birthdays','select') then raise exception 'Direct access reopened'; end if;
 task=public.pdr_calendar('save_task',n,jsonb_build_object('input',jsonb_build_object('title','__PDR_CAL_TEST__','date',current_date,'subtasks',jsonb_build_array(jsonb_build_object('title','Verify')))));
 if not exists(select 1 from jsonb_array_elements(public.pdr_calendar('load',n,jsonb_build_object('start',current_date,'end',current_date))->'tasks') x where x->>'id'=task->>'id') then raise exception 'Calendar load failed'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_calendar('load',shared,jsonb_build_object('start',current_date,'end',current_date))->'tasks') x where x->>'id'=task->>'id') then raise exception 'Private task leaked'; end if;
 begin
  perform public.pdr_calendar('patch_task',t,jsonb_build_object('id',task->>'id','input',jsonb_build_object('completed',true)));
  raise exception 'Cross-profile mutation accepted';
 exception when insufficient_privilege then null; end;
 begin
  perform public.pdr_calendar('save_task',shared,jsonb_build_object('input',jsonb_build_object('title','Invalid','date',current_date,'responsible','nicolas')));
  raise exception 'Protected profile impersonated';
 exception when insufficient_privilege then null; end;
 select id into sid from public.subtasks where task_id=(task->>'id')::uuid;
 perform public.pdr_calendar('subtask',n,jsonb_build_object('id',sid,'completed',true));
 if not (select completed from public.subtasks where id=sid) then raise exception 'Subtask toggle failed'; end if;
 perform public.pdr_calendar('patch_task',n,jsonb_build_object('id',task->>'id','input',jsonb_build_object('completed',true)));
 if not exists(select 1 from jsonb_array_elements(public.pdr_calendar('history',n,'{}')) x where x->>'id'=task->>'id' and x->>'completed_at' is not null) then raise exception 'Completed history failed'; end if;
 perform public.pdr_calendar('patch_task',n,jsonb_build_object('id',task->>'id','input',jsonb_build_object('completed',false,'responsible','ambos')));
 perform public.pdr_calendar('patch_task',t,jsonb_build_object('id',task->>'id','input',jsonb_build_object('completed',true)));
 if not (select completed from public.tasks where id=(task->>'id')::uuid) then raise exception 'Shared completion failed'; end if;
 recur=public.pdr_calendar('save_task',n,jsonb_build_object('input',jsonb_build_object('title','__PDR_RECUR_TEST__','date',current_date,'recurrence_rule',jsonb_build_object('frequency','daily'),'preparation_business_days',1,'reminder_minutes',jsonb_build_array(60,120))));
 perform public.pdr_calendar('load',n,jsonb_build_object('start',current_date,'end',current_date+3));
 if (select count(*) from public.tasks where recurrence_source_id=(recur->>'id')::uuid)<>4 then raise exception 'Recurrence failed'; end if;
 if not exists(select 1 from public.tasks prep join public.tasks occurrence on occurrence.id=prep.preparation_source_id where occurrence.recurrence_source_id=(recur->>'id')::uuid) then raise exception 'Preparation failed'; end if;
 project=public.pdr_calendar('save_project',n,jsonb_build_object('input',jsonb_build_object('idea','__PDR_PROJECT_TEST__','priority','rojo')));
 perform public.pdr_calendar('save_project',n,jsonb_build_object('id',project->>'id','input',jsonb_build_object('status','completado')));
 if not exists(select 1 from public.projects where id=(project->>'id')::uuid and completed_at is not null) then raise exception 'Project completion failed'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_calendar('projects',shared,'{}')) x where x->>'id'=project->>'id') then raise exception 'Private project leaked'; end if;
 bid=(public.pdr_calendar('save_birthday',n,'{"input":{"name":"__PDR_BIRTHDAY_TEST__","month":1,"day":1}}')->>'id')::uuid;
 if not exists(select 1 from jsonb_array_elements(public.pdr_calendar('load',t,jsonb_build_object('start',current_date,'end',current_date))->'birthdays') x where x->>'id'=bid::text) then raise exception 'Birthdays unavailable'; end if;
 perform public.pdr_calendar('delete_birthday',n,jsonb_build_object('id',bid));
 perform public.pdr_calendar('delete_project',n,jsonb_build_object('id',project->>'id'));
 perform public.pdr_calendar('delete_task',n,jsonb_build_object('id',recur->>'id'));
 perform public.pdr_calendar('delete_task',shared,jsonb_build_object('id',task->>'id'));
 if exists(select 1 from public.tasks where id in((task->>'id')::uuid,(recur->>'id')::uuid)) then raise exception 'Task deletion failed'; end if;
end;
$$;
rollback;
