begin;
do $$
declare n text; t text; b text; mid uuid:=gen_random_uuid(); fid uuid:=gen_random_uuid();
 ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
 payload jsonb; doc jsonb; notes jsonb; aid uuid; calendar jsonb; started timestamptz;
begin
 n=public.pdr_sign_in('nicolas',current_setting('pdr.test_pin',true))->>'token'; t=public.pdr_sign_in('tomas','')->>'token'; b=public.pdr_sign_in('benjamin',current_setting('pdr.test_pin',true))->>'token';
 notes=jsonb_build_array(
  jsonb_build_object('id',ids[1],'text','__SCHEDULE_INHERIT__','folder_id',fid),
  jsonb_build_object('id',ids[2],'text','__SCHEDULE_OVERRIDE__','folder_id',fid,'schedule_mode','custom','scheduled_date','2026-11-12'),
  jsonb_build_object('id',ids[3],'text','__SCHEDULE_NONE__','folder_id',fid,'schedule_mode','none'),
  jsonb_build_object('id',ids[4],'text','__SCHEDULE_CONTEXT__','folder_id',fid,'actionable',false));
 payload=jsonb_build_object('id',mid,'title','__SCHEDULE_TEST__','state','draft','notes',notes,
  'folders',jsonb_build_array(jsonb_build_object('id',fid,'name','Fecha general','assignee','tomas','scheduled_date','2026-11-09')));
 doc=public.pdr_workspace('save_minute',n,payload);
 if exists(select 1 from pdr_private.assignments where minute_id=mid) then raise exception 'Draft was scheduled'; end if;
 payload=payload||jsonb_build_object('state','published','version',(doc->>'version')::int);
 doc=public.pdr_workspace('save_minute',n,payload);
 if (select count(*) from pdr_private.assignments where minute_id=mid)<>3 then raise exception 'Distribution count changed'; end if;
 if not exists(select 1 from pdr_private.assignments where minute_id=mid and source_id=ids[1] and scheduled_date='2026-11-09') then raise exception 'Inheritance failed'; end if;
 if not exists(select 1 from pdr_private.assignments where minute_id=mid and source_id=ids[2] and scheduled_date='2026-11-12') then raise exception 'Override failed'; end if;
 if not exists(select 1 from pdr_private.assignments where minute_id=mid and source_id=ids[3] and scheduled_date is null) then raise exception 'Opt out failed'; end if;
 calendar=public.pdr_calendar('load',t,'{"start":"2026-11-01","end":"2026-11-30"}');
 if (select count(*) from jsonb_array_elements(calendar->'tasks') x where x->'metadata'->>'minute_id'=mid::text)<>2 then raise exception 'Calendar projection count wrong'; end if;
 if exists(select 1 from jsonb_array_elements(public.pdr_calendar('load',b,'{"start":"2026-11-01","end":"2026-11-30"}')->'tasks') x where x->'metadata'->>'minute_id'=mid::text) then raise exception 'Calendar privacy leak'; end if;
 select id into aid from pdr_private.assignments where minute_id=mid and source_id=ids[1];
 perform public.pdr_workspace('task_status',t,jsonb_build_object('id',aid,'status','iniciada'));
 select started_at into started from pdr_private.assignments where id=aid;
 perform public.pdr_calendar('save_task',t,jsonb_build_object('id',aid,'input',jsonb_build_object('title','Título editado','date','2026-11-15','priority','alta')));
 if not exists(select 1 from pdr_private.assignments where id=aid and title='Título editado' and scheduled_date='2026-11-15' and priority='alta' and status='iniciada' and started_at=started) then raise exception 'Calendar edit not synced'; end if;
 if not exists(select 1 from pdr_private.minutes m,jsonb_array_elements(m.notes) x where m.id=mid and x->>'id'=ids[1]::text and x->>'text'='Título editado' and x->>'scheduled_date'='2026-11-15') then raise exception 'Source point not synced'; end if;
 perform public.pdr_calendar('patch_task',t,jsonb_build_object('id',aid,'input','{"completed":true}'::jsonb));
 if not exists(select 1 from pdr_private.assignments where id=aid and status='terminada' and completed_at is not null) then raise exception 'Completion not synced'; end if;
 if not exists(select 1 from jsonb_array_elements(public.pdr_calendar('history',t,'{"days":365}')) x where x->>'id'=aid::text) then raise exception 'Completion absent in history'; end if;
 perform public.pdr_calendar('patch_task',t,jsonb_build_object('id',aid,'input','{"date":null}'::jsonb));
 if not exists(select 1 from pdr_private.assignments where id=aid and scheduled_date is null) then raise exception 'Removing date removed distribution'; end if;
 begin perform public.pdr_calendar('patch_task',b,jsonb_build_object('id',aid,'input','{"completed":false}'::jsonb)); raise exception 'Non-owner calendar edit allowed'; exception when insufficient_privilege then null; end;
 begin perform public.pdr_calendar('patch_task',t,jsonb_build_object('id',aid,'input','{"date":"2026-02-30"}'::jsonb)); raise exception 'Invalid date allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.pdr_workspace('save_minute',n,payload); raise exception 'Stale minute overwrote calendar edit'; exception when raise_exception then if sqlerrm not like 'La minuta cambió%' then raise; end if; end;
 perform public.pdr_calendar('delete_task',t,jsonb_build_object('id',aid));
 if exists(select 1 from jsonb_array_elements(public.pdr_workspace('load',t)->'tasks') x where x->>'id'=aid::text) then raise exception 'Deleted linked task still visible'; end if;
 if exists(select 1 from public.tasks where id=aid) then raise exception 'A physical calendar duplicate was created'; end if;
end;
$$;
select 'PASS: optional/inherited/override/no-date, drafts, one task in two views, bidirectional completion and edits, history, privacy, version conflicts, deletion' as result;
rollback;
