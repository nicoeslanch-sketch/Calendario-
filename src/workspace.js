import './workspace.css';
import { login, logout, profiles, request, session } from './lib/workspace-store.js';
import { analyzeMinute, cleanLine, elapsedSince, STATUS } from './lib/minutes.js';

const root = document.querySelector('#app');
const requestedView = new URLSearchParams(location.search).get('view');
const state = { profiles: [], data: { minutes: [], folders: [], milestones: [], tasks: [] }, view: 'minutes', profile: null, selected: null, modal: null, editor: null, search: '', status: 'all', busy: false, loading: true, error: '' };
const uuid = () => crypto.randomUUID();
if (['minutes', 'tasks', 'milestones'].includes(requestedView)) state.view = requestedView;
const esc = (v = '') => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = { notes: '▤', tasks: '☑', history: '◷', folder: '▱', plus: '+', lock: '▣' };
const person = (id) => state.profiles.find((p) => p.id === id);
const date = (iso) => new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago' }).format(new Date(iso));
const firstName = (id) => person(id)?.name.split(' ')[0] || 'Equipo';
const year = () => Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'America/Santiago' }).format(new Date()));
const avatar = (p) => `<span class="avatar" style="--person:${esc(p?.color || '#2f8659')}">${esc((p?.name || '?').split(' ').map((n) => n[0]).slice(0, 2).join(''))}</span>`;
const options = (selected) => state.profiles.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');

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
    state.data = data;
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
  if (!state.modal || !silent) render();
}
function header() {
  const p = person(state.profile);
  return `<header class="topbar"><a href="/" class="brand"><img src="/icons/parque-del-recuerdo.png" alt=""><span>PDR<span class="brand-detail">Espacio de trabajo</span></span></a>
  <div class="profiles" aria-label="Perfiles">${state.profiles.map((item) => `<button data-profile="${esc(item.id)}" class="profile ${state.profile === item.id ? 'active' : ''}" aria-pressed="${state.profile === item.id}">${avatar(item)}<span>${esc(item.name)}${item.locked ? '<small>Acceso con contraseña</small>' : '<small>Acceso directo</small>'}</span>${item.locked ? '<span class="lock" aria-hidden="true">⌑</span>' : ''}</button>`).join('')}</div>
  ${p ? '<button class="icon-button" data-action="logout" title="Cerrar perfil" aria-label="Cerrar perfil">↗</button>' : ''}</header>
  <nav class="navigation" aria-label="Secciones">${[['minutes','Minutas automatizadas','notes'],['tasks','Distribución de tareas','tasks'],['milestones','Mis hitos históricos','history']].map(([id,label,icon]) => `<button data-view="${id}" aria-current="${state.view === id ? 'page' : 'false'}" class="${state.view === id ? 'active' : ''}"><span aria-hidden="true">${icons[icon]}</span>${label}</button>`).join('')}</nav>`;
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
    ${list.map((m) => `<article class="minute-card"><div class="card-top"><span class="document-icon">▤</span><span class="badge ${m.state === 'published' ? 'done' : ''}">${m.state === 'published' ? 'Distribuida' : 'Borrador'}</span></div><button class="card-title" data-minute="${m.id}">${esc(m.title)}</button><p>${esc(m.analysis?.summary || 'Puntos de la reunión pendientes de organizar.')}</p><div class="folder-chips">${m.folders.slice(0,3).map((f) => `<span>▱ ${esc(f.name)}</span>`).join('')}</div><footer><span>${m.notes.length} puntos · ${m.folders.length} carpetas</span><button data-minute="${m.id}" aria-label="Abrir ${esc(m.title)}">↗</button></footer><small class="updated">Actualizada ${esc(date(m.updated_at))}</small></article>`).join('')}</section>`;
}
function tasksView() {
  const filtered = state.data.tasks.filter((t) => t.assignee === state.selected && (state.status === 'all' || t.status === state.status) && (t.title + t.folder_name).toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  const assigned = state.data.tasks.filter((t) => t.assignee === state.selected);
  const stats = Object.keys(STATUS).map((s) => [s, assigned.filter((t) => t.status === s).length]);
  return intro('UN EQUIPO, EL MISMO PANORAMA', 'Distribución de tareas', 'Consulta el avance del equipo. Las tareas nacen de las minutas guardadas y conservan su carpeta de origen.',
    ['nicolas','benjamin'].includes(state.profile) ? '<button class="button" data-action="add-profile">+ Agregar integrante</button>' : '') +
    `<div class="assignee-tabs" role="tablist" aria-label="Tareas por responsable">${state.profiles.map((p) => `<button role="tab" aria-selected="${state.selected === p.id}" data-assignee="${esc(p.id)}" class="${state.selected === p.id ? 'active' : ''}">${avatar(p)}<span>Tareas ${esc(firstName(p.id))}</span><b>${state.data.tasks.filter((t) => t.assignee === p.id && t.status !== 'terminada').length}</b></button>`).join('')}</div>
    <div class="task-stats">${stats.map(([s,n]) => `<button data-status-filter="${s}" class="stat ${s} ${state.status === s ? 'selected' : ''}"><span class="status-dot"></span><strong>${n}</strong><span>${STATUS[s]}</span></button>`).join('')}</div>
    <div class="section-line"><button class="text-button" data-status-filter="all">Ver todos los estados</button><label class="search"><span>⌕</span><input data-search value="${esc(state.search)}" placeholder="Buscar tareas" aria-label="Buscar tareas"></label></div>
    <section class="task-list">${filtered.length ? filtered.map((t) => {
      const editable = t.assignee === state.profile || t.owner_id === state.profile;
      return `<article class="assignment ${t.status}"><span class="task-mark">${t.status === 'terminada' ? '✓' : t.status === 'iniciada' ? '◴' : '○'}</span><div class="assignment-body"><div class="task-source"><span>▱ ${esc(t.folder_name)}</span><span>${esc(t.minute_title)}</span></div><h2>${esc(t.title)}</h2><p>${t.started_at ? `<span data-elapsed="${t.started_at}">Inició ${elapsedSince(t.started_at)}</span><span class="exact-time"> · ${date(t.started_at)}</span>` : 'Todavía no iniciada'}${t.completed_at ? ` · Terminada el ${date(t.completed_at)}` : ''}</p><small>Creada por ${esc(person(t.owner_id)?.name)}</small></div>
      <div class="task-control"><label class="sr-only" for="task-${t.id}">Estado de ${esc(t.title)}</label><select id="task-${t.id}" data-task-status="${t.id}" ${editable ? '' : 'disabled'}>${Object.entries(STATUS).map(([v,l]) => `<option value="${v}" ${t.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${editable ? '' : '<small>Solo consulta</small>'}</div></article>`;
    }).join('') : empty('Todo por construir', 'Aquí aparecerán las tareas de este integrante al guardar y distribuir una minuta.', '☑')}</section>`;
}
function milestonesView() {
  const list = state.data.milestones.filter((h) => (h.title + h.guidelines + h.plan).toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  return intro('LO QUE APRENDEMOS, PERMANECE', 'Mis hitos históricos', 'Guarda las directrices, la planificación y los aprendizajes de cada evento. El próximo año empieza con esa experiencia.',
    '<button class="button primary" data-action="new-milestone">+ Crear un hito histórico</button>') +
    `<div class="section-line"><span>${state.data.milestones.length} hitos en tu historial privado</span><label class="search"><span>⌕</span><input data-search value="${esc(state.search)}" placeholder="Buscar en mis hitos" aria-label="Buscar en mis hitos"></label></div>
    <section class="milestone-grid">${list.length ? list.map((h) => `<article class="milestone-card"><div class="card-top"><span class="year">${h.year}</span><span class="document-icon">◷</span></div><button class="card-title" data-milestone="${h.id}">${esc(h.title)}</button><p>${esc(h.purpose || h.guidelines || 'Planificación y aprendizajes guardados.')}</p><div class="milestone-detail"><span>Directrices</span><p>${esc(h.guidelines || 'Sin directrices aún.')}</p></div><footer><button class="text-button" data-milestone="${h.id}">Ver historial ↗</button><button class="button small" data-reuse="${h.id}">Usar como base</button></footer></article>`).join('') : empty('Tu experiencia merece un lugar', 'Crea tu primer hito y conserva lo necesario para repetirlo o mejorarlo en otros años.', '◷')}</section>`;
}
function loginView() {
  return intro('BIENVENIDOS AL ESPACIO PDR', 'Las ideas merecen continuidad.', 'Elige tu perfil arriba para escribir minutas, distribuir tareas y construir el historial de tus proyectos.') +
    `<section class="welcome-card"><div class="welcome-graphic"><span>▤</span><i>→</i><span>▱</span><i>→</i><span>☑</span></div><h2>De los puntos de una reunión<br>a un equipo en movimiento.</h2><p>Tu perfil reúne tus minutas y tus hitos. El tablero de tareas permite acompañar el avance de cada integrante.</p></section>`;
}
function render() {
  root.innerHTML = header() + `<main>${state.error ? `<div class="error-banner" role="alert">${esc(state.error)} <button data-action="reload">Reintentar</button></div>` : ''}${state.loading ? '<div class="loading">Preparando tu espacio…</div>' : !state.profile ? loginView() : state.view === 'minutes' ? minutesView() : state.view === 'tasks' ? tasksView() : milestonesView()}</main><footer class="app-footer"><span>PDR · Equipo Santa Clara</span><span>Ideas claras. Acuerdos que avanzan.</span></footer>${modalView()}`;
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
  return `<article class="point-card" draggable="true" data-note="${note.id}"><span class="grip" aria-hidden="true">⠿</span><textarea data-note-text="${note.id}" aria-label="Editar punto" rows="2" maxlength="2000">${esc(note.text)}</textarea><button class="remove-point" data-remove-point="${note.id}" aria-label="Quitar punto">×</button><div class="point-controls"><label><input type="checkbox" data-actionable="${note.id}" ${note.actionable !== false ? 'checked' : ''}> Crear tarea</label><label class="sr-only" for="move-${note.id}">Mover punto a carpeta</label><select id="move-${note.id}" data-move-note="${note.id}"><option value="">Sin agrupar</option>${state.editor.folders.map((f) => `<option value="${f.id}" ${f.id === note.folder_id ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></div></article>`;
}
function minuteEditor() {
  const m = state.editor;
  const loose = m.notes.filter((n) => !m.folders.some((f) => f.id === n.folder_id));
  const used = new Set(m.folders.map((f) => f.id));
  return `<div class="notebook-top"><span class="eyebrow">CUADERNO DE REUNIONES</span><span class="private-label">⌑ Privada · ${esc(firstName(state.profile))}</span></div>
    <input class="minute-title-input" name="minute-title" placeholder="Título de la minuta" maxlength="180" value="${esc(m.title)}" aria-label="Título de la minuta">
    <div class="notebook-toolbar"><span>Organiza tu punteo en carpetas</span><div><select data-folder-library aria-label="Agregar carpeta existente"><option value="">Mis carpetas guardadas</option>${state.data.folders.filter((f) => !used.has(f.id)).map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select><button class="button small" data-action="toggle-folder-form">+ Agregar carpeta</button></div></div>
    <form id="folder-form" class="folder-form" hidden><label>Nombre de carpeta<input name="name" required maxlength="100" placeholder="Ej.: Evento de fin de año"></label><label>Responsable<select name="assignee">${options(state.profile)}</select></label><button class="button primary small">Crear carpeta</button></form>
    <div class="notebook-workspace"><section class="capture-column" data-drop-folder=""><h3>Puntos de la reunión <span>${loose.length}</span></h3><p class="hint">Enter crea una tarjeta. Shift + Enter permite seguir escribiendo. Arrástrala a una carpeta o usa su selector.</p><textarea id="point-input" placeholder="Escribe una idea, acuerdo o pendiente…" aria-label="Nuevo punto de la minuta" rows="5" maxlength="20000">${esc(m.pendingText || '')}</textarea><button class="button small add-point" data-action="add-point">+ Añadir punto</button><div class="loose-points">${loose.map(noteCard).join('')}</div></section>
    <section class="folders-board" aria-label="Carpetas de la minuta">${m.folders.length ? m.folders.map((f) => `<section class="folder-column" data-drop-folder="${f.id}"><header><span class="folder-icon">▱</span><h3>${esc(f.name)}</h3><b>${m.notes.filter((n) => n.folder_id === f.id).length}</b></header><label class="folder-owner">Responsable<select data-folder-owner="${f.id}">${options(f.assignee)}</select></label><div class="folder-points">${m.notes.filter((n) => n.folder_id === f.id).map(noteCard).join('') || '<div class="drop-hint">Arrastra tus puntos aquí<br>o elige esta carpeta en una tarjeta.</div>'}</div></section>`).join('') : '<div class="folder-placeholder"><span>▱</span><h3>Cada tema, en su carpeta.</h3><p>Agrega una carpeta, elige su responsable y reúne los puntos relacionados.</p></div>'}</section></div>
    ${m.analysis ? `<section class="analysis"><div class="analysis-heading"><div><span class="eyebrow">REVISIÓN ANTES DE DISTRIBUIR</span><h2>Resumen por carpeta</h2></div><span class="badge done">${m.analysis.task_count} tareas</span></div><p class="hint">Síntesis basada en tu punteo. Se conservan los acuerdos escritos; los puntos marcados como contexto no generan tareas.</p>${m.analysis.folders.map((f) => `<article><h3>▱ ${esc(f.name)} <small>→ ${esc(person(f.assignee)?.name)}</small></h3><label>Resumen editable<textarea data-summary="${f.id}" rows="3" maxlength="10000">${esc(f.summary)}</textarea></label><p>${f.tasks.length} tareas para distribuir${f.agreements.length ? ` · ${f.agreements.length} acuerdos identificados` : ''}</p></article>`).join('')}</section>` : ''}
    <footer class="notebook-actions"><span>${m.notes.length} puntos · ${m.folders.length} carpetas</span><div>${m.state !== 'published' ? '<button class="button" data-action="save-draft">Guardar borrador</button>' : ''}<button class="button" data-action="analyze">Analizar minuta</button><button class="button primary" data-action="publish" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Guardando…' : 'Guardar minuta y distribuir'} →</button></div></footer>`;
}
function milestoneEditor() {
  const h = state.editor;
  return `<form id="milestone-form"><span class="eyebrow">MEMORIA DEL EQUIPO · TU HISTORIAL PRIVADO</span><h2>${h.id ? 'Editar hito histórico' : 'Crear un hito histórico'}</h2><p>Deja una guía que te sirva cuando vuelvas a organizarlo.</p>
    <div class="form-grid"><label class="wide">Título del evento o hito<input name="title" required maxlength="180" value="${esc(h.title)}" placeholder="Ej.: Encuentro anual del equipo"></label><label>Año<input type="number" name="year" required min="2000" max="2200" value="${h.year}"></label><label class="wide">Para qué se realiza<textarea name="purpose" rows="2" maxlength="10000">${esc(h.purpose)}</textarea></label><label class="wide">Directrices y criterios<textarea name="guidelines" rows="4" maxlength="20000" placeholder="Objetivo, público, requisitos y criterios que se deben respetar…">${esc(h.guidelines)}</textarea></label><label class="wide">Planificación y pasos a seguir<textarea name="plan" rows="5" maxlength="20000" placeholder="Actividades, recursos, contactos internos, pasos y tiempos de preparación…">${esc(h.plan)}</textarea></label><label class="wide">Aprendizajes para otros años<textarea name="learnings" rows="4" maxlength="20000" placeholder="Qué funcionó, qué cambiar y qué recordar la próxima vez…">${esc(h.learnings)}</textarea></label></div>
    <div class="form-actions"><button type="button" class="button" data-action="close-modal">Cerrar</button><button class="button primary" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Guardando…' : 'Guardar hito histórico'}</button></div></form>`;
}
function addPoints() {
  const input = document.querySelector('#point-input');
  const lines = input.value.split('\n').map(cleanLine).filter(Boolean);
  if (lines.some((line) => line.length > 2000)) throw new Error('Cada punto puede tener hasta 2000 caracteres.');
  if (state.editor.notes.length + lines.length > 300) throw new Error('Una minuta admite hasta 300 puntos.');
  if (!lines.length) return;
  state.editor.pendingText = '';
  state.editor.notes.push(...lines.map((text) => ({ id: uuid(), text, folder_id: '', actionable: true })));
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
  state.modal = null; state.editor = null; state.modalError = '';
  render();
}
async function saveMinute(publish) {
  const pending = document.querySelector('#point-input')?.value?.trim();
  if (pending) addPoints();
  const m = state.editor;
  if (!m.title.trim()) throw new Error('Ponle un título a la minuta.');
  if (publish && !m.analysis) {
    m.analysis = analyzeMinute(m); render();
    toast('Revisa el resumen y los responsables; después pulsa Guardar minuta y distribuir.');
    return;
  }
  state.busy = true; render();
  try {
    await request('save_minute', { ...m, analysis: m.analysis || {}, state: publish ? 'published' : 'draft' });
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
    if (target.dataset.view) { state.view = target.dataset.view; state.search = ''; render(); return; }
    if (target.dataset.minute) { openMinute(target.dataset.minute); return; }
    if (target.dataset.assignee) { state.selected = target.dataset.assignee; state.search = ''; state.status = 'all'; render(); return; }
    if (target.dataset.statusFilter) { state.status = target.dataset.statusFilter; render(); return; }
    if (target.dataset.milestone || target.dataset.reuse) {
      state.editor = structuredClone(state.data.milestones.find((h) => h.id === (target.dataset.milestone || target.dataset.reuse)));
      if (target.dataset.reuse) { delete state.editor.id; state.editor.version = 0; state.editor.year = year(); state.editor.title += ' · nueva edición'; }
      state.modal = 'milestone'; render(); return;
    }
    if (target.dataset.removePoint) { state.editor.notes = state.editor.notes.filter((n) => n.id !== target.dataset.removePoint); invalidate(); render(); return; }
    const action = target.dataset.action;
    if (action === 'logout') { await logout(); state.profile = null; state.modal = null; state.editor = null; state.data = { minutes: [], folders: [], tasks: [], milestones: [] }; render(); }
    if (action === 'reload') await refresh();
    if (action === 'new-minute') newMinute();
    if (action === 'close-modal') closeModal();
    if (action === 'add-profile') { state.modal = 'profile'; render(); }
    if (action === 'new-milestone') { state.modal = 'milestone'; state.editor = { title: '', year: year(), purpose: '', guidelines: '', plan: '', learnings: '' }; render(); }
    if (action === 'toggle-folder-form') { const form = document.querySelector('#folder-form'); form.hidden = !form.hidden; if (!form.hidden) form.querySelector('input').focus(); }
    if (action === 'add-point') addPoints();
    if (action === 'analyze') { addPoints(); state.editor.analysis = analyzeMinute(state.editor); rememberDraft(); render(); document.querySelector('.analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (action === 'save-draft') await saveMinute(false);
    if (action === 'publish') await saveMinute(true);
  } catch (error) { state.busy = false; fail(error); }
});

root.addEventListener('submit', async (event) => {
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
      await request('save_milestone', { ...state.editor, ...data, year: Number(data.year) });
      state.modal = null; state.editor = null; await refresh(); toast('Hito histórico guardado.');
    } else if (form.id === 'profile-form') {
      await request('add_profile', data); state.profiles = await profiles(); state.modal = null; toast('Integrante agregado.');
    }
  } catch (error) {
    if (form.id === 'pin-form') { state.modalError = error.message; } else fail(error);
  } finally { state.busy = false; render(); }
});
root.addEventListener('input', (event) => {
  const input = event.target;
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
    if (input.dataset.moveNote) { state.editor.notes.find((n) => n.id === input.dataset.moveNote).folder_id = input.value; invalidate(); render(); }
    if (input.dataset.folderOwner) { state.editor.folders.find((f) => f.id === input.dataset.folderOwner).assignee = input.value; invalidate(); }
    if (input.dataset.actionable) { state.editor.notes.find((n) => n.id === input.dataset.actionable).actionable = input.checked; invalidate(); }
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
