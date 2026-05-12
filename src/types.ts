export type StatKey =
  | 'hp'
  | 'attack'
  | 'defense'
  | 'specialAttack'
  | 'specialDefense'
  | 'speed';

export type MoveCategory = 'Physical' | 'Special' | 'Status';
export type Weather = 'clear' | 'sun' | 'rain' | 'sand' | 'snow';
export type Terrain = 'none' | 'electric' | 'grassy' | 'misty' | 'psychic';
export type StatusCondition = 'healthy' | 'burn' | 'poison' | 'toxic' | 'paralysis' | 'sleep' | 'freeze';
export type BattleTab = 'team-builder' | 'damage-lab' | 'pokedex' | 'ai-builder' | 'analyzer' | 'simulator' | 'profile';
export type BattleFormat = 'Singles' | 'Doubles';
export type UsageLabel = 'OU' | 'UU' | 'RU' | 'NU';
export type LayoutMode = 'Auto' | 'Stretch' | 'Focus';

export interface StatBlock {
  hp: number;
  attack: number;
  defense: number;
  specialAttack: number;
  specialDefense: number;
  speed: number;
}

export interface PokemonMove {
  id: string;
  name: string;
  type: string;
  category: MoveCategory;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  effectChance: number | null;
  description: string;
}

export interface AbilityEntry {
  name: string;
  description: string;
}

export interface PokemonEntry {
  id: string;
  displayName: string;
  dexNumber: number;
  types: string[];
  classification: string;
  height: string;
  weight: string;
  sprite: string;
  shinySprite: string;
  isMega: boolean;
  abilities: AbilityEntry[];
  baseStats: StatBlock;
  neutralRanges: Record<StatKey, string>;
  movePool: PokemonMove[];
  damageTaken: Record<string, number>;
  speciesSlug: string;
  baseSpecies: string;
  megaStone: string | null;
}

export interface ItemEntry {
  id: string;
  name: string;
  effect: string;
  location: string;
  category: string;
}

export interface UpdatedMoveEntry {
  name: string;
  champions: {
    type: string;
    pp: number;
    power: number | null;
    accuracy: number | null;
    effectChance: number;
  };
  scarletViolet: {
    type: string;
    pp: number;
    power: number | null;
    accuracy: number | null;
    effectChance: number;
  };
  description: string;
}

export interface ChampionsDataset {
  generatedAt: string;
  sourcePages: string[];
  mechanics: {
    releaseDate: string;
    battleLevel: number;
    ivPolicy: string;
    trainingCosts: Record<string, string>;
    notes: string[];
  };
  pokemon: PokemonEntry[];
  moves: PokemonMove[];
  items: ItemEntry[];
  updatedMoves: UpdatedMoveEntry[];
}

export interface NatureEntry {
  id: string;
  name: string;
  plus: StatKey | null;
  minus: StatKey | null;
}

export interface PokemonBuild {
  id: string;
  pokemonId: string | null;
  nickname: string;
  natureId: string;
  itemId: string | null;
  abilityName: string | null;
  moveIds: string[];
  evs: StatBlock;
  useMega: boolean;
  currentHpPercent: number;
  status: StatusCondition;
  attackStage: number;
  defenseStage: number;
  specialAttackStage: number;
  specialDefenseStage: number;
  speedStage: number;
  accuracyStage: number;
  evasionStage: number;
  notes: string;
}

export interface Team {
  id: string;
  name: string;
  format: BattleFormat;
  notes: string;
  slots: PokemonBuild[];
  createdAt: string;
  updatedAt: string;
}

export interface SimulatorMatchRecord {
  id: string;
  playedAt: string;
  format: BattleFormat;
  teamName: string;
  result: 'Win' | 'Loss';
  turns: number;
  opponentPreview: string[];
  starPokemon: string | null;
  topPerformers: string[];
  announcerEnabled: boolean;
  timerEnabled: boolean;
  battleLog: string[];
  turnReviews: SimulatorTurnReview[];
}

export interface SimulatorTurnReview {
  turn: number;
  pokemon: string;
  chosenAction: string;
  betterAction: string | null;
  outcomeDelta: string;
}

export interface Profile {
  trainerName: string;
  favoriteFormat: BattleFormat;
  playerNote: string;
  offMetaBias: number;
  layoutMode: LayoutMode;
  resizablePanels: boolean;
  matchHistory: SimulatorMatchRecord[];
}

export interface EnvironmentState {
  weather: Weather;
  terrain: Terrain;
  criticalHit: boolean;
  reflect: boolean;
  lightScreen: boolean;
  defenderProtectedByBerry: boolean;
}

export interface DamageResult {
  move: PokemonMove;
  appliedType: string;
  minDamage: number;
  maxDamage: number;
  averageDamage: number;
  minPercent: number;
  maxPercent: number;
  averagePercent: number;
  attackStat: number;
  defenseStat: number;
  stab: number;
  effectiveness: number;
  hitSummary: string;
  koSummary: string;
  rollRange: number[];
  modifierSummary: string[];
  koChances: {
    oneHit: number;
    twoHit: number;
    threeHit: number;
  };
  notes: string[];
}

export interface ThreatReport {
  pokemonId: string;
  name: string;
  score: number;
  reason: string;
  previewCue: string;
  counterplay: string[];
  bringPlan: string;
}

export interface UsageInsight {
  label: UsageLabel;
  reason: string;
  source: string;
}

export interface TeamAnalysis {
  format: BattleFormat;
  synergyScore: number;
  estimatedWinRate: number;
  estimatedWinRateLow: number;
  estimatedWinRateHigh: number;
  survivabilityScore: number;
  survivabilityGrade: string;
  survivabilityTurns: number;
  winRateSummary: string;
  survivabilitySummary: string;
  metricNotes: string[];
  overview: string;
  strengths: string[];
  weaknesses: string[];
  threats: ThreatReport[];
  recommendations: string[];
  balanceHints: string[];
  coverageHighlights: string[];
  formatNotes: string[];
  previewPlans: string[];
  archetypeSuggestions: string[];
  easyTargets: string[];
  teamUsage: UsageInsight;
}

export interface GeneratedTeamPlan {
  id: string;
  name: string;
  format: BattleFormat;
  archetype: string;
  planTag: string;
  summary: string;
  reasons: string[];
  expertNotes: string[];
  favoritePokemon: string | null;
  megaPokemonId: string | null;
  megaReason: string;
  slots: PokemonBuild[];
  analysis: TeamAnalysis;
}

export interface AppState {
  profile: Profile;
  teams: Team[];
  activeTeamId: string;
}
