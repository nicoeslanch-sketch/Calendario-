import { describe, expect, it } from 'vitest';
import { isValidPerson, isVisibleForPerson, PERSON } from '../src/lib/people.js';

describe('responsables del calendario', () => {
  it('incluye a Tomás y el calendario compartido', () => {
    expect(PERSON).toEqual({
      nicolas: 'Nicolás',
      benjamin: 'Benjamín',
      tomas: 'Tomás',
      ambos: 'Compartido',
    });
    expect(isValidPerson('tomas')).toBe(true);
  });

  it('muestra a cada persona sus tareas y las compartidas', () => {
    expect(isVisibleForPerson('tomas', 'tomas')).toBe(true);
    expect(isVisibleForPerson('tomas', 'ambos')).toBe(true);
    expect(isVisibleForPerson('tomas', 'nicolas')).toBe(false);
  });

  it('muestra las tareas de los tres en la vista compartida', () => {
    for (const responsible of ['nicolas', 'benjamin', 'tomas', 'ambos']) {
      expect(isVisibleForPerson('ambos', responsible)).toBe(true);
    }
  });
});
