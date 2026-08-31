alter table public.tasks
add column is_secondary boolean not null default false;

comment on column public.tasks.is_secondary is
'Separates compact weekly support tasks from the primary calendar views.';

create index tasks_secondary_week_idx
on public.tasks(is_secondary, completed, date, responsible)
where is_recurring_template = false;
