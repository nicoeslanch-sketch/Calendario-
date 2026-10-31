import { calendarRequest } from './workspace-store.js';

export const backendMode = () => 'supabase';
export const loadRange = (start, end) => calendarRequest('load', { start, end });
export const loadHistory = (days = 30) => calendarRequest('history', { days });
export const loadProjects = () => calendarRequest('projects');
export const saveTask = (input, id = null) => calendarRequest('save_task', { input, id });
export const patchTask = (id, input) => calendarRequest('patch_task', { input, id });
export const deleteTask = (id) => calendarRequest('delete_task', { id });
export const toggleTask = (task) => patchTask(task.id, { completed: !task.completed });
export const toggleSubtask = (id, completed) => calendarRequest('subtask', { id, completed });
export const saveProject = (input, id = null) => calendarRequest('save_project', { input, id });
export const patchProject = (id, input) => calendarRequest('save_project', { input, id });
export const deleteProject = (id) => calendarRequest('delete_project', { id });
export const saveBirthday = (input, id = null) => calendarRequest('save_birthday', { input, id });
export const deleteBirthday = (id) => calendarRequest('delete_birthday', { id });
export const snoozeTask = (id, minutes) => calendarRequest('snooze', { id, minutes });

export function duplicateTask(task) {
  const { title, description, date, start_time, deadline_time, responsible, priority,
    category, notify_target, estimated_minutes, reminder_minutes, is_secondary } = task;
  return saveTask({ title: `${title} (copia)`, description, date, start_time, deadline_time,
    responsible, priority, category, notify_target, estimated_minutes, reminder_minutes,
    is_secondary, recurrence_rule: { frequency: 'none' },
    subtasks: (task.subtasks || []).map((s) => ({ title: s.title, completed: false })) });
}

export function saveSubscription(subscription, person, deviceName) {
  const json = subscription.toJSON();
  return calendarRequest('subscribe', { endpoint: json.endpoint, p256dh: json.keys.p256dh,
    auth: json.keys.auth, device_name: deviceName, person, user_agent: navigator.userAgent });
}
export const disableSubscription = (endpoint) => calendarRequest('unsubscribe', { endpoint });

// Custom profile sessions are not Supabase Auth JWTs. Poll through the validated
// RPC instead of opening the private tables to anonymous Realtime subscribers.
export function subscribeRealtime(onChange) {
  const timer = setInterval(onChange, 20000);
  return () => clearInterval(timer);
}
