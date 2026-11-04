import { expect, it } from 'vitest';
import { canViewTasks, taskProfiles } from '../src/lib/task-access.js';
const profiles = ['nicolas','benjamin','tomas','ambos'].map((id) => ({ id }));
it('Nicolás and Benjamín can consult all team task groups', () => {
  for (const id of ['nicolas','benjamin']) expect(taskProfiles(profiles,id)).toEqual(profiles);
});
it('Tomás can only consult his group and Shared', () => {
  expect(taskProfiles(profiles,'tomas').map((p) => p.id)).toEqual(['tomas','ambos']);
  expect(canViewTasks('tomas','nicolas')).toBe(false);
  expect(canViewTasks('tomas','benjamin')).toBe(false);
});
it('Shared and future open profiles cannot expose protected groups', () => {
  expect(taskProfiles(profiles,'ambos').map((p) => p.id)).toEqual(['ambos']);
  expect(canViewTasks('new-profile','nicolas')).toBe(false);
});
