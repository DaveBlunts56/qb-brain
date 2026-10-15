import { Rng } from "../math/rng";
import { clamp } from "../math/vec";
import type { DefSlot, KickerProfile, OffSlot, PlayerProfile, Position, Ratings, Team, TeamColors } from "./types";

/**
 * Original fictional teams. Names, colors and players are invented for Pocket Gridiron.
 * Phase 1 ships four teams; the league phase expands this to 32.
 */
interface TeamSeed {
  id: string;
  city: string;
  name: string;
  abbr: string;
  colors: TeamColors;
  offense: number;
  defense: number;
  seed: number;
}

const TEAM_SEEDS: TeamSeed[] = [
  { id: "gulls", city: "Harbor City", name: "Gulls", abbr: "HCG", offense: 80, defense: 74, seed: 11,
    colors: { primary: 0x1b8a8c, secondary: 0xf4f1de, accent: 0xf28c28, helmet: 0xe9ecef } },
  { id: "rattlers", city: "Mesa", name: "Rattlers", abbr: "MSA", offense: 74, defense: 81, seed: 23,
    colors: { primary: 0x8c1c2b, secondary: 0xf2d8a7, accent: 0x3b2418, helmet: 0x8c1c2b } },
  { id: "yetis", city: "Glacier Peak", name: "Yetis", abbr: "GPY", offense: 77, defense: 77, seed: 37,
    colors: { primary: 0x2e4a9e, secondary: 0xffffff, accent: 0x9fd3ff, helmet: 0xd9e6ff } },
  { id: "foxes", city: "Redwood", name: "Foxes", abbr: "RWF", offense: 83, defense: 70, seed: 41,
    colors: { primary: 0xd2551e, secondary: 0x1f1a17, accent: 0xf6e7c8, helmet: 0x1f1a17 } },
];

const FIRST = ["Andre", "Ben", "Cal", "Dante", "Eli", "Felix", "Gabe", "Hank", "Isaiah", "Jace", "Kofi", "Luis",
  "Marcus", "Nate", "Omar", "Pete", "Quinn", "Rashad", "Sam", "Theo", "Uriah", "Vic", "Wes", "Xavier", "Yusuf", "Zeke",
  "Abel", "Brock", "Cyrus", "Deon", "Emmett", "Jalen", "Kai", "Malik", "Reid", "Tavon"];
const LAST = ["Abara", "Brooks", "Castellano", "Dorsey", "Ekwueme", "Fairbanks", "Greer", "Holloway", "Ibarra",
  "Jansen", "Kowalski", "Lockett", "Mbeki", "Navarro", "Okafor", "Pruitt", "Quarles", "Ridley", "Sorensen", "Tolliver",
  "Underwood", "Vasquez", "Whitfield", "Yancey", "Zamora", "Achebe", "Barrows", "Colfax", "Delacroix", "Ellery",
  "Fontaine", "Gallo", "Haddix", "Ingram", "Juarez", "Kincaid"];

/** Position templates: typical ratings for an average (70 overall) starter. */
const TEMPLATES: Record<Position, Ratings> = {
  QB: r({ speed: 62, acceleration: 66, agility: 64, strength: 55, awareness: 74, catching: 40, routeRunning: 20,
    throwPower: 82, throwAccuracy: 78, passBlock: 20, passRush: 10, manCoverage: 10, zoneCoverage: 10, tackling: 30, elusiveness: 55 }),
  OL: r({ speed: 42, acceleration: 55, agility: 45, strength: 82, awareness: 68, catching: 20, routeRunning: 10,
    throwPower: 10, throwAccuracy: 10, passBlock: 76, passRush: 30, manCoverage: 10, zoneCoverage: 10, tackling: 45, elusiveness: 20 }),
  WR: r({ speed: 86, acceleration: 84, agility: 82, strength: 52, awareness: 68, catching: 78, routeRunning: 76,
    throwPower: 20, throwAccuracy: 15, passBlock: 35, passRush: 10, manCoverage: 20, zoneCoverage: 20, tackling: 35, elusiveness: 72 }),
  TE: r({ speed: 74, acceleration: 72, agility: 66, strength: 72, awareness: 70, catching: 74, routeRunning: 66,
    throwPower: 15, throwAccuracy: 10, passBlock: 60, passRush: 20, manCoverage: 15, zoneCoverage: 15, tackling: 45, elusiveness: 58 }),
  RB: r({ speed: 84, acceleration: 86, agility: 84, strength: 64, awareness: 66, catching: 66, routeRunning: 56,
    throwPower: 20, throwAccuracy: 15, passBlock: 52, passRush: 15, manCoverage: 15, zoneCoverage: 15, tackling: 38, elusiveness: 80 }),
  DL: r({ speed: 58, acceleration: 68, agility: 56, strength: 82, awareness: 66, catching: 25, routeRunning: 10,
    throwPower: 10, throwAccuracy: 10, passBlock: 30, passRush: 74, manCoverage: 20, zoneCoverage: 25, tackling: 74, elusiveness: 30 }),
  LB: r({ speed: 76, acceleration: 76, agility: 70, strength: 70, awareness: 72, catching: 48, routeRunning: 10,
    throwPower: 10, throwAccuracy: 10, passBlock: 30, passRush: 62, manCoverage: 60, zoneCoverage: 70, tackling: 78, elusiveness: 40 }),
  CB: r({ speed: 87, acceleration: 86, agility: 84, strength: 52, awareness: 70, catching: 58, routeRunning: 10,
    throwPower: 10, throwAccuracy: 10, passBlock: 20, passRush: 35, manCoverage: 76, zoneCoverage: 72, tackling: 62, elusiveness: 50 }),
  S: r({ speed: 83, acceleration: 80, agility: 76, strength: 62, awareness: 74, catching: 56, routeRunning: 10,
    throwPower: 10, throwAccuracy: 10, passBlock: 20, passRush: 45, manCoverage: 66, zoneCoverage: 76, tackling: 72, elusiveness: 45 }),
};

function r(x: Ratings): Ratings {
  return x;
}

const OFF_POSITIONS: Record<OffSlot, Position> = { QB: "QB", OL1: "OL", OL2: "OL", X: "WR", H: "WR", Y: "TE", Z: "WR", RB: "RB" };
const DEF_POSITIONS: Record<DefSlot, Position> = { DL1: "DL", DL2: "DL", LB: "LB", CB1: "CB", CB2: "CB", SS: "S", FS: "S" };
const NUMBER_RANGES: Record<Position, [number, number]> = {
  QB: [1, 19], OL: [60, 79], WR: [10, 19], TE: [80, 89], RB: [20, 39], DL: [90, 99], LB: [40, 59], CB: [20, 39], S: [20, 49],
};

function makePlayer(rng: Rng, teamId: string, slot: string, position: Position, unit: number, used: Set<number>, names: Set<string>): PlayerProfile {
  const base = TEMPLATES[position];
  const shift = unit - 70; // team strength moves the whole template
  const individual = rng.range(-5, 5); // each player is a little better or worse
  const ratings = {} as Ratings;
  for (const key of Object.keys(base) as (keyof Ratings)[]) {
    const jitter = rng.range(-4, 4);
    // Ratings that don't matter for the position stay low so they can't be exploited.
    const relevant = base[key] >= 40;
    const v = relevant ? base[key] + shift * 0.8 + individual + jitter : base[key] + jitter * 0.5;
    ratings[key] = Math.round(clamp(v, 5, 99));
  }
  const [lo, hi] = NUMBER_RANGES[position];
  let num = rng.int(lo, hi);
  for (let i = 0; i < 50 && used.has(num); i++) num = rng.int(lo, hi);
  used.add(num);
  let name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  for (let i = 0; i < 20 && names.has(name); i++) name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  names.add(name);
  return { id: `${teamId}-${slot}`, name, number: num, position, ratings };
}

function makeKicker(rng: Rng, unit: number, names: Set<string>, used: Set<number>): KickerProfile {
  let num = rng.int(1, 9);
  for (let i = 0; i < 20 && used.has(num); i++) num = rng.int(1, 9);
  used.add(num);
  let name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  for (let i = 0; i < 20 && names.has(name); i++) name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
  names.add(name);
  return { name, number: num, power: Math.round(clamp(unit + rng.range(-6, 10), 50, 99)), accuracy: Math.round(clamp(unit + rng.range(-6, 10), 50, 99)) };
}

export function buildTeam(seed: TeamSeed): Team {
  const rng = new Rng(seed.seed * 7919);
  const used = new Set<number>();
  const names = new Set<string>();
  const offense = {} as Record<OffSlot, PlayerProfile>;
  for (const slot of Object.keys(OFF_POSITIONS) as OffSlot[]) {
    offense[slot] = makePlayer(rng, seed.id, slot, OFF_POSITIONS[slot], seed.offense, used, names);
  }
  const defense = {} as Record<DefSlot, PlayerProfile>;
  for (const slot of Object.keys(DEF_POSITIONS) as DefSlot[]) {
    defense[slot] = makePlayer(rng, seed.id, slot, DEF_POSITIONS[slot], seed.defense, used, names);
  }
  const kicker = makeKicker(rng, (seed.offense + seed.defense) / 2, names, used);
  const punter = makeKicker(rng, (seed.offense + seed.defense) / 2, names, used);
  return { id: seed.id, city: seed.city, name: seed.name, abbr: seed.abbr, colors: seed.colors,
    offenseRating: seed.offense, defenseRating: seed.defense, offense, defense, kicker, punter };
}

export const TEAMS: readonly Team[] = TEAM_SEEDS.map(buildTeam);

export function getTeam(id: string): Team {
  return TEAMS.find((t) => t.id === id) ?? TEAMS[0];
}

/** Returns a copy of a team with every rating shifted (difficulty tuning for the CPU side). */
export function adjustTeam(team: Team, delta: number): Team {
  if (delta === 0) return team;
  const shiftPlayer = (p: PlayerProfile): PlayerProfile => {
    const ratings = { ...p.ratings };
    for (const k of Object.keys(ratings) as (keyof Ratings)[]) {
      if (ratings[k] >= 40) ratings[k] = Math.round(clamp(ratings[k] + delta, 5, 99));
    }
    return { ...p, ratings };
  };
  const offense = Object.fromEntries(Object.entries(team.offense).map(([k, p]) => [k, shiftPlayer(p)])) as Record<OffSlot, PlayerProfile>;
  const defense = Object.fromEntries(Object.entries(team.defense).map(([k, p]) => [k, shiftPlayer(p)])) as Record<DefSlot, PlayerProfile>;
  return { ...team, offense, defense, offenseRating: team.offenseRating + delta, defenseRating: team.defenseRating + delta };
}
