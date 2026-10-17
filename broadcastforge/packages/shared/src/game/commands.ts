import { z } from 'zod';
import { GRAPHIC_KINDS } from './events.js';
import { LIMITS } from './types.js';

const team = z.enum(['home', 'away']);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB colour');
const int = (min: number, max: number) => z.number().int().min(min).max(max);

export const teamPatchSchema = z
  .object({
    name: z.string().trim().max(LIMITS.maxTeamNameLength),
    mascot: z.string().trim().max(LIMITS.maxTeamNameLength),
    abbreviation: z.string().trim().max(LIMITS.maxAbbrLength),
    record: z.string().trim().max(16),
    primaryColor: hexColor,
    secondaryColor: hexColor,
    textColor: hexColor,
    logoAssetId: z.string().max(64).nullable(),
  })
  .partial()
  .strict();

export const ballSpotSchema = z.object({
  side: team.nullable(),
  yardLine: int(1, 50),
});

export const gameConfigPatchSchema = z
  .object({
    formatId: z.enum(['nfhs', 'college', 'pro', 'youth', 'custom']),
    quarterLengthMs: int(60_000, 30 * 60_000),
    overtimeLengthMs: int(60_000, 30 * 60_000).nullable(),
    playClockSeconds: int(5, 99),
    playClockShortSeconds: int(5, 99),
    timeoutsPerHalf: int(0, LIMITS.maxTimeouts),
    overtimeTimeouts: int(0, LIMITS.maxTimeouts),
    resetTimeoutsAtHalf: z.boolean(),
    showTenthsUnderMinute: z.boolean(),
    maxOvertimes: int(1, 9),
  })
  .partial()
  .strict();

const clockId = z.enum(['game', 'play']);

export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('score.add'), team, delta: int(-LIMITS.maxScore, LIMITS.maxScore) }),
  z.object({ type: z.literal('score.set'), team, value: int(0, LIMITS.maxScore) }),
  z.object({ type: z.literal('team.update'), team, patch: teamPatchSchema }),
  z.object({ type: z.literal('team.swap') }),
  z.object({ type: z.literal('timeouts.set'), team, value: int(0, LIMITS.maxTimeouts) }),
  z.object({ type: z.literal('timeouts.adjust'), team, delta: int(-LIMITS.maxTimeouts, LIMITS.maxTimeouts) }),
  z.object({ type: z.literal('timeout.call'), team }),
  z.object({ type: z.literal('period.set'), period: z.string().max(8) }),
  z.object({ type: z.literal('period.step'), direction: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ type: z.literal('clock.start'), clock: clockId }),
  z.object({ type: z.literal('clock.pause'), clock: clockId }),
  z.object({ type: z.literal('clock.toggle'), clock: clockId }),
  z.object({ type: z.literal('clock.set'), clock: clockId, ms: int(0, LIMITS.maxClockMs) }),
  z.object({ type: z.literal('clock.adjust'), clock: clockId, deltaMs: int(-LIMITS.maxClockMs, LIMITS.maxClockMs) }),
  z.object({ type: z.literal('clock.reset'), clock: clockId, seconds: int(1, 99).optional(), autoStart: z.boolean().optional() }),
  z.object({ type: z.literal('clock.expire'), clock: clockId }),
  z.object({ type: z.literal('playClock.visibility'), visible: z.boolean() }),
  z.object({
    type: z.literal('situation.set'),
    down: int(1, 4).nullable().optional(),
    distance: int(0, LIMITS.maxDistance).nullable().optional(),
    goalToGo: z.boolean().optional(),
    ballOn: ballSpotSchema.nullable().optional(),
  }),
  z.object({ type: z.literal('down.next') }),
  z.object({ type: z.literal('firstDown') }),
  z.object({ type: z.literal('situation.visibility'), visible: z.boolean() }),
  z.object({ type: z.literal('possession.set'), team: team.nullable() }),
  z.object({ type: z.literal('possession.toggle') }),
  z.object({ type: z.literal('flag.set'), on: z.boolean() }),
  z.object({ type: z.literal('overlay.visibility'), visible: z.boolean() }),
  z.object({ type: z.literal('label.set'), key: z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/), value: z.string().max(LIMITS.maxLabelLength) }),
  z.object({ type: z.literal('config.update'), patch: gameConfigPatchSchema }),
  z.object({
    type: z.literal('graphic.trigger'),
    graphic: z.enum(GRAPHIC_KINDS),
    team: team.nullable().optional(),
    text: z.string().max(LIMITS.maxLabelLength).optional(),
  }),
  z.object({ type: z.literal('graphics.clear') }),
  z.object({ type: z.literal('game.reset'), keepTeams: z.boolean() }),
  z.object({ type: z.literal('undo') }),
]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
export type GameCommandType = GameCommand['type'];
export type CommandOf<T extends GameCommandType> = Extract<GameCommand, { type: T }>;

/** Commands only the server may issue (clients sending these are rejected). */
export const SYSTEM_ONLY_COMMANDS: ReadonlySet<GameCommandType> = new Set(['clock.expire']);

export function parseCommand(input: unknown): { ok: true; command: GameCommand } | { ok: false; error: string } {
  const result = gameCommandSchema.safeParse(input);
  if (result.success) return { ok: true, command: result.data };
  const issue = result.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join('.') || 'command'}: ${issue.message}` : 'Invalid command' };
}
