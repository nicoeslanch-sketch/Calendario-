export function validOptionalDate(value) {
  if (!value) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2200-12-31'
    || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error('Usa una fecha válida entre 2000 y 2200.');
  return value;
}

export function scheduledDate(note, folders = []) {
  const mode = note.schedule_mode || 'folder';
  if (mode === 'none') return '';
  if (mode === 'custom') return validOptionalDate(note.scheduled_date);
  return validOptionalDate(folders.find((f) => f.id === note.folder_id)?.scheduled_date);
}

export function validateSchedule(minute) {
  minute.folders.forEach((f) => validOptionalDate(f.scheduled_date));
  minute.notes.forEach((n) => {
    if (!['folder', 'custom', 'none'].includes(n.schedule_mode || 'folder')) throw new Error('Selecciona cómo agendar la tarea.');
    validOptionalDate(n.scheduled_date);
    scheduledDate(n, minute.folders);
  });
}

export const shortDate = (iso) => iso ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeZone: 'America/Santiago' }).format(new Date(`${iso}T12:00:00`)) : 'Sin fecha';
