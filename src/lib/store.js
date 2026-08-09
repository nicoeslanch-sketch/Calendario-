import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const hasRemote = Boolean(url && key && !url.includes('TU-PROYECTO'));
export const supabase = hasRemote ? createClient(url, key, {
  realtime: { params: { eventsPerSecond: 10 } },
}) : null;

const LOCAL_KEY = 'pdr-planner-local-v1';
const empty = { tasks: [], birthdays: [], subscriptions: [] };
let local = readLocal();

function readLocal() {
  try {
    return { ...empty, ...JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') };
  } catch {
    return structuredClone(empty);
  }
}

function writeLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  window.dispatchEvent(new CustomEvent('pdr-local-change'));
}

function uuid() {
  return crypto.randomUUID();
}

function normalizeTask(task) {
  return {
    description: '', start_time: null, deadline_time: null, responsible: 'ambos',
    priority: 'media', category: 'otro', completed: false, completed_at: null,
    reminder_minutes_before: 60, recurrence_rule: { frequency: 'none' },
    notify_target: 'responsable', estimated_minutes: 30, preparation_business_days: 0,
    position: 0, metadata: {}, subtasks: [], ...task,
  };
}

export function backendMode() {
  return hasRemote ? 'supabase' : 'local';
}

export async function loadRange(start, end) {
  if (!supabase) {
    return {
      tasks: local.tasks.filter((task) => !(task.is_recurring_template || (task.recurrence_rule?.frequency !== 'none' && !task.recurrence_source_id)) && task.date >= start && task.date <= end),
      birthdays: local.birthdays.filter((birthday) => birthday.active),
    };
  }
  await supabase.rpc('materialize_recurring_tasks', { p_start: start, p_end: end });
  const [tasksResult, birthdaysResult] = await Promise.all([
    supabase.from('tasks').select('*, subtasks(*)').gte('date', start).lte('date', end).eq('is_recurring_template', false).order('date').order('position').order('start_time', { nullsFirst: false }),
    supabase.from('birthdays').select('*').eq('active', true).order('month').order('day'),
  ]);
  if (tasksResult.error) throw tasksResult.error;
  if (birthdaysResult.error) throw birthdaysResult.error;
  return { tasks: tasksResult.data, birthdays: birthdaysResult.data };
}

export async function loadHistory(days = 30) {
  if (!supabase) {
    return local.tasks.filter((task) => task.completed_at).sort((a, b) => b.completed_at.localeCompare(a.completed_at)).slice(0, 100);
  }
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase.from('tasks').select('*').eq('completed', true).gte('completed_at', since).order('completed_at', { ascending: false }).limit(100);
  if (error) throw error;
  return data;
}

export async function saveTask(input, id = null) {
  const subtasks = input.subtasks || [];
  const task = normalizeTask({ ...input });
  task.is_recurring_template = task.recurrence_rule?.frequency !== 'none';
  delete task.subtasks;
  if (!supabase) {
    const now = new Date().toISOString();
    const saved = { ...task, id: id || uuid(), created_at: now, updated_at: now, subtasks: subtasks.map((subtask, position) => ({ id: subtask.id || uuid(), title: subtask.title, completed: Boolean(subtask.completed), position })) };
    const index = local.tasks.findIndex((item) => item.id === saved.id);
    if (index >= 0) local.tasks[index] = { ...local.tasks[index], ...saved };
    else local.tasks.push(saved);
    if (saved.recurrence_rule?.frequency !== 'none') materializeLocal(saved);
    writeLocal();
    return saved;
  }
  const payload = { ...task };
  let result;
  if (id) result = await supabase.from('tasks').update(payload).eq('id', id).select().single();
  else result = await supabase.from('tasks').insert(payload).select().single();
  if (result.error) throw result.error;
  await supabase.from('subtasks').delete().eq('task_id', result.data.id);
  if (subtasks.length) {
    const { error } = await supabase.from('subtasks').insert(subtasks.filter((subtask) => subtask.title?.trim()).map((subtask, position) => ({ task_id: result.data.id, title: subtask.title.trim(), completed: Boolean(subtask.completed), position })));
    if (error) throw error;
  }
  if (payload.is_recurring_template) {
    const end = new Date(); end.setFullYear(end.getFullYear() + 1);
    await supabase.rpc('materialize_recurring_tasks', { p_start: task.date, p_end: end.toISOString().slice(0, 10) });
  }
  return result.data;
}

function materializeLocal(template) {
  const rule = template.recurrence_rule;
  const end = new Date(template.date); end.setFullYear(end.getFullYear() + 1);
  for (let cursor = new Date(template.date + 'T12:00:00'); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    const day = cursor.getDay() || 7;
    const isMatch = rule.frequency === 'daily'
      || (rule.frequency === 'weekly' && (rule.weekdays || [new Date(template.date + 'T12:00:00').getDay() || 7]).includes(day))
      || (rule.frequency === 'monthly' && cursor.getDate() === new Date(template.date + 'T12:00:00').getDate());
    if (!isMatch || local.tasks.some((task) => task.recurrence_source_id === template.id && task.date === date)) continue;
    local.tasks.push({ ...structuredClone(template), id: uuid(), date, is_recurring_template: false, recurrence_source_id: template.id, recurrence_date: date, completed: false, completed_at: null });
  }
}

export async function toggleTask(task) {
  const completed = !task.completed;
  return patchTask(task.id, { completed, completed_at: completed ? new Date().toISOString() : null });
}

export async function patchTask(id, updates) {
  if (!supabase) {
    const task = local.tasks.find((item) => item.id === id);
    Object.assign(task, updates, { updated_at: new Date().toISOString() });
    writeLocal();
    return task;
  }
  const { data, error } = await supabase.from('tasks').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function duplicateTask(task) {
  const copy = { ...task };
  delete copy.id;
  delete copy.created_at;
  delete copy.updated_at;
  delete copy.recurrence_source_id;
  delete copy.recurrence_date;
  return saveTask({ ...copy, title: `${task.title} (copia)`, completed: false, completed_at: null, recurrence_rule: { frequency: 'none' }, subtasks: (task.subtasks || []).map((subtask) => ({ title: subtask.title, completed: false })) });
}

export async function deleteTask(id) {
  if (!supabase) {
    local.tasks = local.tasks.filter((task) => task.id !== id && task.recurrence_source_id !== id);
    writeLocal();
    return;
  }
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function toggleSubtask(subtaskId, completed) {
  if (!supabase) {
    for (const task of local.tasks) {
      const subtask = task.subtasks?.find((item) => item.id === subtaskId);
      if (subtask) subtask.completed = completed;
    }
    writeLocal();
    return;
  }
  const { error } = await supabase.from('subtasks').update({ completed }).eq('id', subtaskId);
  if (error) throw error;
}

export async function saveBirthday(input, id = null) {
  if (!supabase) {
    const saved = { active: true, description: '', ...input, id: id || uuid(), created_at: new Date().toISOString() };
    const index = local.birthdays.findIndex((item) => item.id === saved.id);
    if (index >= 0) local.birthdays[index] = saved; else local.birthdays.push(saved);
    writeLocal();
    return saved;
  }
  const query = id ? supabase.from('birthdays').update(input).eq('id', id) : supabase.from('birthdays').insert(input);
  const { data, error } = await query.select().single();
  if (error) throw error;
  return data;
}

export async function deleteBirthday(id) {
  if (!supabase) {
    local.birthdays = local.birthdays.filter((birthday) => birthday.id !== id);
    writeLocal();
    return;
  }
  const { error } = await supabase.from('birthdays').delete().eq('id', id);
  if (error) throw error;
}

export async function saveSubscription(subscription, person, deviceName) {
  const json = subscription.toJSON();
  const payload = {
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    device_name: deviceName,
    person,
    active: true,
    user_agent: navigator.userAgent,
  };
  if (!supabase) {
    const existing = local.subscriptions.find((item) => item.endpoint === payload.endpoint);
    if (existing) Object.assign(existing, payload); else local.subscriptions.push({ id: uuid(), ...payload });
    writeLocal();
    return;
  }
  const { error } = await supabase.rpc('register_notification_subscription', {
    p_endpoint: payload.endpoint,
    p_p256dh: payload.p256dh,
    p_auth: payload.auth,
    p_device_name: payload.device_name,
    p_person: payload.person,
    p_user_agent: payload.user_agent,
  });
  if (error) throw error;
}

export async function disableSubscription(endpoint) {
  if (!supabase) {
    const item = local.subscriptions.find((subscription) => subscription.endpoint === endpoint);
    if (item) item.active = false;
    writeLocal();
    return;
  }
  const { error } = await supabase.rpc('disable_notification_subscription', { p_endpoint: endpoint });
  if (error) throw error;
}

export async function snoozeTask(taskId, minutes) {
  if (!supabase) return;
  const { error } = await supabase.rpc('schedule_task_snooze', { p_task_id: taskId, p_minutes: minutes });
  if (error) throw error;
}

export function subscribeRealtime(onChange) {
  if (!supabase) {
    window.addEventListener('pdr-local-change', onChange);
    return () => window.removeEventListener('pdr-local-change', onChange);
  }
  const channel = supabase.channel('pdr-planner')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subtasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'birthdays' }, onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
