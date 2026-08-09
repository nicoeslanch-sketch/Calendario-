import './styles.css';
import {
  addDays, addMonths, birthdayISO, chileToday, deadlineState, endOfWeek,
  formatLongDate, formatMonth, formatShortDay, isBirthdayOn, isIOS,
  monthBounds, monthGrid, relativeDeadline, startOfWeek,
} from './lib/date.js';
import {
  backendMode, deleteBirthday, deleteTask, duplicateTask, loadHistory, loadRange,
  patchTask, saveBirthday, saveTask, snoozeTask, subscribeRealtime,
  toggleSubtask, toggleTask,
} from './lib/store.js';
import { currentSubscription, disablePush, enablePush, registerServiceWorker } from './lib/push.js';

const app = document.querySelector('#app');
const PERSON = { nicolas: 'Nicolás', benjamin: 'Benjamín', ambos: 'Los dos' };
const PERSON_COLOR = { nicolas: '#3e6b8c', benjamin: '#a94f86', ambos: '#2f8659' };
const CATEGORY = {
  reunion: ['Reunión', '#3e6b8c'],
  deadline: ['Deadline', '#bb3f34'],
  preparacion: ['Preparación', '#c48620'],
  seguimiento: ['Seguimiento', '#2f8659'],
  administracion: ['Administración', '#6b5b95'],
  otro: ['Otro', '#718077'],
};
const PRIORITY_WEIGHT = { baja: 12, media: 20, alta: 28, urgente: 38 };

const state = {
  view: 'today',
  person: localStorage.getItem('pdr-person') || 'ambos',
  cursor: chileToday(),
  selectedDate: chileToday(),
  tasks: [],
  birthdays: [],
  history: [],
  historyDays: 30,
  modal: null,
  loading: true,
  pushEnabled: false,
};

let realtimeTimer;

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function toast(title, detail = '', kind = 'success') {
  const region = document.querySelector('#toast-region');
  const element = document.createElement('div');
  const color = kind === 'error' ? 'var(--stop)' : kind === 'warning' ? 'var(--warn)' : 'var(--go)';
  element.className = 'toast';
  element.style.setProperty('--toast-color', color);
  element.innerHTML = `<i></i><div><b>${escapeHTML(title)}</b>${detail ? `<small>${escapeHTML(detail)}</small>` : ''}</div>`;
  region.append(element);
  setTimeout(() => element.remove(), 5000);
}

function visible(task) {
  return state.person === 'ambos' || task.responsible === state.person || task.responsible === 'ambos';
}

function byDate(iso) {
  return state.tasks.filter((task) => task.date === iso && visible(task));
}

function birthdayByDate(iso) {
  return state.birthdays.filter((birthday) => isBirthdayOn(birthday, iso));
}

function taskLoad(task) {
  if (task.completed) return 0;
  const deadlineBonus = task.deadline_time ? 8 : 0;
  const subtaskBonus = Math.min(18, (task.subtasks?.filter((item) => !item.completed).length || 0) * 3);
  const durationBonus = Math.min(18, Math.round((task.estimated_minutes || 30) / 30) * 3);
  return PRIORITY_WEIGHT[task.priority] + deadlineBonus + subtaskBonus + durationBonus;
}

function dayLoad(iso) {
  return Math.min(100, byDate(iso).reduce((total, task) => total + taskLoad(task), 0));
}

function loadMeta(load) {
  if (load >= 70) return ['alta', 'var(--stop)'];
  if (load >= 40) return ['media', 'var(--warn)'];
  return ['baja', 'var(--go)'];
}

function sortToday(tasks) {
  const rank = { overdue: 0, urgent: 1, pending: 2, completed: 3 };
  return [...tasks].sort((a, b) => {
    const stateDiff = rank[deadlineState(a)] - rank[deadlineState(b)];
    if (stateDiff) return stateDiff;
    const priorityDiff = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
    if (priorityDiff) return priorityDiff;
    return (a.deadline_time || a.start_time || '99:99').localeCompare(b.deadline_time || b.start_time || '99:99');
  });
}

function rangeForView() {
  if (state.view === 'week') return { start: startOfWeek(state.cursor), end: endOfWeek(state.cursor) };
  if (state.view === 'month') return monthBounds(state.cursor);
  if (state.view === 'history') {
    return { start: addDays(chileToday(), -state.historyDays), end: chileToday() };
  }
  const start = addDays(chileToday(), -7);
  return { start, end: addDays(chileToday(), 35) };
}

async function refresh({ quiet = false } = {}) {
  if (!quiet) state.loading = true;
  try {
    const range = rangeForView();
    const data = await loadRange(range.start, range.end);
    state.tasks = data.tasks;
    state.birthdays = data.birthdays;
    if (state.view === 'history') state.history = await loadHistory(state.historyDays);
  } catch (error) {
    console.error(error);
    toast('No se pudieron cargar los datos', error.message, 'error');
  } finally {
    state.loading = false;
    render();
  }
}

function header() {
  return `
    <header class="topbar">
      <div class="brand"><strong>PDR Planner</strong><small>Calendario operativo</small></div>
      <div class="top-actions">
        <div class="person-switch" role="group" aria-label="Filtrar por responsable">
          ${personButton('nicolas', 'N')} ${personButton('benjamin', 'B')} ${personButton('ambos', '')}
        </div>
        <button class="notify-button ${state.pushEnabled ? 'enabled' : ''}" data-action="notifications">${state.pushEnabled ? 'Avisos activos' : 'Activar avisos'}</button>
      </div>
    </header>
    <nav class="tabs" aria-label="Vistas">
      ${tab('today', 'Hoy')}${tab('week', 'Semana')}${tab('month', 'Mes')}${tab('history', 'Completadas')}${tab('birthdays', 'Cumpleaños')}
    </nav>`;
}

function personButton(person, initial) {
  const label = PERSON[person];
  return `<button class="${state.person === person ? 'active' : ''}" data-person="${person}" aria-pressed="${state.person === person}">${initial ? `<i style="background:${PERSON_COLOR[person]}">${initial}</i>` : ''}${label}</button>`;
}

function tab(view, label) {
  return `<button class="${state.view === view ? 'active' : ''}" data-view="${view}">${label}</button>`;
}

function viewHeader(title, mode = null) {
  const nav = mode ? `<div class="nav"><button class="button" data-action="previous">‹ Anterior</button><button class="button" data-action="today">Hoy</button><button class="button" data-action="next">Siguiente ›</button></div>` : '';
  return `<div class="view-head"><div><h1>${escapeHTML(title)}</h1>${mode ? `<div class="sub">Zona horaria: America/Santiago</div>` : ''}</div>${nav}</div>`;
}

function render() {
  app.innerHTML = `${header()}<main class="app-main">
    ${backendMode() === 'local' ? '<div class="status-banner"><b>Modo local:</b> configura Supabase para compartir y sincronizar el calendario. Los cambios de esta sesión se guardan en este navegador.</div>' : ''}
    ${isIOS() && !window.matchMedia('(display-mode: standalone)').matches ? '<div class="ios-banner">Para recibir avisos en iPhone, agrega PDR Planner a la pantalla de inicio desde Safari.</div>' : ''}
    ${state.loading ? '<div class="card empty">Cargando calendario…</div>' : renderView()}
  </main>${renderModal()}`;
}

function renderView() {
  if (state.view === 'week') return renderWeek();
  if (state.view === 'month') return renderMonth();
  if (state.view === 'history') return renderHistory();
  if (state.view === 'birthdays') return renderBirthdays();
  return renderToday();
}

function renderToday() {
  const today = chileToday();
  const tasks = sortToday(byDate(today));
  const birthdays = birthdayByDate(today);
  const load = dayLoad(today);
  const [loadLabel, loadColor] = loadMeta(load);
  const overdue = tasks.filter((task) => deadlineState(task) === 'overdue').length;
  const urgent = tasks.filter((task) => deadlineState(task) === 'urgent').length;
  const complete = tasks.filter((task) => task.completed).length;
  const alerts = buildAlerts(tasks, today);
  return `
    ${birthdays.map((birthday) => `<div class="birthday-notice"><span class="cake">🎂</span><div><b>Hoy está de cumpleaños ${escapeHTML(birthday.name)}</b><small>${escapeHTML(birthday.description || 'Cumpleaños anual')}</small></div></div>`).join('')}
    <div class="today-grid">
      <section class="card hero">
        <div class="hero-top"><div><div class="eyebrow">Hoy · ${escapeHTML(formatLongDate(today))} · ${PERSON[state.person]}</div><h1>${overdue ? 'Hay pendientes vencidos' : urgent ? 'Próximos vencimientos' : tasks.length ? 'Plan del día' : 'Día despejado'}</h1><p class="summary">${tasks.length} ${tasks.length === 1 ? 'actividad' : 'actividades'} · ${tasks.filter((task) => !task.completed).length} pendientes</p></div><div class="load-ring" style="--pct:${load};--load-color:${loadColor}"><strong>${load}%</strong></div></div>
        <div class="tallies"><div class="tally"><strong style="color:var(--stop)">${overdue}</strong><span>Vencidas</span></div><div class="tally"><strong style="color:var(--warn)">${urgent}</strong><span>Urgentes</span></div><div class="tally"><strong style="color:var(--go)">${complete}</strong><span>Listas</span></div><div class="tally"><strong style="color:${loadColor}">${loadLabel}</strong><span>Carga</span></div></div>
      </section>
      <section class="card"><div class="card-head"><h2>Avisos</h2><span>Por urgencia</span></div><div class="alerts">${alerts}</div></section>
    </div>
    <section class="card quick-card"><div class="card-head"><h2>+ Nueva tarea</h2><span>Guardado inmediato</span><button class="button small" data-action="new-task" data-date="${today}">Más opciones</button></div>${quickForm(today)}</section>
    <section class="card task-list"><div class="card-head"><h2>Plan del día</h2><span>${load}% de carga estimada</span></div>${tasks.length ? tasks.map(taskRow).join('') : '<div class="empty">Nada agendado. Puedes crear una tarea arriba.</div>'}</section>`;
}

function buildAlerts(tasks, today) {
  const items = [];
  tasks.forEach((task) => {
    const status = deadlineState(task);
    if (status === 'overdue') items.push(['var(--stop)', `${task.title} está vencida`, relativeDeadline(task)]);
    else if (status === 'urgent') items.push(['var(--warn)', `${task.title} vence pronto`, relativeDeadline(task)]);
  });
  for (let offset = 1; offset <= 3; offset += 1) {
    const date = addDays(today, offset);
    birthdayByDate(date).forEach((birthday) => items.push(['var(--pink)', `${birthday.name} cumple en ${offset} ${offset === 1 ? 'día' : 'días'}`, birthday.description || 'Cumpleaños anual']));
  }
  if (!items.length) items.push(['var(--go)', 'Todo al día', 'No hay topes vencidos ni tareas críticas.']);
  return items.slice(0, 6).map(([color, title, detail]) => `<div class="alert"><i class="bar" style="background:${color}"></i><div><b>${escapeHTML(title)}</b><small>${escapeHTML(detail)}</small></div></div>`).join('');
}

function quickForm(today) {
  return `<form class="quick-form" id="quick-form">
    <div class="field title-field"><label for="quick-title">Qué hay que hacer</label><input id="quick-title" name="title" required maxlength="160" placeholder="Provisiones"></div>
    <div class="field"><label for="quick-date">Fecha</label><input id="quick-date" name="date" type="date" value="${today}" required></div>
    <div class="field"><label for="quick-time">Hora tope</label><input id="quick-time" name="deadline_time" type="time" value="12:00"></div>
    <div class="field"><label for="quick-person">Responsable</label><select id="quick-person" name="responsible">${personOptions(state.person)}</select></div>
    <div class="field"><label for="quick-reminder">Avisarme</label><select id="quick-reminder" name="reminder_minutes_before">${reminderOptions(60)}</select></div>
    <button class="button primary" type="submit">Guardar</button>
  </form>`;
}

function taskRow(task) {
  const status = deadlineState(task);
  const category = CATEGORY[task.category] || CATEGORY.otro;
  const time = task.start_time || '—';
  const subtaskCount = task.subtasks?.length || 0;
  const subtaskDone = task.subtasks?.filter((item) => item.completed).length || 0;
  return `<article class="task-row ${status}" data-open-task="${task.id}" draggable="true" data-task-id="${task.id}">
    <div class="task-time">${escapeHTML(time.slice(0, 5))}${task.deadline_time ? `<small>tope ${escapeHTML(task.deadline_time.slice(0, 5))}</small>` : ''}</div>
    <button class="check" data-toggle-task="${task.id}" aria-label="${task.completed ? 'Desmarcar' : 'Completar'} ${escapeHTML(task.title)}">✓</button>
    <div><div class="task-title"><i class="responsible-dot" style="background:${category[1]}"></i>${escapeHTML(task.title)}</div><div class="task-meta">${PERSON[task.responsible]} · ${escapeHTML(category[0])}${subtaskCount ? ` · ${subtaskDone}/${subtaskCount} subtareas` : ''}</div></div>
    <div class="task-right">${task.completed ? '<span class="pill completed">Lista</span>' : `<span class="pill ${task.priority}">${task.priority}</span>`}<div class="relative ${status}">${escapeHTML(relativeDeadline(task))}</div></div>
  </article>`;
}

function renderWeek() {
  const start = startOfWeek(state.cursor);
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index));
  return `${viewHeader(`Semana del ${formatLongDate(start).replace(/^[^,]+,?\s*/i, '')}`, 'week')}<div class="week-grid">${days.map(weekDay).join('')}</div>`;
}

function weekDay(iso) {
  const tasks = sortToday(byDate(iso));
  const birthdays = birthdayByDate(iso);
  const load = dayLoad(iso);
  const [label, color] = loadMeta(load);
  return `<section class="week-day ${iso === chileToday() ? 'today' : ''}" data-drop-date="${iso}">
    <div class="week-day-head"><div><span class="day">${escapeHTML(formatShortDay(iso))}</span><span class="number">${Number(iso.slice(-2))}</span></div><span class="load" style="--load-color:${color}">${load}% ${label}</span></div>
    <div class="loadbar" style="--load-color:${color}"><i style="width:${load}%"></i></div>
    ${tasks.map((task) => `<button class="week-task ${task.completed ? 'completed' : ''}" style="--task-color:${(CATEGORY[task.category] || CATEGORY.otro)[1]}" draggable="true" data-task-id="${task.id}" data-open-task="${task.id}">${escapeHTML(task.title)}<span>${task.deadline_time ? `Tope ${task.deadline_time.slice(0, 5)} · ` : ''}${PERSON[task.responsible]}</span></button>`).join('') || '<div class="empty">Sin tareas</div>'}
    ${birthdays.length ? `<div class="week-bday">🎂 ${birthdays.map((birthday) => escapeHTML(birthday.name)).join(', ')}</div>` : ''}
  </section>`;
}

function renderMonth() {
  const days = monthGrid(state.cursor);
  const month = state.cursor.slice(0, 7);
  return `${viewHeader(formatMonth(state.cursor), 'month')}<div class="month-layout">
    <section class="card calendar"><div class="calendar-head"><div>Lun</div><div>Mar</div><div>Mié</div><div>Jue</div><div>Vie</div><div>Sáb</div><div>Dom</div></div><div class="month-grid">${days.map((iso) => monthCell(iso, month)).join('')}</div></section>
    ${dayPanel(state.selectedDate)}
  </div>`;
}

function monthCell(iso, month) {
  const tasks = byDate(iso);
  const birthdays = birthdayByDate(iso);
  const load = dayLoad(iso);
  const [, color] = loadMeta(load);
  return `<button class="month-cell ${iso.slice(0, 7) !== month ? 'out' : ''} ${iso === chileToday() ? 'today' : ''} ${iso === state.selectedDate ? 'selected' : ''}" data-select-date="${iso}" data-drop-date="${iso}"><i class="cell-load" style="--load-color:${load ? color : 'transparent'}"></i><span class="cell-number">${Number(iso.slice(-2))}</span>${tasks.slice(0, 3).map((task) => `<span class="month-task" draggable="true" data-task-id="${task.id}" style="--task-color:${(CATEGORY[task.category] || CATEGORY.otro)[1]}">${escapeHTML(task.title)}</span>`).join('')}${tasks.length > 3 ? `<span class="month-task" style="--task-color:#718077">+${tasks.length - 3}</span>` : ''}${birthdays.length ? `<span class="month-bday">🎂 ${birthdays.map((birthday) => escapeHTML(birthday.name.split(' ')[0])).join(', ')}</span>` : ''}</button>`;
}

function dayPanel(iso) {
  const tasks = sortToday(byDate(iso));
  const birthdays = birthdayByDate(iso);
  const load = dayLoad(iso);
  const [label, color] = loadMeta(load);
  return `<aside class="card day-panel"><div class="card-head"><h2>Detalle del día</h2><button class="button small primary" data-action="new-task" data-date="${iso}">+ Tarea</button></div><div class="day-panel-body"><h2>${escapeHTML(formatLongDate(iso))}</h2><div class="task-meta" style="color:${color}">${load}% · carga ${label}</div>${birthdays.map((birthday) => `<div class="birthday-notice" style="margin-top:10px"><span>🎂</span><b>${escapeHTML(birthday.name)}</b></div>`).join('')}${tasks.map((task) => `<div class="day-panel-task"><button data-open-task="${task.id}"><b>${escapeHTML(task.title)}</b><div class="task-meta">${task.deadline_time ? `Tope ${task.deadline_time.slice(0, 5)} · ` : ''}${PERSON[task.responsible]}</div></button></div>`).join('') || '<div class="empty">Sin tareas</div>'}</div></aside>`;
}

function renderHistory() {
  const list = state.history.filter(visible);
  return `${viewHeader('Completadas recientemente')}<div class="history-controls"><select class="button" data-history-days><option value="7" ${state.historyDays === 7 ? 'selected' : ''}>Últimos 7 días</option><option value="30" ${state.historyDays === 30 ? 'selected' : ''}>Últimos 30 días</option></select></div><section class="card history-list">${list.length ? list.map((task) => `<article class="task-row completed" data-open-task="${task.id}"><span class="check">✓</span><div><div class="task-title">${escapeHTML(task.title)}</div><div class="task-meta">${PERSON[task.responsible]} · tarea del ${escapeHTML(formatLongDate(task.date))}</div></div><div class="relative completed">${escapeHTML(relativeDeadline(task))}</div></article>`).join('') : '<div class="empty">No hay tareas completadas en este período.</div>'}</section>`;
}

function renderBirthdays() {
  const ordered = [...state.birthdays].sort((a, b) => (a.month * 100 + a.day) - (b.month * 100 + b.day));
  return `${viewHeader('Cumpleaños')}<section class="card quick-card"><div class="card-head"><h2>Agregar cumpleaños</h2><span>No suma carga ni genera pendientes</span></div><form class="quick-form" id="birthday-form" style="grid-template-columns:2fr 1fr 2fr auto"><div class="field"><label>Nombre</label><input name="name" required maxlength="120" placeholder="Nombre y apellido"></div><div class="field"><label>Fecha</label><input name="date" type="date" required value="${chileToday()}"></div><div class="field"><label>Descripción / equipo</label><input name="description" maxlength="200" placeholder="Opcional"></div><button class="button primary">Guardar</button></form></section><div class="birthday-grid">${ordered.map(birthdayCard).join('') || '<div class="card empty">No hay cumpleaños registrados.</div>'}</div>`;
}

function birthdayCard(birthday) {
  const iso = birthdayISO(birthday, new Date().getFullYear());
  return `<article class="card birthday-card"><span class="cake">🎂</span><div><b>${escapeHTML(birthday.name)}</b><small>${Number(iso.slice(-2))} de ${new Intl.DateTimeFormat('es-CL', { month: 'long' }).format(new Date(`${iso}T12:00:00`))}${birthday.description ? ` · ${escapeHTML(birthday.description)}` : ''}</small></div><div class="actions"><button class="button small" data-edit-birthday="${birthday.id}">Editar</button><button class="button small danger" data-delete-birthday="${birthday.id}">×</button></div></article>`;
}

function personOptions(selected = 'ambos') {
  return Object.entries(PERSON).map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('');
}

function reminderOptions(selected = 60) {
  return [[0, 'Sin aviso'], [10, '10 min antes'], [30, '30 min antes'], [60, '1 hora antes'], [120, '2 horas antes'], [1440, '1 día antes']].map(([value, label]) => `<option value="${value}" ${Number(selected) === value ? 'selected' : ''}>${label}</option>`).join('');
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal.type === 'notifications') return notificationModal();
  if (state.modal.type === 'birthday') return birthdayModal(state.modal.birthday);
  return taskModal(state.modal.task);
}

function taskModal(task = {}) {
  const isNew = !task.id;
  const recurrence = task.recurrence_rule || { frequency: 'none' };
  const subtasks = task.subtasks || [];
  return `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><form id="task-form">
    <div class="modal-head"><h2 id="modal-title">${isNew ? 'Nueva tarea' : 'Editar tarea'}</h2><button class="modal-close" type="button" data-close-modal aria-label="Cerrar">×</button></div>
    <div class="modal-body"><div class="form-grid">
      <div class="field wide"><label>Título</label><input name="title" required maxlength="160" value="${escapeHTML(task.title || '')}" autofocus></div>
      <div class="field wide"><label>Descripción</label><textarea name="description" maxlength="2000">${escapeHTML(task.description || '')}</textarea></div>
      <div class="field"><label>Responsable</label><select name="responsible">${personOptions(task.responsible || state.person)}</select></div>
      <div class="field"><label>Notificar</label><select name="notify_target"><option value="responsable" ${task.notify_target !== 'ambos' ? 'selected' : ''}>Responsable solamente</option><option value="ambos" ${task.notify_target === 'ambos' ? 'selected' : ''}>Los dos</option></select></div>
      <div class="field"><label>Fecha</label><input name="date" type="date" required value="${task.date || state.selectedDate || chileToday()}"></div>
      <div class="field"><label>Hora de inicio</label><input name="start_time" type="time" value="${task.start_time?.slice(0, 5) || ''}"></div>
      <div class="field"><label>Hora límite</label><input name="deadline_time" type="time" value="${task.deadline_time?.slice(0, 5) || ''}"></div>
      <div class="field"><label>Recordatorio</label><select name="reminder_minutes_before">${reminderOptions(task.reminder_minutes_before)}</select></div>
      <div class="field"><label>Prioridad</label><select name="priority">${['baja', 'media', 'alta', 'urgente'].map((value) => `<option ${task.priority === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
      <div class="field"><label>Categoría</label><select name="category">${Object.entries(CATEGORY).map(([value, [label]]) => `<option value="${value}" ${task.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Duración estimada</label><select name="estimated_minutes">${[15, 30, 45, 60, 90, 120].map((value) => `<option value="${value}" ${Number(task.estimated_minutes || 30) === value ? 'selected' : ''}>${value} minutos</option>`).join('')}</select></div>
      <div class="field"><label>Recurrencia</label><select name="recurrence"><option value="none">No se repite</option><option value="daily" ${recurrence.frequency === 'daily' ? 'selected' : ''}>Todos los días</option><option value="weekly" ${recurrence.frequency === 'weekly' ? 'selected' : ''}>Semanal / días elegidos</option><option value="monthly" ${recurrence.frequency === 'monthly' ? 'selected' : ''}>Todos los meses</option></select></div>
      <div class="field"><label>Preparación previa</label><select name="preparation_business_days"><option value="0">Sin preparación</option>${[1, 2, 3, 5].map((value) => `<option value="${value}" ${Number(task.preparation_business_days) === value ? 'selected' : ''}>${value} ${value === 1 ? 'día hábil' : 'días hábiles'} antes</option>`).join('')}</select></div>
      <div class="field wide"><label>Días de la semana</label><div class="weekdays">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((label, index) => `<label><input type="checkbox" name="weekday" value="${index + 1}" ${(recurrence.weekdays || []).includes(index + 1) ? 'checked' : ''}> ${label}</label>`).join('')}</div></div>
      <div class="field wide"><label>Subtareas</label><div class="subtasks" id="subtasks">${subtasks.map((subtask) => subtaskInput(subtask)).join('')}</div><button class="button small" type="button" data-action="add-subtask">+ Subtarea</button></div>
    </div>${!isNew ? `<div class="snooze"><p>Recordar más tarde en este dispositivo:</p>${[10, 20, 30, 60].map((minutes) => `<button type="button" class="button small" data-snooze="${minutes}" data-task="${task.id}">${minutes === 60 ? '1 hora' : `${minutes} min`}</button>`).join('')}</div>` : ''}</div>
    <div class="modal-actions">${!isNew ? `<button type="button" class="button danger" data-delete-task="${task.id}">Eliminar</button><button type="button" class="button" data-duplicate-task="${task.id}">Duplicar</button>` : ''}<button type="button" class="button push-right" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar</button></div>
  </form></section></div>`;
}

function subtaskInput(subtask = {}) {
  return `<div class="subtask-input"><input type="checkbox" class="subtask-check" ${subtask.completed ? 'checked' : ''} data-subtask-id="${subtask.id || ''}"><input type="text" class="subtask-title" maxlength="200" value="${escapeHTML(subtask.title || '')}" placeholder="Detalle de la tarea"><button class="button small danger" type="button" data-remove-subtask>×</button></div>`;
}

function notificationModal() {
  return `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>Avisos de este dispositivo</h2><button class="modal-close" data-close-modal>×</button></div><form id="notification-form"><div class="modal-body"><p style="margin-bottom:14px;color:var(--muted)">Los avisos Web Push pueden llegar con PDR Planner cerrado. Asocia este dispositivo a la persona correcta.</p><div class="form-grid"><div class="field"><label>Dispositivo</label><input name="device_name" required maxlength="100" value="${escapeHTML(navigator.platform || 'Mi dispositivo')}"></div><div class="field"><label>Asociar a</label><select name="person">${personOptions(state.person)}</select></div></div></div><div class="modal-actions">${state.pushEnabled ? '<button class="button danger" type="button" data-action="disable-notifications">Desactivar avisos</button>' : ''}<button class="button push-right" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">${state.pushEnabled ? 'Actualizar dispositivo' : 'Activar avisos'}</button></div></form></section></div>`;
}

function birthdayModal(birthday) {
  const year = new Date().getFullYear();
  return `<div class="modal-backdrop" data-close-modal><section class="modal"><form id="birthday-edit-form"><div class="modal-head"><h2>Editar cumpleaños</h2><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="form-grid"><div class="field wide"><label>Nombre</label><input name="name" required maxlength="120" value="${escapeHTML(birthday.name)}"></div><div class="field"><label>Fecha</label><input name="date" type="date" required value="${birthdayISO(birthday, year)}"></div><div class="field"><label>Descripción</label><input name="description" maxlength="200" value="${escapeHTML(birthday.description || '')}"></div></div></div><div class="modal-actions"><button type="button" class="button" data-close-modal>Cancelar</button><button class="button primary push-right">Guardar</button></div></form></section></div>`;
}

function taskFromForm(form) {
  const data = new FormData(form);
  const recurrence = data.get('recurrence');
  const weekdays = [...form.querySelectorAll('[name="weekday"]:checked')].map((input) => Number(input.value));
  const subtasks = [...form.querySelectorAll('.subtask-input')].map((row) => ({ id: row.querySelector('.subtask-check').dataset.subtaskId || undefined, completed: row.querySelector('.subtask-check').checked, title: row.querySelector('.subtask-title').value.trim() })).filter((item) => item.title);
  return {
    title: data.get('title').trim(), description: data.get('description').trim(),
    responsible: data.get('responsible'), notify_target: data.get('notify_target'),
    date: data.get('date'), start_time: data.get('start_time') || null,
    deadline_time: data.get('deadline_time') || null, priority: data.get('priority'),
    category: data.get('category'), reminder_minutes_before: Number(data.get('reminder_minutes_before')),
    estimated_minutes: Number(data.get('estimated_minutes')), preparation_business_days: Number(data.get('preparation_business_days')),
    recurrence_rule: { frequency: recurrence, weekdays: recurrence === 'weekly' ? weekdays : [] }, subtasks,
  };
}

async function withBusy(element, operation) {
  if (element) element.disabled = true;
  try { await operation(); } catch (error) { console.error(error); toast('No se pudo guardar', error.message, 'error'); }
  finally { if (element) element.disabled = false; }
}

document.addEventListener('click', (event) => {
  const person = event.target.closest('[data-person]')?.dataset.person;
  if (person) { state.person = person; localStorage.setItem('pdr-person', person); render(); return; }
  const view = event.target.closest('[data-view]')?.dataset.view;
  if (view) { state.view = view; state.cursor = chileToday(); state.selectedDate = chileToday(); refresh(); return; }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action) handleAction(action, event.target.closest('[data-action]'));
  const toggleId = event.target.closest('[data-toggle-task]')?.dataset.toggleTask;
  if (toggleId) { event.preventDefault(); event.stopPropagation(); const task = state.tasks.find((item) => item.id === toggleId); const wasCompleted = task.completed; withBusy(event.target, async () => { await toggleTask(task); toast(wasCompleted ? 'Tarea desmarcada' : 'Tarea completada'); await refresh({ quiet: true }); }); return; }
  const openId = event.target.closest('[data-open-task]')?.dataset.openTask;
  if (openId) { const task = state.tasks.find((item) => item.id === openId) || state.history.find((item) => item.id === openId); state.modal = { type: 'task', task }; render(); return; }
  const selectedDate = event.target.closest('[data-select-date]')?.dataset.selectDate;
  if (selectedDate) { state.selectedDate = selectedDate; render(); return; }
  const deleteId = event.target.closest('[data-delete-task]')?.dataset.deleteTask;
  if (deleteId) removeTask(deleteId, event.target);
  const duplicateId = event.target.closest('[data-duplicate-task]')?.dataset.duplicateTask;
  if (duplicateId) copyTask(duplicateId, event.target);
  const editBirthdayId = event.target.closest('[data-edit-birthday]')?.dataset.editBirthday;
  if (editBirthdayId) { state.modal = { type: 'birthday', birthday: state.birthdays.find((item) => item.id === editBirthdayId) }; render(); return; }
  const deleteBirthdayId = event.target.closest('[data-delete-birthday]')?.dataset.deleteBirthday;
  if (deleteBirthdayId) removeBirthday(deleteBirthdayId, event.target);
  const snooze = event.target.closest('[data-snooze]');
  if (snooze) withBusy(snooze, async () => { await snoozeTask(snooze.dataset.task, Number(snooze.dataset.snooze)); toast('Recordatorio programado', `Te avisaremos en ${snooze.dataset.snooze} minutos.`); });
  if (event.target.matches('[data-close-modal]') && (event.target.classList.contains('modal-backdrop') || !event.target.closest('.modal-body'))) { state.modal = null; render(); }
  if (event.target.closest('[data-remove-subtask]')) event.target.closest('.subtask-input').remove();
});

function handleAction(action, element) {
  if (action === 'notifications') { state.modal = { type: 'notifications' }; render(); }
  if (action === 'new-task') { state.modal = { type: 'task', task: { date: element.dataset.date || state.selectedDate } }; render(); }
  if (action === 'add-subtask') document.querySelector('#subtasks').insertAdjacentHTML('beforeend', subtaskInput());
  if (action === 'today') { state.cursor = chileToday(); state.selectedDate = chileToday(); refresh(); }
  if (action === 'previous' || action === 'next') {
    const amount = action === 'previous' ? -1 : 1;
    state.cursor = state.view === 'week' ? addDays(state.cursor, amount * 7) : addMonths(state.cursor, amount);
    state.selectedDate = state.cursor;
    refresh();
  }
  if (action === 'disable-notifications') withBusy(element, async () => { await disablePush(); state.pushEnabled = false; state.modal = null; toast('Avisos desactivados'); render(); });
}

document.addEventListener('submit', (event) => {
  event.preventDefault();
  if (event.target.id === 'quick-form') submitQuick(event.target);
  if (event.target.id === 'task-form') submitTask(event.target);
  if (event.target.id === 'birthday-form') submitBirthday(event.target);
  if (event.target.id === 'birthday-edit-form') submitBirthdayEdit(event.target);
  if (event.target.id === 'notification-form') submitNotifications(event.target);
});

function submitQuick(form) {
  const data = new FormData(form);
  withBusy(form.querySelector('button[type="submit"]'), async () => {
    await saveTask({ title: data.get('title').trim(), date: data.get('date'), deadline_time: data.get('deadline_time') || null, responsible: data.get('responsible'), reminder_minutes_before: Number(data.get('reminder_minutes_before')), priority: 'alta', category: 'deadline', recurrence_rule: { frequency: 'none' }, subtasks: [] });
    form.reset(); toast('Tarea creada', 'Ya está disponible para ambos dispositivos.'); await refresh({ quiet: true });
  });
}

function submitTask(form) {
  const task = state.modal.task;
  withBusy(form.querySelector('button[type="submit"]'), async () => { await saveTask(taskFromForm(form), task.id); state.modal = null; toast(task.id ? 'Tarea actualizada' : 'Tarea creada'); await refresh({ quiet: true }); });
}

function submitBirthday(form) {
  const data = new FormData(form); const [, month, day] = data.get('date').split('-').map(Number);
  withBusy(form.querySelector('button[type="submit"]'), async () => { await saveBirthday({ name: data.get('name').trim(), month, day, description: data.get('description').trim(), active: true }); toast('Cumpleaños guardado'); form.reset(); await refresh({ quiet: true }); });
}

function submitBirthdayEdit(form) {
  const data = new FormData(form); const [, month, day] = data.get('date').split('-').map(Number); const birthday = state.modal.birthday;
  withBusy(form.querySelector('button[type="submit"]'), async () => { await saveBirthday({ name: data.get('name').trim(), month, day, description: data.get('description').trim(), active: true }, birthday.id); state.modal = null; toast('Cumpleaños actualizado'); await refresh({ quiet: true }); });
}

function submitNotifications(form) {
  const data = new FormData(form);
  withBusy(form.querySelector('button[type="submit"]'), async () => { await enablePush(data.get('person'), data.get('device_name').trim()); state.pushEnabled = true; state.modal = null; toast('Avisos activados', 'Este dispositivo quedó registrado.'); render(); });
}

async function removeTask(id, button) {
  if (!confirm('¿Eliminar esta tarea? Esta acción no se puede deshacer.')) return;
  await withBusy(button, async () => { await deleteTask(id); state.modal = null; toast('Tarea eliminada'); await refresh({ quiet: true }); });
}

async function copyTask(id, button) {
  const task = state.tasks.find((item) => item.id === id) || state.modal.task;
  await withBusy(button, async () => { await duplicateTask(task); state.modal = null; toast('Tarea duplicada'); await refresh({ quiet: true }); });
}

async function removeBirthday(id, button) {
  if (!confirm('¿Eliminar este cumpleaños?')) return;
  await withBusy(button, async () => { await deleteBirthday(id); toast('Cumpleaños eliminado'); await refresh({ quiet: true }); });
}

document.addEventListener('change', (event) => {
  if (event.target.matches('[data-history-days]')) { state.historyDays = Number(event.target.value); refresh(); }
  if (event.target.matches('.subtask-check') && event.target.dataset.subtaskId) withBusy(event.target, async () => { await toggleSubtask(event.target.dataset.subtaskId, event.target.checked); });
});

document.addEventListener('dragstart', (event) => {
  const task = event.target.closest('[data-task-id]');
  if (task) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/task-id', task.dataset.taskId); }
});
document.addEventListener('dragover', (event) => { const target = event.target.closest('[data-drop-date]'); if (target) { event.preventDefault(); target.classList.add('dragover'); } });
document.addEventListener('dragleave', (event) => event.target.closest('[data-drop-date]')?.classList.remove('dragover'));
document.addEventListener('drop', (event) => {
  const target = event.target.closest('[data-drop-date]'); if (!target) return;
  event.preventDefault(); target.classList.remove('dragover');
  const id = event.dataTransfer.getData('text/task-id'); const task = state.tasks.find((item) => item.id === id);
  if (!task || task.date === target.dataset.dropDate) return;
  withBusy(null, async () => { await patchTask(id, { date: target.dataset.dropDate }); toast('Tarea movida', `Nueva fecha: ${formatLongDate(target.dataset.dropDate)}`); await refresh({ quiet: true }); });
});

async function initialize() {
  render();
  try {
    await registerServiceWorker();
    state.pushEnabled = Boolean(await currentSubscription());
  } catch (error) { console.warn('Service Worker no disponible:', error); }
  subscribeRealtime(() => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => refresh({ quiet: true }), 180);
  });
  const params = new URLSearchParams(location.search);
  if (params.get('action') === 'new') state.modal = { type: 'task', task: { date: chileToday() } };
  if (params.get('snooze') && params.get('task')) {
    await snoozeTask(params.get('task'), Number(params.get('snooze')));
    toast('Recordatorio pospuesto', `Te avisaremos en ${params.get('snooze')} minutos.`);
    history.replaceState({}, '', '/');
  }
  await refresh();
}

initialize();
