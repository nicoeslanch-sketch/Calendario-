import { confirmDelete } from './lib/confirm.js';
import './workspace.css';
import { login, logout, profiles, request, session, milestoneFile } from './lib/workspace-store.js';
import { documentMeta } from '../supabase/functions/hito-documents/validation.js';
import { analyzeMinute, cleanLine, elapsedSince, minutePayload, STATUS } from './lib/minutes.js';
import { mountCalendar } from './main.js';
import { folderToMilestone, taskCounts, reuseMilestone } from './lib/milestones.js';
import { canViewTasks, taskProfiles } from './lib/task-access.js';
import { PRIORITIES, normalizePriority, sortTasksByPriority } from './lib/priorities.js';
import { scheduledDate, shortDate } from './lib/scheduling.js';

const root = document.querySelector('#app');
const requestedView = new URLSearchParams(location.search).get('view');
const state = { profiles: [], data: { minutes: [], folders: [], milestones: [], tasks: [] }, view: 'calendar', profile: null, selected: null, modal: null, editor: null, search: '', status: 'all', busy: false, loading: true, error: '' };
let calendarHost = null;
let calendarProfile = null;
let disposeCalendar = () => {};
const uuid = () => crypto.randomUUID();
if (['calendar', 'minutes', 'tasks', 'milestones'].includes(requestedView)) state.view = requestedView;
const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const trashIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Zm4 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg>';
const trash = (kind, id, label) => `<button type="button" class="trash-button" data-delete-kind="${kind}" data-delete-id="${esc(id)}" aria-label="Eliminar ${esc(label)}" title="Eliminar ${esc(label)}">${trashIcon}</button>`;
const icons = { calendar: '▦', notes: '▤', tasks: '☑', history: '◷', folder: '▱', plus: '+', lock: '▣' };
const person = (id) => state.profiles.find((p) => p.id === id);
const date = (iso) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
const firstName = (id) => person(id)?.name.split(' ')[0] || 'Equipo';
const year = () => Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Santiago' }).format(new Date()));
const avatar = (p) => `<span class="avatar" style="--person:${esc(p?.color || '#2f8659')}">${esc((p?.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join(''))}</span>`;
const options = (selected) => state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
const priorityBadge = (value) => { const key = normalizePriority(value); return `<span class="priority-badge priority-${key}"><span aria-hidden="true"></span>Prioridad ${PRIORITIES[key].label.toLocaleLowerCase()}</span>`; };

function toast(message, error = false) {
  const el = document.createElement('div');
  el.className = `notice ${error ? 'error' : ''}`;
  el.textContent = message;
  document.querySelector('#toast-region').append(el);
  setTimeout(() => el.remove(), 5500);
}
function fail(error) { toast(error.message || 'No se pudo completar la acción.', true); }
function rememberDraft() {
  if (state.editor && state.modal === 'minute') sessionStorage.setItem(`pdr-draft-${state.profile}`, JSON.stringify(state.editor));
}
function invalidate() { state.editor.analysis = null; document.querySelector('.analysis')?.remove(); rememberDraft(); }
function useProfile(profile) {
  state.returnMinute = null;
  state.profile = profile;
  state.selected = profile;
  state.search = '';
  state.status = 'all';
}
async function refresh({ silent = false } = {}) {
  if (!session) return;
  const token = session.token;
  try {
    const data = await request('load');
    if (token !== session?.token) return;
    state.data = { ...data, tasks: data.tasks.filter((t) => canViewTasks(state.profile, t.assignee)) };
    if (!canViewTasks(state.profile, state.selected)) state.selected = state.profile;
    state.error = '';
  } catch (error) {
    if (token !== session?.token) return;
    if (/Sesión|sesión/.test(error.message)) {
      await logout().catch(() => {});
      state.profile = null;
      state.modal = null;
      state.editor = null;
      state.data = { minutes: [], folders: [], tasks: [], milestones: [] };
    }
    state.error = error.message;
  }
  state.loading = false;
  if (!silent || (!state.modal && state.view !== 'calendar') || state.error || !state.profile) render();
}
function header() {
  const p = person(state.profile);
  return `<header class="topbar"><a href="/" class="brand"><img src="/icons/parque-del-recuerdo.png" alt=""><span>PDR<span class="brand-detail">Espacio de trabajo</span></span></a>
  <div class="profiles" aria-label="Perfiles">${state.profiles.map((item) => `<button data-profile="${esc(item.id)}" class="profile ${state.profile === item.id ? 'active' : ''}" aria-pressed="${state.profile === item.id}">${avatar(item)}<span>${esc(item.name)}${item.locked ? '<small>Acceso con contraseña</small>' : '<small>Acceso directo</small>'}</span>${item.locked ? '<span class="lock" aria-hidden="true">⌑</span>' : ''}</button>`).join('')}</div>
  ${p ? '<button class="icon-button" data-action="logout" title="Cerrar perfil" aria-label="Cerrar perfil">↗</button>' : ''}</header>
  <nav class="navigation" aria-label="Secciones">${[['calendar','Calendario','calendar'],['minutes','Minutas automatizadas','notes'],['tasks','Distribución de tareas','tasks'],['milestones','Mis hitos históricos','history']].map(([id,label,icon]) => `<button data-view="${id}" aria-current="${state.view === id ? 'page' : 'false'}" class="${state.view === id ? 'active' : ''}"><span aria-hidden="true">${icons[icon]}</span>${label}</button>`).join('')}</nav>`;
}
function intro(eyebrow, title, description, action = '') {
  return `<section class="intro"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${action}</section>`;
}
function empty(title, text, icon = '▤') { return `<div class="empty"><span>${icon}</span><h2>${title}</h2><p>${text}</p></div>`; }
function minutesView() {
  const list = state.data.minutes.filter((m) => (m.title + JSON.stringify(m.notes)).toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  const published = state.data.minutes.filter((m) => m.state === 'published').length;
  return intro('DE LA CONVERSACIÓN A LA ACCIÓN', 'Minutas automatizadas', 'Captura las ideas, agrúpalas en carpetas y conviértelas en acuerdos con responsables.',
    `<div class="profile-context">${avatar(person(state.profile))}<span>Espacio de ${esc(firstName(state.profile))}<small>Minutas privadas de este perfil</small></span></div>`) +
    `<div class="section-line"><span>${state.data.minutes.length} minutas <i>·</i> ${published} distribuidas</span><label class="search"><span>⌕</span><input data-search value="${esc(state.search)}" placeholder="Buscar en mis minutas" aria-label="Buscar en mis minutas"></label></div>
    <section class="minute-grid"><button class="new-minute" data-action="new-minute"><span class="plus-circle">+</span><strong>Crear una minuta</strong><span>Un espacio para ordenar<br>lo que viene después.</span></button>
    ${list.map(minuteCard).join('')}</section>`;
}
function tasksView() {
  const filtered = sortTasksByPriority(state.data.tasks.filter((t) => t.assignee === state.selected && (state.status === 'all' || t.status === state.status) && (t.title + t.folder_name).toLocaleLowerCase().includes(state.search.toLocaleLowerCase())));
  const assigned = state.data.tasks.filter((t) => t.assignee === state.selected);
  const visibleProfiles = taskProfiles(state.profiles, state.profile);
  const stats = Object.keys(STATUS).map((s) => [s, assigned.filter((t) => t.status === s).length]);
  return intro('UN EQUIPO, EL MISMO PANORAMA', 'Distribución de tareas', 'Las tareas más importantes primero: prioridad alta, media y baja. Consulta sus estados y carpetas de origen.',
    ['nicolas','benjamin'].includes(state.profile) ? '<button class="button" data-action="add-profile">+ Agregar integrante</button>' : '') +
    `<div class="assignee-tabs" role="tablist" aria-label="Tareas por responsable">${visibleProfiles.map((p) => `<button role="tab" aria-selected="${state.selected === p.id}" data-assignee="${esc(p.id)}" class="${state.selected === p.id ? 'active' : ''}">${avatar(p)}<span>Tareas ${esc(firstName(p.id))}</span><b>${state.data.tasks.filter((t) => t.assignee === p.id && t.status !== 'terminada').length}</b></button>`).join('')}</div>
    <div class="task-stats">${stats.map(([s,n]) => `<button data-status-filter="${s}" class="stat ${s} ${state.status === s ? 'selected' : ''}"><span class="status-dot"></span><strong>${n}</strong><span>${STATUS[s]}</span></button>`).join('')}</div>
    <div class="section-line"><button class="text-button" data-status-filter="all">Ver todos los estados</button><label class="search"><span>⌕</span><input data-search value="${esc(state.search)}" placeholder="Buscar tareas" aria-label="Buscar tareas"></label></div>
    <div class="priority-legend" aria-label="Orden por prioridad"><span>Ordenadas por prioridad:</span>${Object.keys(PRIORITIES).map(priorityBadge).join('')}</div>
    <section class="task-list">${filtered.length ? filtered.map((t) => {
      const editable = t.assignee === state.profile || t.owner_id === state.profile;
      return `<article class="assignment ${t.status} priority-${normalizePriority(t.priority)}">${editable ? trash('assignment', t.id, t.title) : ''}<span class="task-mark">${t.status === 'terminada' ? '✓' : t.status === 'iniciada' ? '◴' : '○'}</span><div class="assignment-body"><div class="task-source"><span>▱ ${esc(t.folder_name)}</span><span>${esc(t.minute_title)}</span>${priorityBadge(t.priority)}</div><h2>${esc(t.title)}</h2><p>${t.started_at ? `<span data-elapsed="${t.started_at}">Inició ${elapsedSince(t.started_at)}</span><span class="exact-time"> · ${date(t.started_at)}</span>` : 'Todavía no iniciada'}${t.completed_at ? ` · Terminada el ${date(t.completed_at)}` : ''}</p><small>Creada por ${esc(person(t.owner_id)?.name)}</small></div>
      <div class="task-control">${t.scheduled_date ? `<button class="text-button" data-calendar-date="${esc(t.scheduled_date)}">▦ ${esc(shortDate(t.scheduled_date))}</button>` : '<small>Sin fecha</small>'}<label class="sr-only" for="task-${t.id}">Estado de ${esc(t.title)}</label><select id="task-${t.id}" data-task-status="${t.id}" ${editable ? '' : 'disabled'}>${Object.entries(STATUS).map(([v,l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${editable ? '' : '<small>Solo consulta</small>'}</div></article>`;
    }).join('') : empty('Todo por construir', 'Aquí aparecerán las tareas de este integrante al guardar y distribuir una minuta.', '☑')}</section>`;
}
function milestonesView() {
  const list = state.data.milestones.filter((h) => (h.title + h.guidelines + h.plan).toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  return intro('LO QUE APRENDEMOS, PERMANECE', 'Mis hitos históricos', 'Guarda las directrices, la planificación y los aprendizajes de cada evento. El próximo año empieza con esa experiencia.',
    '<button class="button primary" data-action="new-milestone">+ Crear un hito histórico</button>') +
    `<div class="section-line"><span>${state.data.milestones.length} hitos en tu historial privado</span><label class="search"><span>⌕</span><input data-search value="${esc(state.search)}" placeholder="Buscar en mis hitos" aria-label="Buscar en mis hitos"></label></div>
    <section class="milestone-grid">${list.length ? list.map(milestoneCard).join('') : empty('Tu experiencia merece un lugar', 'Crea tu primer hito y conserva lo necesario para repetirlo o mejorarlo en otros años.', '◷')}</section>`;
}
function loginView() {
  return intro('BIENVENIDOS AL ESPACIO PDR', 'Las ideas merecen continuidad.', 'Elige tu perfil arriba para organizar tu calendario, escribir minutas y acompañar el avance del equipo.') +
    `<section class="welcome-card"><div class="welcome-graphic"><span>▦</span><i>+</i><span>▤</span><i>→</i><span>☑</span></div><h2>Tu agenda y tus acuerdos,<br>en un solo espacio.</h2><p>Calendario para el día a día, minutas para distribuir tareas e hitos para recordar lo aprendido. Siempre con el mismo perfil.</p></section>`;
}
function render() {
  if (calendarProfile !== state.profile) {
    disposeCalendar(); calendarHost = null; calendarProfile = state.profile;
  }
  // Reattach the same instance so background refreshes cannot erase a task form
  // or reset the chosen week/month while navigating between workspace sections.
  calendarHost?.remove();
  root.innerHTML = header() + `<main>${state.error ? `<div class="error-banner" role="alert">${esc(state.error)} <button data-action="reload">Reintentar</button></div>` : ''}${state.loading ? '<div class="loading">Preparando tu espacio…</div>' : !state.profile ? loginView() : state.view === 'calendar' ? '<div id="calendar-slot"></div>' : state.view === 'minutes' ? minutesView() : state.view === 'tasks' ? tasksView() : milestonesView()}</main><footer class="app-footer"><span>PDR · Equipo Santa Clara</span><span>Ideas claras. Acuerdos que avanzan.</span></footer>${modalView()}`;
  const slot = root.querySelector('#calendar-slot');
  if (slot) {
    if (!calendarHost) {
      calendarHost = document.createElement('div');
      slot.append(calendarHost);
      disposeCalendar = mountCalendar(calendarHost, state.profile, state.profiles);
    } else { slot.append(calendarHost); calendarHost.dispatchEvent(new Event('pdr-calendar-refresh')); }
  }
}
function newMinute() {
  const draft = sessionStorage.getItem(`pdr-draft-${state.profile}`);
  state.editor = draft ? JSON.parse(draft) : { id: uuid(), title: '', notes: [], folders: [], analysis: null, state: 'draft', version: 0 };
  state.modal = 'minute';
  render();
  document.querySelector('[name="minute-title"]')?.focus();
}
function openMinute(id) {
  state.editor = structuredClone(state.data.minutes.find((m) => m.id === id));
  if (!Array.isArray(state.editor.analysis?.folders)) state.editor.analysis = null;
  state.modal = 'minute';
  render();
}
function modalView() {
  if (!state.modal) return '';
  let content = '';
  if (state.modal === 'pin') content = `<form id="pin-form" class="compact-form"><span class="eyebrow">ACCESO AL PERFIL</span><h2>${esc(person(state.pendingProfile)?.name)}</h2><p>Ingresa la contraseña para abrir tu espacio.</p><label>Contraseña<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required maxlength="100" autofocus></label><button class="button primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Entrando…' : 'Entrar al perfil'}</button><p class="form-error" role="alert">${esc(state.modalError)}</p></form>`;
  if (state.modal === 'profile') content = `<form id="profile-form" class="compact-form"><span class="eyebrow">EL EQUIPO CRECE</span><h2>Agregar integrante</h2><label>Nombre y apellido<input name="name" required minlength="2" maxlength="100" autofocus></label><p>El nuevo integrante tendrá un perfil con acceso directo, como Tomás.</p><button class="button primary" ${state.busy ? 'disabled' : ''}>Agregar perfil</button></form>`;
  if (state.modal === 'minute') content = minuteEditor();
  if (state.modal === 'milestone') content = milestoneEditor();
  return `<div class="overlay"><section class="dialog ${state.modal === 'minute' ? 'notebook' : state.modal === 'milestone' ? 'milestone-editor' : 'compact'}" role="dialog" aria-modal="true" aria-label="${state.modal === 'minute' ? 'Editor de minuta' : state.modal === 'milestone' ? 'Hito histórico' : 'Perfil'}"><button class="dialog-close" data-action="close-modal" aria-label="Cerrar">×</button>${content}</section></div>`;
}
function noteCard(note) {
  const priority = normalizePriority(note.priority);
  return `<article class="point-card priority-${priority}" draggable="true" data-note="${note.id}"><span class="grip" aria-hidden="true">⠿</span><textarea data-note-text="${note.id}" aria-label="Editar punto" rows="2" maxlength="2000">${esc(note.text)}</textarea><button type="button" class="trash-button remove-point" data-remove-point="${note.id}" aria-label="Eliminar punto">${trashIcon}</button><div class="point-controls"><label><input type="checkbox" data-actionable="${note.id}" ${note.actionable !== false ? 'checked' : ''}> Crear tarea</label><label class="sr-only" for="move-${note.id}">Mover punto a carpeta</label><select id="move-${note.id}" data-move-note="${note.id}"><option value="">Sin agrupar</option>${state.editor.folders.map((f) => `<option value="${f.id}" ${f.id === note.folder_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select><label class="note-priority" for="priority-${note.id}"><span class="priority-dot" aria-hidden="true"></span>Prioridad<select id="priority-${note.id}" data-note-priority="${note.id}" ${note.actionable === false ? 'disabled' : ''}>${Object.entries(PRIORITIES).map(([key, p]) => `<option value="${key}" ${key === priority ? 'selected' : ''}>${p.label} · ${p.color}</option>`).join('')}</select></label>${noteSchedule(note)}</div></article>`;
}
function noteSchedule(note) {
  const mode = note.schedule_mode || 'folder';
  const date = scheduledDate(note, state.editor.folders);
  return `<div class="note-schedule"><label>Calendario<select data-note-schedule="${note.id}" ${note.actionable === false ? 'disabled' : ''}><option value="folder" ${mode === 'folder' ? 'selected' : ''}>Usar fecha de carpeta</option><option value="custom" ${mode === 'custom' ? 'selected' : ''}>Fecha propia</option><option value="none" ${mode === 'none' ? 'selected' : ''}>Sin fecha</option></select></label>${mode === 'custom' ? `<label>Fecha opcional<input type="date" min="2000-01-01" max="2200-12-31" data-note-date="${note.id}" value="${esc(note.scheduled_date || '')}"></label>` : ''}<small>${date && note.actionable !== false ? `▦ ${esc(shortDate(date))} · Se agenda al distribuir` : 'Sin fecha: solo en distribución'}</small></div>`;
}
function minuteEditor() {
  const m = state.editor;
  const loose = m.notes.filter((n) => !m.folders.some((f) => f.id === n.folder_id));
  const used = new Set(m.folders.map((f) => f.id));
  return `<div class="notebook-top"><span class="eyebrow">CUADERNO DE REUNIONES</span><span class="private-label">⌑ Privada · ${esc(firstName(state.profile))}</span>${trash('minute', m.id, m.title || 'esta minuta')}</div>
    <input class="minute-title-input" name="minute-title" placeholder="Título de la minuta" maxlength="180" value="${esc(m.title)}" aria-label="Título de la minuta">
    <div class="notebook-toolbar"><span>Organiza tu punteo en carpetas y elige la prioridad de cada tarea.</span><div><select data-folder-library aria-label="Agregar carpeta existente"><option value="">Mis carpetas guardadas</option>${state.data.folders.filter((f) => !used.has(f.id)).map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select><button class="button small" data-action="toggle-folder-form">+ Agregar carpeta</button></div></div>
    ${folderLibrary()}
    <form id="folder-form" class="folder-form" hidden><label>Nombre de carpeta<input name="name" required maxlength="100" placeholder="Ej.: Evento de fin de año"></label><label>Responsable<select name="assignee">${options(state.profile)}</select></label><button class="button primary small">Crear carpeta</button></form>
    <div class="notebook-workspace"><section class="capture-column" data-drop-folder=""><h3>Puntos de la reunión <span>${loose.length}</span></h3><p class="hint">Enter crea una tarjeta. Shift + Enter permite seguir escribiendo. Arrástrala a una carpeta o usa su selector.</p><textarea id="point-input" placeholder="Escribe una idea, acuerdo o pendiente…" aria-label="Nuevo punto de la minuta" rows="5" maxlength="20000">${esc(m.pendingText || '')}</textarea><button class="button small add-point" data-action="add-point">+ Añadir punto</button><div class="loose-points">${loose.map(noteCard).join('')}</div></section>
    <section class="folders-board" aria-label="Carpetas de la minuta">${m.folders.length ? m.folders.map((f) => `<section class="folder-column" data-drop-folder="${f.id}"><header><span class="folder-icon">▱</span><h3>${esc(f.name)}</h3><b>${m.notes.filter((n) => n.folder_id === f.id).length}</b>${trash('folder-in-minute', f.id, f.name)}</header><label class="folder-owner">Responsable<select data-folder-owner="${f.id}">${options(f.assignee)}</select></label><label class="folder-date">Fecha de carpeta (opcional)<input type="date" data-folder-date="${f.id}" min="2000-01-01" max="2200-12-31" value="${esc(f.scheduled_date || '')}"><small>Se aplica a sus tareas salvo que elijas otra fecha o «Sin fecha».</small></label><button type="button" class="convert-folder text-button" data-convert-folder="${f.id}">◷ Convertir en hito histórico</button><div class="folder-points">${m.notes.filter((n) => n.folder_id === f.id).map(noteCard).join('') || '<div class="drop-hint">Arrastra tus puntos aquí<br>o elige esta carpeta en una tarjeta.</div>'}</div></section>`).join('') : '<div class="folder-placeholder"><span>▱</span><h3>Cada tema, en su carpeta.</h3><p>Agrega una carpeta, elige su responsable y reúne los puntos relacionados.</p></div>'}</section></div>
    ${m.analysis ? `<section class="analysis"><div class="analysis-heading"><div><span class="eyebrow">REVISIÓN ANTES DE DISTRIBUIR</span><h2>Resumen por carpeta</h2></div><span class="badge done">${m.analysis.task_count} tareas</span></div><p class="hint">Síntesis basada en tu punteo. Se conservan los acuerdos escritos; los puntos marcados como contexto no generan tareas.</p>${m.analysis.folders.map((f) => `<article><h3>▱ ${esc(f.name)} <small>→ ${esc(person(f.assignee)?.name)}</small></h3><label>Resumen editable<textarea data-summary="${f.id}" rows="3" maxlength="10000">${esc(f.summary)}</textarea></label><p>${f.tasks.length} tareas para distribuir${f.agreements.length ? ` · ${f.agreements.length} acuerdos identificados` : ''}</p></article>`).join('')}</section>` : ''}
    <footer class="notebook-actions"><span>${m.notes.length} puntos · ${m.folders.length} carpetas</span><div>${m.state !== 'published' ? '<button class="button" data-action="save-draft">Guardar borrador</button>' : ''}<button class="button" data-action="analyze">Analizar minuta</button><button class="button primary" data-action="publish" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Guardando…' : 'Guardar minuta y distribuir'} →</button></div></footer>`;
}
function milestoneEditor() {
  const h = state.editor;
  return `<form id="milestone-form"><div class="editor-record-actions">${trash('milestone', h.id || 'draft', h.title || 'este hito')}</div><span class="eyebrow">MEMORIA DEL EQUIPO · TU HISTORIAL PRIVADO</span><h2>${h.id ? 'Editar hito histórico' : 'Crear un hito histórico'}</h2><p>Tu referencia para repetirlo el próximo año: qué se hizo, qué queda y qué conviene recordar.</p>
    <div class="hito-identity"><label>Título del evento o hito<input name="title" required maxlength="180" value="${esc(h.title)}" placeholder="Ej.: Encuentro anual del equipo"></label><label>Año<input type="number" name="year" required min="2000" max="2200" value="${h.year}"></label></div>
    ${hitoTasksEditor(h)}
    ${hitoDocuments(h)}
    ${hitoOrigin(h)}
    <div class="form-grid hito-background"><label class="wide">Para qué se realiza<textarea name="purpose" rows="2" maxlength="10000">${esc(h.purpose)}</textarea></label><label class="wide">Directrices y criterios<textarea name="guidelines" rows="4" maxlength="20000" placeholder="Objetivo, público, requisitos y criterios que se deben respetar…">${esc(h.guidelines)}</textarea></label><label class="wide">Planificación y pasos a seguir<textarea name="plan" rows="5" maxlength="20000" placeholder="Actividades, recursos, contactos internos, pasos y tiempos de preparación…">${esc(h.plan)}</textarea></label><label class="wide">Aprendizajes para otros años<textarea name="learnings" rows="4" maxlength="20000" placeholder="Qué funcionó, qué cambiar y qué recordar la próxima vez…">${esc(h.learnings)}</textarea></label></div>
    <div class="form-actions"><button type="button" class="button" data-export-hito="">↓ Descargar PDF</button><button type="button" class="button" data-action="close-modal">Cerrar</button><button class="button primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Guardando…' : 'Guardar hito histórico'}</button></div></form>`;
}
function addPoints() {
  const input = document.querySelector('#point-input');
  const lines = input.value.split('\n').map(cleanLine).filter(Boolean);
  if (lines.some((line) => line.length > 2000)) throw new Error('Cada punto puede tener hasta 2000 caracteres.');
  if (state.editor.notes.length + lines.length > 300) throw new Error('Una minuta admite hasta 300 puntos.');
  if (!lines.length) return;
  state.editor.pendingText = '';
  state.editor.notes.push(...lines.map((text) => ({ id: uuid(), text, folder_id: '', actionable: true, priority: 'media' })));
  invalidate();
  render();
  document.querySelector('#point-input')?.focus();
}
function closeModal() {
  if (state.busy) return;
  if (state.modal === 'minute') {
    const pending = document.querySelector('#point-input')?.value?.trim();
    if (pending) addPoints();
    rememberDraft();
  }
  if (state.modal === 'milestone' && state.returnMinute) { state.editor = state.returnMinute; state.returnMinute = null; state.modal = 'minute'; render(); return; }
  state.modal = null; state.editor = null; state.modalError = '';
  render();
}
async function saveMinute(publish) {
  const pending = document.querySelector('#point-input')?.value?.trim();
  if (pending) addPoints();
  const m = state.editor;
  if (!m.title.trim()) throw new Error('Ponle un título a la minuta.');
  const payload = minutePayload(m, publish);
  state.busy = true; render();
  try {
    await request('save_minute', payload);
    sessionStorage.removeItem(`pdr-draft-${state.profile}`);
    state.modal = null; state.editor = null;
    if (publish) { state.view = 'tasks'; state.selected = state.profile; }
    await refresh();
    toast(publish ? 'Minuta guardada. Las tareas ya están distribuidas.' : 'Borrador guardado en tu perfil.');
  } finally { state.busy = false; render(); }
}

root.addEventListener('click', async (event) => {
  const target = event.target.closest('button');
  if (!target || state.busy) return;
  try {
    if (target.dataset.profile) {
      const p = person(target.dataset.profile);
      if (state.modal === 'minute') rememberDraft();
      if (p.locked) { state.pendingProfile = p.id; state.modal = 'pin'; state.modalError = ''; render(); document.querySelector('[name="pin"]')?.focus(); }
      else {
        state.busy = true;
        await login(p.id); useProfile(p.id); state.modal = null; state.editor = null; state.loading = true; render(); await refresh(); state.busy = false; render();
      }
      return;
    }
    if (target.dataset.view) { state.view = target.dataset.view; state.search = ''; if (session && state.view === 'tasks') await refresh(); else render(); return; }
    if (target.dataset.minute) { openMinute(target.dataset.minute); return; }
    if (target.dataset.calendarDate) {
      state.view='calendar'; render(); calendarHost.dispatchEvent(new CustomEvent('pdr-calendar-refresh',{detail:{date:target.dataset.calendarDate}})); return;
    }
    if (target.dataset.downloadDocument) {
      target.disabled=true; target.textContent='Preparando…';
      try { await downloadDocument(target.dataset.downloadDocument); }
      finally { target.disabled=false; target.textContent='Descargar'; }
      return;
    }
    if (target.dataset.removeDocument) {
      if (!await confirmDelete('¿Estás seguro de que quieres eliminar este archivo adjunto de esta edición? No se eliminarán las copias de otras ediciones.')) return;
      state.busy=true;
      try { await milestoneFile('remove',{file_id:target.dataset.removeDocument}); await refreshHitoDocuments(); toast('Archivo eliminado de esta edición.'); }
      finally { state.busy=false; render(); }
      return;
    }
    if (target.dataset.action==='copy-hito-documents') {
      state.busy=true;
      try { await persistHito({copyDocuments:true}); toast('Documentos de referencia copiados.'); }
      finally { state.busy=false; render(); }
      return;
    }
    if (target.dataset.assignee && canViewTasks(state.profile, target.dataset.assignee)) { state.selected = target.dataset.assignee; state.search = ''; state.status = 'all'; render(); return; }
    if (target.dataset.statusFilter) { state.status = target.dataset.statusFilter; render(); return; }
    if (target.dataset.milestone || target.dataset.reuse) {
      state.editor = structuredClone(state.data.milestones.find((h) => h.id === (target.dataset.milestone || target.dataset.reuse)));
      state.returnMinute = null;
      if (target.dataset.reuse) state.editor = reuseMilestone(state.editor, Math.min(2200, Math.max(year(), state.editor.year + 1)));
      state.modal = 'milestone'; render(); return;
    }
    if (target.dataset.deleteKind) { await deleteRecord(target.dataset.deleteKind, target.dataset.deleteId); return; }
    if (target.dataset.convertFolder) { await convertFolder(target.dataset.convertFolder, target.dataset.library === 'true'); return; }
    if (target.dataset.removePoint) { if (!await confirmDelete('¿Estás seguro de que quieres eliminar este punto? Se aplicará al guardar la minuta.')) return; state.editor.notes = state.editor.notes.filter((n) => n.id !== target.dataset.removePoint); invalidate(); render(); return; }
    if (target.dataset.removeHitoTask) { if (!await confirmDelete('¿Estás seguro de que quieres eliminar esta tarea del hito? Se aplicará al guardar.')) return; state.editor.tasks = state.editor.tasks.filter((t) => t.id !== target.dataset.removeHitoTask); render(); return; }
    const action = target.dataset.action;
    if (action === 'logout') { await logout(); state.returnMinute = null; state.profile = null; state.modal = null; state.editor = null; state.data = { minutes: [], folders: [], tasks: [], milestones: [] }; render(); }
    if (action === 'reload') await refresh();
    if (action === 'new-minute') newMinute();
    if (action === 'close-modal') closeModal();
    if (action === 'add-profile') { state.modal = 'profile'; render(); }
    if (action === 'new-milestone') { state.modal = 'milestone'; state.returnMinute = null; state.editor = { title: '', year: year(), purpose: '', guidelines: '', plan: '', learnings: '', tasks: [] }; render(); }
    if (target.hasAttribute('data-export-hito')) { await exportHito(target.dataset.exportHito); return; }
    if (action === 'toggle-folder-form') { const form = document.querySelector('#folder-form'); form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); }
    if (action === 'add-point') addPoints();
    if (action === 'analyze') { addPoints(); state.editor.analysis = analyzeMinute(state.editor); rememberDraft(); render(); document.querySelector('.analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (action === 'save-draft') await saveMinute(false);
    if (action === 'publish') await saveMinute(true);
  } catch (error) { state.busy = false; fail(error); }
});

root.addEventListener('submit', async (event) => {
  if (!(event.target instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (state.busy) return;
  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  try {
    state.busy = true;
    if (form.id === 'pin-form') {
      await login(state.pendingProfile, data.pin);
      useProfile(state.pendingProfile); state.modal = null; state.editor = null; state.loading = true; render(); await refresh();
    } else if (form.id === 'folder-form') {
      const folder = await request('add_folder', data);
      state.data.folders.push(folder);
      state.editor.folders.push({ id: folder.id, name: folder.name, assignee: folder.assignee });
      invalidate(); render();
    } else if (form.id === 'milestone-form') {

      state.editor={...state.editor,...data,year:Number(data.year)};
      await persistHito();
      if (state.returnMinute) { state.editor = state.returnMinute; state.returnMinute = null; state.modal = 'minute'; }
      else { state.modal = null; state.editor = null; }
      await refresh(); toast('Hito histórico guardado.');
    } else if (form.id === 'profile-form') {
      await request('add_profile', data); state.profiles = await profiles(); state.modal = null; toast('Integrante agregado.');
    }
  } catch (error) {
    if (form.id === 'pin-form') { state.modalError = error.message; } else fail(error);
  } finally { state.busy = false; render(); }
});
root.addEventListener('input', (event) => {
  const input = event.target;
  if (state.modal === 'milestone') {
    if (['title','purpose','guidelines','plan','learnings'].includes(input.name)) state.editor[input.name] = input.value;
    if (input.name === 'year') state.editor.year = Number(input.value);
    if (input.dataset.hitoTaskText) state.editor.tasks.find((t) => t.id === input.dataset.hitoTaskText).title = input.value;
    if (input.dataset.hitoTaskNotes) state.editor.tasks.find((t) => t.id === input.dataset.hitoTaskNotes).notes = input.value;
    if (input.hasAttribute('data-hito-new') && input.value.trim()) {
      state.editor.tasks ||= [];
      if (state.editor.tasks.length >= 300) { fail(new Error('El hito admite hasta 300 actividades.')); return; }
      const id = uuid(); const caret = input.selectionStart;
      state.editor.tasks.push({ id, title: input.value, completed: false, notes: '' });
      render();
      const fresh = document.querySelector(`[data-hito-task-text="${id}"]`);
      fresh?.focus(); fresh?.setSelectionRange(caret, caret);
    }
  }
  if (input.id === 'point-input') { state.editor.pendingText = input.value; rememberDraft(); }
  if (input.name === 'minute-title') { state.editor.title = input.value; rememberDraft(); }
  if (input.dataset.noteText) { state.editor.notes.find((n) => n.id === input.dataset.noteText).text = input.value; invalidate(); }
  if (input.dataset.summary) { state.editor.analysis.folders.find((f) => f.id === input.dataset.summary).summary = input.value; rememberDraft(); }
  if (input.hasAttribute('data-search')) {
    const start = input.selectionStart;
    state.search = input.value; render();
    const fresh = document.querySelector('[data-search]'); fresh?.focus(); fresh?.setSelectionRange(start, start);
  }
});
root.addEventListener('change', async (event) => {
  const input = event.target;
  try {
    if (input.hasAttribute('data-hito-files')) { await uploadDocuments([...input.files]); return; }
    if (input.dataset.hitoTaskState) { state.editor.tasks.find((t) => t.id === input.dataset.hitoTaskState).completed = input.value === 'done'; render(); }
    if (input.dataset.moveNote) { state.editor.notes.find((n) => n.id === input.dataset.moveNote).folder_id = input.value; invalidate(); render(); }
    if (input.dataset.folderOwner) { state.editor.folders.find((f) => f.id === input.dataset.folderOwner).assignee = input.value; invalidate(); }
    if (input.dataset.actionable) { state.editor.notes.find((n) => n.id === input.dataset.actionable).actionable = input.checked; invalidate(); render(); }
    if (input.dataset.notePriority) {
      state.editor.notes.find((n) => n.id === input.dataset.notePriority).priority = normalizePriority(input.value);
      invalidate(); render(); document.querySelector(`[data-note-priority="${input.dataset.notePriority}"]`)?.focus();
    }
    if (input.dataset.folderDate) { state.editor.folders.find((f) => f.id === input.dataset.folderDate).scheduled_date = input.value; invalidate(); render(); }
    if (input.dataset.noteDate) { state.editor.notes.find((n) => n.id === input.dataset.noteDate).scheduled_date = input.value; invalidate(); render(); }
    if (input.dataset.noteSchedule) { state.editor.notes.find((n) => n.id === input.dataset.noteSchedule).schedule_mode = input.value; invalidate(); render(); }
    if (input.hasAttribute('data-folder-library') && input.value) {
      const f = state.data.folders.find((f) => f.id === input.value);
      state.editor.folders.push({ id: f.id, name: f.name, assignee: f.assignee }); invalidate(); render();
    }
    if (input.dataset.taskStatus) {
      input.disabled = true;
      await request('task_status', { id: input.dataset.taskStatus, status: input.value }); await refresh();
      toast('Estado actualizado para todo el equipo.');
    }
  } catch (error) { fail(error); await refresh({ silent: true }); }
});
root.addEventListener('keydown', (event) => {
  if ((event.target.dataset.hitoTaskText || event.target.hasAttribute('data-hito-new')) && event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); document.querySelector('[data-hito-new]')?.focus();
  }
  if (event.target.id === 'point-input' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); try { addPoints(); } catch (error) { fail(error); } }
  if (event.key === 'Escape') closeModal();
  if (event.key === 'Tab' && state.modal) {
    const focusable = [...document.querySelectorAll('.dialog button:not([disabled]),.dialog input,.dialog textarea,.dialog select')].filter((el) => !el.closest('[hidden]'));
    if (event.shiftKey && event.target === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
    if (!event.shiftKey && event.target === focusable.at(-1)) { event.preventDefault(); focusable[0]?.focus(); }
  }
});
root.addEventListener('dragstart', (event) => {
  const card = event.target.closest('[data-note]');
  if (!card || event.target.matches('textarea,input,select')) { event.preventDefault(); return; }
  event.dataTransfer.setData('text/plain', card.dataset.note); event.dataTransfer.effectAllowed = 'move';
});
root.addEventListener('dragover', (event) => {
  const zone = event.target.closest('[data-drop-folder]');
  if (zone) { event.preventDefault(); zone.classList.add('drag-over'); }
});
root.addEventListener('dragleave', (event) => event.target.closest('[data-drop-folder]')?.classList.remove('drag-over'));
root.addEventListener('drop', (event) => {
  const zone = event.target.closest('[data-drop-folder]');
  if (!zone) return;
  event.preventDefault();
  const note = state.editor.notes.find((n) => n.id === event.dataTransfer.getData('text/plain'));
  if (note) { note.folder_id = zone.dataset.dropFolder; invalidate(); render(); }
});
window.addEventListener('beforeunload', (event) => { if (state.modal === 'minute') { rememberDraft(); event.preventDefault(); event.returnValue = ''; } });
setInterval(() => refresh({ silent: true }), 20000);
setInterval(() => document.querySelectorAll('[data-elapsed]').forEach((el) => { el.textContent = 'Inició ' + elapsedSince(el.dataset.elapsed); }), 60000);
async function start() {
  try {
    state.profiles = await profiles();
    if (session && new Date(session.expires_at) > new Date()) { useProfile(session.profile); await refresh(); }
    else { if (session) await logout().catch(() => {}); state.loading = false; render(); }
  } catch (error) { state.loading = false; state.error = error.message; render(); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
render();
start();

function minuteCard(m) {
  return `<article class="minute-card"><div class="card-top"><span class="document-icon">▤</span><span class="badge ${m.state === 'published' ? 'done' : ''}">${m.state === 'published' ? 'Distribuida' : 'Borrador'}</span>${trash('minute', m.id, m.title)}</div><button class="card-title" data-minute="${m.id}">${esc(m.title)}</button><p>${esc(m.analysis?.summary || 'Puntos de la reunión pendientes de organizar.')}</p><div class="folder-chips">${m.folders.slice(0,3).map((f) => `<span>▱ ${esc(f.name)}</span>`).join('')}</div><footer><span>${m.notes.length} puntos · ${m.folders.length} carpetas</span><button data-minute="${m.id}" aria-label="Abrir ${esc(m.title)}">↗</button></footer><small class="updated">Actualizada ${esc(date(m.updated_at))}</small></article>`;
}
function milestoneCard(h) {
  const counts = taskCounts(h.tasks);
  return `<article class="milestone-card"><div class="card-top"><span class="year">${h.year}</span><span class="document-icon">◷</span>${trash('milestone',h.id,h.title)}</div><button class="card-title" data-milestone="${h.id}">${esc(h.title)}</button><div class="milestone-task-summary"><strong>Planilla histórica de actividades</strong><span>${counts.done} realizadas · ${counts.pending} por realizar · ${(h.documents || []).length} archivos</span>${(h.tasks || []).slice(0,3).map((t) => `<p><span class="activity-state">${t.completed ? 'Realizada' : 'Por realizar'}</span> ${esc(t.title)}</p>`).join('')}</div><p>${esc(h.purpose || h.guidelines || 'Planificación y aprendizajes guardados.')}</p><div class="milestone-detail"><span>Directrices</span><p>${esc(h.guidelines || 'Sin directrices aún.')}</p></div><footer><button class="text-button" data-milestone="${h.id}">Ver historial ↗</button><button class="button small" data-reuse="${h.id}">Crear nueva edición</button><button class="button small" data-export-hito="${h.id}" aria-label="Descargar PDF de ${esc(h.title)}">↓ PDF</button></footer></article>`;
}
function folderLibrary() {
  return `<details class="folder-library"><summary>Mis carpetas guardadas (${state.data.folders.length})</summary><p>Eliminar aquí quita la carpeta de la biblioteca; las minutas guardadas conservan su historial.</p>${state.data.folders.map((f) => `<div class="library-folder"><span>▱ ${esc(f.name)}</span><button type="button" class="text-button" data-convert-folder="${f.id}" data-library="true">Convertir en hito histórico</button>${trash('folder',f.id,f.name)}</div>`).join('') || '<p>No hay carpetas guardadas.</p>'}</details>`;
}
function hitoTasksEditor(h) {
  const tasks = h.tasks || []; const counts = taskCounts(tasks);
  return `<section class="hito-tasks"><header><h3>Planilla histórica de actividades</h3><span>${counts.done} realizadas · ${counts.pending} por realizar</span></header><p class="hint">Deja aquí lo que hiciste y lo que falta. Escribe en la última fila para continuar la planilla. Enter pasa a una fila nueva; Shift + Enter permite varias líneas. Los cambios se conservan al guardar el hito.</p><div class="hito-sheet-wrap"><table class="hito-sheet"><thead><tr><th scope="col">Tarea / actividad</th><th scope="col">Estado</th><th scope="col">Observaciones para el próximo año</th><th scope="col"><span class="sr-only">Eliminar</span></th></tr></thead><tbody>${tasks.map((t) => `<tr class="${t.completed ? 'done' : ''}"><td><textarea data-hito-task-text="${t.id}" aria-label="Tarea o actividad" required maxlength="2000" rows="2">${esc(t.title)}</textarea></td><td><select data-hito-task-state="${t.id}" aria-label="Estado de ${esc(t.title)}"><option value="pending" ${!t.completed ? 'selected' : ''}>Por realizar</option><option value="done" ${t.completed ? 'selected' : ''}>Realizada</option></select></td><td><textarea data-hito-task-notes="${t.id}" aria-label="Observaciones de ${esc(t.title)}" maxlength="4000" rows="2" placeholder="Qué recordar, cómo se hizo, qué mejorar…">${esc(t.notes || '')}</textarea></td><td><button type="button" class="trash-button" data-remove-hito-task="${t.id}" aria-label="Eliminar tarea del hito: ${esc(t.title)}">${trashIcon}</button></td></tr>`).join('')}${tasks.length < 300 ? '<tr class="new-sheet-row"><td><textarea data-hito-new aria-label="Nueva fila de la planilla" placeholder="Escribe la siguiente actividad aquí…" maxlength="2000" rows="2"></textarea></td><td><span class="hint">Por realizar</span></td><td><span class="hint">La fila se incorpora al escribir.</span></td><td></td></tr>' : ''}</tbody></table></div></section>`;
}
function hitoDocuments(h) {
  const documents=h.documents || [];
  const pending=(h.source_snapshot?.documents || []).filter((f)=>!documents.some((d)=>d.source_file_id===f.id));
  return `<section class="hito-documents"><header><h3>Documentos de esta edición</h3><span>${documents.length} / 10 archivos</span></header><p class="hint">Adjunta PDF, Word, Excel, PowerPoint, TXT, CSV o imágenes, hasta 5 MB por archivo. Al adjuntar se guardan también los cambios del hito. Los archivos se descargan desde tu perfil, sin enlaces públicos.</p><label class="file-picker">Adjuntar archivos<input type="file" data-hito-files multiple accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.png,.jpg,.jpeg" ${state.busy?'disabled':''}></label>${documents.map((f)=>`<div class="hito-file"><span><strong>${esc(f.name)}</strong><small>${Math.max(1,Math.ceil(f.size/1024))} KB</small></span><button type="button" class="button small" data-download-document="${f.id}">Descargar</button><button type="button" class="trash-button" data-remove-document="${f.id}" aria-label="Eliminar archivo ${esc(f.name)}">${trashIcon}</button></div>`).join('')||'<p class="hint">Todavía no hay archivos adjuntos.</p>'}${pending.length?`<p class="hint">${pending.length} documentos de referencia disponibles. En una edición nueva se copian al guardar. Cada edición conserva su propia copia.</p><button type="button" class="button small" data-action="copy-hito-documents" ${state.busy?'disabled':''}>Copiar documentos de referencia</button>`:''}</section>`;
}
function hitoOrigin(h) {
  const origin=h.source_snapshot;
  if (!origin?.title) return '';
  const counts=taskCounts(origin.tasks);
  return `<details class="hito-origin"><summary>Referencia de la edición ${origin.year}: ${esc(origin.title)}</summary><p class="hint">Registro anterior conservado como referencia. Sus resultados no se mezclan con el avance de esta edición.</p><p>${counts.done} realizadas · ${counts.pending} por realizar</p><h4>Actividades anteriores</h4>${(origin.tasks||[]).map((t)=>`<div class="origin-task"><strong>${t.completed?'Realizada':'Por realizar'} · ${esc(t.title)}</strong><p>${esc(t.notes||'')}</p></div>`).join('')}${[['Objetivo',origin.purpose],['Directrices',origin.guidelines],['Planificación',origin.plan],['Aprendizajes',origin.learnings]].map(([title,text])=>`<h4>${title}</h4><p class="origin-text">${esc(text||'Sin información registrada.')}</p>`).join('')}<h4>Documentos de referencia</h4>${(origin.documents||[]).map((f)=>`<p>${esc(f.name)}</p>`).join('')||'<p>Sin archivos de referencia.</p>'}</details>`;
}
async function refreshHitoDocuments() {
  await refresh({silent:true});
  if (state.modal==='milestone' && state.editor?.id) {
    state.editor.documents=state.data.milestones.find((h)=>h.id===state.editor.id)?.documents || [];
  }
}
async function persistHito({copyDocuments=false}={}) {
  const h=state.editor;
  const isNew=!h.id;
  const payload=Object.fromEntries(Object.entries(h).filter(([key])=>!['documents','source_snapshot'].includes(key)));
  const saved=await request('save_milestone',payload);
  state.editor={...h,...saved};
  await refreshHitoDocuments();
  const source=(isNew || copyDocuments) ? (state.editor.source_snapshot?.documents || []) : [];
  for (const file of source) {
    if (!state.editor.documents.some((d)=>d.source_file_id===file.id)) {
      try { await milestoneFile('copy',{file_id:file.id,milestone_id:saved.id}); }
      catch(error) { await refreshHitoDocuments(); throw new Error(`El hito quedó guardado, pero no se copió «${file.name}»: ${error.message}`); }
      await refreshHitoDocuments();
    }
  }
  return saved;
}
async function uploadDocuments(files) {
  if (state.busy || !files.length) return;
  if (!document.querySelector('#milestone-form').reportValidity()) return;
  files.forEach((f)=>documentMeta(f.name,f.size));
  if ((state.editor.documents||[]).length+files.length>10) throw new Error('El hito admite hasta 10 archivos.');
  state.busy=true; render();
  try {
    await persistHito();
    for (const file of files) await milestoneFile('upload',{milestone_id:state.editor.id},file);
    toast('Archivos adjuntos y cambios del hito guardados.');
  } finally { await refreshHitoDocuments(); state.busy=false; render(); }
}
async function downloadDocument(id) {
  const file=(state.editor?.documents||[]).find((f)=>f.id===id);
  if (!file) throw new Error('Archivo no encontrado.');
  const blob=await milestoneFile('download',{file_id:id});
  if (blob.size!==file.size) throw new Error('El archivo recibido está incompleto. Intenta nuevamente.');
  const href=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=href; a.download=file.name; a.className='button small'; a.textContent=`Guardar ${file.name}`;
  document.querySelector('.hito-documents').append(a);
  a.click();
  toast('Archivo preparado. Si el navegador no inicia la descarga, pulsa el enlace «Guardar».');
  setTimeout(()=>{URL.revokeObjectURL(href);a.remove();},300000);
}
async function exportHito(id) {
  const hito = id ? state.data.milestones.find((h) => h.id === id) : state.editor;
  if (!hito) throw new Error('Abre un hito para descargar su planilla.');
  state.busy = true;
  try {
    const { downloadMilestonePdf } = await import('./lib/milestone-pdf.js');
    await downloadMilestonePdf(hito, person(state.profile)?.name || '');
    toast('PDF del hito descargado.');
  } finally { state.busy = false; }
}
async function convertFolder(id, library) {
  const folder = (library ? state.data.folders : state.editor.folders).find((f) => f.id === id);
  if (!folder) throw new Error('Carpeta no encontrada.');
  const source = state.editor;
  const minutes = library ? [...state.data.minutes.filter((m) => m.id !== source?.id), ...(state.modal === 'minute' ? [source] : [])] : [source];
  const hito = folderToMilestone(folder, minutes, state.data.tasks, year());
  if (hito.tasks.length > 300) throw new Error('Esta carpeta reúne más de 300 tareas. Convierte una minuta a la vez.');
  if (state.modal === 'minute') { rememberDraft(); state.returnMinute = structuredClone(source); }
  state.editor = hito; state.modal = 'milestone'; render();
  toast('Revisa el hito y pulsa Guardar. La carpeta y su minuta se conservan.');
}
async function deleteRecord(kind, id) {
  if (kind === 'folder-in-minute') {
    if (!await confirmDelete('¿Estás seguro de que quieres eliminar esta carpeta de la minuta? Sus puntos quedarán sin agrupar. Se aplicará al guardar.')) return;
    state.editor.folders = state.editor.folders.filter((f) => f.id !== id);
    state.editor.notes.forEach((n) => { if (n.folder_id === id) n.folder_id = ''; });
    invalidate(); render(); return;
  }
  const collections = { minute: 'minutes', milestone: 'milestones', folder: 'folders', assignment: 'tasks' };
  const record = state.data[collections[kind]]?.find((r) => r.id === id);
  const isDraft = !record && ((kind === 'minute' && state.modal === 'minute' && state.editor.id === id) || (kind === 'milestone' && state.modal === 'milestone'));
  if (!record && !isDraft) throw new Error('El registro ya no está disponible. Recarga e inténtalo otra vez.');
  const extra = kind === 'minute' ? ' También se eliminarán las tareas distribuidas desde esta minuta.' : kind === 'folder' ? ' Se quitará de tus carpetas guardadas; las minutas conservarán sus puntos.' : kind === 'assignment' ? ' No se volverá a crear al guardar la minuta. Su punto original se conserva como referencia.' : '';
  if (!await confirmDelete('¿Estás seguro de que quieres eliminar ' + (kind === 'minute' ? 'esta minuta' : kind === 'milestone' ? 'este hito histórico' : kind === 'folder' ? 'esta carpeta' : 'esta tarea') + '?' + extra)) return;
  state.busy = true;
  try {
    if (!isDraft) {
      await request({ minute: 'delete_minute', milestone: 'delete_milestone', folder: 'delete_folder', assignment: 'delete_assignment' }[kind], { id, version: record.version });
      const file_ids=(record.documents || []).map((f)=>f.id);
      if (kind==='milestone' && file_ids.length) await milestoneFile('cleanup',{file_ids}).catch(()=>toast('Hito eliminado. Quedó pendiente retirar sus adjuntos del almacenamiento.'));
    }
    if (kind === 'minute') {
      const draft = sessionStorage.getItem(`pdr-draft-${state.profile}`);
      if (draft && JSON.parse(draft).id === id) sessionStorage.removeItem(`pdr-draft-${state.profile}`);
    }
    if (kind === 'minute' && state.modal === 'minute' && state.editor.id === id) { state.modal = null; state.editor = null; }
    if (kind === 'milestone' && state.modal === 'milestone' && (state.editor.id === id || isDraft)) {
      if (state.returnMinute) { state.editor = state.returnMinute; state.returnMinute = null; state.modal = 'minute'; }
      else { state.modal = null; state.editor = null; }
    }
    await refresh(); toast('Registro eliminado.');
  } finally { state.busy = false; render(); }
}
