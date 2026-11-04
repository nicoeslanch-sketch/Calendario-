import { expect, it } from 'vitest';
import { normalizePriority, sortTasksByPriority } from '../src/lib/priorities.js';
import { analyzeMinute, minutePayload } from '../src/lib/minutes.js';

it('defaults legacy and unrecognized priorities to medium', () => {
  for (const value of [undefined, null, '', 'urgent', '__proto__', 'constructor']) expect(normalizePriority(value)).toBe('media');
  for (const value of ['alta', 'media', 'baja']) expect(normalizePriority(value)).toBe(value);
});

it('sorts high, medium, low stably without changing the input, independent of status', () => {
  const tasks = [
    { id: 1, priority: 'baja' }, { id: 2 }, { id: 3, priority: 'alta', status: 'terminada' },
    { id: 4, priority: 'media' }, { id: 5, priority: 'alta' }, { id: 6, priority: 'baja' },
  ];
  expect(sortTasksByPriority(tasks).map((t) => t.id)).toEqual([3, 5, 2, 4, 1, 6]);
  expect(tasks.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(sortTasksByPriority([])).toEqual([]);
});

it('keeps each note priority through analysis, draft and one-click publication', () => {
  const minute = { title: 'Prioridades', folders: [{ id: 'f', name: 'Equipo', assignee: 'tomas' }], notes: [
    { id: '1', text: 'Primera', folder_id: 'f', priority: 'alta' },
    { id: '2', text: 'Segunda', folder_id: 'f', priority: 'baja' },
    { id: '3', text: 'Anterior sin prioridad', folder_id: 'f' },
    { id: '4', text: 'Contexto', folder_id: 'f', priority: 'alta', actionable: false },
  ] };
  expect(analyzeMinute(minute).folders[0].tasks.map((t) => t.priority)).toEqual(['alta', 'baja', 'media']);
  expect(minutePayload(minute, true).notes.map((n) => n.priority)).toEqual(['alta', 'baja', 'media', 'alta']);
  expect(minutePayload(minute, false).notes[0].priority).toBe('alta');
  expect(minute.notes[2]).not.toHaveProperty('priority');
});
