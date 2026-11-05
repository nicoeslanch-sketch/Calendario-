begin;
do $$
declare n text; t text; h jsonb; h2 jsonb; saved jsonb; fid uuid; docs jsonb;
begin
 n=public.pdr_sign_in('nicolas',current_setting('pdr.test_pin',true))->>'token'; t=public.pdr_sign_in('tomas','')->>'token';
 h=public.pdr_workspace('save_milestone',n,jsonb_build_object('title','__MEMORY_ORIGINAL__','year',2026,'learnings','Más anticipación',
  'tasks',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Reservar','completed',true,'notes','Listo en octubre'))));
 h2=public.pdr_workspace('save_milestone',n,jsonb_build_object('title','__MEMORY_NEXT__','year',2027,'source_hito_id',h->>'id',
  'source_snapshot','{"title":"Falso"}'::jsonb,'tasks',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Reservar','completed',false))));
 if h2->'source_snapshot'->>'title'<>'__MEMORY_ORIGINAL__' or h2->'source_snapshot'->>'learnings'<>'Más anticipación' then raise exception 'Snapshot missing or client-controlled'; end if;
 if not exists(select 1 from pdr_private.milestones where id=(h->>'id')::uuid and tasks->0->>'completed'='true' and version=(h->>'version')::int) then raise exception 'Original modified'; end if;
 begin perform public.pdr_workspace('save_milestone',t,jsonb_build_object('title','__MEMORY_PRIVATE__','year',2027,'source_hito_id',h->>'id')); raise exception 'Foreign origin copied'; exception when insufficient_privilege then null; end;
 if has_function_privilege('anon','public.pdr_hito_file(text,text,jsonb)','execute') or has_schema_privilege('anon','pdr_private','usage') then raise exception 'Private files exposed'; end if;
 fid=(public.pdr_hito_file(n,'reserve',jsonb_build_object('milestone_id',h->>'id','name','Bases.pdf','mime','application/pdf','size',100))->>'id')::uuid;
 perform public.pdr_hito_file(n,'ready',jsonb_build_object('file_id',fid));
 docs=public.pdr_milestone_documents(n);
 if not exists(select 1 from jsonb_array_elements(docs) x where x->>'id'=fid::text) then raise exception 'Own document not listed'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_milestone_documents(t)) x where x->>'id'=fid::text) then raise exception 'Private file metadata leaked'; end if;
 begin perform public.pdr_hito_file(t,'get',jsonb_build_object('file_id',fid)); raise exception 'Private file downloadable'; exception when insufficient_privilege then null; end;
 perform public.pdr_workspace('delete_milestone',n,jsonb_build_object('id',h->>'id','version',(h->>'version')::int));
 if not exists(select 1 from pdr_private.milestone_files where id=fid and milestone_id is null) then raise exception 'File cleanup not queued'; end if;
 select to_jsonb(x) into saved from pdr_private.milestones x where id=(h2->>'id')::uuid;
 if saved->'source_snapshot'->>'learnings'<>'Más anticipación' then raise exception 'Source deletion erased history'; end if;
end;
$$;
select 'PASS: independent historical editions, authoritative immutable reference, private documents, ownership and cleanup' as result;
rollback;
