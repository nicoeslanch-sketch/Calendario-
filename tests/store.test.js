import { beforeAll, describe, expect, it, vi } from 'vitest';

const memory = new Map();
vi.stubGlobal('localStorage', {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
});
vi.stubGlobal('window', new EventTarget());

let store;
beforeAll(async () => {
  store = await import('../src/lib/store.js');
});

describe('local calendar persistence', () => {
  it('creates, edits, completes, duplicates and deletes tasks', async () => {
    const created = await store.saveTask({
      title: 'Provisiones', date: '2026-08-10', responsible: 'nicolas',
      deadline_time: '12:00', recurrence_rule: { frequency: 'none' },
      subtasks: [{ title: 'Validar montos', completed: false }],
    });
    expect((await store.loadRange('2026-08-10', '2026-08-10')).tasks).toHaveLength(1);

    await store.patchTask(created.id, { date: '2026-08-11', title: 'Provisiones editadas' });
    let tasks = (await store.loadRange('2026-08-11', '2026-08-11')).tasks;
    expect(tasks[0].title).toBe('Provisiones editadas');

    await store.toggleTask(tasks[0]);
    tasks = (await store.loadRange('2026-08-11', '2026-08-11')).tasks;
    expect(tasks[0].completed).toBe(true);
    expect(tasks[0].completed_at).toBeTruthy();

    await store.toggleTask(tasks[0]);
    expect((await store.loadRange('2026-08-11', '2026-08-11')).tasks[0].completed).toBe(false);

    const copy = await store.duplicateTask(tasks[0]);
    expect(copy.title).toContain('(copia)');
    await store.deleteTask(copy.id);
    expect((await store.loadRange('2026-08-11', '2026-08-11')).tasks).toHaveLength(1);

    await store.deleteTask(created.id);
    expect((await store.loadRange('2026-08-11', '2026-08-11')).tasks).toHaveLength(0);
  });

  it('persists and removes birthdays independently of tasks', async () => {
    const birthday = await store.saveBirthday({ name: 'Carlos', month: 8, day: 9, active: true });
    expect((await store.loadRange('2026-08-01', '2026-08-31')).birthdays).toHaveLength(1);
    await store.deleteBirthday(birthday.id);
    expect((await store.loadRange('2026-08-01', '2026-08-31')).birthdays).toHaveLength(0);
  });
});
