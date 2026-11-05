begin;
do $$
declare token text; other_token text; h jsonb; file1 jsonb; file2 jsonb; attached jsonb; candidates jsonb; value jsonb;
begin
 token=public.pdr_sign_in('tomas','')->>'token'; other_token=public.pdr_sign_in('ambos','')->>'token';
 h=public.pdr_workspace('save_milestone',token,'{"title":"__CLEANUP_GUARD_TEST__","year":2026}');
 file1=public.pdr_hito_file(token,'reserve',jsonb_build_object('milestone_id',h->>'id','name','Prueba-1.txt','mime','text/plain','size',1));
 file2=public.pdr_hito_file(token,'reserve',jsonb_build_object('milestone_id',h->>'id','name','Prueba-2.txt','mime','text/plain','size',1));
 attached=public.pdr_hito_file(token,'reserve',jsonb_build_object('milestone_id',h->>'id','name','Conservar.txt','mime','text/plain','size',1));
 perform public.pdr_hito_file(token,'ready',jsonb_build_object('file_id',attached->>'id'));
 perform public.pdr_hito_file(token,'remove',jsonb_build_object('file_id',file1->>'id'));
 perform public.pdr_hito_file(token,'remove',jsonb_build_object('file_id',file2->>'id'));
 for value in select * from jsonb_array_elements('[null,[],{},[null],["*"],["not-a-uuid"]]'::jsonb) loop
  begin
   perform public.pdr_hito_file(token,'cleanup',jsonb_build_object('file_ids',value));
   raise exception 'Invalid cleanup scope accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
 begin perform public.pdr_hito_file(token,'cleanup','{}'); raise exception 'Missing IDs accepted'; exception when invalid_parameter_value then null; end;
 candidates=public.pdr_hito_file(token,'cleanup',jsonb_build_object('file_ids',jsonb_build_array(file1->>'id')));
 if jsonb_array_length(candidates)<>1 or candidates->0->>'id'<>file1->>'id' then raise exception 'Cleanup returned an unrequested orphan'; end if;
 if jsonb_array_length(public.pdr_hito_file(token,'cleanup',jsonb_build_object('file_ids',jsonb_build_array(attached->>'id'))))<>0 then raise exception 'Attached file became a cleanup candidate'; end if;
 if jsonb_array_length(public.pdr_hito_file(other_token,'cleanup',jsonb_build_object('file_ids',jsonb_build_array(file1->>'id',file2->>'id'))))<>0 then raise exception 'Foreign-profile candidates leaked'; end if;
 if not exists(select 1 from pdr_private.milestone_files where id=(file2->>'id')::uuid) then raise exception 'Unrequested orphan changed'; end if;
 if has_function_privilege('anon','public.pdr_hito_file(text,text,jsonb)','execute') then raise exception 'File service exposed'; end if;
end;
$$;
select 'PASS: explicit cleanup IDs required, unrequested orphans excluded, attached documents protected, ownership preserved' as result;
rollback;
