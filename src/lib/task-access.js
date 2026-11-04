export const isSupervisor = (profile) => ['nicolas', 'benjamin'].includes(profile);
export const canViewTasks = (profile, assignee) => isSupervisor(profile) || assignee === profile || assignee === 'ambos';
export const taskProfiles = (profiles, profile) => profiles.filter((p) => canViewTasks(profile, p.id));
