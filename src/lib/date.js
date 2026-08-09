export const TIME_ZONE = 'America/Santiago';

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function chileToday(now = new Date()) {
  return ymd.format(now);
}

export function dateFromISO(iso) {
  return new Date(`${iso}T12:00:00`);
}

export function toISO(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function addDays(iso, amount) {
  const date = dateFromISO(iso);
  date.setDate(date.getDate() + amount);
  return toISO(date);
}

export function addMonths(iso, amount) {
  const date = dateFromISO(iso);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return toISO(date);
}

export function startOfWeek(iso) {
  const date = dateFromISO(iso);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toISO(date);
}

export function endOfWeek(iso) {
  return addDays(startOfWeek(iso), 6);
}

export function monthBounds(iso) {
  const date = dateFromISO(iso);
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 12);
  return { start: toISO(start), end: toISO(end) };
}

export function monthGrid(iso) {
  const { start, end } = monthBounds(iso);
  const gridStart = startOfWeek(start);
  const endDate = dateFromISO(end);
  const endDay = endDate.getDay() || 7;
  const gridEnd = addDays(end, 7 - endDay);
  const days = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDays(cursor, 1)) days.push(cursor);
  return days;
}

export function formatLongDate(iso) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(dateFromISO(iso));
}

export function formatMonth(iso) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(dateFromISO(iso));
}

export function formatShortDay(iso) {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: TIME_ZONE,
    weekday: 'short',
  }).format(dateFromISO(iso)).replace('.', '');
}

export function chileDateTime(iso, time) {
  if (!iso || !time) return null;
  const normalizedTime = String(time).match(/^\d{2}:\d{2}/)?.[0];
  if (!normalizedTime) return null;
  // noon-based offset lookup avoids device timezone assumptions around DST.
  const base = new Date(`${iso}T${normalizedTime}:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    timeZoneName: 'longOffset',
    hour: '2-digit',
  }).formatToParts(base);
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value.replace('GMT', '') || '-04:00';
  return new Date(`${iso}T${normalizedTime}:00${offset}`);
}

export function deadlineState(task, now = new Date()) {
  if (task.completed || !task.deadline_time) return task.completed ? 'completed' : 'pending';
  const deadline = chileDateTime(task.date, task.deadline_time);
  const minutes = Math.round((deadline - now) / 60000);
  if (minutes < 0) return 'overdue';
  if (minutes <= (task.reminder_minutes_before ?? 60)) return 'urgent';
  return 'pending';
}

export function relativeDeadline(task, now = new Date()) {
  if (task.completed && task.completed_at) {
    return `Completada ${new Intl.DateTimeFormat('es-CL', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(task.completed_at))}`;
  }
  if (!task.deadline_time) return 'Sin hora límite';
  const minutes = Math.round((chileDateTime(task.date, task.deadline_time) - now) / 60000);
  const label = duration(Math.abs(minutes));
  return minutes < 0 ? `Venció hace ${label}` : `Quedan ${label}`;
}

export function duration(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? 'día' : 'días'}`;
}

export function birthdayISO(birthday, year) {
  const day = String(birthday.day).padStart(2, '0');
  const month = String(birthday.month).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isBirthdayOn(birthday, iso) {
  const [, month, day] = iso.split('-').map(Number);
  return birthday.active && birthday.month === month && birthday.day === day;
}

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

