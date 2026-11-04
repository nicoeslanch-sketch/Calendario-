// Conversion is a copy: source notes, assignments and minute are never removed.
export function folderToMilestone(folder, minutes, assignments, year, makeId = () => crypto.randomUUID()) {
  const points = new Map();
  const origins = [];
  for (const minute of minutes) {
    const notes = minute.notes.filter((n) => n.folder_id === folder.id);
    if (notes.length) origins.push(minute.title || 'Minuta sin título');
    for (const note of notes) points.set(`${minute.id}:${note.id}`, { note, minute });
  }
  const tasks = [...points.values()].filter(({ note }) => note.actionable !== false).map(({ note, minute }) => {
    const assignment = assignments.find((a) => a.minute_id === minute.id && a.source_id === note.id);
    return { id: makeId(), title: note.text.trim(), completed: assignment?.status === 'terminada' };
  });
  return { title: folder.name, year, purpose: origins.length ? `Referencia de: ${[...new Set(origins)].join(', ')}.` : '',
    guidelines: [...points.values()].filter(({ note }) => note.actionable === false).map(({ note }) => note.text).join('\n'),
    plan: [...points.values()].map(({ note }) => `• ${note.text}`).join('\n'),
    learnings: '', tasks, version: 0 };
}

export function taskCounts(tasks = []) {
  const done = tasks.filter((t) => t.completed).length;
  return { done, pending: tasks.length - done };
}
