/**
 * Station-name quality filter.
 *
 * The directory is community-maintained and unmoderated, so some entries are
 * advertisements rather than station names. The worst one observed:
 *
 *   "- DJ & CLUB CHARTS ---> Club Classics, Festival-Hits, Remixes, Single
 *    Charts, Mashups, DJ Sets, Club Edits, Dancefloor, Underground, Nightlife,
 *    Party Anthems, Ibiza, Miami, Clubbing, Festival, Remix, Mashup, DJ, EDM,
 *    RAVE, Dance, Urban, Latin, Beachclub, Lounge"
 *
 * 230 characters of keyword stuffing. In a tooltip it is unreadable, and on a
 * globe pin it is meaningless.
 *
 * The thresholds are deliberately loose. Dropping a station costs geographic
 * coverage — the exact thing ADR-0004 was written to protect — so a name has to
 * be clearly abusive before it is discarded. Merely long or punctuated names
 * are kept.
 */

import type { Station } from '../types/domain';

/**
 * Real station names are short. The longest legitimate one in a 250-station
 * sample was 63 characters ("Radio Paradise Main Mix (EU) 320k AAC" is 40).
 */
export const MAX_STATION_NAME_LENGTH = 80;

export type NameIssue = 'too-long' | 'arrow-chain' | 'keyword-stuffed' | 'pipe-soup';

export interface NameAssessment {
  /** True when the name should be treated as advertising rather than a name. */
  spam: boolean;
  reason?: NameIssue;
}

/** `--->`, `==>`, `→`, `»` — a call-to-action, not a name. */
const ARROW_CHAIN = /(?:-{2,}>|={2,}>|→|»)/;

function countOccurrences(text: string, character: string): number {
  let count = 0;
  for (const letter of text) {
    if (letter === character) count += 1;
  }
  return count;
}

/**
 * Assess a station name.
 *
 * Rules are ordered most-specific first so the reported reason is the most
 * informative one.
 */
export function assessStationName(name: string): NameAssessment {
  const trimmed = name.trim();

  if (ARROW_CHAIN.test(trimmed)) {
    return { spam: true, reason: 'arrow-chain' };
  }

  if (trimmed.length > MAX_STATION_NAME_LENGTH) {
    return { spam: true, reason: 'too-long' };
  }

  // A name that is mostly a comma-separated list of genres is a keyword dump.
  // Two commas is normal ("Jazz, Soul"); eight is not.
  const commas = countOccurrences(trimmed, ',');
  if (commas >= 6 && trimmed.length > 60) {
    return { spam: true, reason: 'keyword-stuffed' };
  }

  const pipes = countOccurrences(trimmed, '|');
  if (pipes >= 4 && trimmed.length > 30) {
    return { spam: true, reason: 'pipe-soup' };
  }

  return { spam: false };
}

export interface FilterResult {
  kept: Station[];
  dropped: number;
  /** Dropped stations with the reason, for logging and tests. */
  rejections: ReadonlyArray<{ name: string; reason: NameIssue }>;
}

export function filterSpamStations(stations: readonly Station[]): FilterResult {
  const kept: Station[] = [];
  const rejections: Array<{ name: string; reason: NameIssue }> = [];

  for (const station of stations) {
    const assessment = assessStationName(station.name);
    if (assessment.spam) {
      rejections.push({ name: station.name, reason: assessment.reason ?? 'too-long' });
    } else {
      kept.push(station);
    }
  }

  return { kept, dropped: rejections.length, rejections };
}

/** Clip a name for display. Truncation, never dropping — the pin still matters. */
export function shortenStationName(name: string, maxLength = 48): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}
