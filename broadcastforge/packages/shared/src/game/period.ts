import type { GameConfig, PeriodId } from './types.js';

const PERIOD_RE = /^(PRE|Q[1-4]|HALF|OT[1-9]|FINAL)$/;

export function isValidPeriod(period: string, config?: GameConfig): boolean {
  if (!PERIOD_RE.test(period)) return false;
  if (config && period.startsWith('OT')) return Number(period.slice(2)) <= config.maxOvertimes;
  return true;
}

export function periodOrder(config: GameConfig): PeriodId[] {
  const order: PeriodId[] = ['PRE', 'Q1', 'Q2', 'HALF', 'Q3', 'Q4'];
  for (let i = 1; i <= config.maxOvertimes; i++) order.push(`OT${i}`);
  order.push('FINAL');
  return order;
}

export function periodIndex(period: PeriodId, config: GameConfig): number {
  return periodOrder(config).indexOf(period);
}

export function stepPeriod(period: PeriodId, direction: 1 | -1, config: GameConfig): PeriodId {
  const order = periodOrder(config);
  const i = order.indexOf(period);
  if (i < 0) return 'PRE';
  const next = Math.min(order.length - 1, Math.max(0, i + direction));
  return order[next]!;
}

export function isOvertime(period: PeriodId): boolean {
  return period.startsWith('OT');
}

export function isTimedPeriod(period: PeriodId, config: GameConfig): boolean {
  if (/^Q[1-4]$/.test(period)) return true;
  if (isOvertime(period)) return config.overtimeLengthMs !== null;
  return false;
}

/** Clock length for a period. PRE shows a full quarter so the bug looks right before kickoff. */
export function periodLengthMs(period: PeriodId, config: GameConfig): number {
  if (period === 'PRE' || /^Q[1-4]$/.test(period)) return config.quarterLengthMs;
  if (isOvertime(period)) return config.overtimeLengthMs ?? 0;
  return 0;
}

export function periodLabel(period: PeriodId): string {
  switch (period) {
    case 'PRE':
      return 'PRE';
    case 'Q1':
      return '1ST';
    case 'Q2':
      return '2ND';
    case 'HALF':
      return 'HALF';
    case 'Q3':
      return '3RD';
    case 'Q4':
      return '4TH';
    case 'FINAL':
      return 'FINAL';
    default: {
      if (isOvertime(period)) {
        const n = Number(period.slice(2));
        return n === 1 ? 'OT' : `${n}OT`;
      }
      return period;
    }
  }
}

/** Whether the game clock should be shown at all in this period. */
export function periodShowsClock(period: PeriodId, config: GameConfig): boolean {
  return period === 'PRE' || isTimedPeriod(period, config);
}
