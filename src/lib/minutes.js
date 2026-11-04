import { normalizePriority } from './priorities.js';

export const STATUS = { sin_iniciar: 'Sin iniciar', iniciada: 'Iniciada', terminada: 'Terminada' };

export function minutePayload(minute, publish) {
  const normalized = { ...minute, notes: minute.notes.map((note) => ({ ...note, priority: normalizePriority(note.priority) })) };
  return { ...normalized, analysis: publish ? (minute.analysis || analyzeMinute(normalized)) : (minute.analysis || {}), state: publish ? 'published' : 'draft' };
}

export function cleanLine(text) {
  return text.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
}

// Extractive analysis: preserve what was written; never invent agreements or owners.
export function analyzeMinute(minute) {
  if (!minute.title?.trim()) throw new Error('Ponle un título a la minuta.');
  if (!minute.notes.length) throw new Error('Escribe al menos un punto de la reunión.');
  if (minute.notes.some((note) => !minute.folders.some((folder) => folder.id === note.folder_id))) {
    throw new Error('Agrupa todos los puntos en una carpeta antes de analizar.');
  }
  const folders = minute.folders.map((folder) => {
    const notes = minute.notes.filter((note) => note.folder_id === folder.id);
    if (notes.length && !folder.assignee) throw new Error(`Selecciona responsable para «${folder.name}».`);
    const actions = notes.filter((note) => note.actionable !== false);
    return {
      id: folder.id, name: folder.name, assignee: folder.assignee,
      summary: notes.map((note) => cleanLine(note.text).split(/(?<=[.!?])\s/)[0]).slice(0, 3).join(' · ')
        + (notes.length > 3 ? `\nAdemás, se registraron ${notes.length - 3} puntos adicionales en esta carpeta.` : ''),
      agreements: notes.filter((note) => /(?:^|\s)(acord[oó]|aprobad[oa]|decidi[oó]|definid[oa]|confirmad[oa])(?:\s|[.,;:]|$)/i.test(note.text)).map((note) => note.text),
      tasks: actions.map((note) => ({ source_id: note.id, title: cleanLine(note.text), assignee: note.assignee || folder.assignee, folder: folder.name, priority: normalizePriority(note.priority) })),
      count: notes.length,
    };
  }).filter((folder) => folder.count);
  return { folders, summary: folders.map((folder) => `${folder.name}: ${folder.count} puntos · ${folder.tasks.length} tareas`).join('\n'), task_count: folders.reduce((sum, folder) => sum + folder.tasks.length, 0), method: 'extractive-v1' };
}

export function elapsedSince(iso, now = Date.now()) {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}
