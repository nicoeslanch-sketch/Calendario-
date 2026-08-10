export const PRIORITY_GROUPS = {
  critical: { label: 'Críticas', priorities: ['urgente', 'alta'] },
  medium: { label: 'Medias', priorities: ['media'] },
  low: { label: 'Bajo riesgo', priorities: ['baja'] },
};

export function priorityGroup(priority) {
  return Object.entries(PRIORITY_GROUPS).find(([, group]) => group.priorities.includes(priority))?.[0] || 'low';
}

export function weeklyPrioritySummary(tasks) {
  const summary = Object.fromEntries(Object.keys(PRIORITY_GROUPS).map((key) => [key, { total: 0, pending: 0 }]));
  tasks.forEach((task) => {
    const group = priorityGroup(task.priority);
    summary[group].total += 1;
    if (!task.completed) summary[group].pending += 1;
  });
  return summary;
}

export function filterByPriorityGroup(tasks, filter) {
  if (!filter || filter === 'all') return tasks;
  return tasks.filter((task) => priorityGroup(task.priority) === filter);
}
