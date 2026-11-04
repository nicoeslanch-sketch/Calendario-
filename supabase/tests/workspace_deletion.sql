begin;
do $$
declare n text; t text; b text; folder jsonb; mid uuid:=gen_random_uuid(); nid uuid:=gen_random_uuid();
 doc jsonb; h jsonb; task_id uuid; payload jsonb; updated jsonb;
begin
 n=public.pdr_sign_in('nicolas','1234')->>'token';
 t=public.pdr_sign_in('tomas','')->>'token'; b=public.pdr_sign_in('benjamin','1234')->>'token';
 folder=public.pdr_workspace('add_folder',n,'{"name":"__DELETE_TEST__","assignee":"tomas"}');
 payload=jsonb_build_object('id',mid,'title','__DELETE_TEST__','state','published',
  'folders',jsonb_build_array(folder),'notes',jsonb_build_array(jsonb_build_object('id',nid,'folder_id',folder->>'id','text','Preparar evento','actionable',true)));
 doc=public.pdr_workspace('save_minute',n,payload);
 select id into task_id from pdr_private.assignments where minute_id=mid;
 begin
  perform public.pdr_workspace('delete_assignment',b,jsonb_build_object('id',task_id));
  raise exception 'Observer deleted assignment';
 exception when insufficient_privilege then null; end;
 perform public.pdr_workspace('delete_assignment',t,jsonb_build_object('id',task_id));
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',n)->'tasks') x where x->>'id'=task_id::text) then raise exception 'Deleted task visible'; end if;
 updated=public.pdr_workspace('save_minute',n,payload||jsonb_build_object('version',doc->'version'));
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',n)->'tasks') x where x->>'source_id'=nid::text) then raise exception 'Deleted assignment resurrected'; end if;
 h=public.pdr_workspace('save_milestone',n,jsonb_build_object('title','__HITO_TEST__','year',2026,'tasks',jsonb_build_array(
  jsonb_build_object('id',gen_random_uuid(),'title','Confirmar','completed',false),
  jsonb_build_object('id',gen_random_uuid(),'title','Reservar','completed',true))));
 if jsonb_array_length(h->'tasks')<>2 or h->'tasks'->1->>'completed'<>'true' then raise exception 'Milestone tasks failed'; end if;
 begin
  perform public.pdr_workspace('delete_milestone',t,jsonb_build_object('id',h->>'id','version',h->'version'));
  raise exception 'Other profile deleted milestone';
 exception when insufficient_privilege then null; end;
 begin
  perform public.pdr_workspace('save_milestone',t,h);
  raise exception 'Other profile changed milestone tasks';
 exception when insufficient_privilege then null; end;
 begin
  perform public.pdr_workspace('save_milestone',n,jsonb_build_object('title','Bad','year',2026,'tasks','[{"id":"invalid","title":"Bad","completed":true}]'::jsonb));
  raise exception 'Malformed task accepted';
 exception when invalid_text_representation then null; end;
 begin
  perform public.pdr_workspace('delete_minute',n,jsonb_build_object('id',mid,'version',0));
  raise exception 'Stale deletion accepted';
 exception when raise_exception then if sqlerrm='Stale deletion accepted' then raise; end if; end;
 begin
  perform public.pdr_workspace('delete_folder',t,jsonb_build_object('id',folder->>'id'));
  raise exception 'Other profile deleted folder';
 exception when insufficient_privilege then null; end;
 perform public.pdr_workspace('delete_folder',n,jsonb_build_object('id',folder->>'id'));
 if (select jsonb_array_length(folders) from pdr_private.minutes where id=mid)<>1 then raise exception 'Folder library deletion changed historical minute'; end if;
 begin
  perform public.pdr_workspace('delete_minute',t,jsonb_build_object('id',mid,'version',updated->'version'));
  raise exception 'Assignee deleted private minute';
 exception when insufficient_privilege then null; end;
 perform public.pdr_workspace('delete_minute',n,jsonb_build_object('id',mid,'version',updated->'version'));
 if exists(select 1 from pdr_private.assignments where minute_id=mid) then raise exception 'Minute task cascade failed'; end if;
 perform public.pdr_workspace('delete_milestone',n,jsonb_build_object('id',h->>'id','version',h->'version'));
 if exists(select 1 from pdr_private.milestones where id=(h->>'id')::uuid) then raise exception 'Milestone deletion failed'; end if;
 if has_function_privilege('anon','pdr_private.workspace_base(text,text,jsonb)','execute') then raise exception 'Base RPC exposed'; end if;
end;
$$;
select 'PASS: milestone checklist, owner deletion, assignment tombstones, minute cascade, folder history, version checks' as result;
rollback;
