import { describe, expect, it } from 'vitest';
import { localTimeAt, minutesUntilLocalMidnight, offsetLabel, utcOffsetSecondsFor } from './time';

describe('offsetLabel', () => {
  it('renders UTC for a zero offset', () => {
    expect(offsetLabel(0)).toBe('UTC');
  });

  it('renders whole-hour offsets', () => {
    expect(offsetLabel(9 * 3600)).toBe('GMT+9');
    expect(offsetLabel(-5 * 3600)).toBe('GMT-5');
  });

  it('renders half- and quarter-hour offsets', () => {
    expect(offsetLabel(5.5 * 3600)).toBe('GMT+5:30');
    expect(offsetLabel(-3.5 * 3600)).toBe('GMT-3:30');
    expect(offsetLabel(5.75 * 3600)).toBe('GMT+5:45');
  });
});

describe('localTimeAt', () => {
  it('shifts the instant into the target wall clock', () => {
    const instant = new Date('2026-10-07T13:00:00Z');
    const parts = localTimeAt(9 * 3600, instant, 'en');

    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(10);
    expect(parts.day).toBe(7);
    expect(parts.hour).toBe(22);
    expect(parts.minute).toBe(0);
    expect(parts.display).toBe('2026-10-07 22:00');
    expect(parts.offsetLabel).toBe('GMT+9');
  });

  it('rolls the date over when the offset crosses midnight', () => {
    const instant = new Date('2026-10-07T22:30:00Z');
    const parts = localTimeAt(9 * 3600, instant, 'en');

    expect(parts.day).toBe(8);
    expect(parts.hour).toBe(7);
    expect(parts.minute).toBe(30);
  });

  it('rolls backwards for negative offsets', () => {
    const instant = new Date('2026-10-07T02:00:00Z');
    const parts = localTimeAt(-5 * 3600, instant, 'en');

    expect(parts.day).toBe(6);
    expect(parts.hour).toBe(21);
  });

  it('does not depend on the host machine timezone', () => {
    const instant = new Date('2026-10-07T13:00:00Z');
    expect(localTimeAt(0, instant, 'en').display).toBe('2026-10-07 13:00');
    expect(localTimeAt(3600, instant, 'en').display).toBe('2026-10-07 14:00');
  });

  it('localises the weekday', () => {
    // 2026-10-07 is a Wednesday.
    const instant = new Date('2026-10-07T13:00:00Z');
    expect(localTimeAt(0, instant, 'en').weekday).toBe('Wednesday');
    expect(localTimeAt(0, instant, 'zh-CN').weekday).toBe('星期三');
  });
});

describe('utcOffsetSecondsFor', () => {
  it('resolves a fixed-offset zone', () => {
    expect(utcOffsetSecondsFor('Asia/Tokyo', new Date('2026-10-07T13:00:00Z'))).toBe(9 * 3600);
    expect(utcOffsetSecondsFor('UTC', new Date('2026-10-07T13:00:00Z'))).toBe(0);
  });

  it('handles zones with non-hour offsets', () => {
    expect(utcOffsetSecondsFor('Asia/Kolkata', new Date('2026-10-07T13:00:00Z'))).toBe(5.5 * 3600);
    expect(utcOffsetSecondsFor('Asia/Kathmandu', new Date('2026-10-07T13:00:00Z'))).toBe(
      5.75 * 3600,
    );
  });

  it('tracks daylight saving transitions', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');

    expect(utcOffsetSecondsFor('America/New_York', winter)).toBe(-5 * 3600);
    expect(utcOffsetSecondsFor('America/New_York', summer)).toBe(-4 * 3600);
    expect(utcOffsetSecondsFor('Europe/London', winter)).toBe(0);
    expect(utcOffsetSecondsFor('Europe/London', summer)).toBe(3600);
  });
});

describe('minutesUntilLocalMidnight', () => {
  it('counts down to the next local day', () => {
    expect(minutesUntilLocalMidnight(0, new Date('2026-10-07T23:30:00Z'))).toBe(30);
    expect(minutesUntilLocalMidnight(0, new Date('2026-10-07T00:00:00Z'))).toBe(1440);
  });

  it('accounts for the offset', () => {
    // 23:30 UTC is already 08:30 the next day in Tokyo (+9).
    expect(minutesUntilLocalMidnight(9 * 3600, new Date('2026-10-07T23:30:00Z'))).toBe(930);
  });
});
