-- Extend existing distribution without replacing its session/ownership/version guards.
-- Legacy tasks have medium priority; no task content or status is removed/reset.
alter table pdr_private.assignments add column priority text not null default 'media'
  check (priority in ('alta','media','baja'));

create function pdr_private.validate_minute_priorities() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from jsonb_array_elements(new.notes) n
    where n ? 'priority' and (jsonb_typeof(n->'priority')<>'string'
      or n->>'priority' not in ('alta','media','baja'))) then
    raise exception 'Prioridad inválida. Selecciona alta, media o baja.' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function pdr_private.validate_minute_priorities() from public,anon,authenticated;
create trigger validate_minute_priorities before insert or update of notes
  on pdr_private.minutes for each row execute function pdr_private.validate_minute_priorities();

-- The persisted minute is authoritative, never the client-generated summary.
-- Existing stable source IDs and upserts keep task statuses/timestamps/tombstones.
create function pdr_private.assignment_priority_from_minute() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  select coalesce(n->>'priority','media') into new.priority
    from pdr_private.minutes m cross join lateral jsonb_array_elements(m.notes) n
    where m.id=new.minute_id and n->>'id'=new.source_id::text;
  new.priority=coalesce(new.priority,'media');
  return new;
end;
$$;
revoke all on function pdr_private.assignment_priority_from_minute() from public,anon,authenticated;
create trigger assignment_priority_from_minute before insert or update
  on pdr_private.assignments for each row execute function pdr_private.assignment_priority_from_minute();

notify pgrst,'reload schema';
