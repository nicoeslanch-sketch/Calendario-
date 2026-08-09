import { describe, expect, it } from 'vitest';
import { addDays, deadlineState, endOfWeek, monthGrid, startOfWeek } from '../src/lib/date.js';

describe('calendar dates', () => {
  it('builds Monday-to-Sunday weeks', () => {
    expect(startOfWeek('2026-08-09')).toBe('2026-08-03');
    expect(endOfWeek('2026-08-09')).toBe('2026-08-09');
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('creates complete month grids', () => {
    const days = monthGrid('2026-08-09');
    expect(days[0]).toBe('2026-07-27');
    expect(days.at(-1)).toBe('2026-09-06');
    expect(days).toHaveLength(42);
  });
});

describe('deadlines', () => {
  it('classifies overdue and completed tasks', () => {
    expect(deadlineState({ date: '2026-08-09', deadline_time: '12:00', completed: false, reminder_minutes_before: 60 }, new Date('2026-08-09T17:00:00Z'))).toBe('overdue');
    expect(deadlineState({ date: '2026-08-09', deadline_time: '12:00:00', completed: false, reminder_minutes_before: 60 }, new Date('2026-08-09T17:00:00Z'))).toBe('overdue');
    expect(deadlineState({ date: '2026-08-09', deadline_time: '12:00', completed: true }, new Date())).toBe('completed');
  });

  it('uses the earliest scheduled point when a task has multiple reminders', () => {
    const task = { date: '2026-08-09', deadline_time: '14:00', completed: false, reminder_minutes: [10, 60] };
    expect(deadlineState(task, new Date('2026-08-09T17:30:00Z'))).toBe('urgent');
  });
});
