export const SIZE = 96,
  DAY = 12000,
  HOUR = 500,
  TPS = 20;
export type Resource =
  | 'wood'
  | 'steel'
  | 'components'
  | 'raw'
  | 'meal'
  | 'ration'
  | 'medicine'
  | 'stone'
  | 'silver';
export type BuildingKind =
  | 'wall'
  | 'door'
  | 'bed'
  | 'table'
  | 'chair'
  | 'stove'
  | 'campfire'
  | 'workbench'
  | 'research'
  | 'medical'
  | 'generator'
  | 'wire'
  | 'lamp'
  | 'cooler'
  | 'solar'
  | 'battery'
  | 'sandbag'
  | 'beacon';
export type Work =
  | 'doctor'
  | 'grow'
  | 'cook'
  | 'build'
  | 'cut'
  | 'mine'
  | 'haul'
  | 'craft'
  | 'research';
export type JobKind = Work | 'eat' | 'sleep' | 'relax' | 'move' | 'attack' | 'rescue';
export interface Item {
  id: number;
  x: number;
  y: number;
  kind: Resource;
  count: number;
  age: number;
  reserved: number;
}
export interface Nature {
  id: number;
  x: number;
  y: number;
  kind: 'tree' | 'ore' | 'berry' | 'rock';
  amount: number;
  marked: boolean;
}
export interface Building {
  id: number;
  x: number;
  y: number;
  kind: BuildingKind;
  progress: number;
  paid: boolean;
  delivered: Partial<Record<Resource, number>>;
  hp: number;
  powered: boolean;
  enabled: boolean;
  energy: number;
  demolish: boolean;
}
export interface Crop {
  x: number;
  y: number;
  growth: number;
  crop: 'grain' | 'herb';
  reserved: number;
}
export interface Wound {
  part: number;
  damage: number;
  tended: boolean;
}
export interface Job {
  kind: JobKind;
  target: number;
  x: number;
  y: number;
  path: number[];
  progress: number;
  total: number;
  resource?: Resource;
  amount?: number;
  item?: number;
  stage?: number;
  pickups?: { id: number; amount: number }[];
  stationary?: boolean;
}
export interface Pawn {
  id: number;
  name: string;
  role: string;
  color: number;
  x: number;
  y: number;
  enemy: boolean;
  animal: boolean;
  food: number;
  rest: number;
  joy: number;
  mood: number;
  blood: number;
  wounds: Wound[];
  dead: boolean;
  downed: boolean;
  drafted: boolean;
  weapon: 'gun' | 'knife';
  cooldown: number;
  job: Job | null;
  carry: { kind: Resource; count: number } | null;
  skills: Record<Work, number>;
  priorities: Record<Work, number>;
  schedule: 'balanced' | 'night' | 'work';
  thoughts: { text: string; value: number; expires: number }[];
  lowMood: number;
  breakUntil: number;
  protectionUntil: number;
  waitUntil: number;
  reason: string;
}
export interface Log {
  id: number;
  tick: number;
  text: string;
  type: 'info' | 'good' | 'danger';
  x?: number;
  y?: number;
}
export interface Stats {
  harvested: number;
  cooked: number;
  built: number;
  hauled: number;
  tended: number;
  kills: number;
  raids: number;
  mealsEaten: number;
}
export interface World {
  version: 1;
  seed: number;
  rng: number;
  tick: number;
  nextId: number;
  revision: number;
  terrain: Uint8Array;
  zones: Uint8Array;
  fertility: Uint8Array;
  nature: Nature[];
  items: Item[];
  buildings: Building[];
  crops: Crop[];
  pawns: Pawn[];
  logs: Log[];
  stats: Stats;
  research: Record<string, number>;
  researchTarget: string;
  mealTarget: number;
  nextRaid: number;
  nextWeather: number;
  weather: 'clear' | 'rain' | 'cold';
  weatherUntil: number;
  beaconTicks: number;
  beaconActive: boolean;
  finalWaves: number;
  outcome: 'playing' | 'won' | 'lost';
  continueAfterWin: boolean;
  lastHurt: number;
  autoPause: boolean;
  tutorialHidden: boolean;
  difficulty: number;
  power: { generated: number; demand: number; stored: number };
}
export type Command =
  | { type: 'build'; kind: BuildingKind; x: number; y: number }
  | { type: 'zone'; zone: number; x: number; y: number; x2: number; y2: number }
  | {
      type: 'mark';
      x: number;
      y: number;
      x2: number;
      y2: number;
      mode: 'cut' | 'mine' | 'harvest' | 'cancel' | 'demolish';
    }
  | { type: 'draft'; ids: number[]; value: boolean }
  | { type: 'move'; ids: number[]; x: number; y: number }
  | { type: 'priority'; id: number; work: Work; value: number }
  | { type: 'schedule'; id: number; value: Pawn['schedule'] }
  | { type: 'research'; target: string }
  | { type: 'mealTarget'; value: number }
  | { type: 'beacon' | 'continue' | 'tutorial' }
  | { type: 'autoPause'; value: boolean }
  | { type: 'toggle'; id: number };
export interface Result {
  ok: boolean;
  reason: string;
}
export interface Summary {
  tick: number;
  revision: number;
  pawns: Pawn[];
  inventory: Record<Resource, number>;
  available: Record<Resource, number>;
  logs: Log[];
  stats: Stats;
  research: Record<string, number>;
  researchTarget: string;
  mealTarget: number;
  buildings: Building[];
  weather: World['weather'];
  temperature: number;
  beaconTicks: number;
  beaconActive: boolean;
  outcome: World['outcome'];
  continueAfterWin: boolean;
  autoPause: boolean;
  tutorialHidden: boolean;
  nextRaid: number;
  gridBytes: number;
  entityCount: number;
  cropCount: number;
  power: { generated: number; demand: number; stored: number };
}
export interface SaveData extends Omit<World, 'terrain' | 'zones' | 'fertility'> {
  terrain: number[];
  zones: number[];
  fertility: number[];
}
