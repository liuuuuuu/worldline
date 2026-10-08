import { describe, expect, it } from 'vitest';
import {
  assessStationName,
  filterSpamStations,
  MAX_STATION_NAME_LENGTH,
  shortenStationName,
} from './stationFilter';
import type { Station } from '../types/domain';

function station(name: string): Station {
  return {
    id: name,
    name,
    streamUrl: 'http://example.invalid/stream',
    tags: [],
    country: 'Test',
    countryCode: 'XX',
    votes: 0,
    codec: 'MP3',
    bitrate: 128,
    hls: false,
    healthy: true,
    geo: null,
  };
}

describe('assessStationName', () => {
  it('accepts ordinary station names', () => {
    const names = [
      'Radio Paradise Main Mix (EU) 320k AAC',
      'KLAN Kosova FM',
      'Adroit Jazz Underground',
      'Ö1 | ORF | HQ',
      'Classic Vinyl HD',
      'Radio Swiss Jazz',
      'Fm La Paz 96.7',
      'WALM - Old Time Radio',
      'ایران Radio Liberty (Iran)',
      'Clásica 102.5 Guatemala',
      'Hiti FM',
      'RMC FR',
    ];

    for (const name of names) {
      expect(assessStationName(name), name).toEqual({ spam: false });
    }
  });

  it('rejects the keyword-stuffed advert seen in the real directory', () => {
    const spam =
      '- DJ & CLUB CHARTS ---> Club Classics, Festival-Hits, Remixes, Single Charts, ' +
      'Mashups, DJ Sets, Club Edits, Dancefloor, Underground, Nightlife, Party Anthems, ' +
      'Ibiza, Miami, Clubbing, Festival, Remix, Mashup, DJ, EDM, RAVE, Dance, Urban, ' +
      'Latin, Beachclub, Lounge';

    const verdict = assessStationName(spam);
    expect(verdict.spam).toBe(true);
    // The arrow chain is checked first, so that is the reported reason.
    expect(verdict.reason).toBe('arrow-chain');
  });

  it('flags an arrow chain on its own', () => {
    expect(assessStationName('Best Radio ---> Listen Now')).toMatchObject({
      spam: true,
      reason: 'arrow-chain',
    });
    expect(assessStationName('Hits ==> 24/7').spam).toBe(true);
    expect(assessStationName('Musik → Jetzt').spam).toBe(true);
  });

  it('does not treat a single hyphen as an arrow', () => {
    expect(assessStationName('WALM - Old Time Radio').spam).toBe(false);
    expect(assessStationName('1 A - Oldies von 1A Radio').spam).toBe(false);
  });

  it('flags a name that is longer than any plausible station name', () => {
    const verdict = assessStationName('A'.repeat(MAX_STATION_NAME_LENGTH + 1));
    expect(verdict).toMatchObject({ spam: true, reason: 'too-long' });
  });

  it('keeps a long but plausible name', () => {
    const long = 'Radio Paradise Main Mix (European Feed) 320kbps AAC Stereo';
    expect(long.length).toBeLessThanOrEqual(MAX_STATION_NAME_LENGTH);
    expect(assessStationName(long).spam).toBe(false);
  });

  it('flags a comma-separated keyword dump', () => {
    const verdict = assessStationName(
      'Jazz, Soul, Funk, Blues, Gospel, Swing, Bebop, Ragtime, Dixieland',
    );
    expect(verdict).toMatchObject({ spam: true, reason: 'keyword-stuffed' });
  });

  it('keeps a name with a couple of genres in it', () => {
    expect(assessStationName('Jazz, Soul and Funk').spam).toBe(false);
    expect(assessStationName('Classic Rock, Hits').spam).toBe(false);
  });

  it('flags pipe soup', () => {
    const verdict = assessStationName('Dance | House | Techno | Trance | Rave | Club');
    expect(verdict).toMatchObject({ spam: true, reason: 'pipe-soup' });
  });

  it('keeps a short name that uses pipes as separators', () => {
    expect(assessStationName('Ö1 | ORF | HQ').spam).toBe(false);
    expect(assessStationName('RTL | FR').spam).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(assessStationName('   KLAN Kosova FM   ').spam).toBe(false);
    expect(assessStationName(`   ${'x'.repeat(200)}   `).spam).toBe(true);
  });
});

describe('filterSpamStations', () => {
  it('keeps good names and reports what it dropped, with reasons', () => {
    const result = filterSpamStations([
      station('Radio Paradise'),
      station('Hits ---> Listen'),
      station('KLAN Kosova FM'),
    ]);

    expect(result.kept.map((item) => item.name)).toEqual(['Radio Paradise', 'KLAN Kosova FM']);
    expect(result.dropped).toBe(1);
    expect(result.rejections[0]).toMatchObject({ name: 'Hits ---> Listen', reason: 'arrow-chain' });
  });

  it('does nothing to a clean list', () => {
    const result = filterSpamStations([station('A FM'), station('B FM')]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toBe(0);
    expect(result.rejections).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(filterSpamStations([])).toEqual({ kept: [], dropped: 0, rejections: [] });
  });
});

describe('shortenStationName', () => {
  it('leaves short names alone', () => {
    expect(shortenStationName('KLAN Kosova FM')).toBe('KLAN Kosova FM');
  });

  it('clips long names with an ellipsis rather than dropping them', () => {
    const long = 'A'.repeat(80);
    const short = shortenStationName(long, 20);

    expect(short.length).toBeLessThanOrEqual(20);
    expect(short.endsWith('…')).toBe(true);
  });

  it('does not leave a trailing space before the ellipsis', () => {
    expect(shortenStationName('Radio Paradise Main Mix', 16)).toBe('Radio Paradise…');
  });
});
