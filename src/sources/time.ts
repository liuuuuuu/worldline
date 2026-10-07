/**
 * Local-time arithmetic.
 *
 * Deliberately free of any HTTP: Open-Meteo already hands back the IANA zone
 * name and the UTC offset for a coordinate, so computing local time is pure
 * arithmetic and needs no extra timezone API.
 *
 * Everything here shifts the instant by an offset and then reads UTC fields,
 * which sidesteps the host machine's own timezone entirely — important because
 * "local time in Tokyo" must not depend on where the user is sitting.
 */

import type { LocalTimeParts } from '../types/domain';

const MINUTE_MS = 60_000;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** `9 * 3600` → `GMT+9`, `-12600` → `GMT-3:30`, `0` → `UTC`. */
export function offsetLabel(utcOffsetSeconds: number): string {
  if (utcOffsetSeconds === 0) return 'UTC';

  const sign = utcOffsetSeconds < 0 ? '-' : '+';
  const totalMinutes = Math.round(Math.abs(utcOffsetSeconds) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes === 0 ? `GMT${sign}${hours}` : `GMT${sign}${hours}:${pad(minutes)}`;
}

/** Shift an instant to a place's wall clock and read the fields back. */
export function localTimeAt(
  utcOffsetSeconds: number,
  at: Date = new Date(),
  locale = 'en',
): LocalTimeParts {
  const shifted = new Date(at.getTime() + utcOffsetSeconds * 1000);

  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const day = shifted.getUTCDate();
  const hour = shifted.getUTCHours();
  const minute = shifted.getUTCMinutes();

  let weekday: string;
  try {
    weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(shifted);
  } catch {
    weekday = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(shifted);
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
    offsetLabel: offsetLabel(utcOffsetSeconds),
    display: `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`,
  };
}

/**
 * Resolve a UTC offset for an IANA zone at a given instant.
 *
 * Handles DST correctly because `Intl` does — the offset is derived from the
 * zone's actual wall clock at that moment, not from a static table. Used by the
 * scheduling layer for places we know by name but have not queried weather for.
 */
export function utcOffsetSecondsFor(timeZone: string, at: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found ? Number(found.value) : 0;
  };

  // Some ICU builds emit hour 24 for midnight.
  const rawHour = read('hour');
  const hour = rawHour === 24 ? 0 : rawHour;

  const asIfUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    hour,
    read('minute'),
    read('second'),
  );

  // Drop sub-second precision so the difference is an exact number of seconds.
  const base = Math.floor(at.getTime() / 1000) * 1000;

  return Math.round((asIfUtc - base) / 1000);
}

/** Minutes until the wall clock at this offset rolls over to the next day. */
export function minutesUntilLocalMidnight(utcOffsetSeconds: number, at: Date = new Date()): number {
  const shifted = at.getTime() + utcOffsetSeconds * 1000;
  const msIntoDay = ((shifted % 86_400_000) + 86_400_000) % 86_400_000;
  return Math.ceil((86_400_000 - msIntoDay) / MINUTE_MS);
}
