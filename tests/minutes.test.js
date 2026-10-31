import { describe, expect, it } from 'vitest';
import { analyzeMinute, elapsedSince } from '../src/lib/minutes.js';

const minute = () => ({ title: 'Reunión', folders: [{ id: 'f1', name: 'Evento', assignee: 'tomas' }], notes: [
  { id: 'n1', text: 'Confirmar recinto', folder_id: 'f1', actionable: true },
  { id: 'n2', text: 'Se acordó un encuentro presencial.', folder_id: 'f1', actionable: false },
] });

describe('análisis de minutas', () => {
  it('distribuye acciones al responsable sin convertir contexto en tareas', () => {
    const analysis = analyzeMinute(minute());
    expect(analysis.task_count).toBe(1);
    expect(analysis.folders[0].tasks[0]).toMatchObject({ source_id: 'n1', title: 'Confirmar recinto', assignee: 'tomas' });
    expect(analysis.folders[0].agreements).toHaveLength(1);
  });
  it('impide distribuir puntos sueltos o responsables sin definir', () => {
    const m = minute(); m.notes[0].folder_id = '';
    expect(() => analyzeMinute(m)).toThrow('Agrupa todos');
    m.notes[0].folder_id = 'f1'; m.folders[0].assignee = '';
    expect(() => analyzeMinute(m)).toThrow('responsable');
  });
  it('no inventa plazos ni tareas al resumir carpetas largas', () => {
    const m = minute();
    m.notes.push(...Array.from({ length: 5 }, (_, i) => ({ id: `x${i}`, text: `Punto ${i}`, folder_id: 'f1', actionable: false })));
    const result = analyzeMinute(m);
    expect(result.folders[0].summary).toContain('4 puntos adicionales');
    expect(result.task_count).toBe(1);
    expect(result.folders[0].tasks[0]).not.toHaveProperty('deadline');
  });
});
it('muestra el tiempo transcurrido incluso varios días después', () => {
  expect(elapsedSince('2026-10-26T09:00:00Z', Date.parse('2026-10-30T09:00:00Z'))).toBe('hace 4 días');
});
