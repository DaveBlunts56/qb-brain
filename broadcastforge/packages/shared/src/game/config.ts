import type { FootballFormatId, GameConfig } from './types.js';

const MIN = 60_000;

export interface FootballFormat {
  id: FootballFormatId;
  label: string;
  description: string;
  config: GameConfig;
}

export const FOOTBALL_FORMATS: Record<FootballFormatId, FootballFormat> = {
  nfhs: {
    id: 'nfhs',
    label: 'High School (NFHS)',
    description: '12:00 quarters, untimed overtime, 40/25 play clock, 3 timeouts per half, 1 per overtime.',
    config: {
      formatId: 'nfhs',
      quarterLengthMs: 12 * MIN,
      overtimeLengthMs: null,
      playClockSeconds: 40,
      playClockShortSeconds: 25,
      timeoutsPerHalf: 3,
      overtimeTimeouts: 1,
      resetTimeoutsAtHalf: true,
      showTenthsUnderMinute: true,
      maxOvertimes: 9,
    },
  },
  college: {
    id: 'college',
    label: 'College',
    description: '15:00 quarters, untimed overtime, 40/25 play clock, 3 timeouts per half.',
    config: {
      formatId: 'college',
      quarterLengthMs: 15 * MIN,
      overtimeLengthMs: null,
      playClockSeconds: 40,
      playClockShortSeconds: 25,
      timeoutsPerHalf: 3,
      overtimeTimeouts: 1,
      resetTimeoutsAtHalf: true,
      showTenthsUnderMinute: true,
      maxOvertimes: 9,
    },
  },
  pro: {
    id: 'pro',
    label: 'Pro style',
    description: '15:00 quarters, 10:00 timed overtime, 40/25 play clock.',
    config: {
      formatId: 'pro',
      quarterLengthMs: 15 * MIN,
      overtimeLengthMs: 10 * MIN,
      playClockSeconds: 40,
      playClockShortSeconds: 25,
      timeoutsPerHalf: 3,
      overtimeTimeouts: 2,
      resetTimeoutsAtHalf: true,
      showTenthsUnderMinute: true,
      maxOvertimes: 2,
    },
  },
  youth: {
    id: 'youth',
    label: 'Youth',
    description: '10:00 quarters, untimed overtime, 25-second play clock.',
    config: {
      formatId: 'youth',
      quarterLengthMs: 10 * MIN,
      overtimeLengthMs: null,
      playClockSeconds: 25,
      playClockShortSeconds: 25,
      timeoutsPerHalf: 3,
      overtimeTimeouts: 1,
      resetTimeoutsAtHalf: true,
      showTenthsUnderMinute: false,
      maxOvertimes: 9,
    },
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    description: 'Start from high-school rules and adjust anything.',
    config: {
      formatId: 'custom',
      quarterLengthMs: 12 * MIN,
      overtimeLengthMs: null,
      playClockSeconds: 40,
      playClockShortSeconds: 25,
      timeoutsPerHalf: 3,
      overtimeTimeouts: 1,
      resetTimeoutsAtHalf: true,
      showTenthsUnderMinute: true,
      maxOvertimes: 9,
    },
  },
};

export function defaultGameConfig(formatId: FootballFormatId = 'nfhs'): GameConfig {
  return { ...FOOTBALL_FORMATS[formatId].config };
}
