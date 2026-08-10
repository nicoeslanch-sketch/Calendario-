import { describe, expect, it } from 'vitest';
import { filterByPriorityGroup, priorityGroup, weeklyPrioritySummary } from '../src/lib/task-groups.js';

const tasks = [
  { id: '1', priority: 'urgente', completed: false },
  { id: '2', priority: 'alta', completed: true },
  { id: '3', priority: 'media', completed: false },
  { id: '4', priority: 'baja', completed: false },
];

describe('weekly task priority groups', () => {
  it('groups urgent and high priority tasks as critical', () => {
    expect(priorityGroup('urgente')).toBe('critical');
    expect(priorityGroup('alta')).toBe('critical');
    expect(priorityGroup('media')).toBe('medium');
    expect(priorityGroup('baja')).toBe('low');
  });

  it('reports total and pending counts independently', () => {
    expect(weeklyPrioritySummary(tasks)).toEqual({
      critical: { total: 2, pending: 1 },
      medium: { total: 1, pending: 1 },
      low: { total: 1, pending: 1 },
    });
  });

  it('filters the general list by its selected risk group', () => {
    expect(filterByPriorityGroup(tasks, 'critical').map((task) => task.id)).toEqual(['1', '2']);
    expect(filterByPriorityGroup(tasks, 'all')).toBe(tasks);
  });
});
