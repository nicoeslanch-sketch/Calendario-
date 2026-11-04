export const PRIORITIES = {
  alta: { label: 'Alta', color: 'Rojo', rank: 0 },
  media: { label: 'Media', color: 'Amarillo', rank: 1 },
  baja: { label: 'Baja', color: 'Verde', rank: 2 },
};

export const normalizePriority = (value) => Object.hasOwn(PRIORITIES, value) ? value : 'media';

// Stable sort: keep the current order inside each priority and never mutate data.
export const sortTasksByPriority = (tasks) => [...tasks].sort((a, b) =>
  PRIORITIES[normalizePriority(a.priority)].rank - PRIORITIES[normalizePriority(b.priority)].rank);
