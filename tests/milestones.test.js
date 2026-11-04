import { describe, expect, it } from 'vitest';
import { folderToMilestone, taskCounts } from '../src/lib/milestones.js';

describe('folder to historical milestone', () => {
  const folder = { id: 'f1', name: 'Evento anual' };
  const minute = { id: 'm1', title: 'Reunión', notes: [
    { id: 'n1', folder_id: 'f1', text: 'Reservar recinto', actionable: true },
    { id: 'n2', folder_id: 'f1', text: 'Invitar al equipo', actionable: true },
    { id: 'n3', folder_id: 'f1', text: 'Evento presencial', actionable: false },
    { id: 'n4', folder_id: 'other', text: 'Otro tema', actionable: true },
  ] };
  it('copies only the selected folder and preserves completed tasks', () => {
    const before = structuredClone(minute);
    let id = 0;
    const result = folderToMilestone(folder, [minute], [{ minute_id: 'm1', source_id: 'n1', status: 'terminada' }], 2026, () => `new-${++id}`);
    expect(result.title).toBe('Evento anual');
    expect(result.tasks).toEqual([{ id: 'new-1', title: 'Reservar recinto', completed: true }, { id: 'new-2', title: 'Invitar al equipo', completed: false }]);
    expect(result.guidelines).toBe('Evento presencial');
    expect(result.plan).not.toContain('Otro tema');
    expect(taskCounts(result.tasks)).toEqual({ done: 1, pending: 1 });
    expect(minute).toEqual(before);
  });
  it('handles an empty folder without inventing tasks', () => {
    const result = folderToMilestone(folder, [], [], 2027);
    expect(result.tasks).toEqual([]);
    expect(taskCounts()).toEqual({ done: 0, pending: 0 });
  });
  it('does not duplicate a source point and scopes status by source minute', () => {
    const result = folderToMilestone(folder, [minute, minute], [{ minute_id: 'another', source_id: 'n1', status: 'terminada' }], 2026, () => 'id');
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0].completed).toBe(false);
  });
});
