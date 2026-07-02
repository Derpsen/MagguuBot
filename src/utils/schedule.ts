const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface LocalScheduleParts {
  dateKey: string;
  day: number;
  hour: number;
}

export function localScheduleParts(date: Date, timeZone: string): LocalScheduleParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return {
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
    day: Math.max(0, WEEKDAYS.indexOf(get('weekday') as (typeof WEEKDAYS)[number])),
    hour: Number(get('hour')),
  };
}

export function weeklyPeriodKey(
  date: Date,
  timeZone: string,
  scheduledDay: number,
  scheduledHour: number,
): string | null {
  const local = localScheduleParts(date, timeZone);
  if (local.day === scheduledDay && local.hour < scheduledHour) return null;
  const daysSinceSchedule = (local.day - scheduledDay + 7) % 7;
  const [year, month, day] = local.dateKey.split('-').map(Number);
  const anchor = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) - daysSinceSchedule));
  return anchor.toISOString().slice(0, 10);
}

export function parseFutureTime(raw: string, now = Date.now()): Date | null {
  const relative = raw.trim().match(/^(\d+)\s*(m|h|d)$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]?.toLowerCase();
    const factor = unit === 'm' ? 60_000 : unit === 'h' ? 60 * 60_000 : 24 * 60 * 60_000;
    const date = new Date(now + amount * factor);
    return amount > 0 && Number.isFinite(date.getTime()) ? date : null;
  }
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) && date.getTime() > now ? date : null;
}

export function nextReminderRetryAt(attempts: number, now = new Date()): Date | null {
  const failedAttempts = Math.max(0, Math.floor(attempts)) + 1;
  if (failedAttempts >= 5) return null;
  const delayMinutes = Math.min(60, 5 * (2 ** (failedAttempts - 1)));
  return new Date(now.getTime() + delayMinutes * 60_000);
}
