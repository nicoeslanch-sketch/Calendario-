-- Reject unbounded cleanup at the database boundary, even for the file service.
-- No data is deleted by this migration and existing access rules are unchanged.
create or replace function public.pdr_hito_file(p_token text,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_owner text; h uuid; fid uuid; f pdr_private.milestone_files%rowtype; v_result jsonb; v_ids uuid[];
begin
 select profile_id into v_owner from pdr_private.sessions where token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and expires_at>now();
 if v_owner is null then raise exception 'Sesión vencida.' using errcode='28000'; end if;
 h=nullif(p_payload->>'milestone_id','')::uuid; fid=nullif(p_payload->>'file_id','')::uuid;
 if p_action='cleanup' then
  if jsonb_typeof(p_payload->'file_ids') is distinct from 'array' then
   raise exception 'La limpieza requiere IDs de archivos explícitos.' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'file_ids') not between 1 and 100 then
   raise exception 'La limpieza requiere entre 1 y 100 IDs de archivos.' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'file_ids') x
    where jsonb_typeof(x)<>'string' or (x#>>'{}') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') then
   raise exception 'La limpieza recibió IDs de archivos inválidos.' using errcode='22023'; end if;
  v_ids=array(select distinct x::uuid from jsonb_array_elements_text(p_payload->'file_ids') x);
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from pdr_private.milestone_files x
    where x.id=any(v_ids) and x.owner_id=v_owner
      and (x.milestone_id is null or (not x.ready and x.created_at<now()-interval '1 hour'))),'[]');
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
