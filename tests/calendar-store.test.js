import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/lib/workspace-store.js', () => ({ calendarRequest: rpc }));
import * as calendar from '../src/lib/calendar-store.js';

beforeEach(() => rpc.mockClear());
describe('calendar uses the workspace profile session', () => {
  it('loads dates and history through the protected calendar RPC', async () => {
    await calendar.loadRange('2026-10-26', '2026-11-01');
    await calendar.loadHistory(7);
    expect(rpc).toHaveBeenNthCalledWith(1, 'load', { start: '2026-10-26', end: '2026-11-01' });
    expect(rpc).toHaveBeenNthCalledWith(2, 'history', { days: 7 });
  });
  it('lets the server set completion timestamps', async () => {
    await calendar.toggleTask({ id: 'task-1', completed: false });
    expect(rpc).toHaveBeenCalledWith('patch_task', { id: 'task-1', input: { completed: true } });
  });
  it('duplicates only editable fields, without IDs, recurrence or completed state', async () => {
    await calendar.duplicateTask({ id: 'old', title: 'Reunión', responsible: 'tomas',
      date: '2026-10-31', completed: true, recurrence_source_id: 'source',
      subtasks: [{ id: 'old-subtask', title: 'Preparar', completed: true }] });
    expect(rpc.mock.calls[0][1]).toMatchObject({ id: null, input: {
      title: 'Reunión (copia)', responsible: 'tomas', recurrence_rule: { frequency: 'none' },
      subtasks: [{ title: 'Preparar', completed: false }],
    } });
    expect(rpc.mock.calls[0][1].input).not.toHaveProperty('id');
    expect(rpc.mock.calls[0][1].input).not.toHaveProperty('completed');
    expect(rpc.mock.calls[0][1].input).not.toHaveProperty('recurrence_source_id');
  });
});
