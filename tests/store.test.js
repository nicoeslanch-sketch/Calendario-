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

  it('persists future tasks assigned to Benjamín', async () => {
    const created = await store.saveTask({
      title: 'Seguimiento Benjamín', date: '2026-08-21', responsible: 'benjamin',
      recurrence_rule: { frequency: 'none' }, subtasks: [],
    });
    const tasks = (await store.loadRange('2026-08-21', '2026-08-21')).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ title: 'Seguimiento Benjamín', responsible: 'benjamin' });
    await store.deleteTask(created.id);
  });

  it('creates, starts, completes and deletes projects without dates', async () => {
    const created = await store.saveProject({
      idea: 'Automatizar seguimiento',
      description: 'Crear un tablero compartido.',
      purpose: 'Reducir trabajo manual.',
      kpis: 'Horas ahorradas; tiempo de respuesta',
      responsible: 'ambos',
      status: 'sin_iniciar',
      priority: 'rojo',
    });

    let projects = await store.loadProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({ idea: 'Automatizar seguimiento', priority: 'rojo', status: 'sin_iniciar' });

    await store.patchProject(created.id, { status: 'iniciado' });
    projects = await store.loadProjects();
    expect(projects[0].status).toBe('iniciado');
    expect(projects[0].completed_at).toBeNull();

    await store.patchProject(created.id, { status: 'completado' });
    projects = await store.loadProjects();
    expect(projects[0].completed_at).toBeTruthy();

    await store.deleteProject(created.id);
    expect(await store.loadProjects()).toHaveLength(0);
  });

  it('keeps secondary tasks in the weekly range and moves them to completed history', async () => {
    const created = await store.saveTask({
      title: 'Confirmar envío de minuta',
      date: '2026-08-31',
      responsible: 'ambos',
      priority: 'baja',
      is_secondary: true,
      reminder_minutes: [],
      recurrence_rule: { frequency: 'none' },
      subtasks: [],
    });

    let tasks = (await store.loadRange('2026-08-31', '2026-09-06')).tasks;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ is_secondary: true, completed: false });

    await store.toggleTask(tasks[0]);
    tasks = (await store.loadRange('2026-08-31', '2026-09-06')).tasks;
    expect(tasks[0].completed).toBe(true);
    const history = await store.loadHistory(30);
    expect(history.some((task) => task.id === created.id && task.is_secondary)).toBe(true);

    await store.deleteTask(created.id);
  });
});
