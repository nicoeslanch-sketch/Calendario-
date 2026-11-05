begin;
do $$
declare n text; b text; t text; s text; mid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid();
 ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 groups text[]:=array['nicolas','benjamin','tomas','ambos']; notes jsonb:='[]'; folders jsonb:='[]'; doc jsonb; a uuid; i int;
begin
 n=public.pdr_sign_in('nicolas',current_setting('pdr.test_pin',true))->>'token'; b=public.pdr_sign_in('benjamin',current_setting('pdr.test_pin',true))->>'token';
 t=public.pdr_sign_in('tomas','')->>'token'; s=public.pdr_sign_in('ambos','')->>'token';
 for i in 1..4 loop
  fid=gen_random_uuid();
  notes=notes||jsonb_build_array(jsonb_build_object('id',ids[i],'text','__VISIBILITY_TEST__','folder_id',fid,'actionable',true));
  folders=folders||jsonb_build_array(jsonb_build_object('id',fid,'name','__VISIBILITY_TEST__','assignee',groups[i]));
 end loop;
 doc=public.pdr_workspace('save_minute',n,jsonb_build_object('id',mid,'title','__VISIBILITY_TEST__','state','published','notes',notes,'folders',folders));
 if (select count(*) from jsonb_array_elements(public.pdr_workspace('load',n)->'tasks') x where x->>'minute_id'=mid::text)<>4 then raise exception 'Nicolás visibility failed'; end if;
 if (select count(*) from jsonb_array_elements(public.pdr_workspace('load',b)->'tasks') x where x->>'minute_id'=mid::text)<>4 then raise exception 'Benjamín visibility failed'; end if;
 if (select count(*) from jsonb_array_elements(public.pdr_workspace('load',t)->'tasks') x where x->>'minute_id'=mid::text)<>2 then raise exception 'Tomás visibility failed'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',t)->'tasks') x where x->>'assignee' in('nicolas','benjamin')) then raise exception 'Private task leaked to Tomás'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',s)->'tasks') x where x->>'assignee'<>'ambos') then raise exception 'Private task leaked to Shared'; end if;
 select id into a from pdr_private.assignments where minute_id=mid and assignee='nicolas';
 begin perform public.pdr_workspace('task_status',t,jsonb_build_object('id',a,'status','terminada')); raise exception 'Tomás modified private task'; exception when insufficient_privilege then null; end;
 begin perform public.pdr_workspace('delete_assignment',t,jsonb_build_object('id',a)); raise exception 'Tomás deleted private task'; exception when insufficient_privilege then null; end;
 select id into a from pdr_private.assignments where minute_id=mid and assignee='tomas';
 perform public.pdr_workspace('task_status',t,jsonb_build_object('id',a,'status','iniciada'));
 if not exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',b)->'tasks') x where x->>'id'=a::text and x->>'status'='iniciada') then raise exception 'Supervisor cannot track Tomás'; end if;
end;
$$;
select 'PASS: supervisor/own/shared task visibility, private mutations blocked, Tomás tracked by supervisors' as result;
rollback;
