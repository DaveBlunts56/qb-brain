import type { FieldBinding } from './types.js';
import type { TeamSide } from '../game/types.js';

export type FieldKind = 'number' | 'text' | 'image' | 'color' | 'boolean';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  group: 'Home' | 'Away' | 'Clock' | 'Situation' | 'Graphics' | 'Labels';
}

const teamFields = (side: TeamSide): FieldDef[] => {
  const g = side === 'home' ? 'Home' : 'Away';
  const T = side === 'home' ? 'Home' : 'Away';
  return [
    { key: `${side}.score`, label: `${T} score`, kind: 'number', group: g },
    { key: `${side}.name`, label: `${T} school name`, kind: 'text', group: g },
    { key: `${side}.mascot`, label: `${T} mascot`, kind: 'text', group: g },
    { key: `${side}.fullName`, label: `${T} full name`, kind: 'text', group: g },
    { key: `${side}.abbreviation`, label: `${T} abbreviation`, kind: 'text', group: g },
    { key: `${side}.record`, label: `${T} record`, kind: 'text', group: g },
    { key: `${side}.logo`, label: `${T} logo`, kind: 'image', group: g },
    { key: `${side}.primaryColor`, label: `${T} primary colour`, kind: 'color', group: g },
    { key: `${side}.secondaryColor`, label: `${T} secondary colour`, kind: 'color', group: g },
    { key: `${side}.textColor`, label: `${T} text colour`, kind: 'color', group: g },
    { key: `${side}.timeouts`, label: `${T} timeouts`, kind: 'number', group: g },
    { key: `${side}.hasPossession`, label: `${T} has possession`, kind: 'boolean', group: g },
  ];
};

export const FIELD_DEFS: FieldDef[] = [
  ...teamFields('home'),
  ...teamFields('away'),
  { key: 'gameClock', label: 'Game clock', kind: 'text', group: 'Clock' },
  { key: 'gameClockVisible', label: 'Game clock shown', kind: 'boolean', group: 'Clock' },
  { key: 'gameClockRunning', label: 'Game clock running', kind: 'boolean', group: 'Clock' },
  { key: 'playClock', label: 'Play clock', kind: 'text', group: 'Clock' },
  { key: 'playClockVisible', label: 'Play clock shown', kind: 'boolean', group: 'Clock' },
  { key: 'period', label: 'Quarter / period', kind: 'text', group: 'Clock' },
  { key: 'down', label: 'Down (1ST)', kind: 'text', group: 'Situation' },
  { key: 'distance', label: 'Yards to gain', kind: 'text', group: 'Situation' },
  { key: 'downDistance', label: 'Down & distance (3RD & 6)', kind: 'text', group: 'Situation' },
  { key: 'ballOn', label: 'Ball on (IRW 34)', kind: 'text', group: 'Situation' },
  { key: 'showSituation', label: 'Down & distance shown', kind: 'boolean', group: 'Situation' },
  { key: 'flag', label: 'Flag on the play', kind: 'boolean', group: 'Situation' },
  { key: 'event.title', label: 'Graphic title (TOUCHDOWN…)', kind: 'text', group: 'Graphics' },
  { key: 'event.text', label: 'Graphic custom text', kind: 'text', group: 'Graphics' },
  { key: 'event.team.name', label: 'Graphic team name', kind: 'text', group: 'Graphics' },
  { key: 'event.team.fullName', label: 'Graphic team full name', kind: 'text', group: 'Graphics' },
  { key: 'event.team.abbreviation', label: 'Graphic team abbreviation', kind: 'text', group: 'Graphics' },
  { key: 'event.team.logo', label: 'Graphic team logo', kind: 'image', group: 'Graphics' },
  { key: 'event.team.score', label: 'Graphic team score', kind: 'number', group: 'Graphics' },
  { key: 'event.team.primaryColor', label: 'Graphic team colour', kind: 'color', group: 'Graphics' },
  { key: 'label.title', label: 'Label: title', kind: 'text', group: 'Labels' },
  { key: 'label.subtitle', label: 'Label: subtitle', kind: 'text', group: 'Labels' },
];

export const FIELD_MAP: Record<string, FieldDef> = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f]));

export function fieldDef(key: string): FieldDef | undefined {
  if (FIELD_MAP[key]) return FIELD_MAP[key];
  if (key.startsWith('label.')) return { key, label: `Label: ${key.slice(6)}`, kind: 'text', group: 'Labels' };
  return undefined;
}

export const FIELD_ROLES = [
  'homeScore',
  'awayScore',
  'homeAbbr',
  'awayAbbr',
  'homeName',
  'awayName',
  'homeLogo',
  'awayLogo',
  'homePanel',
  'awayPanel',
  'homeRecord',
  'awayRecord',
  'homeTimeout',
  'awayTimeout',
  'homePossession',
  'awayPossession',
  'gameClock',
  'playClock',
  'period',
  'down',
  'distance',
  'downDistance',
  'ballOn',
  'flag',
  'label',
  'eventTitle',
  'eventTeamName',
  'eventTeamLogo',
  'eventPanel',
] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export type RoleCategory = 'Teams' | 'Clock' | 'Situation' | 'Indicators' | 'Graphics';

export interface RoleDef {
  id: FieldRole;
  label: string;
  category: RoleCategory;
  team?: TeamSide;
  /** What kind of element best represents this role. */
  element: 'text' | 'image' | 'shape';
  description: string;
  /** Default bindings when the role is assigned. `index` is for repeated roles (timeout pips). */
  bindings: (index?: number) => FieldBinding[];
  /** Sample content for previews and for new placeholder text. */
  sample: string;
  repeatable?: boolean;
}

const text = (field: string): FieldBinding[] => [{ field, target: 'text' }];

function teamRoles(side: TeamSide): RoleDef[] {
  const T = side === 'home' ? 'Home' : 'Away';
  return [
    { id: `${side}Score` as FieldRole, label: `${T} score`, category: 'Teams', team: side, element: 'text', description: 'Animated score digits.', bindings: () => text(`${side}.score`), sample: side === 'home' ? '21' : '17' },
    { id: `${side}Abbr` as FieldRole, label: `${T} abbreviation`, category: 'Teams', team: side, element: 'text', description: '3–4 letter team code.', bindings: () => text(`${side}.abbreviation`), sample: side === 'home' ? 'IRW' : 'BAY' },
    { id: `${side}Name` as FieldRole, label: `${T} name`, category: 'Teams', team: side, element: 'text', description: 'School or team name.', bindings: () => text(`${side}.name`), sample: side === 'home' ? 'IRONWOOD' : 'BAYVIEW' },
    { id: `${side}Logo` as FieldRole, label: `${T} logo`, category: 'Teams', team: side, element: 'image', description: 'Team logo image.', bindings: () => [{ field: `${side}.logo`, target: 'image' }], sample: '' },
    { id: `${side}Panel` as FieldRole, label: `${T} team colour`, category: 'Teams', team: side, element: 'shape', description: 'Panel filled with the team colour.', bindings: () => [{ field: `${side}.primaryColor`, target: 'fill' }], sample: '' },
    { id: `${side}Record` as FieldRole, label: `${T} record`, category: 'Teams', team: side, element: 'text', description: 'Win-loss record or optional label.', bindings: () => text(`${side}.record`), sample: '7-1' },
    {
      id: `${side}Timeout` as FieldRole,
      label: `${T} timeout indicator`,
      category: 'Indicators',
      team: side,
      element: 'shape',
      description: 'One pip per timeout; dims when used.',
      bindings: (index = 1) => [{ field: `${side}.timeouts`, target: 'visible', index, mode: 'dim', dimOpacity: 0.2 }],
      sample: '',
      repeatable: true,
    },
    {
      id: `${side}Possession` as FieldRole,
      label: `${T} possession`,
      category: 'Indicators',
      team: side,
      element: 'shape',
      description: 'Shown when this team has the ball.',
      bindings: () => [{ field: `${side}.hasPossession`, target: 'visible', mode: 'hide' }],
      sample: '',
    },
  ];
}

export const ROLE_DEFS: RoleDef[] = [
  ...teamRoles('away'),
  ...teamRoles('home'),
  { id: 'gameClock', label: 'Game clock', category: 'Clock', element: 'text', description: 'Server-synchronised game clock.', bindings: () => [{ field: 'gameClock', target: 'text' }, { field: 'gameClockVisible', target: 'visible', mode: 'hide' }], sample: '7:42' },
  { id: 'playClock', label: 'Play clock', category: 'Clock', element: 'text', description: '40/25 second play clock.', bindings: () => [{ field: 'playClock', target: 'text' }, { field: 'playClockVisible', target: 'visible', mode: 'hide' }], sample: '25' },
  { id: 'period', label: 'Quarter / period', category: 'Clock', element: 'text', description: '1ST–4TH, HALF, OT, FINAL.', bindings: () => text('period'), sample: '3RD' },
  { id: 'down', label: 'Down', category: 'Situation', element: 'text', description: '1ST–4TH.', bindings: () => [...text('down'), { field: 'showSituation', target: 'visible', mode: 'hide' }], sample: '3RD' },
  { id: 'distance', label: 'Yards to gain', category: 'Situation', element: 'text', description: 'Distance, GOAL or INCHES.', bindings: () => [...text('distance'), { field: 'showSituation', target: 'visible', mode: 'hide' }], sample: '6' },
  { id: 'downDistance', label: 'Down & distance', category: 'Situation', element: 'text', description: '"3RD & 6" in one field.', bindings: () => [...text('downDistance'), { field: 'showSituation', target: 'visible', mode: 'hide' }], sample: '3RD & 6' },
  { id: 'ballOn', label: 'Ball location', category: 'Situation', element: 'text', description: 'Team abbreviation and yard line.', bindings: () => [...text('ballOn'), { field: 'showSituation', target: 'visible', mode: 'hide' }], sample: 'BAY 34' },
  { id: 'flag', label: 'Penalty flag', category: 'Indicators', element: 'shape', description: 'Yellow FLAG panel shown while a flag is on.', bindings: () => [{ field: 'flag', target: 'visible', mode: 'hide' }], sample: 'FLAG' },
  { id: 'label', label: 'Custom label', category: 'Teams', element: 'text', description: 'Operator-editable text (title, sponsor, rivalry name).', bindings: () => text('label.title'), sample: 'HOMECOMING', repeatable: true },
  { id: 'eventTitle', label: 'Graphic title', category: 'Graphics', element: 'text', description: 'TOUCHDOWN / FIELD GOAL / custom text.', bindings: () => text('event.title'), sample: 'TOUCHDOWN' },
  { id: 'eventTeamName', label: 'Graphic team name', category: 'Graphics', element: 'text', description: 'Name of the team in the graphic.', bindings: () => text('event.team.fullName'), sample: 'IRONWOOD FOXES' },
  { id: 'eventTeamLogo', label: 'Graphic team logo', category: 'Graphics', element: 'image', description: 'Logo of the team in the graphic.', bindings: () => [{ field: 'event.team.logo', target: 'image' }], sample: '' },
  { id: 'eventPanel', label: 'Graphic team colour', category: 'Graphics', element: 'shape', description: 'Panel in the graphic team colour.', bindings: () => [{ field: 'event.team.primaryColor', target: 'fill' }], sample: '' },
];

export const ROLE_MAP: Record<FieldRole, RoleDef> = Object.fromEntries(ROLE_DEFS.map((r) => [r.id, r])) as Record<FieldRole, RoleDef>;

export function roleTeam(role: FieldRole | null): TeamSide | null {
  if (!role) return null;
  if (role.startsWith('home')) return 'home';
  if (role.startsWith('away')) return 'away';
  return null;
}
