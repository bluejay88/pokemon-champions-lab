import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  applyEffortValue,
  battleFormats,
  bestAttackingStat,
  buildLabel,
  buildStats,
  createDefaultState,
  createTeam,
  dataset,
  defaultEnvironment,
  displaySpriteForPokemon,
  fillEffortSpreadRemainder,
  findMegaForm,
  findMegaStoneItem,
  fixedIvValue,
  getItemById,
  getNatureById,
  getNinetalesBiasLabel,
  getPokemonById,
  maxEffortValue,
  makeId,
  natures,
  normalizeBuildForChampions,
  normalizeEffortSpread,
  normalizeMoveSelection,
  remainingEffortPoints,
  resolvePokemonForm,
  sanitizeTeamForChampions,
  selectedPokemon,
  stageMultiplier,
  statLabels,
  statOrder,
  statusOptions,
  terrainOptions,
  totalEffortBudget,
  totalEffortPoints,
  usesMegaSpriteFallback,
  weatherOptions,
} from './lib/champions';
import { battleMusicTracks } from './lib/battleMusic';
import { clearState, listStoredProfiles, loadState, saveState } from './lib/storage';
import type {
  BattleFormat,
  BattleMusicMode,
  BattleTab,
  EnvironmentState,
  GeneratedTeamPlan,
  LayoutMode,
  OnlineBattleAccount,
  OnlineBattleRoomHistoryEntry,
  OnlinePresenceStats,
  PokemonBuild,
  PokemonEntry,
  PokemonMove,
  SimulatorMatchRecord,
  SimulatorTurnReview,
  TeamAnalysis,
  Team,
  UsageInsight,
} from './types';
import type { SimSide, SimUnit, SimulatorBattleState, SimulatorChoice } from './lib/simulator';
import type { OnlineBattleRoomView } from './lib/online';
type AiRuntimeModule = typeof import('./lib/ai');
type UsageRuntimeModule = typeof import('./lib/usage');
type DamageRuntimeModule = typeof import('./lib/damage');
type MoveParityRuntimeModule = typeof import('./lib/moveParity');
type AbilityParityRuntimeModule = typeof import('./lib/abilityParity');
type SimulatorRuntimeModule = typeof import('./lib/simulator');
type OnlineRuntimeModule = typeof import('./lib/online');
type DamageResult = ReturnType<DamageRuntimeModule['calculateDamage']>;
type MoveParitySummary = ReturnType<MoveParityRuntimeModule['buildMoveParitySummary']>;
type MoveParityEntry = ReturnType<MoveParityRuntimeModule['moveParityForMove']>;
type AbilityParitySummary = ReturnType<AbilityParityRuntimeModule['buildAbilityParitySummary']>;
type PokemonInputValidation = ReturnType<AiRuntimeModule['validateLockedPokemonInput']>;

type BattleCoreRuntime = {
  damage: DamageRuntimeModule;
  moveParity: MoveParityRuntimeModule;
  abilityParity: AbilityParityRuntimeModule;
  simulator: SimulatorRuntimeModule;
};

type TeamIntelRuntime = {
  ai: AiRuntimeModule;
  usage: UsageRuntimeModule;
};

type SimulatorPreviewState = {
  format: BattleFormat;
  opponentTeam: Team;
  previewEndsAt: number;
};

type ChoiceDraft = {
  type: 'move' | 'mega' | 'switch';
  moveId: string;
  target: number;
  switchTarget: number;
};

type AnnouncerStyle = 'Arena' | 'Championship' | 'Analyst';

type StatusBadgeTone = 'burn' | 'freeze' | 'paralysis' | 'poison' | 'sleep' | 'toxic';
type StatusBadge = {
  label: string;
  tone: StatusBadgeTone;
  title: string;
};
type BattleTag = {
  key: string;
  label: string;
  tone: 'neutral' | 'positive' | 'negative' | 'warning';
  title: string;
};
type BattlefieldBackdrop = {
  id: string;
  label: string;
  flavor: string;
  image: string;
  pixelated?: boolean;
};
type BattlefieldPlaybackEvent = {
  id: string;
  tone: 'impact' | 'guard' | 'switch' | 'ko' | 'status' | 'field' | 'ability';
  message: string;
  actorName?: string | null;
  targetName?: string | null;
  moveName?: string | null;
};
type BattlefieldSlotModel = {
  key: string;
  pokemon: PokemonEntry | null;
  title: string;
  subtitle: string;
  types?: string[];
  statusBadge?: StatusBadge | null;
  battleTags?: BattleTag[];
  hidden?: boolean;
  hpPercent?: number | null;
  hpLabel?: string | null;
  fainted?: boolean;
};
type BattlefieldConditionSection = {
  label: string;
  tags: BattleTag[];
};

let battleCoreRuntimeCache: BattleCoreRuntime | null = null;
let battleCoreRuntimePromise: Promise<BattleCoreRuntime> | null = null;
let teamIntelRuntimeCache: TeamIntelRuntime | null = null;
let teamIntelRuntimePromise: Promise<TeamIntelRuntime> | null = null;
let onlineRuntimeCache: OnlineRuntimeModule | null = null;
let onlineRuntimePromise: Promise<OnlineRuntimeModule> | null = null;

const ONLINE_SESSION_STORAGE_KEY = 'pokemon-champions-lab-online-session';
const LOCAL_PRESENCE_STORAGE_KEY = 'pokemon-champions-lab-presence-v1';
const ACTIVE_PRESENCE_WINDOW_MS = 90_000;
const NETLIFY_FUNCTION_ENDPOINT = '/.netlify/functions/arena';
const fallbackUsageInsight: UsageInsight = {
  label: 'UU',
  reason: 'Usage insight is still loading for this surface.',
  source: 'Deferred runtime',
};

const fallbackArchetypes = [
  { id: 'stadium-balance', name: 'Stadium Balance' },
  { id: 'rain-circuit', name: 'Rain Circuit' },
  { id: 'sun-circuit', name: 'Sun Circuit' },
  { id: 'sand-bunker', name: 'Sand Bunker' },
  { id: 'snow-glacier', name: 'Snow Glacier' },
  { id: 'deep-cut', name: 'Deep Cut' },
];

const emptyMoveParitySummary: MoveParitySummary = {
  total: dataset.moves.length,
  explicit: 0,
  rulesAware: 0,
  damageCore: 0,
  reviewNeeded: dataset.moves.length,
  coveredPercent: 0,
  topReviewMoves: [],
};

const emptyAbilityParitySummary: AbilityParitySummary = {
  total: dataset.pokemon.length,
  explicit: 0,
  damageCore: 0,
  reviewNeeded: dataset.pokemon.length,
  coveredPercent: 0,
  topReviewAbilities: [],
};

const emptyTeamAnalysis = (format: BattleFormat): TeamAnalysis => ({
  format,
  synergyScore: 0,
  estimatedWinRate: 0,
  estimatedWinRateLow: 0,
  estimatedWinRateHigh: 0,
  survivabilityScore: 0,
  survivabilityGrade: '--',
  survivabilityTurns: 0,
  winRateSummary: 'Win-rate modeling is still loading for this team.',
  survivabilitySummary: 'Survivability modeling is still loading for this team.',
  metricNotes: ['Team analysis is deferred until the intelligence runtime loads.'],
  overview: 'The team analysis runtime is still loading.',
  strengths: [],
  weaknesses: [],
  threats: [],
  recommendations: [],
  balanceHints: [],
  coverageHighlights: [],
  formatNotes: [],
  previewPlans: [],
  archetypeSuggestions: [],
  easyTargets: [],
  teamUsage: fallbackUsageInsight,
});

function hasBattleCoreRuntime() {
  return battleCoreRuntimeCache !== null;
}

async function ensureBattleCoreRuntime() {
  if (battleCoreRuntimeCache) {
    return battleCoreRuntimeCache;
  }

  battleCoreRuntimePromise ??= Promise.all([
    import('./lib/damage'),
    import('./lib/moveParity'),
    import('./lib/abilityParity'),
    import('./lib/simulator'),
  ]).then(([damage, moveParity, abilityParity, simulator]) => {
    battleCoreRuntimeCache = { damage, moveParity, abilityParity, simulator };
    return battleCoreRuntimeCache;
  });

  return battleCoreRuntimePromise;
}

function hasTeamIntelRuntime() {
  return teamIntelRuntimeCache !== null;
}

async function ensureTeamIntelRuntime() {
  if (teamIntelRuntimeCache) {
    return teamIntelRuntimeCache;
  }

  teamIntelRuntimePromise ??= Promise.all([
    import('./lib/ai'),
    import('./lib/usage'),
  ]).then(([ai, usage]) => {
    teamIntelRuntimeCache = { ai, usage };
    return teamIntelRuntimeCache;
  });

  return teamIntelRuntimePromise;
}

function hasOnlineRuntime() {
  return onlineRuntimeCache !== null;
}

async function ensureOnlineRuntime() {
  if (onlineRuntimeCache) {
    return onlineRuntimeCache;
  }

  onlineRuntimePromise ??= import('./lib/online').then((runtime) => {
    onlineRuntimeCache = runtime;
    return runtime;
  });

  return onlineRuntimePromise;
}

function ensureOnlineSessionId() {
  if (typeof window === 'undefined') {
    return makeId('session');
  }

  const existing = window.localStorage.getItem(ONLINE_SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = makeId('session');
  window.localStorage.setItem(ONLINE_SESSION_STORAGE_KEY, created);
  return created;
}

function fallbackLegalMovesForUnit(unit: SimUnit) {
  return normalizeMoveSelection(unit.build, unit.pokemon)
    .map((moveId) => unit.pokemon.movePool.find((move) => move.id === moveId))
    .filter((move): move is PokemonMove => Boolean(move));
}

function calculateDamage(attacker: PokemonBuild, defender: PokemonBuild, move: PokemonMove, environment: EnvironmentState): DamageResult {
  return battleCoreRuntimeCache?.damage.calculateDamage(attacker, defender, move, environment) ?? null;
}

function summaryForResult(result: DamageResult) {
  if (!battleCoreRuntimeCache) {
    return 'Loading battle math...';
  }

  return battleCoreRuntimeCache.damage.summaryForResult(result);
}

function moveParityForMove(move: PokemonMove): MoveParityEntry {
  return battleCoreRuntimeCache?.moveParity.moveParityForMove(move) ?? {
    moveId: move.id,
    moveName: move.name,
    tier: 'Review Needed',
    summary: 'Move parity details are still loading for this report.',
    tags: ['loading'],
  };
}

function buildMoveParitySummary(moves: PokemonMove[]): MoveParitySummary {
  return battleCoreRuntimeCache?.moveParity.buildMoveParitySummary(moves) ?? emptyMoveParitySummary;
}

function buildAbilityParitySummary(pokemon: PokemonEntry[]): AbilityParitySummary {
  return battleCoreRuntimeCache?.abilityParity.buildAbilityParitySummary(pokemon) ?? emptyAbilityParitySummary;
}

function pendingReplacementActors(side: SimSide) {
  return battleCoreRuntimeCache?.simulator.pendingReplacementActors(side) ?? side.active.flatMap((unitIndex, activeSlot) => {
    const unit = typeof unitIndex === 'number' && unitIndex >= 0 ? side.units[unitIndex] ?? null : null;
    return !unit || unit.fainted ? [activeSlot] : [];
  });
}

function battleHasPendingReplacements(state: SimulatorBattleState) {
  return battleCoreRuntimeCache?.simulator.battleHasPendingReplacements(state) ?? (
    pendingReplacementActors(state.player).length > 0 || pendingReplacementActors(state.opponent).length > 0
  );
}

function legalMovesForUnit(unit: SimUnit, state?: SimulatorBattleState, sideId?: 'player' | 'opponent') {
  return battleCoreRuntimeCache?.simulator.legalMovesForUnit(unit, state, sideId) ?? fallbackLegalMovesForUnit(unit);
}

function createSimulatorBattle(...args: Parameters<SimulatorRuntimeModule['createSimulatorBattle']>) {
  if (!battleCoreRuntimeCache) {
    throw new Error('Battle runtime is still loading.');
  }

  return battleCoreRuntimeCache.simulator.createSimulatorBattle(...args);
}

function advancePreviewToBattle(...args: Parameters<SimulatorRuntimeModule['advancePreviewToBattle']>) {
  if (!battleCoreRuntimeCache) {
    throw new Error('Battle runtime is still loading.');
  }

  return battleCoreRuntimeCache.simulator.advancePreviewToBattle(...args);
}

function applyReplacementChoices(...args: Parameters<SimulatorRuntimeModule['applyReplacementChoices']>) {
  if (!battleCoreRuntimeCache) {
    throw new Error('Battle runtime is still loading.');
  }

  return battleCoreRuntimeCache.simulator.applyReplacementChoices(...args);
}

function buildAutoReplacementChoices(...args: Parameters<SimulatorRuntimeModule['buildAutoReplacementChoices']>) {
  if (!battleCoreRuntimeCache) {
    return [] as SimulatorChoice[];
  }

  return battleCoreRuntimeCache.simulator.buildAutoReplacementChoices(...args);
}

function resolveTurn(...args: Parameters<SimulatorRuntimeModule['resolveTurn']>) {
  if (!battleCoreRuntimeCache) {
    throw new Error('Battle runtime is still loading.');
  }

  return battleCoreRuntimeCache.simulator.resolveTurn(...args);
}

function usageInsightWithReason(reason: string): UsageInsight {
  return {
    ...fallbackUsageInsight,
    reason,
  };
}

function getMoveUsageInsight(...args: Parameters<UsageRuntimeModule['getMoveUsageInsight']>) {
  return teamIntelRuntimeCache?.usage.getMoveUsageInsight(...args) ?? usageInsightWithReason('Move usage reads are still loading for this view.');
}

function getPokemonUsageInsight(...args: Parameters<UsageRuntimeModule['getPokemonUsageInsight']>) {
  return teamIntelRuntimeCache?.usage.getPokemonUsageInsight(...args) ?? usageInsightWithReason('Pokemon usage reads are still loading for this view.');
}

function getPopularPresetPatch(...args: Parameters<UsageRuntimeModule['getPopularPresetPatch']>) {
  return teamIntelRuntimeCache?.usage.getPopularPresetPatch(...args) ?? null;
}

function getPopularPresetSummary(...args: Parameters<UsageRuntimeModule['getPopularPresetSummary']>) {
  return teamIntelRuntimeCache?.usage.getPopularPresetSummary(...args) ?? null;
}

function recommendMoveIds(...args: Parameters<AiRuntimeModule['recommendMoveIds']>) {
  if (teamIntelRuntimeCache) {
    return teamIntelRuntimeCache.ai.recommendMoveIds(...args);
  }

  const [pokemon] = args;
  return pokemon.movePool.slice(0, 4).map((move) => move.id);
}

function validateLockedPokemonInput(...args: Parameters<AiRuntimeModule['validateLockedPokemonInput']>): PokemonInputValidation {
  if (teamIntelRuntimeCache) {
    return teamIntelRuntimeCache.ai.validateLockedPokemonInput(...args);
  }

  const [input] = args;
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const roster = dataset.pokemon.filter((pokemon) => !pokemon.isMega);
  const matchedPokemon = roster.find((pokemon) => {
    const names = [pokemon.displayName, pokemon.baseSpecies]
      .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    return names.includes(normalized);
  }) ?? null;
  const suggestions = normalized
    ? roster
      .filter((pokemon) => {
        const name = pokemon.displayName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const base = pokemon.baseSpecies.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        return name.includes(normalized) || base.includes(normalized);
      })
      .slice(0, 3)
      .map((pokemon) => ({
        pokemon,
        reason: 'Suggested from the current Champions roster while the full AI validation runtime loads.',
        usageLabel: getPokemonUsageInsight(pokemon, args[1]).label,
      }))
    : [];

  return {
    input,
    normalizedInput: normalized,
    isValid: Boolean(matchedPokemon),
    matchedPokemon,
    autoReplacement: matchedPokemon,
    message: matchedPokemon
      ? `${matchedPokemon.displayName} is available in the live Champions roster.`
      : 'Full roster validation is still loading. Try again in a moment for smarter role-based replacements.',
    suggestions,
  };
}

function validateLockedPokemonInputs(...args: Parameters<AiRuntimeModule['validateLockedPokemonInputs']>) {
  if (teamIntelRuntimeCache) {
    return teamIntelRuntimeCache.ai.validateLockedPokemonInputs(...args);
  }

  const [inputs, format] = args;
  return inputs.map((input) => validateLockedPokemonInput(input, format));
}

function describeBuildRole(...args: Parameters<AiRuntimeModule['describeBuildRole']>) {
  return teamIntelRuntimeCache?.ai.describeBuildRole(...args) ?? 'Role loading';
}

function suggestArchetypesForCore(...args: Parameters<AiRuntimeModule['suggestArchetypesForCore']>) {
  return teamIntelRuntimeCache?.ai.suggestArchetypesForCore(...args) ?? fallbackArchetypes.map((entry) => entry.name).slice(0, 3);
}

function analyzeTeam(...args: Parameters<AiRuntimeModule['analyzeTeam']>) {
  return teamIntelRuntimeCache?.ai.analyzeTeam(...args) ?? emptyTeamAnalysis(args[0].format);
}

function generateTeamPlans(...args: Parameters<AiRuntimeModule['generateTeamPlans']>) {
  return teamIntelRuntimeCache?.ai.generateTeamPlans(...args) ?? [];
}

function activeArchetypeOptions() {
  return teamIntelRuntimeCache?.ai.archetypeLibrary ?? fallbackArchetypes;
}

function localHeartbeatPresence(sessionId: string): OnlinePresenceStats {
  if (typeof window === 'undefined') {
    return { activeUsers: 1, totalVisits: 1, activeBattles: 0 };
  }

  const now = new Date().toISOString();
  const raw = window.localStorage.getItem(LOCAL_PRESENCE_STORAGE_KEY);
  const store = raw
    ? JSON.parse(raw) as { totalVisits: number; sessions: Record<string, string> }
    : { totalVisits: 0, sessions: {} as Record<string, string> };

  if (!store.sessions[sessionId]) {
    store.totalVisits += 1;
  }
  store.sessions[sessionId] = now;

  for (const [storedSessionId, lastSeen] of Object.entries(store.sessions)) {
    if (Date.now() - new Date(lastSeen).getTime() > ACTIVE_PRESENCE_WINDOW_MS) {
      delete store.sessions[storedSessionId];
    }
  }

  window.localStorage.setItem(LOCAL_PRESENCE_STORAGE_KEY, JSON.stringify(store));
  return {
    activeUsers: Object.keys(store.sessions).length,
    totalVisits: store.totalVisits,
    activeBattles: 0,
  };
}

async function heartbeatPresence(sessionId: string) {
  try {
    const response = await fetch(NETLIFY_FUNCTION_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'heartbeat', sessionId }),
    });
    if (!response.ok) {
      throw new Error(`Presence request failed with ${response.status}`);
    }
    const payload = await response.json() as { stats?: OnlinePresenceStats; remoteUnavailable?: boolean };
    if (!payload.stats || payload.remoteUnavailable) {
      throw new Error('Remote presence unavailable.');
    }
    return payload.stats;
  } catch {
    return localHeartbeatPresence(sessionId);
  }
}

async function fetchOnlineRoom(...args: Parameters<OnlineRuntimeModule['fetchOnlineRoom']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.fetchOnlineRoom(...args);
}

async function fetchOnlineRoomHistory(...args: Parameters<OnlineRuntimeModule['fetchOnlineRoomHistory']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.fetchOnlineRoomHistory(...args);
}

async function registerOnlineAccount(...args: Parameters<OnlineRuntimeModule['registerOnlineAccount']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.registerOnlineAccount(...args);
}

async function loginOnlineAccount(...args: Parameters<OnlineRuntimeModule['loginOnlineAccount']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.loginOnlineAccount(...args);
}

async function createOnlineRoom(...args: Parameters<OnlineRuntimeModule['createOnlineRoom']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.createOnlineRoom(...args);
}

async function joinOnlineRoom(...args: Parameters<OnlineRuntimeModule['joinOnlineRoom']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.joinOnlineRoom(...args);
}

async function submitOnlineBringOrder(...args: Parameters<OnlineRuntimeModule['submitOnlineBringOrder']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.submitOnlineBringOrder(...args);
}

async function submitOnlineChoices(...args: Parameters<OnlineRuntimeModule['submitOnlineChoices']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.submitOnlineChoices(...args);
}

async function forfeitOnlineRoom(...args: Parameters<OnlineRuntimeModule['forfeitOnlineRoom']>) {
  const runtime = await ensureOnlineRuntime();
  return runtime.forfeitOnlineRoom(...args);
}

const appTabs: { id: BattleTab; label: string; short: string; description: string }[] = [
  { id: 'team-builder', label: 'Team Builder', short: 'Build', description: 'Craft, label, and save up to ten squads.' },
  { id: 'damage-lab', label: 'Damage Lab', short: 'Calc', description: 'Run both-way damage lines with items and Mega toggles.' },
  { id: 'pokedex', label: 'Champions Dex', short: 'Dex', description: 'Browse move pools, abilities, items, and Mega data.' },
  { id: 'ai-builder', label: 'AI Builder', short: 'AI', description: 'Generate meta, anti-meta, and random team plans around your core.' },
  { id: 'analyzer', label: 'Analyzer', short: 'Scan', description: 'Surface survivability, threats, roles, and bring-four ideas.' },
  { id: 'simulator', label: 'Simulator', short: 'Sim', description: 'Preview matchups, pick four, and play a live battle sandbox.' },
  { id: 'pvp-battles', label: 'PvP Battles', short: 'PvP', description: 'Register, share a 6-digit code, and battle another live player with timers and reveal rules.' },
  { id: 'profile', label: 'Profile', short: 'Save', description: 'Manage your trainer profile and local save data.' },
];

const brandPokemonIcons = ['Bellibolt', 'Jolteon', 'Sableye', 'Gengar', 'Mega Alakazam', 'Mega Clefable', 'Garchomp'];
const layoutModes: LayoutMode[] = ['Auto', 'Stretch', 'Focus'];
const pokemonTypeOptions = ['Any', ...[...new Set(dataset.pokemon.flatMap((pokemon) => pokemon.types))].sort()];
const battlefieldBackdrops: BattlefieldBackdrop[] = [
  {
    id: 'retro-grass',
    label: 'Retro Grass',
    flavor: 'A compact throwback lane that feels like an old-school challenge cup.',
    image: '/battle-backgrounds/pokemon battle image 1.png',
    pixelated: true,
  },
  {
    id: 'cave-clash',
    label: 'Cave Clash',
    flavor: 'A rocky chamber built for bruisers, pivots, and weather wars.',
    image: '/battle-backgrounds/pokemon battle image 2.png',
  },
  {
    id: 'celestial-ring',
    label: 'Celestial Ring',
    flavor: 'A bright arena floor under a star-washed sky that suits fast offensive games.',
    image: '/battle-backgrounds/pokemon battle image 3.png',
  },
  {
    id: 'neon-stadium',
    label: 'Neon Stadium',
    flavor: 'A big-match stadium look for ranked sets, replays, and showcase battles.',
    image: '/battle-backgrounds/pokemon battle image 4.png',
  },
  {
    id: 'crystal-depths',
    label: 'Crystal Depths',
    flavor: 'A darker crystal cavern with room for bulky mirrors and trap pressure.',
    image: '/battle-backgrounds/pokemon battle image 5.png',
  },
  {
    id: 'azure-cavern',
    label: 'Azure Cavern',
    flavor: 'A blue stone floor with strong contrast for clean sprite readability.',
    image: '/battle-backgrounds/pokemon battle image 6.png',
  },
];
const simulatorStatusBadges: Record<Exclude<PokemonBuild['status'], 'healthy'>, StatusBadge> = {
  burn: {
    label: 'BRN',
    tone: 'burn',
    title: 'Burned: chip damage each turn and physical damage is reduced unless another effect overrides it.',
  },
  freeze: {
    label: 'FRZ',
    tone: 'freeze',
    title: 'Frozen: per current Champions rules, the user has a 25% thaw chance on each move attempt and always thaws by the third frozen turn.',
  },
  paralysis: {
    label: 'PAR',
    tone: 'paralysis',
    title: 'Paralyzed: per current Champions rules, Speed is halved and there is a 12.5% chance of full paralysis on move attempt.',
  },
  poison: {
    label: 'PSN',
    tone: 'poison',
    title: 'Poisoned: standard end-of-turn poison chip applies unless an immunity or healing effect overrides it.',
  },
  sleep: {
    label: 'SLP',
    tone: 'sleep',
    title: 'Asleep: per current Champions rules, wake checks start on turn 2 of sleep and wake is guaranteed by turn 3.',
  },
  toxic: {
    label: 'TOX',
    tone: 'toxic',
    title: 'Badly Poisoned: escalating poison chip is tracked turn by turn unless an immunity or healing effect overrides it.',
  },
};
const simulatorSupportMoveNames = new Set([
  'Protect',
  'Detect',
  'Wide Guard',
  'Quick Guard',
  'Tailwind',
  'Trick Room',
  'Helping Hand',
  'Follow Me',
  'Rage Powder',
  'Spore',
  'Thunder Wave',
  'Encore',
  'Disable',
  'Fake Out',
  'Icy Wind',
  'Magic Room',
  'Snarl',
  'Sticky Web',
  'Toxic Spikes',
  'Will-O-Wisp',
  'Wonder Room',
  'Reflect',
  'Light Screen',
  'Safeguard',
  'Taunt',
  'Swords Dance',
  'Calm Mind',
  'Nasty Plot',
  'Dragon Dance',
]);
const simulatorLeadMoveNames = new Set([
  'Fake Out',
  'Tailwind',
  'Trick Room',
  'Spore',
  'Follow Me',
  'Rage Powder',
  'Icy Wind',
  'Magic Room',
  'Snarl',
  'Sticky Web',
  'Encore',
  'Taunt',
  'Toxic Spikes',
  'Wonder Room',
]);
const simulatorAutoTargetMoves = new Set([
  'Acid Armor',
  'Agility',
  'Amnesia',
  'Aqua Ring',
  'Aurora Veil',
  'Baneful Bunker',
  'Bulk Up',
  'Calm Mind',
  'Charge',
  'Chilly Reception',
  'Coil',
  'Cosmic Power',
  'Cotton Guard',
  'Defog',
  'Detect',
  'Double Team',
  'Dragon Dance',
  'Electric Terrain',
  'Endure',
  'Grassy Terrain',
  'Gravity',
  'Growth',
  'Haze',
  'Heal Bell',
  'Howl',
  'Ingrain',
  'Iron Defense',
  "King's Shield",
  'Light Screen',
  'Life Dew',
  'Magic Room',
  'Misty Terrain',
  'Nasty Plot',
  'Protect',
  'Psychic Terrain',
  'Quick Guard',
  'Rage Powder',
  'Rain Dance',
  'Reflect',
  'Rest',
  'Safeguard',
  'Sandstorm',
  'Snowscape',
  'Spikes',
  'Stealth Rock',
  'Sticky Web',
  'Struggle',
  'Sunny Day',
  'Swords Dance',
  'Tailwind',
  'Toxic Spikes',
  'Trick Room',
  'Wonder Room',
  'Wide Guard',
]);
const simulatorAllyTargetMoves = new Set(['Coaching', 'Heal Pulse', 'Helping Hand']);

type SimulatorTargetMode = 'foe' | 'ally' | 'auto';

const announcerScripts: Record<
  'preview' | 'turn' | 'switch' | 'hit' | 'super' | 'resist' | 'miss' | 'status' | 'protect' | 'ko' | 'finish' | 'star',
  string[]
> = {
  preview: [
    'Welcome back to Pokemon Champions Lab. Team preview is live and the pressure starts right now.',
    'Six species are on the board, and every choice at preview can decide the next four turns.',
    'This matchup already hints at speed control, positioning, and a very real late-game race.',
    'The crowd is studying the preview screen and searching for the hidden tech.',
    'Viewers can expect a tactical opener with both sides threatening immediate pressure.',
    'Keep an eye on {pokemon}; that could become the hinge point of the whole battle.',
    'That preview shows multiple lines of attack, and neither side can afford a sloppy lead.',
    'The chess match begins before turn one, and the preview is giving us plenty to talk about.',
    'This could become a weather war, a positioning fight, or a clean offensive sprint.',
    'One key question at preview: which four are actually coming to the field?',
    'The matchup grid is loaded with options, and the mind games are already underway.',
    'You can feel the tension building as both sides lock in their bring-four plans.',
  ],
  turn: [
    'Turn {turn} is underway, and both sides are racing the clock.',
    'The move timer is active. Every second matters now.',
    'We are live on turn {turn}, and the next click could swing the entire game.',
    'Decision time on turn {turn}. Positioning, damage, and nerves all matter here.',
    'This is where preparation meets execution on turn {turn}.',
    'The timer is ticking, and both sides need a clean choice right now.',
    'Turn {turn} is loaded with options, but only one line survives contact.',
    'No wasted motions on turn {turn}; this battle is tightening fast.',
    'The field is set, the clock is moving, and turn {turn} demands precision.',
    'A huge turn is developing here, and both sides need to commit.',
  ],
  switch: [
    '{pokemon} hits the field and changes the entire look of the position.',
    'A fresh switch from {pokemon}, and the momentum might be changing hands.',
    '{pokemon} enters with purpose, and the crowd knows this slot matters.',
    'That switch to {pokemon} opens a new line immediately.',
    '{pokemon} takes the stage, and now the matchup shifts.',
    'A key reposition brings in {pokemon}, and that could reshape the turn.',
    '{pokemon} is now on the field, and the battle state just got more complicated.',
    'There is the reveal. {pokemon} is in, and now both sides have to adapt.',
  ],
  hit: [
    '{pokemon} lands {move}, and that is a clean connection.',
    '{pokemon} fires off {move} and puts real pressure on {target}.',
    'Direct hit from {pokemon}. {move} finds its mark.',
    '{move} connects from {pokemon}, and the tempo is rising.',
    '{pokemon} does not miss the moment. {move} lands.',
    'That is a sharp strike from {pokemon}, and {target} felt all of it.',
    '{pokemon} commits to {move}, and the hit comes through.',
    'A well-timed {move} from {pokemon} lands right where it needed to.',
    '{pokemon} converts the turn with a successful {move}.',
    '{move} lands from {pokemon}, and that is meaningful board damage.',
    'The attack is on target, and {pokemon} delivers with {move}.',
    '{pokemon} threads the hit with {move} and keeps the pressure high.',
  ],
  super: [
    'That was super effective, and the damage reflects it.',
    'A brutal type advantage there, and {target} paid for it.',
    'That is exactly the matchup the attacker wanted. Super effective damage!',
    'Massive connection. The typing lined up perfectly for that hit.',
    'Super effective pressure there, and this field just tilted hard.',
    'No doubt about it, that strike landed for premium damage.',
    '{target} could not stomach that hit. The typing was all wrong.',
    'That is a huge swing off type advantage alone.',
    'Super effective damage there, and the crowd is awake now.',
    'A perfect punish. That move found the exact weakness it needed.',
  ],
  resist: [
    '{target} resists the hit and keeps some breathing room.',
    'Not very effective, but the attacker still keeps the pressure on.',
    '{target} absorbs the blow better than expected.',
    'That resistance matters. {target} stays standing with a little extra space.',
    'The damage is tempered by typing, and {target} survives the exchange.',
    '{target} shrugs off part of that hit thanks to the matchup.',
  ],
  miss: [
    '{pokemon} misses with {move}, and that is a costly miss.',
    '{move} does not connect, and the whole turn just changed.',
    'A miss from {pokemon}, and the door swings open.',
    'That attack goes wide, and the crowd reacts instantly.',
    '{pokemon} cannot find the target with {move}.',
    'No damage there. {move} misses at a critical time.',
    'The accuracy check fails, and {pokemon} will hate that one.',
    '{move} misses, and this battle gets another twist.',
  ],
  status: [
    '{target} picks up a status, and that could echo for multiple turns.',
    'A major status lands on {target}, and now the timer really starts.',
    '{target} is under pressure from a fresh status condition.',
    'That status changes the math for every turn after this one.',
    '{source} adds long-term pressure by applying {status}.',
    'A smart utility sequence there, and {target} now has to manage {status}.',
    '{target} is now compromised, and the follow-up lines get much stronger.',
    'Status pressure is online, and that can decide endgames in a hurry.',
  ],
  protect: [
    '{pokemon} shuts the door with a protective line.',
    'Protection comes through, and the attack window closes.',
    '{pokemon} reads the pressure and blocks it out.',
    'That defensive timing from {pokemon} could buy a huge turn.',
    'A clean shield from {pokemon}, and now the pacing changes.',
    '{pokemon} protects successfully and denies the immediate punish.',
  ],
  ko: [
    '{target} goes down to {attacker} using {move}, and that is a massive knockout.',
    'Knockout confirmed. {attacker} wins the exchange decisively with {move}.',
    'That is a KO from {attacker} with {move}, and the battle state just snapped into a new shape.',
    '{target} falls after taking {move}, and the momentum surges toward {attacker}.',
    '{attacker} secures the knockout with {move} and opens the door for the next wave.',
    'A huge removal there. {target} is out of the battle after {move}.',
    'The crowd erupts as {target} drops from the field.',
    'That knockout from {attacker} using {move} will be remembered if this battle stays close.',
    '{attacker} converts pressure into a clean finish with {move}.',
    'One more down, and the numbers game starts to matter.',
  ],
  finish: [
    'The battle is over, and {winner} claims the win.',
    '{winner} closes it out and takes the match in style.',
    'That is your winner: {winner}. A composed finish from start to end.',
    '{winner} seals the result and walks away with the victory.',
    'It is finished. {winner} stands tall when the dust settles.',
    '{winner} wins the battle, and the final sequence was clinical.',
    'That is the closing bell. {winner} takes the set.',
    '{winner} gets the job done and secures the result.',
  ],
  star: [
    'Pokemon of the Game: {pokemon}. That Pokemon delivered when it mattered most.',
    '{pokemon} was the standout performer and earns Pokemon of the Game honors.',
    'Give a spotlight to {pokemon}; that is your Pokemon of the Game.',
    '{pokemon} put in the work and earns player-of-the-game honors.',
    'The effort chart points straight at {pokemon} as the Pokemon of the Game.',
    '{pokemon} was the engine behind the win and deserves the Pokemon of the Game callout.',
  ],
};

function pickLine(lines: string[]) {
  return lines[Math.floor(Math.random() * lines.length)] ?? lines[0] ?? '';
}

function fillAnnouncerLine(template: string, replacements: Record<string, string | number | null | undefined>) {
  return Object.entries(replacements).reduce((line, [key, value]) => line.replaceAll(`{${key}}`, String(value ?? '')), template);
}

function titleCaseFieldLabel(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function weatherFieldLabel(state: SimulatorBattleState) {
  return state.environment.weather === 'clear' || state.weatherTurns <= 0
    ? 'Clear'
    : `${titleCaseFieldLabel(state.environment.weather)} (${state.weatherTurns} turn${state.weatherTurns === 1 ? '' : 's'})`;
}

function matchClockLabel(seconds: number) {
  return `${Math.floor(Math.max(0, seconds) / 60)}:${`${Math.max(0, seconds) % 60}`.padStart(2, '0')}`;
}

function terrainFieldLabel(state: SimulatorBattleState) {
  return state.environment.terrain === 'none' || state.terrainTurns <= 0
    ? 'None'
    : `${titleCaseFieldLabel(state.environment.terrain)} (${state.terrainTurns} turn${state.terrainTurns === 1 ? '' : 's'})`;
}

function conditionTurnLabel(label: string, turns: number) {
  return `${label} ${turns}`;
}

function simulatorGlobalFieldTags(state: SimulatorBattleState) {
  const tags: BattleTag[] = [];
  if (state.environment.weather !== 'clear' && state.weatherTurns > 0) {
    tags.push({
      key: 'weather',
      label: conditionTurnLabel(titleCaseFieldLabel(state.environment.weather), state.weatherTurns),
      tone: 'neutral',
      title: `${titleCaseFieldLabel(state.environment.weather)} is active for ${state.weatherTurns} more turn${state.weatherTurns === 1 ? '' : 's'}.`,
    });
  }
  if (state.environment.terrain !== 'none' && state.terrainTurns > 0) {
    tags.push({
      key: 'terrain',
      label: conditionTurnLabel(titleCaseFieldLabel(state.environment.terrain), state.terrainTurns),
      tone: 'positive',
      title: `${titleCaseFieldLabel(state.environment.terrain)} Terrain is active for ${state.terrainTurns} more turn${state.terrainTurns === 1 ? '' : 's'}.`,
    });
  }
  if (state.trickRoomTurns > 0) {
    tags.push({
      key: 'trick-room',
      label: conditionTurnLabel('Trick Room', state.trickRoomTurns),
      tone: 'warning',
      title: `Trick Room is active for ${state.trickRoomTurns} more turn${state.trickRoomTurns === 1 ? '' : 's'}.`,
    });
  }
  if (state.gravityTurns > 0) {
    tags.push({
      key: 'gravity',
      label: conditionTurnLabel('Gravity', state.gravityTurns),
      tone: 'warning',
      title: `Gravity is active for ${state.gravityTurns} more turn${state.gravityTurns === 1 ? '' : 's'}.`,
    });
  }
  if (state.magicRoomTurns > 0) {
    tags.push({
      key: 'magic-room',
      label: conditionTurnLabel('Magic Room', state.magicRoomTurns),
      tone: 'warning',
      title: `Magic Room is active for ${state.magicRoomTurns} more turn${state.magicRoomTurns === 1 ? '' : 's'}. Held-item effects are suppressed.`,
    });
  }
  if (state.wonderRoomTurns > 0) {
    tags.push({
      key: 'wonder-room',
      label: conditionTurnLabel('Wonder Room', state.wonderRoomTurns),
      tone: 'warning',
      title: `Wonder Room is active for ${state.wonderRoomTurns} more turn${state.wonderRoomTurns === 1 ? '' : 's'}. Defense and Sp. Def are swapped.`,
    });
  }
  return tags;
}

function simulatorSideConditionTags(side: SimSide) {
  const tags: BattleTag[] = [];
  if (side.tailwindTurns > 0) {
    tags.push({
      key: `${side.name}-tailwind`,
      label: conditionTurnLabel('Tailwind', side.tailwindTurns),
      tone: 'positive',
      title: `Tailwind is active for ${side.tailwindTurns} more turn${side.tailwindTurns === 1 ? '' : 's'}.`,
    });
  }
  if (side.reflectTurns > 0) {
    tags.push({
      key: `${side.name}-reflect`,
      label: conditionTurnLabel('Reflect', side.reflectTurns),
      tone: 'positive',
      title: `Reflect is active for ${side.reflectTurns} more turn${side.reflectTurns === 1 ? '' : 's'}.`,
    });
  }
  if (side.lightScreenTurns > 0) {
    tags.push({
      key: `${side.name}-light-screen`,
      label: conditionTurnLabel('Light Screen', side.lightScreenTurns),
      tone: 'positive',
      title: `Light Screen is active for ${side.lightScreenTurns} more turn${side.lightScreenTurns === 1 ? '' : 's'}.`,
    });
  }
  if (side.auroraVeilTurns > 0) {
    tags.push({
      key: `${side.name}-aurora-veil`,
      label: conditionTurnLabel('Aurora Veil', side.auroraVeilTurns),
      tone: 'positive',
      title: `Aurora Veil is active for ${side.auroraVeilTurns} more turn${side.auroraVeilTurns === 1 ? '' : 's'}.`,
    });
  }
  if (side.safeguardTurns > 0) {
    tags.push({
      key: `${side.name}-safeguard`,
      label: conditionTurnLabel('Safeguard', side.safeguardTurns),
      tone: 'neutral',
      title: `Safeguard is active for ${side.safeguardTurns} more turn${side.safeguardTurns === 1 ? '' : 's'}.`,
    });
  }
  if (side.stealthRock) {
    tags.push({
      key: `${side.name}-stealth-rock`,
      label: 'Stealth Rock',
      tone: 'negative',
      title: 'Stealth Rock is active on this side.',
    });
  }
  if (side.spikesLayers > 0) {
    tags.push({
      key: `${side.name}-spikes`,
      label: `Spikes ${side.spikesLayers}`,
      tone: 'negative',
      title: `${side.spikesLayers} Spikes layer${side.spikesLayers === 1 ? '' : 's'} are active on this side.`,
    });
  }
  if (side.toxicSpikesLayers > 0) {
    tags.push({
      key: `${side.name}-toxic-spikes`,
      label: `Toxic Spikes ${side.toxicSpikesLayers}`,
      tone: 'negative',
      title: `${side.toxicSpikesLayers} Toxic Spikes layer${side.toxicSpikesLayers === 1 ? '' : 's'} are active on this side.`,
    });
  }
  if (side.stickyWeb) {
    tags.push({
      key: `${side.name}-sticky-web`,
      label: 'Sticky Web',
      tone: 'negative',
      title: 'Sticky Web is active on this side.',
    });
  }
  return tags;
}

function sleepTimerMeta(unit: SimUnit) {
  if (unit.build.status !== 'sleep') {
    return null;
  }

  if (unit.sleepSource === 'rest') {
    const lockedTurnsRemaining = Math.max(0, 2 - unit.sleepTurns);
    return lockedTurnsRemaining > 0
      ? {
          label: `Rest ${lockedTurnsRemaining} left`,
          title: `Rest sleep is active. ${lockedTurnsRemaining} forced sleep turn${lockedTurnsRemaining === 1 ? '' : 's'} remain before the next wake check.`,
          note: `Rest sleep is active. ${lockedTurnsRemaining} forced sleep turn${lockedTurnsRemaining === 1 ? '' : 's'} remain before this Pokemon can wake.`,
        }
      : {
          label: 'Wake next',
          title: 'Rest sleep has reached its final lock. This Pokemon will wake on its next move attempt.',
          note: 'Rest sleep has reached its final lock. This Pokemon will wake on its next move attempt.',
        };
  }

  if (unit.sleepTurns === 0) {
    return {
      label: 'Sleep locked',
      title: 'First sleep turn: this Pokemon cannot move. The next move attempt has a 33.3% wake chance, and wake is guaranteed on turn 3.',
      note: 'First sleep turn: this Pokemon cannot move. The next move attempt has a 33.3% wake chance, and wake is guaranteed on turn 3.',
    };
  }

  if (unit.sleepTurns === 1) {
    return {
      label: 'Wake 33%',
      title: 'Second sleep turn: the next move attempt has a 33.3% chance to wake. If it fails, wake is guaranteed on turn 3.',
      note: 'Second sleep turn: the next move attempt has a 33.3% chance to wake. If it fails, wake is guaranteed on turn 3.',
    };
  }

  return {
    label: 'Wake next',
    title: 'Sleep has reached its guaranteed wake turn.',
    note: 'Sleep has reached its guaranteed wake turn.',
  };
}

function freezeTimerMeta(unit: SimUnit) {
  if (unit.build.status !== 'freeze') {
    return null;
  }

  const guaranteedTurnsRemaining = Math.max(0, 3 - unit.freezeTurns);
  return guaranteedTurnsRemaining > 1
    ? {
        label: `Thaw <=${guaranteedTurnsRemaining}`,
        title: `Freeze is active. This Pokemon has a 25% thaw chance on each move attempt and is guaranteed to thaw within ${guaranteedTurnsRemaining} more attempt${guaranteedTurnsRemaining === 1 ? '' : 's'}.`,
        note: `Freeze is active. This Pokemon has a 25% thaw chance on each move attempt and is guaranteed to thaw within ${guaranteedTurnsRemaining} more move attempts.`,
      }
    : {
        label: 'Thaw next',
        title: 'Freeze is on its final guaranteed turn. This Pokemon will thaw on its next move attempt if it has not already thawed earlier.',
        note: 'Freeze is on its final guaranteed turn. This Pokemon will thaw on its next move attempt if it has not already thawed earlier.',
      };
}

function copyBuild(build: PokemonBuild): PokemonBuild {
  return {
    ...build,
    evs: { ...build.evs },
    moveIds: [...build.moveIds],
  };
}

function cloneTeam(team: Team): Team {
  return {
    ...team,
    slots: team.slots.map(copyBuild),
  };
}

function activeTeamFromState(state: ReturnType<typeof createDefaultState>) {
  return state.teams.find((team) => team.id === state.activeTeamId) ?? state.teams[0];
}

function pickerLabel(pokemon: PokemonEntry) {
  return `#${String(pokemon.dexNumber).padStart(4, '0')} ${pokemon.displayName}`;
}

function defaultAbilityName(pokemon: PokemonEntry | null) {
  return pokemon?.abilities[0]?.name ?? null;
}

function availableItemsForPokemon(pokemon: PokemonEntry | null) {
  return dataset.items.filter((item) => {
    if (item.category === 'held' || item.category === 'berry') {
      return true;
    }

    if (item.category === 'mega-stone' && pokemon) {
      return item.effect.includes(` ${pokemon.baseSpecies} `) || item.effect.includes(`${pokemon.baseSpecies}.`) || item.effect.includes(`${pokemon.baseSpecies} holding`);
    }

    return false;
  });
}

function describeMegaState(build: PokemonBuild, pokemon: PokemonEntry | null) {
  const megaStone = findMegaStoneItem(pokemon);
  if (!megaStone) {
    return 'No Mega option';
  }

  return build.useMega ? `Mega live via ${megaStone.name}` : `Mega ready via ${megaStone.name}`;
}

function prepareBuildForPokemon(build: PokemonBuild, pokemonId: string | null, format: BattleFormat) {
  const pickedPokemon = getPokemonById(pokemonId);
  const chosenPokemon =
    pickedPokemon?.isMega
      ? dataset.pokemon.find((entry) => entry.baseSpecies === pickedPokemon.baseSpecies && !entry.isMega) ?? pickedPokemon
      : pickedPokemon;
  const nextBuild = copyBuild(build);
  nextBuild.pokemonId = chosenPokemon?.id ?? null;
  nextBuild.useMega = false;
  nextBuild.abilityName = defaultAbilityName(chosenPokemon);
  const presetPriority =
    chosenPokemon && bestAttackingStat(chosenPokemon.baseStats) === 'attack'
      ? (['attack', 'speed', 'hp', 'defense', 'specialDefense', 'specialAttack'] as const)
      : (['specialAttack', 'speed', 'hp', 'defense', 'specialDefense', 'attack'] as const);

  if (nextBuild.itemId && getItemById(nextBuild.itemId)?.category === 'mega-stone') {
    nextBuild.itemId = null;
  }

  const presetPatch = chosenPokemon ? getPopularPresetPatch(pickedPokemon ?? chosenPokemon, format) ?? getPopularPresetPatch(chosenPokemon, format) : null;
  if (presetPatch) {
    nextBuild.abilityName = presetPatch.abilityName ?? nextBuild.abilityName;
    nextBuild.natureId = presetPatch.natureId ?? nextBuild.natureId;
    nextBuild.moveIds = [...(presetPatch.moveIds ?? [])];
    nextBuild.evs = presetPatch.evs ? fillEffortSpreadRemainder(normalizeEffortSpread({ ...presetPatch.evs }), [...presetPriority]) : nextBuild.evs;
    nextBuild.itemId = presetPatch.itemId ?? nextBuild.itemId;
    nextBuild.useMega = Boolean(presetPatch.useMega && chosenPokemon?.megaStone);
  } else {
    nextBuild.moveIds = chosenPokemon ? recommendMoveIds(chosenPokemon, format) : [];
  }

  if (pickedPokemon?.isMega && chosenPokemon) {
    const megaForm = findMegaForm(chosenPokemon) ?? pickedPokemon;
    const megaStone = findMegaStoneItem(chosenPokemon, megaForm);
    nextBuild.useMega = Boolean(megaForm);
    nextBuild.itemId = megaStone?.id ?? nextBuild.itemId;
  }

  return nextBuild;
}

function profileSummary(teamCount: number) {
  return `${teamCount}/10 saved teams`;
}

function isMoveEntry(move: PokemonEntry['movePool'][number] | undefined | null): move is PokemonEntry['movePool'][number] {
  return Boolean(move);
}

function natureBenefitLabel(natureId: string) {
  const nature = getNatureById(natureId);
  if (!nature.plus && !nature.minus) {
    return 'Nature: Neutral';
  }

  const labels: string[] = [];
  if (nature.plus) {
    labels.push(`Plus (+) ${statLabels[nature.plus]}`);
  }
  if (nature.minus) {
    labels.push(`Minus (-) ${statLabels[nature.minus]}`);
  }
  return labels.join(' | ');
}

function effortSpreadLabel(evs: PokemonBuild['evs']) {
  const parts = statOrder
    .map((stat) => (evs[stat] > 0 ? `${statLabels[stat]} ${evs[stat]}` : null))
    .filter((entry): entry is string => Boolean(entry));

  return parts.length ? parts.join(' / ') : 'No EV investment';
}

function buildTeamFromPlan(plan: GeneratedTeamPlan) {
  const team = createTeam(plan.name, plan.format);
  team.name = plan.name;
  team.notes = `${plan.summary}\n\n${plan.reasons.join('\n')}\n\n${plan.expertNotes.join('\n')}`;
  team.slots = plan.slots.map(copyBuild);
  return team;
}

function planSignature(plan: GeneratedTeamPlan | null) {
  if (!plan) {
    return '';
  }

  return plan.slots
    .map((slot) => slot.pokemonId ?? '')
    .filter(Boolean)
    .sort()
    .join('|');
}

function lockedNamesFromValidations(validations: ReturnType<typeof validateLockedPokemonInputs>) {
  return validations
    .map((validation) => {
      if (!validation.input.trim()) {
        return null;
      }
      return validation.isValid
        ? validation.matchedPokemon?.baseSpecies ?? null
        : validation.autoReplacement?.baseSpecies ?? null;
    })
    .filter((name): name is string => Boolean(name));
}

function displayNamesFromValidations(validations: ReturnType<typeof validateLockedPokemonInputs>, fallbackValues: string[]) {
  return validations.map((validation, index) => {
    if (!validation.input.trim()) {
      return '';
    }
    if (validation.isValid) {
      return validation.matchedPokemon?.displayName ?? fallbackValues[index] ?? validation.input.trim();
    }
    return validation.autoReplacement?.displayName ?? fallbackValues[index] ?? validation.input.trim();
  });
}

function randomOpponentTeam(format: BattleFormat, offMetaBias: number) {
  const archetypes = activeArchetypeOptions();
  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)] ?? archetypes[0];
  const plans = generateTeamPlans(archetype.id, format, offMetaBias, [], 6, true);
  const selectedPlan = plans[Math.floor(Math.random() * plans.length)] ?? plans[0];
  if (selectedPlan) {
    return buildTeamFromPlan(selectedPlan);
  }

  const fallbackTeam = createTeam('Fallback Opponent', format);
  fallbackTeam.slots = fallbackTeam.slots.map((slot, index) => {
    const pokemon = dataset.pokemon.filter((entry) => !entry.isMega)[index];
    if (!pokemon) {
      return slot;
    }
    return {
      ...slot,
      pokemonId: pokemon.id,
      moveIds: pokemon.movePool.slice(0, 4).map((move) => move.id),
      abilityName: pokemon.abilities[0]?.name ?? null,
    };
  });
  return fallbackTeam;
}

function usablePokemonForBuild(build: PokemonBuild) {
  return selectedPokemon(build) ?? resolvePokemonForm(build);
}

function filledSlotIndices(team: Team) {
  return team.slots
    .map((slot, index) => (usablePokemonForBuild(slot) ? index : -1))
    .filter((index) => index >= 0);
}

function livingTargetSlots(side: SimulatorBattleState['player']) {
  return side.active
    .map((unitIndex, targetIndex) => ({ unit: side.units[unitIndex], targetIndex }))
    .filter((entry): entry is { unit: SimUnit; targetIndex: number } => Boolean(entry.unit && !entry.unit.fainted));
}

function knownMovesForBuild(build: PokemonBuild, pokemon: PokemonEntry | null) {
  if (!pokemon) {
    return [];
  }

  return build.moveIds.map((moveId) => pokemon.movePool.find((move) => move.id === moveId)).filter(isMoveEntry);
}

function bestAverageDamagePercent(attackerBuild: PokemonBuild, defenderBuild: PokemonBuild) {
  const attacker = resolvePokemonForm(attackerBuild);
  if (!attacker) {
    return 0;
  }

  return knownMovesForBuild(attackerBuild, attacker).reduce((best, move) => {
    const result = calculateDamage(attackerBuild, defenderBuild, move, defaultEnvironment);
    return Math.max(best, result?.averagePercent ?? 0);
  }, 0);
}

function simulatorSupportScore(build: PokemonBuild, pokemon: PokemonEntry | null, format: BattleFormat) {
  const moves = knownMovesForBuild(build, pokemon);
  return moves.reduce((score, move) => {
    let next = score;
    if (simulatorSupportMoveNames.has(move.name)) {
      next += format === 'Doubles' ? 11 : 8;
    }
    if (simulatorLeadMoveNames.has(move.name)) {
      next += format === 'Doubles' ? 8 : 5;
    }
    if (move.category === 'Status') {
      next += 2;
    }
    if (move.name === 'Protect' && format === 'Doubles') {
      next += 4;
    }
    return next;
  }, 0);
}

function chooseOpponentBringOrder(format: BattleFormat, opponentTeam: Team, playerTeam: Team, playerOrder: number[]) {
  const playerBuilds = playerOrder.map((slotIndex) => playerTeam.slots[slotIndex]).filter((build) => Boolean(build?.pokemonId));
  const candidateScores = filledSlotIndices(opponentTeam)
    .map((slotIndex) => {
      const build = opponentTeam.slots[slotIndex];
      const pokemon = resolvePokemonForm(build);
      if (!pokemon) {
        return null;
      }

      const stats = buildStats(pokemon.baseStats, build.evs, build.natureId);
      const speedScore = stats.speed * 0.12;
      const supportScore = simulatorSupportScore(build, pokemon, format);
      const trickRoomLeadBias = knownMovesForBuild(build, pokemon).some((move) => move.name === 'Trick Room')
        ? Math.max(0, 180 - stats.speed) * 0.18
        : 0;
      const offense =
        playerBuilds.reduce((total, defenderBuild) => total + bestAverageDamagePercent(build, defenderBuild), 0) /
        Math.max(1, playerBuilds.length);
      const defense =
        playerBuilds.reduce((total, attackerBuild) => total + Math.max(0, 100 - bestAverageDamagePercent(attackerBuild, build)), 0) /
        Math.max(1, playerBuilds.length);
      const megaBonus = build.useMega || getItemById(build.itemId)?.category === 'mega-stone' ? 12 : 0;
      const totalScore = offense * 0.62 + defense * 0.34 + supportScore + speedScore + megaBonus;
      const leadScore = offense * 0.46 + defense * 0.18 + supportScore * 1.22 + speedScore + trickRoomLeadBias;

      return {
        slotIndex,
        totalScore,
        leadScore,
      };
    })
    .filter((entry): entry is { slotIndex: number; totalScore: number; leadScore: number } => Boolean(entry))
    .sort((left, right) => right.totalScore - left.totalScore);

  const chosen = candidateScores.slice(0, 4);
  if (format === 'Singles') {
    return [...chosen].sort((left, right) => right.leadScore - left.leadScore).map((entry) => entry.slotIndex);
  }

  const openingPair = [...chosen].sort((left, right) => right.leadScore - left.leadScore).slice(0, 2);
  const openingSet = new Set(openingPair.map((entry) => entry.slotIndex));
  const backline = chosen.filter((entry) => !openingSet.has(entry.slotIndex)).sort((left, right) => right.totalScore - left.totalScore);
  return [...openingPair, ...backline].map((entry) => entry.slotIndex);
}

function roleSummary(team: Team) {
  return team.slots
    .map((slot) => {
      const pokemon = resolvePokemonForm(slot);
      if (!pokemon) {
        return null;
      }
      return `${pokemon.displayName}: ${describeBuildRole(slot, team.format)}`;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function teammateItemIds(team: Team, slotIndex: number) {
  return new Set(
    team.slots
      .map((slot, index) => (index !== slotIndex ? slot.itemId : null))
      .filter((itemId): itemId is string => Boolean(itemId)),
  );
}

function simulatorBringSummary(team: Team, format: BattleFormat, bringOrder: number[]) {
  if (!bringOrder.length) {
    return `Pick 4 Pokemon to lock your bring order. In ${format}, the first ${format === 'Doubles' ? 'two selected Pokemon become your leads' : 'selected Pokemon becomes your lead'}.`;
  }

  const names = bringOrder
    .map((slotIndex) => selectedPokemon(team.slots[slotIndex])?.displayName ?? resolvePokemonForm(team.slots[slotIndex])?.displayName ?? `Slot ${slotIndex + 1}`)
    .filter(Boolean);

  if (format === 'Singles') {
    const lead = names[0] ?? 'your lead';
    const backline = names.slice(1);
    return backline.length
      ? `Singles lead: ${lead}. Backline order: ${backline.join(' -> ')}.`
      : `Singles lead: ${lead}. Select ${4 - bringOrder.length} more Pokemon to finish your bring order.`;
  }

  const leads = names.slice(0, 2);
  const backline = names.slice(2);
  if (leads.length < 2) {
    return `Doubles lead slot 1 is ${leads[0] ?? 'open'}. Select one more lead plus ${Math.max(0, 4 - bringOrder.length - 1)} backline Pokemon.`;
  }

  return backline.length
    ? `Doubles leads: ${leads[0]} and ${leads[1]}. Backline order: ${backline.join(' -> ')}.`
    : `Doubles leads: ${leads[0]} and ${leads[1]}. Select ${4 - bringOrder.length} more Pokemon for the backline.`;
}

function simulatorStatusBadge(unit: SimUnit): StatusBadge | null {
  if (unit.build.status === 'healthy') {
    return null;
  }

  const baseBadge = simulatorStatusBadges[unit.build.status];
  const sleepMeta = sleepTimerMeta(unit);
  if (sleepMeta) {
    return { ...baseBadge, title: sleepMeta.title };
  }
  const freezeMeta = freezeTimerMeta(unit);
  if (freezeMeta) {
    return { ...baseBadge, title: freezeMeta.title };
  }
  return baseBadge;
}

function simulatorBattleTags(unit: SimUnit) {
  const tags: BattleTag[] = [];
  const legalMoves = legalMovesForUnit(unit);
  if (unit.rechargeTurns > 0) {
    tags.push({
      key: 'recharge',
      label: 'Recharge',
      tone: 'warning',
      title: `${unit.rechargeMoveName ?? 'The last move'} has locked this Pokemon into a recharge turn.`,
    });
  }
  if (unit.chargingTurns > 0 && unit.chargingMoveName) {
    tags.push({
      key: 'charging',
      label: `${unit.chargingMoveName} Charge`,
      tone: 'warning',
      title: `${unit.chargingMoveName} is charging now and will fire on the next action if this Pokemon is not interrupted.`,
    });
  }
  if (unit.tauntTurns > 0) {
    tags.push({
      key: 'taunt',
      label: `Taunt ${unit.tauntTurns}`,
      tone: 'warning',
      title: 'Status moves are blocked while Taunt is active.',
    });
  }
  if (unit.encoreTurns > 0 && unit.encoreMoveId) {
    const encoreMove = unit.pokemon.movePool.find((move) => move.id === unit.encoreMoveId)?.name ?? 'Locked move';
    tags.push({
      key: 'encore',
      label: `Encore ${unit.encoreTurns}`,
      tone: 'warning',
      title: `Encore is locking this Pokemon into ${encoreMove}.`,
    });
  }
  if (unit.disableTurns > 0 && unit.disabledMoveId) {
    const disabledMove = unit.pokemon.movePool.find((move) => move.id === unit.disabledMoveId)?.name ?? 'a move';
    tags.push({
      key: 'disable',
      label: `Disable ${unit.disableTurns}`,
      tone: 'negative',
      title: `${disabledMove} cannot be selected while Disable is active.`,
    });
  }
  if (unit.yawnTurns > 0) {
    tags.push({
      key: 'yawn',
      label: `Yawn ${unit.yawnTurns}`,
      tone: 'warning',
      title: `Yawn is active. This Pokemon will fall asleep when the countdown reaches zero if it stays in battle and is still healthy.`,
    });
  }
  if (unit.perishSongTurns > 0) {
    tags.push({
      key: 'perish-song',
      label: `Perish ${unit.perishSongTurns}`,
      tone: 'negative',
      title: `Perish Song is active. This Pokemon faints when the count reaches zero unless it switches out first.`,
    });
  }
  if (unit.tormentActive) {
    tags.push({
      key: 'torment',
      label: 'Torment',
      tone: 'warning',
      title: 'Torment is active. This Pokemon cannot select the same move it used last turn until it switches out.',
    });
  }
  if (unit.trappedByMove) {
    tags.push({
      key: 'trapped',
      label: unit.trappedByMove,
      tone: 'negative',
      title: `${unit.trappedByMove} is preventing this Pokemon from switching out right now.`,
    });
  }
  if (unit.saltCure) {
    tags.push({
      key: 'salt-cure',
      label: 'Salt Cure',
      tone: 'negative',
      title: 'Salt Cure chip is active and will continue while this Pokemon remains in battle.',
    });
  }
  if (unit.syrupTurns > 0) {
    tags.push({
      key: 'syrup',
      label: `Syrup ${unit.syrupTurns}`,
      tone: 'warning',
      title: `Syrup Bomb is active for ${unit.syrupTurns} more end step${unit.syrupTurns === 1 ? '' : 's'}.`,
    });
  }
  if (unit.bindingTurns > 0) {
    tags.push({
      key: 'binding',
      label: `Bind ${unit.bindingTurns}`,
      tone: 'negative',
      title: `A binding effect is active for ${unit.bindingTurns} more turn${unit.bindingTurns === 1 ? '' : 's'}.`,
    });
  }
  if (unit.destinyBondActive) {
    tags.push({
      key: 'destiny-bond',
      label: 'Destiny Bond',
      tone: 'warning',
      title: 'If this Pokemon is knocked out by a direct attack before its next move, the attacker will be taken down as well.',
    });
  }
  const sleepMeta = sleepTimerMeta(unit);
  if (sleepMeta) {
    tags.push({
      key: 'sleep-progress',
      label: sleepMeta.label,
      tone: 'warning',
      title: sleepMeta.title,
    });
  }
  const freezeMeta = freezeTimerMeta(unit);
  if (freezeMeta) {
    tags.push({
      key: 'freeze-progress',
      label: freezeMeta.label,
      tone: 'warning',
      title: freezeMeta.title,
    });
  }
  if (legalMoves.some((move) => move.id === 'struggle')) {
    tags.push({
      key: 'struggle-lock',
      label: 'Struggle Lock',
      tone: 'negative',
      title: 'All normal move options are locked, so this Pokemon is forced to Struggle until a restriction ends.',
    });
  }

  const stageTags: Array<[keyof Pick<PokemonBuild, 'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage' | 'accuracyStage' | 'evasionStage'>, string]> = [
    ['attackStage', 'Atk'],
    ['defenseStage', 'Def'],
    ['specialAttackStage', 'SpA'],
    ['specialDefenseStage', 'SpD'],
    ['speedStage', 'Spe'],
    ['accuracyStage', 'Acc'],
    ['evasionStage', 'Eva'],
  ];
  for (const [field, label] of stageTags) {
    const value = unit.build[field];
    if (!value) {
      continue;
    }
    tags.push({
      key: field,
      label: `${label} ${value > 0 ? `+${value}` : value}`,
      tone: value > 0 ? 'positive' : 'negative',
      title: `${label} stage is currently ${value > 0 ? `+${value}` : value}.`,
    });
  }

  return tags;
}

function simulatorRestrictionNotes(unit: SimUnit) {
  const notes: string[] = [];
  if (unit.rechargeTurns > 0) {
    notes.push(`${unit.rechargeMoveName ?? 'The previous move'} has forced a recharge turn, so this Pokemon cannot attack or switch out right now.`);
  }
  if (unit.chargingTurns > 0 && unit.chargingMoveName) {
    notes.push(`${unit.chargingMoveName} is already charging. This Pokemon is committed to that move on its next action unless it is interrupted first.`);
  }
  if (unit.tauntTurns > 0) {
    notes.push(`Taunt is active for ${unit.tauntTurns} more turn${unit.tauntTurns === 1 ? '' : 's'}, so status moves are blocked.`);
  }
  if (unit.encoreTurns > 0 && unit.encoreMoveId) {
    const encoreMove = unit.pokemon.movePool.find((move) => move.id === unit.encoreMoveId)?.name ?? 'the encored move';
    notes.push(`Encore is active for ${unit.encoreTurns} more turn${unit.encoreTurns === 1 ? '' : 's'}, so this slot is locked into ${encoreMove} unless another restriction overrides it.`);
  }
  if (unit.disableTurns > 0 && unit.disabledMoveId) {
    const disabledMove = unit.pokemon.movePool.find((move) => move.id === unit.disabledMoveId)?.name ?? 'the disabled move';
    notes.push(`${disabledMove} is disabled for ${unit.disableTurns} more turn${unit.disableTurns === 1 ? '' : 's'}.`);
  }
  if (unit.yawnTurns > 0) {
    notes.push(`Yawn is active for ${unit.yawnTurns} more end step${unit.yawnTurns === 1 ? '' : 's'} unless this Pokemon switches out first.`);
  }
  if (unit.perishSongTurns > 0) {
    notes.push(`Perish Song count is ${unit.perishSongTurns}. This Pokemon will faint when it reaches zero unless it leaves the field first.`);
  }
  if (unit.tormentActive) {
    notes.push('Torment is active until this Pokemon switches out, so it cannot repeat the last move it used.');
  }
  if (unit.trappedByMove) {
    notes.push(`${unit.trappedByMove} is preventing this Pokemon from switching out right now.`);
  }
  if (unit.saltCure) {
    notes.push('Salt Cure is active, so this Pokemon keeps taking chip each turn until it leaves the field.');
  }
  if (unit.syrupTurns > 0) {
    notes.push(`Syrup Bomb is still active for ${unit.syrupTurns} more end step${unit.syrupTurns === 1 ? '' : 's'}.`);
  }
  if (unit.bindingTurns > 0) {
    notes.push(`A binding effect is still active for ${unit.bindingTurns} more turn${unit.bindingTurns === 1 ? '' : 's'}.`);
  }
  if (unit.destinyBondActive) {
    notes.push('Destiny Bond is primed. A direct knockout before this Pokemon moves again will drag the attacker down too.');
  }
  if (unit.build.status === 'freeze') {
    notes.push(freezeTimerMeta(unit)?.note ?? 'Freeze uses the current Champions rule set here: 25% thaw chance on each move attempt, guaranteed thaw by frozen turn 3.');
  }
  if (unit.build.status === 'sleep') {
    notes.push(sleepTimerMeta(unit)?.note ?? 'Sleep uses the current Champions rule set here: wake checks begin on sleep turn 2 and wake is guaranteed by turn 3.');
  }
  if (unit.build.status === 'paralysis') {
    notes.push('Paralysis uses the current Champions rate here: 12.5% full paralysis with Speed reduced to half.');
  }
  const legalMoves = legalMovesForUnit(unit);
  if (legalMoves.some((move) => move.id === 'struggle')) {
    notes.push('All normal move options are locked, so this Pokemon is Struggle-locked until one of the active restrictions clears.');
  } else if (!legalMoves.length && unit.rechargeTurns <= 0 && unit.chargingTurns <= 0) {
    notes.push('No legal move is currently available because the active lock effects overlap. Switch if possible, or wait for the restriction to clear.');
  }
  return notes;
}

function simulatorTargetMode(move: PokemonMove | null, format: BattleFormat): SimulatorTargetMode {
  if (!move) {
    return 'foe';
  }

  if (simulatorAutoTargetMoves.has(move.name)) {
    return 'auto';
  }

  if (simulatorAllyTargetMoves.has(move.name)) {
    return format === 'Doubles' ? 'ally' : 'auto';
  }

  return 'foe';
}

function simulatorTargetNote(move: PokemonMove | null, format: BattleFormat, allyName: string | null) {
  if (!move) {
    return null;
  }

  if (simulatorAllyTargetMoves.has(move.name) && format !== 'Doubles') {
    return `${move.name} needs an ally on the field, so it will fail in Singles.`;
  }

  const targetMode = simulatorTargetMode(move, format);
  if (targetMode === 'ally') {
    return allyName
      ? `${move.name} targets your ally automatically here: ${allyName}.`
      : `${move.name} needs an ally on the field to work.`;
  }

  if (targetMode === 'auto') {
    if (move.name === 'Aurora Veil') {
      return 'Aurora Veil applies to your side automatically and only works while snow is active.';
    }
    if (move.name === 'Struggle') {
      return 'Struggle targets a random live opposing slot automatically here.';
    }
    return `${move.name} resolves automatically here, so no opponent target slot is needed.`;
  }

  return null;
}

function pickPreferredMaleVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return null;
  }

  const voices = window.speechSynthesis.getVoices();
  const maleKeywords = ['david', 'guy', 'brian', 'mark', 'male', 'daniel', 'alex'];
  return (
    voices.find((voice) => maleKeywords.some((keyword) => voice.name.toLowerCase().includes(keyword)) && voice.lang.toLowerCase().startsWith('en')) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith('en')) ??
    voices[0] ??
    null
  );
}

const announcerSpeechReplacements: Array<[RegExp, string]> = [
  [/\bSpA\b/g, 'special attack'],
  [/\bSpD\b/g, 'special defense'],
  [/\bAtk\b/g, 'attack'],
  [/\bDef\b/g, 'defense'],
  [/\bSpe\b/g, 'speed'],
  [/\bHP\b/g, 'H P'],
  [/\bvs\.\b/gi, 'versus'],
  [/Ting-Lu/g, 'Ting Loo'],
  [/Chien-Pao/g, 'Chee-en Pow'],
  [/Wo-Chien/g, 'Woe Chee-en'],
  [/Chi-Yu/g, 'Chee Yoo'],
  [/Farigiraf/g, 'Fah-ridge-uh-raff'],
  [/Archaludon/g, 'Ar-ka-loo-don'],
  [/Bellibolt/g, 'Bell-ee-bolt'],
  [/Sinistcha/g, 'Sin-iss-cha'],
  [/Meowscarada/g, 'Meow-skah-rah-duh'],
  [/Ogerpon/g, 'Oh-ger-pon'],
  [/Enamorus/g, 'Eh-na-more-us'],
  [/Gholdengo/g, 'Goal-den-go'],
  [/Amoonguss/g, 'Uh-moon-gus'],
  [/Urshifu/g, 'Ur-shee-foo'],
  [/Hydreigon/g, 'High-dry-gon'],
  [/Rillaboom/g, 'Rill-uh-boom'],
  [/Sneasler/g, 'Sneez-ler'],
];

function speechFriendlyText(line: string) {
  return announcerSpeechReplacements.reduce((nextLine, [pattern, replacement]) => nextLine.replace(pattern, replacement), line);
}

let announcerSpeechQueue: { line: string; rate: number }[] = [];
let announcerSpeechActive = false;

function humanizeAnnouncerLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return '';
  }

  const punctuated = /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  return punctuated
    .replace(/:\s+/g, ', ')
    .replace(/\s+\|\s+/g, '. ')
    .replace(/\s{2,}/g, ' ');
}

function flushAnnouncerQueue() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    announcerSpeechQueue = [];
    announcerSpeechActive = false;
    return;
  }

  if (announcerSpeechActive || !announcerSpeechQueue.length) {
    return;
  }

  const synth = window.speechSynthesis;
  const nextUtterance = announcerSpeechQueue.shift();
  if (!nextUtterance?.line) {
    announcerSpeechActive = false;
    return;
  }

  announcerSpeechActive = true;
  const voice = pickPreferredMaleVoice();
  const utterance = new SpeechSynthesisUtterance(speechFriendlyText(nextUtterance.line));
  utterance.rate = nextUtterance.rate;
  utterance.pitch = 0.94;
  utterance.volume = 1;
  if (voice) {
    utterance.voice = voice;
  }
  utterance.onend = () => {
    announcerSpeechActive = false;
    if (typeof window !== 'undefined') {
      window.setTimeout(() => flushAnnouncerQueue(), 140);
    }
  };
  utterance.onerror = () => {
    announcerSpeechActive = false;
    if (typeof window !== 'undefined') {
      window.setTimeout(() => flushAnnouncerQueue(), 140);
    }
  };
  synth.speak(utterance);
}

function speakAnnouncerLines(lines: string[], rate: number, interrupt = false) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !lines.length) {
    return;
  }

  const synth = window.speechSynthesis;
  if (interrupt) {
    synth.cancel();
    announcerSpeechQueue = [];
    announcerSpeechActive = false;
  }
  announcerSpeechQueue.push(
    ...lines
      .slice(0, 2)
      .map((line) => humanizeAnnouncerLine(line))
      .filter(Boolean)
      .map((line) => ({ line, rate })),
  );
  flushAnnouncerQueue();
}

function battleTrackLabel(trackId: string) {
  return battleMusicTracks.find((track) => track.id === trackId)?.label ?? 'Battle Music';
}

function hashBattlefieldSeed(source: string) {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function battlefieldBackdropForSeed(seed: string) {
  return battlefieldBackdrops[hashBattlefieldSeed(seed) % battlefieldBackdrops.length] ?? battlefieldBackdrops[0];
}

function recentBattleLogEntries(currentLog: string[], previousLog: string[] | null, limit = 8) {
  if (!currentLog.length) {
    return [];
  }

  if (!previousLog?.length) {
    return currentLog.slice(0, limit);
  }

  const previousHead = previousLog[0];
  const prefixLength = previousHead ? currentLog.indexOf(previousHead) : -1;
  if (prefixLength > 0) {
    return currentLog.slice(0, Math.min(limit, prefixLength));
  }

  const fallbackDelta = Math.max(1, currentLog.length - previousLog.length);
  return currentLog.slice(0, Math.min(limit, fallbackDelta));
}

function battleNamePool(battle: SimulatorBattleState) {
  return [...battle.player.units, ...battle.opponent.units]
    .map((unit) => unit?.pokemon.displayName)
    .filter((name): name is string => Boolean(name))
    .sort((left, right) => right.length - left.length);
}

function parseBattlefieldPlaybackEvent(entries: string[], battle: SimulatorBattleState): BattlefieldPlaybackEvent | null {
  if (!entries.length) {
    return null;
  }

  const knownNames = battleNamePool(battle);
  const fallbackName = (entry: string) => knownNames.find((name) => entry.includes(name)) ?? null;

  for (const entry of entries) {
    const abilityMatch = entry.match(/^(.+?) (?:set .+ with|boosted .+ with|lowered .+ with|stood firm against .+ with|ignored .+ because of) (.+?)\.$/);
    if (abilityMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'ability',
        message: entry,
        actorName: fallbackName(entry),
        moveName: abilityMatch[2],
      };
    }

    const abilityKickInMatch = entry.match(/^(.+?)'s ability (.+?) kicks in and (.+?)\.$/);
    if (abilityKickInMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'ability',
        message: entry,
        actorName: abilityKickInMatch[1],
        moveName: abilityKickInMatch[2],
      };
    }

    const koMatch = entry.match(/^(.+?) was knocked out by (.+?) using (.+?)\.$/);
    if (koMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'ko',
        message: entry,
        actorName: koMatch[2],
        targetName: koMatch[1],
        moveName: koMatch[3],
      };
    }

    const hitMatch = entry.match(/^(.+?) used (.+?) on (.+?) for (\d+) damage\.$/);
    if (hitMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'impact',
        message: entry,
        actorName: hitMatch[1],
        targetName: hitMatch[3],
        moveName: hitMatch[2],
      };
    }

    const missMatch = entry.match(/^(.+?)'s (.+?) missed (.+?)\.$/);
    if (missMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'impact',
        message: entry,
        actorName: missMatch[1],
        targetName: missMatch[3],
        moveName: missMatch[2],
      };
    }

    const statusMatch = entry.match(/^(.+?) was afflicted by (.+?) \((.+?)\)\.$/);
    if (statusMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'status',
        message: entry,
        actorName: fallbackName(entry),
        targetName: statusMatch[1],
        moveName: statusMatch[2],
      };
    }

    const guardMatch = entry.match(/^(.+?) blocked (.+?) with (.+?)\.$/);
    if (guardMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'guard',
        message: entry,
        actorName: guardMatch[1],
        targetName: guardMatch[1],
        moveName: guardMatch[2],
      };
    }

    const switchMatch = entry.match(/^(.+?) switched out for (.+?)\.$/);
    if (switchMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'switch',
        message: entry,
        actorName: switchMatch[1],
        targetName: switchMatch[2],
      };
    }

    const sentOutMatch = entry.match(/sent out (.+)\.$/i);
    if (sentOutMatch) {
      return {
        id: makeId('battlefield-event'),
        tone: 'switch',
        message: entry,
        targetName: sentOutMatch[1],
      };
    }

    if (/Mega Evolved|set Reflect|set Light Screen|Aurora Veil|Tailwind|Trick Room|weather|terrain|Gravity|Magic Room|Wonder Room/i.test(entry)) {
      return {
        id: makeId('battlefield-event'),
        tone: 'field',
        message: entry,
        actorName: fallbackName(entry),
      };
    }
  }

  return {
    id: makeId('battlefield-event'),
    tone: 'field',
    message: entries[0],
    actorName: fallbackName(entries[0]),
  };
}

function normalizedPlaylistIds(trackIds: string[]) {
  const validIds = trackIds.filter((trackId) => battleMusicTracks.some((track) => track.id === trackId));
  return validIds.length ? [...new Set(validIds)] : [battleMusicTracks[0]?.id ?? 'gen5-final'];
}

function primaryBattleMusicTrackId(preferredTrackId: string, playlistIds: string[]) {
  const playlist = normalizedPlaylistIds(playlistIds);
  return battleMusicTracks.some((track) => track.id === preferredTrackId) ? preferredTrackId : playlist[0];
}

function battlePlaylistSummary(trackIds: string[]) {
  const playlist = normalizedPlaylistIds(trackIds);
  return playlist.map(battleTrackLabel).join(', ');
}

function reservedMegaActorForDrafts(drafts: Record<number, ChoiceDraft>) {
  for (const [actor, draft] of Object.entries(drafts)) {
    if (draft.type === 'mega') {
      return Number(actor);
    }
  }

  return null;
}

function mergeChoiceDraftWithSingleMegaRule(
  current: Record<number, ChoiceDraft>,
  actor: number,
  fallback: ChoiceDraft,
  partial: Partial<ChoiceDraft>,
) {
  const next = {
    ...current,
    [actor]: {
      ...(current[actor] ?? fallback),
      ...partial,
    } satisfies ChoiceDraft,
  };

  if (next[actor]?.type === 'mega') {
    for (const key of Object.keys(next)) {
      const otherActor = Number(key);
      if (otherActor === actor) {
        continue;
      }
      if (next[otherActor]?.type === 'mega') {
        next[otherActor] = {
          ...next[otherActor],
          type: 'move',
        };
      }
    }
  }

  return next;
}

function BattleMusicPlayer({
  trackId,
  mode,
  playlistIds,
  enabled,
  volume,
  active,
  sessionKey,
}: {
  trackId: string;
  mode: BattleMusicMode;
  playlistIds: string[];
  enabled: boolean;
  volume: number;
  active: boolean;
  sessionKey: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTrackId, setCurrentTrackId] = useState(trackId);

  useEffect(() => {
    const playlist = normalizedPlaylistIds(playlistIds);
    if (mode === 'random') {
      const randomTrack = battleMusicTracks[Math.floor(Math.random() * battleMusicTracks.length)] ?? battleMusicTracks[0];
      setCurrentTrackId(randomTrack?.id ?? trackId);
      return;
    }
    if (mode === 'playlist') {
      setCurrentTrackId(playlist[0] ?? trackId);
      return;
    }
    setCurrentTrackId(trackId);
  }, [trackId, playlistIds, mode, sessionKey]);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.pause();
    audioRef.current.currentTime = 0;
  }, [sessionKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const currentTrack = battleMusicTracks.find((track) => track.id === currentTrackId) ?? battleMusicTracks[0];
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.preload = 'auto';
    }

    const audio = audioRef.current;
    audio.pause();
    audio.src = currentTrack.audioUrl;
    audio.load();

    const playlist = normalizedPlaylistIds(playlistIds);
    audio.loop = mode === 'single';
    audio.onended = () => {
      if (mode === 'playlist') {
        const currentIndex = playlist.indexOf(currentTrack.id);
        const nextTrackId = playlist[(currentIndex + 1) % playlist.length] ?? playlist[0];
        setCurrentTrackId(nextTrackId);
        return;
      }
      if (mode === 'random') {
        const candidates = battleMusicTracks.filter((track) => track.id !== currentTrack.id);
        const nextTrack = candidates[Math.floor(Math.random() * Math.max(1, candidates.length))] ?? battleMusicTracks[0];
        setCurrentTrackId(nextTrack.id);
      }
    };

    audio.volume = Math.max(0, Math.min(1, volume / 100));
    if (active && enabled) {
      const attemptPlay = () => {
        void audio.play().catch(() => {
          window.setTimeout(() => {
            void audio.play().catch(() => undefined);
          }, 120);
        });
      };

      audio.oncanplay = () => {
        if (active && enabled) {
          attemptPlay();
        }
      };
      attemptPlay();
    } else {
      audio.pause();
      audio.currentTime = 0;
    }

    return () => {
      audio.pause();
      audio.oncanplay = null;
    };
  }, [currentTrackId, playlistIds, mode, active, enabled, volume]);

  return <span className="youtube-audio-player" aria-hidden="true" />;
}

function battleUnitDisplayName(unit: SimUnit) {
  return unit.build.nickname.trim() || unit.pokemon.displayName;
}

function battlefieldTypesForUnit(unit: SimUnit) {
  const currentTypes = unit.typeOverride?.length ? [...unit.typeOverride] : [...unit.pokemon.types];
  for (const addedType of unit.addedTypes) {
    if (!currentTypes.includes(addedType)) {
      currentTypes.push(addedType);
    }
  }
  return currentTypes;
}

function battlefieldEffectTagsForUnit(unit: SimUnit) {
  return simulatorBattleTags(unit).slice(0, 6);
}

function battlePerformanceScore(unit: SimUnit) {
  return unit.damageDealt + unit.knockouts * 120 + unit.turnsActive * 8 + (unit.megaEvolved ? 12 : 0);
}

function topBattlePerformers(battle: SimulatorBattleState) {
  return [...battle.player.units, ...battle.opponent.units]
    .filter((unit) => unit.pokemon)
    .map((unit) => ({
      name: battleUnitDisplayName(unit),
      score: battlePerformanceScore(unit),
    }))
    .sort((left, right) => right.score - left.score);
}

function buildSimulatorMatchRecord(
  battle: SimulatorBattleState,
  teamName: string,
  announcerEnabled: boolean,
  timerEnabled: boolean,
  battleLog: string[],
  turnReviews: SimulatorTurnReview[],
  mode: SimulatorMatchRecord['mode'] = 'AI Simulator',
  extras: Partial<Pick<SimulatorMatchRecord, 'opponentName' | 'roomCode' | 'musicTrackId' | 'resultReason'>> = {},
): SimulatorMatchRecord {
  const performers = topBattlePerformers(battle);
  return {
    id: makeId('match'),
    playedAt: new Date().toISOString(),
    format: battle.format,
    teamName,
    mode,
    result: battle.winner === 'player' ? 'Win' : battle.winner === 'opponent' ? 'Loss' : 'Draw',
    turns: Math.max(1, battle.turn - 1),
    opponentPreview: battle.opponent.units.map((unit) => unit.basePokemon.displayName),
    starPokemon: performers[0]?.name ?? null,
    topPerformers: performers.slice(0, 3).map((entry) => entry.name),
    announcerEnabled,
    timerEnabled,
    opponentName: extras.opponentName ?? null,
    roomCode: extras.roomCode ?? null,
    musicTrackId: extras.musicTrackId ?? null,
    resultReason: extras.resultReason ?? 'normal',
    battleLog,
    turnReviews,
  };
}

function battleRecordSummary(history: SimulatorMatchRecord[]) {
  const wins = history.filter((record) => record.result === 'Win').length;
  const draws = history.filter((record) => record.result === 'Draw').length;
  const losses = history.length - wins - draws;
  const decisiveMatches = Math.max(1, wins + losses);
  const winRate = wins + losses ? Math.round((wins / decisiveMatches) * 100) : 0;
  const averageTurns = history.length ? (history.reduce((sum, record) => sum + record.turns, 0) / history.length).toFixed(1) : '0.0';
  let currentStreak = 0;
  let bestStreak = 0;
  for (const record of history) {
    if (record.result === 'Win') {
      currentStreak += 1;
      bestStreak = Math.max(bestStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  const growthChart = history.slice(-12).map((record, index, recent) => {
    const segment = recent.slice(0, index + 1);
    const segmentWins = segment.filter((entry) => entry.result === 'Win').length;
    return {
      ...record,
      cumulativeWinRate: Math.round((segmentWins / segment.length) * 100),
    };
  });

  return {
    wins,
    losses,
    draws,
    winRate,
    averageTurns,
    bestStreak,
    growthChart,
  };
}

function simulatorCurrentBuild(unit: SimUnit): PokemonBuild {
  return {
    ...unit.build,
    useMega: unit.megaEvolved,
    currentHpPercent: Math.max(1, Math.round((unit.currentHp / unit.maxHp) * 100)),
  };
}

function bestProjectedChoice(battle: SimulatorBattleState, unit: SimUnit) {
  let best:
    | {
        moveId: string;
        moveName: string;
        targetName: string;
        averageDamage: number;
        averagePercent: number;
        koSummary: string;
      }
    | null = null;

  for (const move of legalMovesForUnit(unit)) {
    if (move.category === 'Status') {
      continue;
    }

    for (const enemyIndex of battle.opponent.active) {
      const defender = battle.opponent.units[enemyIndex];
      if (!defender || defender.fainted) {
        continue;
      }

      const result = calculateDamage(
        simulatorCurrentBuild(unit),
        simulatorCurrentBuild(defender),
        move,
        {
          ...battle.environment,
          gravity: battle.gravityTurns > 0,
          magicRoom: battle.magicRoomTurns > 0,
          wonderRoom: battle.wonderRoomTurns > 0,
          helpingHand: false,
          reflect: battle.opponent.reflectTurns > 0,
          lightScreen: battle.opponent.lightScreenTurns > 0,
          auroraVeil: battle.opponent.auroraVeilTurns > 0,
        },
      );
      if (!result) {
        continue;
      }

      if (!best || result.averageDamage > best.averageDamage) {
        best = {
          moveId: move.id,
          moveName: move.name,
          targetName: defender.pokemon.displayName,
          averageDamage: result.averageDamage,
          averagePercent: result.averagePercent,
          koSummary: result.koSummary,
        };
      }
    }
  }

  return best;
}

function chosenProjection(battle: SimulatorBattleState, unit: SimUnit, choice: SimulatorChoice) {
  if (choice.type === 'switch') {
    return null;
  }

  const move = legalMovesForUnit(unit).find((entry) => entry.id === choice.moveId) ?? unit.pokemon.movePool.find((entry) => entry.id === choice.moveId) ?? null;
  const targetIndex = battle.opponent.active[choice.target];
  const defender = typeof targetIndex === 'number' ? battle.opponent.units[targetIndex] ?? null : null;
  if (!move || !defender || move.category === 'Status') {
    return null;
  }

  const result = calculateDamage(
    simulatorCurrentBuild(unit),
    simulatorCurrentBuild(defender),
    move,
    {
      ...battle.environment,
      gravity: battle.gravityTurns > 0,
      magicRoom: battle.magicRoomTurns > 0,
      wonderRoom: battle.wonderRoomTurns > 0,
      helpingHand: false,
      reflect: battle.opponent.reflectTurns > 0,
      lightScreen: battle.opponent.lightScreenTurns > 0,
      auroraVeil: battle.opponent.auroraVeilTurns > 0,
    },
  );
  if (!result) {
    return null;
  }

  return {
    moveName: move.name,
    targetName: defender.pokemon.displayName,
    averageDamage: result.averageDamage,
    averagePercent: result.averagePercent,
    koSummary: result.koSummary,
  };
}

function buildTurnReviewEntry(battle: SimulatorBattleState, actor: number, choice: SimulatorChoice): SimulatorTurnReview | null {
  const unitIndex = battle.player.active[actor];
  const unit = typeof unitIndex === 'number' ? battle.player.units[unitIndex] ?? null : null;
  if (!unit || unit.fainted) {
    return null;
  }

  const chosenAction =
    choice.type === 'switch'
      ? `Switched to ${battle.player.units[choice.target]?.pokemon.displayName ?? 'a bench option'}`
      : `${choice.type === 'mega' ? 'Mega Evolved and used' : 'Used'} ${unit.pokemon.movePool.find((move) => move.id === choice.moveId)?.name ?? 'a move'}`;
  const bestChoice = bestProjectedChoice(battle, unit);
  const chosen = chosenProjection(battle, unit, choice);

  if (!bestChoice) {
    return {
      turn: battle.turn,
      pokemon: unit.pokemon.displayName,
      chosenAction,
      betterAction: null,
      outcomeDelta: 'This turn leaned on utility or positioning, so no stronger immediate damage line clearly stood out.',
    };
  }

  const damageGap = Math.round(bestChoice.averageDamage - (chosen?.averageDamage ?? 0));
  if (
    choice.type !== 'switch' &&
    chosen &&
    bestChoice.moveId === choice.moveId &&
    Math.abs(damageGap) <= 12
  ) {
    return {
      turn: battle.turn,
      pokemon: unit.pokemon.displayName,
      chosenAction,
      betterAction: null,
      outcomeDelta: `The selected line stayed close to optimal pressure at about ${Math.round(chosen.averagePercent)}% projected damage into ${chosen.targetName}.`,
    };
  }

  return {
    turn: battle.turn,
    pokemon: unit.pokemon.displayName,
    chosenAction,
    betterAction: `${bestChoice.moveName} into ${bestChoice.targetName}`,
    outcomeDelta:
      choice.type === 'switch'
        ? `Projected alternative pressure was roughly ${Math.round(bestChoice.averagePercent)}% into ${bestChoice.targetName}, with ${bestChoice.koSummary}.`
        : `Projected upgrade was about ${Math.max(0, damageGap)} more damage into ${bestChoice.targetName}, with ${bestChoice.koSummary}.`,
  };
}

function announcerStyleLine(style: AnnouncerStyle, line: string) {
  return line;
}

function announcerUnitName(unit: SimUnit) {
  return battleUnitDisplayName(unit);
}

function announcerReplaceCustomNames(line: string, battle: SimulatorBattleState) {
  let nextLine = line;
  for (const unit of [...battle.player.units, ...battle.opponent.units]) {
    const nickname = unit.build.nickname.trim();
    if (!nickname) {
      continue;
    }
    nextLine = nextLine.replaceAll(unit.pokemon.displayName, nickname);
    nextLine = nextLine.replaceAll(unit.basePokemon.displayName, nickname);
  }
  return nextLine;
}

function announcerApproxSpeed(unit: SimUnit, side: SimSide, battle: SimulatorBattleState) {
  let speed = buildStats(unit.pokemon.baseStats, unit.build.evs, unit.build.natureId).speed * stageMultiplier(unit.build.speedStage);
  if (side.tailwindTurns > 0) {
    speed *= 2;
  }
  if (unit.build.status === 'paralysis') {
    speed *= 0.5;
  }
  return speed;
}

function announcerCountdownAnalysis(battle: SimulatorBattleState, style: AnnouncerStyle, seconds: number) {
  const allActive = [
    ...battle.player.active.map((unitIndex) => ({ side: battle.player, unit: battle.player.units[unitIndex] })),
    ...battle.opponent.active.map((unitIndex) => ({ side: battle.opponent, unit: battle.opponent.units[unitIndex] })),
  ].filter((entry): entry is { side: SimSide; unit: SimUnit } => Boolean(entry.unit && !entry.unit.fainted));
  if (!allActive.length) {
    return null;
  }

  const fastest = [...allActive].sort((left, right) => announcerApproxSpeed(right.unit, right.side, battle) - announcerApproxSpeed(left.unit, left.side, battle))[0];
  const baseLine = battle.trickRoomTurns > 0
    ? `${announcerUnitName(fastest.unit)} has the raw speed edge, but Trick Room flips the order for this turn.`
    : `${announcerUnitName(fastest.unit)} currently holds the cleanest speed edge on the field.`;
  const fieldLine = battle.environment.weather !== 'clear'
    ? `${titleCaseFieldLabel(battle.environment.weather)} weather is still shaping the board.`
    : battle.environment.terrain !== 'none'
      ? `${titleCaseFieldLabel(battle.environment.terrain)} Terrain is still affecting the next exchange.`
      : 'The board is clear enough that positioning and speed control will decide the next line.';

  return announcerStyleLine(style, announcerReplaceCustomNames(seconds <= 10 ? fieldLine : baseLine, battle));
}

function announcerLinesFromBattleUpdate(previous: SimulatorBattleState | null, current: SimulatorBattleState, style: AnnouncerStyle) {
  const lines: string[] = [];
  const previousLength = previous?.log.length ?? 0;
  const newEntries = current.log.slice(0, Math.max(0, current.log.length - previousLength)).reverse();

  for (const entry of newEntries) {
    let line: string | null = null;
    const switchMatch = entry.match(/sent out (.+)\.$/i);
    const hitMatch = entry.match(/^(.+?) used (.+?) on (.+?) for (\d+) damage\.$/);
    const superMatch = entry.match(/^It's super effective against (.+)\.$/);
    const resistMatch = entry.match(/^(.+?) resisted the hit\.$/);
    const missMatch = entry.match(/^(.+?)'s (.+?) missed (.+?)\.$/);
    const statusMatch = entry.match(/^(.+?) was afflicted by (.+?) \((.+?)\)\.$/);
    const koMatch = entry.match(/^(.+?) was knocked out by (.+?) using (.+?)\.$/);
    const legacyKoMatch = entry.match(/^(.+?) was knocked out\.$/);
    const abilityCueMatch = entry.match(/^(.+?) (?:set .+ with|boosted .+ with|lowered .+ with|stood firm against .+ with|ignored .+ because of) (.+?)\.$/);
    const abilityKickInMatch = entry.match(/^(.+?)'s ability (.+?) kicks in and (.+?)\.$/);
    const turnMatch = entry.match(/^Turn (\d+) ended\./);

    if (hitMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.hit), { pokemon: hitMatch[1], move: hitMatch[2], target: hitMatch[3] });
    } else if (superMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.super), { target: superMatch[1] });
    } else if (resistMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.resist), { target: resistMatch[1] });
    } else if (missMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.miss), { pokemon: missMatch[1], move: missMatch[2], target: missMatch[3] });
    } else if (statusMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.status), { source: statusMatch[2], status: statusMatch[3], target: statusMatch[1] });
    } else if (koMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.ko), { target: koMatch[1], attacker: koMatch[2], move: koMatch[3], pokemon: koMatch[2] });
    } else if (legacyKoMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.ko), { target: legacyKoMatch[1], attacker: 'the attacker', move: 'the finishing move', pokemon: 'the attacker' });
    } else if (abilityKickInMatch) {
      line = `${abilityKickInMatch[1]}'s ${abilityKickInMatch[2]} just activated, and ${abilityKickInMatch[3]}.`;
    } else if (abilityCueMatch) {
      line = `${abilityCueMatch[1]} just triggered ${abilityCueMatch[2]}, and the board is shifting around it.`;
    } else if (switchMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.switch), { pokemon: switchMatch[1] });
    } else if (/blocked .+ with|braced itself with|set Quick Guard|set Wide Guard/i.test(entry)) {
      line = fillAnnouncerLine(pickLine(announcerScripts.protect), { pokemon: entry.split(' ')[0] });
    } else if (/replacement send-outs are complete/i.test(entry)) {
      line = 'Fresh replacements are on the field now, and the next exchange is about to begin.';
    } else if (turnMatch) {
      line = fillAnnouncerLine(pickLine(announcerScripts.turn), { turn: Number(turnMatch[1]) + 1 });
    } else if (/Mega Evolved|set .* terrain|changed the weather|called in snow|twisted the dimensions|returned the dimensions to normal/i.test(entry)) {
      line = entry;
    } else if (/woke up|thawed out|is fully paralyzed|is asleep|is frozen solid/i.test(entry)) {
      line = entry;
    }

    if (line) {
      lines.push(announcerStyleLine(style, announcerReplaceCustomNames(line, current)));
    }
  }

  if (current.winner) {
    const performers = topBattlePerformers(current);
    lines.push(
      announcerStyleLine(
        style,
        fillAnnouncerLine(pickLine(announcerScripts.finish), {
          winner: current.winner === 'player' ? current.player.name : current.opponent.name,
        }),
      ),
    );
    if (performers[0]) {
      lines.push(
        announcerStyleLine(
          style,
          fillAnnouncerLine(pickLine(announcerScripts.star), {
            pokemon: performers[0].name,
          }),
        ),
      );
    }
  } else if (current.stage === 'finished') {
    lines.push(announcerStyleLine(style, 'Time is up, and this battle ends as a draw.'));
  }

  return lines;
}

function App() {
  const initialState = useMemo(() => loadState(), []);
  const [state, setState] = useState(initialState);
  const [battleCoreReady, setBattleCoreReady] = useState(() => hasBattleCoreRuntime());
  const [teamIntelReady, setTeamIntelReady] = useState(() => hasTeamIntelRuntime());
  const [onlineRuntimeReady, setOnlineRuntimeReady] = useState(() => hasOnlineRuntime());
  const [activeTab, setActiveTab] = useState<BattleTab>('team-builder');
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [calcAttacker, setCalcAttacker] = useState<PokemonBuild>(() => copyBuild(initialState.teams[0]?.slots[0] ?? createDefaultState().teams[0].slots[0]));
  const [calcDefender, setCalcDefender] = useState<PokemonBuild>(() => copyBuild(initialState.teams[0]?.slots[1] ?? createDefaultState().teams[0].slots[1]));
  const [environment, setEnvironment] = useState<EnvironmentState>(() => ({
    ...defaultEnvironment,
    battleFormat: activeTeamFromState(initialState).format,
  }));
  const [selectedDamageMoveId, setSelectedDamageMoveId] = useState<string | null>(null);
  const [pokedexSearch, setPokedexSearch] = useState('');
  const [selectedPokedexId, setSelectedPokedexId] = useState<string>(dataset.pokemon[0]?.id ?? '');
  const [selectedArchetype, setSelectedArchetype] = useState(fallbackArchetypes[0].id);
  const [aiFormat, setAiFormat] = useState<BattleFormat>(() => activeTeamFromState(initialState).format);
  const [aiLockedNames, setAiLockedNames] = useState<string[]>(['', '', '', '', '']);
  const [aiVariantCount, setAiVariantCount] = useState(8);
  const [aiRandomMode, setAiRandomMode] = useState(false);
  const [generatedPlans, setGeneratedPlans] = useState<GeneratedTeamPlan[]>([]);
  const [selectedGeneratedPlanId, setSelectedGeneratedPlanId] = useState<string | null>(null);
  const [aiBuilderMessage, setAiBuilderMessage] = useState<string | null>(null);
  const [simFormat, setSimFormat] = useState<BattleFormat>(() => activeTeamFromState(initialState).format);
  const [simPreview, setSimPreview] = useState<SimulatorPreviewState | null>(null);
  const [simBringOrder, setSimBringOrder] = useState<number[]>([]);
  const [simBattle, setSimBattle] = useState<SimulatorBattleState | null>(null);
  const [simBattlefieldSeed, setSimBattlefieldSeed] = useState<string>(() => `sim-idle-${activeTeamFromState(initialState).format}`);
  const [simBattleMusicSeed, setSimBattleMusicSeed] = useState(0);
  const [simChoiceDrafts, setSimChoiceDrafts] = useState<Record<number, ChoiceDraft>>({});
  const [simTurnTimerEnabled, setSimTurnTimerEnabled] = useState(false);
  const [simTurnClock, setSimTurnClock] = useState(30);
  const [simMatchDeadlineAt, setSimMatchDeadlineAt] = useState<string | null>(null);
  const [simMatchClock, setSimMatchClock] = useState(8 * 60);
  const [simTurnNotice, setSimTurnNotice] = useState<string | null>(null);
  const [simChoicesLocked, setSimChoicesLocked] = useState(false);
  const [simAnnouncerEnabled, setSimAnnouncerEnabled] = useState(false);
  const [simAnnouncerStyle, setSimAnnouncerStyle] = useState<AnnouncerStyle>('Arena');
  const [simAnnouncerRate, setSimAnnouncerRate] = useState(1);
  const [simAnnouncerFeed, setSimAnnouncerFeed] = useState<string[]>([]);
  const [simBattlefieldEvent, setSimBattlefieldEvent] = useState<BattlefieldPlaybackEvent | null>(null);
  const [simTurnReviews, setSimTurnReviews] = useState<SimulatorTurnReview[]>([]);
  const [simCountdown, setSimCountdown] = useState(0);
  const [simPreviewMessage, setSimPreviewMessage] = useState<string | null>(null);
  const [presenceStats, setPresenceStats] = useState<OnlinePresenceStats>({ activeUsers: 0, totalVisits: 0, activeBattles: 0 });
  const [onlineSessionId] = useState(() => ensureOnlineSessionId());
  const [onlineAuthMode, setOnlineAuthMode] = useState<'register' | 'login'>('register');
  const [onlineEmail, setOnlineEmail] = useState('');
  const [onlinePassword, setOnlinePassword] = useState('');
  const [onlineLookup, setOnlineLookup] = useState('');
  const [onlineStatusMessage, setOnlineStatusMessage] = useState<string | null>(null);
  const [pvpRoomCodeInput, setPvpRoomCodeInput] = useState('');
  const [pvpRoom, setPvpRoom] = useState<OnlineBattleRoomView | null>(null);
  const [pvpBattleMusicSeed, setPvpBattleMusicSeed] = useState(0);
  const [pvpBringOrder, setPvpBringOrder] = useState<number[]>([]);
  const [pvpChoiceDrafts, setPvpChoiceDrafts] = useState<Record<number, ChoiceDraft>>({});
  const [pvpCountdown, setPvpCountdown] = useState(0);
  const [pvpMatchCountdown, setPvpMatchCountdown] = useState(8 * 60);
  const [pvpMessage, setPvpMessage] = useState<string | null>(null);
  const [pvpAnnouncerFeed, setPvpAnnouncerFeed] = useState<string[]>([]);
  const [pvpBattlefieldEvent, setPvpBattlefieldEvent] = useState<BattlefieldPlaybackEvent | null>(null);
  const [pvpRoomHistory, setPvpRoomHistory] = useState<OnlineBattleRoomHistoryEntry[]>([]);
  const [pvpHistorySearch, setPvpHistorySearch] = useState('');
  const [profileMusicPreviewActive, setProfileMusicPreviewActive] = useState(false);
  const [profileMusicPreviewSession, setProfileMusicPreviewSession] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState('Autosave ready');
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  const simBattleRef = useRef<SimulatorBattleState | null>(null);
  const pvpRoomRef = useRef<OnlineBattleRoomView | null>(null);
  const simChoiceDraftsRef = useRef<Record<number, ChoiceDraft>>({});
  const simTurnReviewsRef = useRef<SimulatorTurnReview[]>([]);
  const simChoicesLockedRef = useRef(false);
  const previousBattleRef = useRef<SimulatorBattleState | null>(null);
  const previousPvpBattleRef = useRef<SimulatorBattleState | null>(null);
  const previousSimStageRef = useRef<string | null>(null);
  const previousPvpStageRef = useRef<string | null>(null);
  const recordedBattleKeyRef = useRef<string | null>(null);
  const recordedPvpBattleKeyRef = useRef<string | null>(null);

  const team = activeTeamFromState(state);
  const analysis = analyzeTeam(team);
  const onlineAccount = state.profile.onlineAccount;
  const selectedTeamSlot = team.slots[selectedSlotIndex] ?? team.slots[0];
  const deferredDexSearch = useDeferredValue(pokedexSearch);
  const pokedexMatches = useMemo(
    () => dataset.pokemon.filter((pokemon) => pickerLabel(pokemon).toLowerCase().includes(deferredDexSearch.toLowerCase())),
    [deferredDexSearch],
  );
  const selectedPokedexPokemon = dataset.pokemon.find((pokemon) => pokemon.id === selectedPokedexId) ?? pokedexMatches[0] ?? dataset.pokemon[0];
  const attackerPokemon = resolvePokemonForm(calcAttacker);
  const defenderPokemon = resolvePokemonForm(calcDefender);
  const attackerBuild = attackerPokemon ? { ...calcAttacker, moveIds: normalizeMoveSelection(calcAttacker, attackerPokemon) } : calcAttacker;
  const defenderBuild = defenderPokemon ? { ...calcDefender, moveIds: normalizeMoveSelection(calcDefender, defenderPokemon) } : calcDefender;
  const attackerMoves = attackerPokemon ? attackerBuild.moveIds.map((id) => attackerPokemon.movePool.find((move) => move.id === id)).filter(isMoveEntry) : [];
  const defenderMoves = defenderPokemon ? defenderBuild.moveIds.map((id) => defenderPokemon.movePool.find((move) => move.id === id)).filter(isMoveEntry) : [];
  const attackerMoveResults = useMemo(
    () => battleCoreReady ? attackerMoves.map((move) => ({ move, result: calculateDamage(attackerBuild, defenderBuild, move, environment) })) : [],
    [attackerBuild, attackerMoves, battleCoreReady, defenderBuild, environment],
  );
  const defenderMoveResults = useMemo(
    () => battleCoreReady ? defenderMoves.map((move) => ({ move, result: calculateDamage(defenderBuild, attackerBuild, move, environment) })) : [],
    [attackerBuild, battleCoreReady, defenderBuild, defenderMoves, environment],
  );
  const archetypeOptions = useMemo(() => activeArchetypeOptions(), [teamIntelReady]);
  const selectedGeneratedPlan = generatedPlans.find((plan) => plan.id === selectedGeneratedPlanId) ?? generatedPlans[0] ?? null;
  const aiLockedValidations = useMemo(() => validateLockedPokemonInputs(aiLockedNames, aiFormat), [aiLockedNames, aiFormat]);
  const coreArchetypeSuggestions = suggestArchetypesForCore(lockedNamesFromValidations(aiLockedValidations), aiFormat);
  const selectedSlotBlockedItemIds = useMemo(() => teammateItemIds(team, selectedSlotIndex), [team, selectedSlotIndex]);
  const saveStatusLabel = lastSavedAt ? `${saveMessage} at ${new Date(lastSavedAt).toLocaleTimeString()}` : 'Local autosave is ready.';
  const profileHistorySummary = battleRecordSummary(state.profile.matchHistory);
  const selectedReplay =
    state.profile.matchHistory.find((record) => record.id === selectedReplayId) ??
    state.profile.matchHistory[state.profile.matchHistory.length - 1] ??
    null;
  const simBattleResolved = Boolean(simBattle && simBattle.stage === 'finished');
  const pvpBattleResolved = Boolean(pvpRoom && pvpRoom.stage === 'finished');
  const aiBattleMusicActive = activeTab === 'simulator' && simBattle?.stage === 'battle';
  const pvpBattleMusicActive = activeTab === 'pvp-battles' && pvpRoom?.stage === 'battle';
  const simDecisionPhaseKey = simBattle
    ? `${simBattle.turn}-${simBattle.player.active.join(',')}-${simBattle.opponent.active.join(',')}-${simBattle.player.bench.join(',')}-${simBattle.opponent.bench.join(',')}`
    : 'sim-idle';
  const activeBattleMusicTrackId = activeTab === 'pvp-battles'
    ? pvpRoom?.musicTrackId ?? primaryBattleMusicTrackId(state.profile.preferredBattleTrackId, state.profile.battleMusicPlaylistIds)
    : primaryBattleMusicTrackId(state.profile.preferredBattleTrackId, state.profile.battleMusicPlaylistIds);
  const battleMusicSessionKey = activeTab === 'pvp-battles'
    ? pvpRoom?.stage === 'battle'
      ? `pvp-battle-${pvpRoom?.code ?? 'idle'}-${pvpBattleMusicSeed}`
      : 'pvp-idle'
    : simBattle?.stage === 'battle'
        ? `sim-battle-${simBattleMusicSeed}`
        : 'sim-idle';
  const profileReady = Boolean(state.profile.trainerName.trim());
  const storedProfiles = useMemo(() => listStoredProfiles(), [state.profile.trainerName, lastSavedAt]);
  const overallMoveParity = useMemo(() => buildMoveParitySummary(dataset.moves), [battleCoreReady]);
  const overallAbilityParity = useMemo(() => buildAbilityParitySummary(dataset.pokemon), [battleCoreReady]);
  const selectedMoveParityEntries = useMemo(
    () => selectedPokedexPokemon.movePool.map((move) => moveParityForMove(move)),
    [battleCoreReady, selectedPokedexPokemon],
  );
  const filteredPvpHistory = useMemo(() => {
    const query = pvpHistorySearch.trim().toLowerCase();
    if (!query) {
      return pvpRoomHistory;
    }
    return pvpRoomHistory.filter((entry) =>
      entry.code.includes(query) ||
      entry.opponentName.toLowerCase().includes(query) ||
      entry.trainerName.toLowerCase().includes(query),
    );
  }, [pvpHistorySearch, pvpRoomHistory]);
  const simBackdrop = useMemo(() => battlefieldBackdropForSeed(simBattlefieldSeed), [simBattlefieldSeed]);
  const pvpBackdrop = useMemo(
    () => battlefieldBackdropForSeed(`pvp-${pvpRoom?.code ?? 'idle'}`),
    [pvpRoom?.code],
  );
  const simPreviewPlayerOrder = useMemo(
    () => (simBringOrder.length ? simBringOrder : filledSlotIndices(team).slice(0, 4)),
    [simBringOrder, team],
  );
  const simPreviewOpponentOrder = useMemo(
    () => (simPreview ? filledSlotIndices(simPreview.opponentTeam).slice(0, 4) : []),
    [simPreview],
  );
  const pvpPreviewPlayerOrder = useMemo(
    () => (pvpBringOrder.length ? pvpBringOrder : filledSlotIndices(team).slice(0, 4)),
    [pvpBringOrder, team],
  );
  const pvpPreviewOpponentOrder = useMemo(
    () => (pvpRoom?.opponentTeam ? filledSlotIndices(pvpRoom.opponentTeam).slice(0, 4) : []),
    [pvpRoom?.opponentTeam],
  );
  const simFieldSections = useMemo<BattlefieldConditionSection[]>(
    () => simBattle ? [
      {
        label: 'Turn Flow',
        tags: [
          { key: 'sim-turn', label: `Turn ${simBattle.turn}`, tone: 'positive', title: 'The current live simulator turn.' },
          { key: 'sim-clock', label: simTurnTimerEnabled && !simBattle.winner ? `${simTurnClock}s clock` : 'Clock Off', tone: simTurnTimerEnabled && simTurnClock <= 10 ? 'warning' : 'neutral', title: 'The live move clock for the current turn.' },
          { key: 'sim-match-clock', label: `${matchClockLabel(simMatchClock)} match`, tone: simMatchClock <= 30 ? 'negative' : simMatchClock <= 60 ? 'warning' : 'neutral', title: 'The live overall match timer for this simulator battle.' },
        ],
      },
      { label: 'Global Field', tags: simulatorGlobalFieldTags(simBattle) },
      { label: 'Your Side', tags: simulatorSideConditionTags(simBattle.player) },
      { label: 'AI Side', tags: simulatorSideConditionTags(simBattle.opponent) },
    ] : [],
    [simBattle, simTurnClock, simTurnTimerEnabled, simMatchClock],
  );
  const pvpFieldSections = useMemo<BattlefieldConditionSection[]>(
    () => pvpRoom?.battle ? [
      {
        label: 'Turn Flow',
        tags: [
          { key: 'pvp-turn', label: `Turn ${pvpRoom.battle.turn}`, tone: 'positive', title: 'The current live PvP turn.' },
          { key: 'pvp-clock', label: pvpRoom.playerChoicesLocked ? 'You locked' : `${pvpCountdown}s clock`, tone: pvpRoom.playerChoicesLocked ? 'positive' : pvpCountdown <= 10 ? 'warning' : 'neutral', title: pvpRoom.playerChoicesLocked ? 'Your turn submission is locked, so your personal move clock is effectively stopped while the room waits on the opponent.' : 'The mandatory room timer for the current turn.' },
          { key: 'pvp-match-clock', label: `${matchClockLabel(pvpMatchCountdown)} match`, tone: pvpMatchCountdown <= 30 ? 'negative' : pvpMatchCountdown <= 60 ? 'warning' : 'neutral', title: 'The live overall match timer for this PvP room.' },
        ],
      },
      { label: 'Global Field', tags: simulatorGlobalFieldTags(pvpRoom.battle) },
      { label: 'Your Side', tags: simulatorSideConditionTags(pvpRoom.battle.player) },
      { label: 'Opponent Side', tags: simulatorSideConditionTags(pvpRoom.battle.opponent) },
    ] : [],
    [pvpRoom?.battle, pvpCountdown, pvpMatchCountdown],
  );
  const simPreviewFieldSections = useMemo<BattlefieldConditionSection[]>(
    () => simPreview ? [
      {
        label: 'Preview Clock',
        tags: [
          { key: 'format', label: simPreview.format, tone: 'positive', title: 'The projected battle format for this preview.' },
          { key: 'countdown', label: `${simCountdown}s left`, tone: simCountdown <= 10 ? 'warning' : 'neutral', title: 'Time left before the preview expires.' },
          { key: 'selected', label: `${simBringOrder.length}/4 locked`, tone: simBringOrder.length === 4 ? 'positive' : 'warning', title: 'Your current bring-order lock status.' },
        ],
      },
    ] : [],
    [simPreview, simCountdown, simBringOrder.length],
  );
  const pvpPreviewFieldSections = useMemo<BattlefieldConditionSection[]>(
    () => pvpRoom?.stage === 'preview' ? [
      {
        label: 'Room Preview',
        tags: [
          { key: 'room-code', label: `Room ${pvpRoom.code}`, tone: 'neutral', title: 'The current live room code.' },
          { key: 'preview-format', label: pvpRoom.format, tone: 'positive', title: 'The live PvP format for this room.' },
          { key: 'preview-clock', label: `${pvpCountdown}s left`, tone: pvpCountdown <= 10 ? 'warning' : 'neutral', title: 'Mandatory preview clock before battle.' },
          { key: 'bring-lock', label: `${pvpBringOrder.length}/4 locked`, tone: pvpBringOrder.length === 4 ? 'positive' : 'warning', title: 'Your current bring-order lock status.' },
        ],
      },
    ] : [],
    [pvpRoom, pvpCountdown, pvpBringOrder.length],
  );
  const simPendingReplacementActors = useMemo(
    () => simBattle ? pendingReplacementActors(simBattle.player) : [],
    [simBattle],
  );
  const pvpPendingReplacementActors = useMemo(
    () => pvpRoom?.battle ? pendingReplacementActors(pvpRoom.battle.player) : [],
    [pvpRoom?.battle],
  );
  const simBattleNeedsReplacementPhase = useMemo(
    () => Boolean(simBattle && battleHasPendingReplacements(simBattle)),
    [simBattle],
  );
  const pvpBattleNeedsReplacementPhase = useMemo(
    () => Boolean(pvpRoom?.battle && battleHasPendingReplacements(pvpRoom.battle)),
    [pvpRoom?.battle],
  );

  const selectedResult = attackerMoveResults.find(({ move }) => move.id === selectedDamageMoveId)?.result ?? null;

  const simCommandDeck = !simBattle ? null : (!simBattleResolved ? (
    <>
      <SectionHeader
        title={simBattleNeedsReplacementPhase ? 'Replacement Command Deck' : 'Battle Command Deck'}
        subtitle="Keep the field in view while you lock moves, Mega timing, or replacement send-outs for the next board state."
        compact
      />
      {!simBattle.player.megaUsed && reservedMegaActorForDrafts(simChoiceDrafts) !== null ? (
        <div className="note-row compact-note battle-mega-banner">
          Mega Evolution is reserved this turn for {battleUnitDisplayName(simBattle.player.units[simBattle.player.active[reservedMegaActorForDrafts(simChoiceDrafts)!]])}. Other lanes lose the Mega option until that reservation is changed.
        </div>
      ) : (
        <div className="note-row compact-note battle-mega-banner">
          Hard rule active: only one Pokemon on your side can Mega Evolve during the entire battle, even if multiple active lanes are holding Mega Stones.
        </div>
      )}
      {simPendingReplacementActors.length ? (
        <div className="sim-action-grid replacement-phase-grid">
          {simPendingReplacementActors.map((actor) => {
            const availableBench = simBattle.player.bench.filter((benchIndex) => !simBattle.player.units[benchIndex]?.fainted);
            const draft = simChoiceDrafts[actor] ?? {
              type: 'switch' as const,
              moveId: '',
              target: 0,
              switchTarget: availableBench[0] ?? 0,
            };
            return (
              <div key={`replacement-${actor}`} className="subpanel sim-action-card">
                <SectionHeader title={`Replacement Lane ${actor + 1}`} subtitle="This slot was knocked out last turn. Pick the Pokemon that should enter at the top of the next turn." compact />
                <div className="note-row compact-note">The KOed slot stays empty for the rest of the resolved turn. Your replacement will not enter until the new turn begins.</div>
                <label className="field">
                  <span>Send In</span>
                  <select value={draft.switchTarget} onChange={(event) => updateChoiceDraft(actor, { type: 'switch', switchTarget: Number(event.target.value) })}>
                    {availableBench.map((benchIndex) => (
                      <option key={benchIndex} value={benchIndex}>{simBattle.player.units[benchIndex]?.pokemon.displayName}</option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sim-action-grid">
          {simBattle.player.active.map((unitIndex, actor) => {
            const unit = simBattle.player.units[unitIndex];
            if (!unit || unit.fainted) {
              return null;
            }

            const legalMoves = legalMovesForUnit(unit);
            const switchTargets = simBattle.player.bench.filter((benchIndex) => !simBattle.player.units[benchIndex]?.fainted);
            const draft = simChoiceDrafts[actor] ?? {
              type: 'move' as const,
              moveId: legalMoves[0]?.id ?? unit.build.moveIds[0] ?? '',
              target: 0,
              switchTarget: switchTargets[0] ?? 0,
            };
            const canMegaEvolve = Boolean(unit.megaPokemon && !unit.megaEvolved && !simBattle.player.megaUsed);
            const reservedMegaActor = reservedMegaActorForDrafts(simChoiceDrafts);
            const megaReservedByOtherLane = reservedMegaActor !== null && reservedMegaActor !== actor;
            const allowMegaOption = canMegaEvolve && !megaReservedByOtherLane;
            const canSwitch = switchTargets.length > 0 && !unit.trappedByMove && unit.bindingTurns <= 0;
            const statusBadge = simulatorStatusBadge(unit);
            const battleTags = simulatorBattleTags(unit);
            const effectiveDraftType = draft.type === 'switch' && !canSwitch ? 'move' : draft.type;
            const selectedMoveId = legalMoves.some((move) => move.id === draft.moveId) ? draft.moveId : legalMoves[0]?.id ?? '';
            const selectedMove = legalMoves.find((move) => move.id === selectedMoveId) ?? legalMoves[0] ?? null;
            const allyUnit =
              simBattle.player.active
                .map((activeIndex) => simBattle.player.units[activeIndex])
                .find((candidate) => candidate && candidate !== unit && !candidate.fainted) ?? null;
            const liveEnemyTargets = livingTargetSlots(simBattle.opponent);
            const selectedTarget = liveEnemyTargets.some((entry) => entry.targetIndex === draft.target)
              ? draft.target
              : (liveEnemyTargets[0]?.targetIndex ?? 0);
            const targetMode = simulatorTargetMode(selectedMove, simBattle.format);
            const targetNote = simulatorTargetNote(selectedMove, simBattle.format, allyUnit?.pokemon.displayName ?? null);
            const restrictionNotes = simulatorRestrictionNotes(unit);

            return (
              <div key={`${unit.pokemon.id}-${actor}`} className="subpanel sim-action-card">
                <SectionHeader title={unit.pokemon.displayName} subtitle={describeBuildRole(unit.build, simBattle.format)} compact />
                {battleTags.length || statusBadge ? (
                  <div className="battle-tag-row action-tag-row">
                    {battleTags.map((tag) => (
                      <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                        {tag.label}
                      </span>
                    ))}
                    {statusBadge ? (
                      <span
                        className={`battle-tag battle-tag-${statusBadge.tone === 'sleep' ? 'warning' : 'neutral'}`}
                        title={statusBadge.title}
                      >
                        Status {statusBadge.label}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <label className="field">
                  <span>Action</span>
                  <select value={effectiveDraftType} onChange={(event) => updateChoiceDraft(actor, { type: event.target.value as ChoiceDraft['type'] })} disabled={unit.rechargeTurns > 0 || unit.chargingTurns > 0}>
                    <option value="move">Move</option>
                    {allowMegaOption ? <option value="mega">Mega Evolve</option> : null}
                    {canSwitch ? <option value="switch">Switch</option> : null}
                  </select>
                </label>
                {effectiveDraftType !== 'switch' ? (
                  <>
                    <label className="field">
                      <span>{effectiveDraftType === 'mega' ? 'Move After Mega' : 'Move'}</span>
                      <select value={selectedMoveId} onChange={(event) => updateChoiceDraft(actor, { moveId: event.target.value })} disabled={!legalMoves.length}>
                        {legalMoves.map((move) => {
                          return <option key={move.id} value={move.id}>{move.name}</option>;
                        })}
                      </select>
                    </label>
                    {targetMode === 'foe' ? (
                      <label className="field">
                        <span>Target</span>
                        <select value={selectedTarget} onChange={(event) => updateChoiceDraft(actor, { target: Number(event.target.value) })}>
                          {liveEnemyTargets.map(({ unit: enemy, targetIndex }) => (
                            <option key={`${enemy.pokemon.id}-${targetIndex}`} value={targetIndex}>{enemy.pokemon.displayName}</option>
                          ))}
                        </select>
                      </label>
                    ) : targetNote ? (
                      <div className="note-row compact-note">
                        {targetNote}
                      </div>
                    ) : null}
                    {restrictionNotes.map((note) => (
                      <div key={note} className="note-row compact-note">
                        {note}
                      </div>
                    ))}
                    {!legalMoves.length ? (
                      <div className="note-row compact-note">
                        {unit.rechargeTurns > 0
                          ? 'This slot is spending the turn recharging, so it cannot pick a move or switch.'
                          : unit.chargingTurns > 0
                            ? 'This slot is already charging a two-turn move and will fire that stored move automatically on its next action.'
                            : 'No legal move is currently available under the active locks. If the turn timer expires here, the sandbox will fall back to the correct forced line automatically.'}
                      </div>
                    ) : null}
                    {effectiveDraftType === 'mega' && unit.megaPokemon ? (
                      <div className="note-row compact-note">
                        {unit.basePokemon.displayName} will Mega Evolve into {unit.megaPokemon.displayName} before acting this turn.
                      </div>
                    ) : megaReservedByOtherLane ? (
                      <div className="note-row compact-note">
                        Mega Evolution is already reserved for another active lane this turn.
                      </div>
                    ) : null}
                  </>
                ) : (
                  <label className="field">
                    <span>Switch To</span>
                    <select value={draft.switchTarget} onChange={(event) => updateChoiceDraft(actor, { switchTarget: Number(event.target.value) })}>
                      {switchTargets.map((benchIndex) => (
                        <option key={benchIndex} value={benchIndex}>{simBattle.player.units[benchIndex]?.pokemon.displayName}</option>
                      ))}
                    </select>
                  </label>
                )}
                {unit.megaEvolved ? <div className="note-row compact-note">Mega active. The Mega ability now applies on the field and on re-entry.</div> : null}
              </div>
            );
          })}
        </div>
      )}
      <div className="team-actions">
        <button className="action-button primary" onClick={submitSimTurn} disabled={simTurnTimerEnabled && simChoicesLocked}>
          {simBattleNeedsReplacementPhase
            ? (simTurnTimerEnabled ? (simChoicesLocked ? 'Replacements Locked' : 'Lock Replacements') : 'Send Replacements')
            : (simTurnTimerEnabled ? (simChoicesLocked ? 'Choices Locked' : 'Lock Turn') : 'Resolve Turn')}
        </button>
        <button className="action-button" onClick={() => { setSimBattle(null); setSimMatchDeadlineAt(null); setSimChoiceDrafts({}); setSimChoicesLocked(false); }}>End Simulation</button>
      </div>
    </>
  ) : (
    <div className="team-actions">
      <button className="action-button primary" onClick={() => { setSimBattle(null); setSimMatchDeadlineAt(null); setSimChoiceDrafts({}); setSimChoicesLocked(false); startSimulatorPreview(); }}>Run Another Match</button>
      <button className="action-button" onClick={() => { setSimBattle(null); setSimMatchDeadlineAt(null); setSimChoiceDrafts({}); setSimChoicesLocked(false); }}>Close Simulator</button>
    </div>
  ));

  const pvpCommandDeck = !pvpRoom?.battle ? null : (!pvpBattleResolved ? (
    <>
      <SectionHeader
        title={pvpBattleNeedsReplacementPhase ? 'PvP Replacement Deck' : 'PvP Command Deck'}
        subtitle="Lock your live battle choices here while the field stays visible. One Mega Evolution per side is enforced across the whole room."
        compact
      />
      {!pvpRoom.battle.player.megaUsed && reservedMegaActorForDrafts(pvpChoiceDrafts) !== null ? (
        <div className="note-row compact-note battle-mega-banner">
          Mega Evolution is reserved this turn for {battleUnitDisplayName(pvpRoom.battle.player.units[pvpRoom.battle.player.active[reservedMegaActorForDrafts(pvpChoiceDrafts)!]])}. Other lanes lose the Mega option until that reservation is changed.
        </div>
      ) : (
        <div className="note-row compact-note battle-mega-banner">
          Hard rule active: one Mega Evolution per side for the full PvP battle, even if multiple teammates are carrying Mega Stones.
        </div>
      )}
      {pvpPendingReplacementActors.length ? (
        <div className="sim-action-grid replacement-phase-grid">
          {pvpPendingReplacementActors.map((actor) => {
            const availableBench = pvpRoom.battle!.player.bench.filter((benchIndex) => !pvpRoom.battle!.player.units[benchIndex]?.fainted);
            const draft = pvpChoiceDrafts[actor] ?? {
              type: 'switch' as const,
              moveId: '',
              target: 0,
              switchTarget: availableBench[0] ?? 0,
            };
            return (
              <div key={`pvp-replacement-${actor}`} className="subpanel sim-action-card">
                <SectionHeader title={`Replacement Lane ${actor + 1}`} subtitle="This slot was knocked out during the last turn. Pick who enters at the top of the next turn." compact />
                <div className="note-row compact-note">Your opponent will not see the full backline details here. The send-out resolves when the replacement clock expires or both battlers lock in.</div>
                <label className="field">
                  <span>Send In</span>
                  <select value={draft.switchTarget} onChange={(event) => updatePvpChoiceDraft(actor, { type: 'switch', switchTarget: Number(event.target.value) })}>
                    {availableBench.map((benchIndex) => (
                      <option key={benchIndex} value={benchIndex}>{pvpRoom.battle!.player.units[benchIndex]?.pokemon.displayName}</option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="sim-action-grid">
          {pvpRoom.battle.player.active.map((unitIndex, actor) => {
            const unit = pvpRoom.battle!.player.units[unitIndex];
            if (!unit || unit.fainted) {
              return null;
            }

            const legalMoves = legalMovesForUnit(unit);
            const switchTargets = pvpRoom.battle!.player.bench.filter((benchIndex) => !pvpRoom.battle!.player.units[benchIndex]?.fainted);
            const draft = pvpChoiceDrafts[actor] ?? {
              type: 'move' as const,
              moveId: legalMoves[0]?.id ?? unit.build.moveIds[0] ?? '',
              target: 0,
              switchTarget: switchTargets[0] ?? 0,
            };
            const canMegaEvolve = Boolean(unit.megaPokemon && !unit.megaEvolved && !pvpRoom.battle!.player.megaUsed);
            const reservedMegaActor = reservedMegaActorForDrafts(pvpChoiceDrafts);
            const megaReservedByOtherLane = reservedMegaActor !== null && reservedMegaActor !== actor;
            const allowMegaOption = canMegaEvolve && !megaReservedByOtherLane;
            const canSwitch = switchTargets.length > 0 && !unit.trappedByMove && unit.bindingTurns <= 0;
            const statusBadge = simulatorStatusBadge(unit);
            const battleTags = simulatorBattleTags(unit);
            const effectiveDraftType = draft.type === 'switch' && !canSwitch ? 'move' : draft.type;
            const selectedMoveId = legalMoves.some((move) => move.id === draft.moveId) ? draft.moveId : legalMoves[0]?.id ?? '';
            const selectedMove = legalMoves.find((move) => move.id === selectedMoveId) ?? legalMoves[0] ?? null;
            const allyUnit =
              pvpRoom.battle!.player.active
                .map((activeIndex) => pvpRoom.battle!.player.units[activeIndex])
                .find((candidate) => candidate && candidate !== unit && !candidate.fainted) ?? null;
            const liveEnemyTargets = livingTargetSlots(pvpRoom.battle!.opponent);
            const selectedTarget = liveEnemyTargets.some((entry) => entry.targetIndex === draft.target)
              ? draft.target
              : (liveEnemyTargets[0]?.targetIndex ?? 0);
            const targetMode = simulatorTargetMode(selectedMove, pvpRoom.battle!.format);
            const targetNote = simulatorTargetNote(selectedMove, pvpRoom.battle!.format, allyUnit?.pokemon.displayName ?? null);
            const restrictionNotes = simulatorRestrictionNotes(unit);

            return (
              <div key={`${unit.pokemon.id}-${actor}`} className="subpanel sim-action-card">
                <SectionHeader title={unit.pokemon.displayName} subtitle={describeBuildRole(unit.build, pvpRoom.battle!.format)} compact />
                {battleTags.length || statusBadge ? (
                  <div className="battle-tag-row action-tag-row">
                    {battleTags.map((tag) => (
                      <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                        {tag.label}
                      </span>
                    ))}
                    {statusBadge ? (
                      <span className={`battle-tag battle-tag-${statusBadge.tone === 'sleep' ? 'warning' : 'neutral'}`} title={statusBadge.title}>
                        Status {statusBadge.label}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <label className="field">
                  <span>Action</span>
                  <select value={effectiveDraftType} onChange={(event) => updatePvpChoiceDraft(actor, { type: event.target.value as ChoiceDraft['type'] })} disabled={unit.rechargeTurns > 0 || unit.chargingTurns > 0}>
                    <option value="move">Move</option>
                    {allowMegaOption ? <option value="mega">Mega Evolve</option> : null}
                    {canSwitch ? <option value="switch">Switch</option> : null}
                  </select>
                </label>
                {effectiveDraftType !== 'switch' ? (
                  <>
                    <label className="field">
                      <span>{effectiveDraftType === 'mega' ? 'Move After Mega' : 'Move'}</span>
                      <select value={selectedMoveId} onChange={(event) => updatePvpChoiceDraft(actor, { moveId: event.target.value })} disabled={!legalMoves.length}>
                        {legalMoves.map((move) => <option key={move.id} value={move.id}>{move.name}</option>)}
                      </select>
                    </label>
                    {targetMode === 'foe' ? (
                      <label className="field">
                        <span>Target</span>
                        <select value={selectedTarget} onChange={(event) => updatePvpChoiceDraft(actor, { target: Number(event.target.value) })}>
                          {liveEnemyTargets.map(({ unit: enemy, targetIndex }) => (
                            <option key={`${enemy.pokemon.id}-${targetIndex}`} value={targetIndex}>{enemy.pokemon.displayName}</option>
                          ))}
                        </select>
                      </label>
                    ) : targetNote ? <div className="note-row compact-note">{targetNote}</div> : null}
                    {restrictionNotes.map((note) => (
                      <div key={note} className="note-row compact-note">
                        {note}
                      </div>
                    ))}
                    {!legalMoves.length ? (
                      <div className="note-row compact-note">
                        {unit.rechargeTurns > 0
                          ? 'This slot is spending the turn recharging, so it cannot pick a move or switch.'
                          : unit.chargingTurns > 0
                            ? 'This slot is already charging a two-turn move and will fire that stored move automatically on its next action.'
                            : 'No legal move is currently available under the active locks. If the PvP timer expires here, the correct forced line will be submitted automatically.'}
                      </div>
                    ) : null}
                    {effectiveDraftType === 'mega' && unit.megaPokemon ? (
                      <div className="note-row compact-note">
                        {unit.basePokemon.displayName} will Mega Evolve into {unit.megaPokemon.displayName} before acting this turn.
                      </div>
                    ) : megaReservedByOtherLane ? (
                      <div className="note-row compact-note">
                        Mega Evolution is already reserved for another active lane this turn.
                      </div>
                    ) : null}
                  </>
                ) : (
                  <label className="field">
                    <span>Switch To</span>
                    <select value={draft.switchTarget} onChange={(event) => updatePvpChoiceDraft(actor, { switchTarget: Number(event.target.value) })}>
                      {switchTargets.map((benchIndex) => (
                        <option key={benchIndex} value={benchIndex}>{pvpRoom.battle!.player.units[benchIndex]?.pokemon.displayName}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="team-actions">
        <button className="action-button primary" onClick={() => { void submitPvpTurn(false); }}>
          {pvpBattleNeedsReplacementPhase ? 'Lock Replacements' : 'Lock Turn'}
        </button>
        <button className="action-button danger" onClick={() => { void handlePvpForfeit(); }}>Forfeit Match</button>
      </div>
      {pvpMessage ? <div className="note-row">{pvpMessage}</div> : null}
    </>
  ) : (
    <div className="team-actions">
      <button className="action-button primary" onClick={() => setPvpRoom(null)}>Close Room</button>
    </div>
  ));

  useEffect(() => {
    const heavyTabs: BattleTab[] = ['damage-lab', 'pokedex', 'simulator', 'pvp-battles', 'profile'];
    const shouldLoadBattleCore =
      heavyTabs.includes(activeTab) ||
      Boolean(simPreview || simBattle || pvpRoom?.battle);
    if (!shouldLoadBattleCore || hasBattleCoreRuntime()) {
      if (hasBattleCoreRuntime() && !battleCoreReady) {
        setBattleCoreReady(true);
      }
      return;
    }

    let cancelled = false;
    void ensureBattleCoreRuntime().then(() => {
      if (!cancelled) {
        setBattleCoreReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, battleCoreReady, pvpRoom?.battle, simBattle, simPreview]);

  useEffect(() => {
    const tabsNeedingIntel: BattleTab[] = ['team-builder', 'damage-lab', 'pokedex', 'ai-builder', 'analyzer', 'simulator', 'pvp-battles'];
    const shouldLoadTeamIntel =
      tabsNeedingIntel.includes(activeTab) ||
      Boolean(simPreview || simBattle || pvpRoom?.battle);
    if (!shouldLoadTeamIntel || hasTeamIntelRuntime()) {
      if (hasTeamIntelRuntime() && !teamIntelReady) {
        setTeamIntelReady(true);
      }
      return;
    }

    let cancelled = false;
    void ensureTeamIntelRuntime().then(() => {
      if (!cancelled) {
        setTeamIntelReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, pvpRoom?.battle, simBattle, simPreview, teamIntelReady]);

  useEffect(() => {
    const shouldLoadOnlineRuntime =
      activeTab === 'pvp-battles' ||
      Boolean(pvpRoom) ||
      (activeTab === 'profile' && Boolean(onlineAccount));
    if (!shouldLoadOnlineRuntime || hasOnlineRuntime()) {
      if (hasOnlineRuntime() && !onlineRuntimeReady) {
        setOnlineRuntimeReady(true);
      }
      return;
    }

    let cancelled = false;
    void ensureOnlineRuntime().then(() => {
      if (!cancelled) {
        setOnlineRuntimeReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, onlineAccount, onlineRuntimeReady, pvpRoom]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      saveState(state);
      setLastSavedAt(new Date().toISOString());
      setSaveMessage('Auto-saved locally');
    }, 180);

    return () => window.clearTimeout(handle);
  }, [state]);

  useEffect(() => {
    if (!state.profile.trainerName.trim() || state.profile.profileCreatedAt) {
      return;
    }

    setState((current) => ({
      ...current,
      profile: {
        ...current.profile,
        profileCreatedAt: new Date().toISOString(),
      },
    }));
  }, [state.profile.trainerName, state.profile.profileCreatedAt]);

  useEffect(() => {
    if (!selectedDamageMoveId && attackerMoves[0]) {
      setSelectedDamageMoveId(attackerMoves[0].id);
    }
  }, [attackerMoves, selectedDamageMoveId]);

  useEffect(() => {
    if (!simPreview && !simBattle) {
      setSimBattlefieldSeed(`sim-idle-${simFormat}`);
    }
  }, [simBattle, simFormat, simPreview]);

  useEffect(() => {
    const nextStage = simBattle?.stage ?? null;
    if (nextStage === 'battle' && previousSimStageRef.current !== 'battle') {
      setSimBattleMusicSeed((current) => current + 1);
    }
    previousSimStageRef.current = nextStage;
  }, [simBattle?.stage]);

  useEffect(() => {
    if (!simPreview) {
      setSimCountdown(0);
      return;
    }

    const tick = () => setSimCountdown(Math.max(0, Math.ceil((simPreview.previewEndsAt - Date.now()) / 1000)));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [simPreview]);

  useEffect(() => {
    if (activeTab !== 'profile' && profileMusicPreviewActive) {
      setProfileMusicPreviewActive(false);
    }
  }, [activeTab, profileMusicPreviewActive]);

  useEffect(() => {
    simBattleRef.current = simBattle;
  }, [simBattle]);

  useEffect(() => {
    pvpRoomRef.current = pvpRoom;
  }, [pvpRoom]);

  useEffect(() => {
    simChoiceDraftsRef.current = simChoiceDrafts;
  }, [simChoiceDrafts]);

  useEffect(() => {
    simTurnReviewsRef.current = simTurnReviews;
  }, [simTurnReviews]);

  useEffect(() => {
    simChoicesLockedRef.current = simChoicesLocked;
  }, [simChoicesLocked]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      const nextStats = await heartbeatPresence(onlineSessionId);
      if (mounted) {
        setPresenceStats(nextStats);
      }
    };

    void tick();
    const handle = window.setInterval(() => {
      void tick();
    }, 15_000);

    return () => {
      mounted = false;
      window.clearInterval(handle);
    };
  }, [onlineSessionId]);

  useEffect(() => {
    if (!simBattle) {
      previousBattleRef.current = null;
      recordedBattleKeyRef.current = null;
      setSimBattlefieldEvent(null);
      setSimTurnClock(30);
      return;
    }

    if (simBattle.stage === 'battle' && !simBattle.winner) {
      pushAnnouncerLines([
        announcerStyleLine(simAnnouncerStyle, fillAnnouncerLine(pickLine(announcerScripts.turn), { turn: simBattle.turn })),
      ]);
    }

    const previousBattle = previousBattleRef.current;
    const recentEntries = recentBattleLogEntries(simBattle.log, previousBattle?.log ?? null);
    const nextBattlefieldEvent = parseBattlefieldPlaybackEvent(recentEntries, simBattle);
    if (nextBattlefieldEvent) {
      setSimBattlefieldEvent(nextBattlefieldEvent);
    }
    const commentaryLines = announcerLinesFromBattleUpdate(previousBattle, simBattle, simAnnouncerStyle);
    if (commentaryLines.length) {
      pushAnnouncerLines(commentaryLines, Boolean(simBattle.winner) || simBattle.stage === 'finished');
    }

    if (simBattle.stage === 'finished') {
      const battleKey = `${simBattle.winner ?? 'draw'}-${simBattle.turn}-${simBattle.player.units.map((unit) => unit.pokemon.id).join('|')}-${simBattle.opponent.units.map((unit) => unit.pokemon.id).join('|')}`;
      if (recordedBattleKeyRef.current !== battleKey) {
        const record = buildSimulatorMatchRecord(
          simBattle,
          team.name,
          simAnnouncerEnabled,
          simTurnTimerEnabled,
          [...simBattle.log].reverse(),
          simTurnReviewsRef.current,
          'AI Simulator',
          {
            musicTrackId: state.profile.preferredBattleTrackId,
            resultReason: simBattle.winner ? 'normal' : 'timeout',
          },
        );
        setState((current) => ({
          ...current,
          profile: {
            ...current.profile,
            matchHistory: [...current.profile.matchHistory, record].slice(-80),
          },
        }));
        setSelectedReplayId(record.id);
        recordedBattleKeyRef.current = battleKey;
      }
    }

    previousBattleRef.current = simBattle;
  }, [simBattle, simAnnouncerEnabled, simAnnouncerStyle, simTurnTimerEnabled, team.name]);

  useEffect(() => {
    if (!simBattle || simBattle.stage !== 'battle' || simBattle.winner) {
      return;
    }

    const playerPending = pendingReplacementActors(simBattle.player);
    const opponentPending = pendingReplacementActors(simBattle.opponent);
    if (playerPending.length || !opponentPending.length) {
      return;
    }

    const nextBattle = applyReplacementChoices(simBattle, [], buildAutoReplacementChoices(simBattle, 'opponent'));
    setSimBattle(nextBattle);
    setSimTurnNotice('Arena AI sent out its replacement at the top of the turn. Pick your next action when ready.');
  }, [simBattle]);

  useEffect(() => {
    const nextStage = pvpRoom?.stage ?? null;
    if (nextStage === 'battle' && previousPvpStageRef.current !== 'battle') {
      setPvpBattleMusicSeed((current) => current + 1);
    }
    previousPvpStageRef.current = nextStage;
  }, [pvpRoom?.stage]);

  useEffect(() => {
    if (!pvpRoom || !onlineAccount) {
      previousPvpBattleRef.current = null;
      recordedPvpBattleKeyRef.current = null;
      setPvpBattlefieldEvent(null);
      return;
    }

    if (pvpRoom.battle) {
      const pvpAnnouncerEnabled = pvpRoom.seat === 'host' ? pvpRoom.hostAnnouncerEnabled : pvpRoom.guestAnnouncerEnabled;
      const recentEntries = recentBattleLogEntries(pvpRoom.battle.log, previousPvpBattleRef.current?.log ?? null);
      const nextBattlefieldEvent = parseBattlefieldPlaybackEvent(recentEntries, pvpRoom.battle);
      if (nextBattlefieldEvent) {
        setPvpBattlefieldEvent(nextBattlefieldEvent);
      }
      const pvpLines = announcerLinesFromBattleUpdate(previousPvpBattleRef.current, pvpRoom.battle, 'Arena');
      if (pvpAnnouncerEnabled && pvpLines.length) {
        setPvpAnnouncerFeed((current) => [...pvpLines.slice().reverse(), ...current].slice(0, 16));
        speakAnnouncerLines(pvpLines, 1, Boolean(pvpRoom.battle.winner) || pvpRoom.stage === 'finished');
      }

      if (pvpRoom.stage === 'finished') {
        const battleKey = `${pvpRoom.code}-${pvpRoom.battle.turn}-${pvpRoom.battle.winner ?? 'draw'}-${pvpRoom.resultReason ?? 'normal'}`;
        if (recordedPvpBattleKeyRef.current !== battleKey) {
          const record = buildSimulatorMatchRecord(
            pvpRoom.battle,
            team.name,
            pvpAnnouncerEnabled,
            true,
            [...pvpRoom.battle.log].reverse(),
            [],
            'PvP',
            {
              opponentName: pvpRoom.seat === 'host' ? pvpRoom.guestTrainerName ?? 'Opponent' : pvpRoom.hostTrainerName,
              roomCode: pvpRoom.code,
              musicTrackId: pvpRoom.musicTrackId,
              resultReason: pvpRoom.resultReason ?? 'normal',
            },
          );
          setState((current) => ({
            ...current,
            profile: {
              ...current.profile,
              matchHistory: [...current.profile.matchHistory, record].slice(-80),
            },
          }));
          setSelectedReplayId(record.id);
          if (pvpAnnouncerEnabled && !pvpLines.length) {
            const wrapUpLines = announcerLinesFromBattleUpdate(null, pvpRoom.battle, 'Arena');
            setPvpAnnouncerFeed((current) => [...wrapUpLines.slice().reverse(), ...current].slice(0, 16));
            speakAnnouncerLines(wrapUpLines, 1, true);
          }
          recordedPvpBattleKeyRef.current = battleKey;
        }
      }
      previousPvpBattleRef.current = pvpRoom.battle;
    }
  }, [pvpRoom, onlineAccount]);

  useEffect(() => {
    if (!simBattlefieldEvent) {
      return;
    }

    const handle = window.setTimeout(() => setSimBattlefieldEvent(null), 2600);
    return () => window.clearTimeout(handle);
  }, [simBattlefieldEvent?.id]);

  useEffect(() => {
    if (!pvpBattlefieldEvent) {
      return;
    }

    const handle = window.setTimeout(() => setPvpBattlefieldEvent(null), 2600);
    return () => window.clearTimeout(handle);
  }, [pvpBattlefieldEvent?.id]);

  useEffect(() => {
    if (!pvpRoom || !onlineAccount || !pvpRoom.code) {
      return;
    }

    let mounted = true;
    const poll = async () => {
      const latest = await fetchOnlineRoom({ account: onlineAccount, code: pvpRoom.code });
      if (mounted) {
        setPvpRoom(latest);
      }
    };

    void poll();
    const handle = window.setInterval(() => {
      void poll();
    }, 2_500);

    return () => {
      mounted = false;
      window.clearInterval(handle);
    };
  }, [pvpRoom?.code, onlineAccount]);

  useEffect(() => {
    if (!onlineAccount) {
      setPvpRoomHistory([]);
      return;
    }

    let mounted = true;
    const loadHistory = async () => {
      const history = await fetchOnlineRoomHistory({ account: onlineAccount });
      if (mounted) {
        setPvpRoomHistory(history);
      }
    };

    void loadHistory();
    return () => {
      mounted = false;
    };
  }, [onlineAccount, pvpRoom?.stage, pvpRoom?.code]);

  useEffect(() => {
    if (!pvpRoom?.deadlineAt) {
      setPvpCountdown(0);
      return;
    }

    const tick = () => setPvpCountdown(Math.max(0, Math.ceil((new Date(pvpRoom.deadlineAt!).getTime() - Date.now()) / 1000)));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [pvpRoom?.deadlineAt]);

  useEffect(() => {
    if (!pvpRoom?.matchDeadlineAt) {
      setPvpMatchCountdown(8 * 60);
      return;
    }

    const tick = () => setPvpMatchCountdown(Math.max(0, Math.ceil((new Date(pvpRoom.matchDeadlineAt!).getTime() - Date.now()) / 1000)));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [pvpRoom?.matchDeadlineAt]);

  useEffect(() => {
    if (!pvpRoom || pvpRoom.stage !== 'battle' || !pvpRoom.battle || pvpRoom.playerChoicesLocked || pvpCountdown > 0) {
      return;
    }

    void submitPvpTurn(true);
  }, [pvpCountdown, pvpRoom?.code, pvpRoom?.stage, pvpRoom?.playerChoicesLocked, pvpRoom?.battle]);

  useEffect(() => {
    if (!simBattle || simBattle.stage !== 'battle' || simBattle.winner || !simTurnTimerEnabled) {
      setSimTurnClock(30);
      setSimChoicesLocked(false);
      return;
    }

    setSimTurnClock(30);
    setSimChoicesLocked(false);
    const intervalHandle = window.setInterval(() => {
      setSimTurnClock((current) => Math.max(0, current - 1));
    }, 1000);
    const timeoutHandle = window.setTimeout(() => {
      resolveSimulatorTurn(true);
    }, 30_000);

    return () => {
      window.clearInterval(intervalHandle);
      window.clearTimeout(timeoutHandle);
    };
  }, [simDecisionPhaseKey, simBattle?.stage, simBattle?.winner, simTurnTimerEnabled]);

  useEffect(() => {
    if (!simMatchDeadlineAt || !simBattle || simBattle.stage !== 'battle') {
      setSimMatchClock(8 * 60);
      return;
    }

    const tick = () => setSimMatchClock(Math.max(0, Math.ceil((new Date(simMatchDeadlineAt).getTime() - Date.now()) / 1000)));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [simMatchDeadlineAt, simBattle?.stage]);

  useEffect(() => {
    if (!simBattle || simBattle.stage !== 'battle' || simBattle.winner || !simAnnouncerEnabled || !simTurnTimerEnabled) {
      return;
    }

    if ([30, 20, 10, 5].includes(simTurnClock)) {
      const countdownLine = announcerCountdownAnalysis(simBattle, simAnnouncerStyle, simTurnClock);
      pushAnnouncerLines([
        announcerStyleLine(
          simAnnouncerStyle,
          `${fillAnnouncerLine(pickLine(announcerScripts.turn), { turn: simBattle.turn })} ${simTurnClock} seconds remain on the move clock.`,
        ),
        countdownLine ?? '',
      ]);
    }
  }, [simTurnClock, simBattle, simAnnouncerEnabled, simTurnTimerEnabled, simAnnouncerStyle]);

  useEffect(() => {
    if (!simBattle || simBattle.stage !== 'battle' || !simMatchDeadlineAt) {
      return;
    }

    if (simMatchClock <= 0) {
      finishTimedOutSimBattle();
      return;
    }

    if (simMatchClock <= 30) {
      setSimTurnNotice(`Match timer: ${simMatchClock}s remain before this battle is forced to finish.`);
    }

    if ([60, 30, 10, 5].includes(simMatchClock)) {
      const warning = simMatchClock >= 60
        ? `Match timer warning: ${Math.ceil(simMatchClock / 60)} minute remains in this battle.`
        : `Match timer warning: ${simMatchClock} seconds remain in this battle.`;
      setSimTurnNotice(warning);
      if (simAnnouncerEnabled) {
        pushAnnouncerLines([warning], simMatchClock === 60);
      }
    }
  }, [simMatchClock, simBattle, simMatchDeadlineAt, simAnnouncerEnabled]);

  useEffect(() => {
    if (!pvpRoom?.battle || pvpRoom.stage !== 'battle' || !pvpCountdown) {
      return;
    }

    const pvpAnnouncerEnabled = pvpRoom.seat === 'host' ? pvpRoom.hostAnnouncerEnabled : pvpRoom.guestAnnouncerEnabled;
    if (!pvpAnnouncerEnabled || ![30, 20, 10, 5].includes(pvpCountdown)) {
      return;
    }

    const line = announcerCountdownAnalysis(pvpRoom.battle, 'Arena', pvpCountdown);
    if (!line) {
      return;
    }

    setPvpAnnouncerFeed((current) => [line, ...current].slice(0, 16));
    speakAnnouncerLines([line], 1);
  }, [pvpCountdown, pvpRoom]);

  useEffect(() => {
    if (!pvpRoom || pvpRoom.stage !== 'battle' || !pvpRoom.matchDeadlineAt) {
      return;
    }

    if (pvpMatchCountdown <= 30 && pvpMatchCountdown > 0) {
      setPvpMessage(`Match timer: ${pvpMatchCountdown}s remain before this room is forced to end.`);
    }

    if ([60, 30, 10, 5].includes(pvpMatchCountdown)) {
      const line = pvpMatchCountdown >= 60
        ? `Match timer warning: ${Math.ceil(pvpMatchCountdown / 60)} minute remains in room ${pvpRoom.code}.`
        : `Match timer warning: ${pvpMatchCountdown} seconds remain in room ${pvpRoom.code}.`;
      setPvpMessage(line);
      const announcerEnabled = pvpRoom.seat === 'host' ? pvpRoom.hostAnnouncerEnabled : pvpRoom.guestAnnouncerEnabled;
      if (announcerEnabled) {
        setPvpAnnouncerFeed((current) => [line, ...current].slice(0, 16));
        speakAnnouncerLines([line], 1, pvpMatchCountdown === 60);
      }
    }
  }, [pvpMatchCountdown, pvpRoom]);

  function updateState(mutator: (draft: ReturnType<typeof createDefaultState>) => ReturnType<typeof createDefaultState>) {
    setState((current) => mutator(current));
  }

  function requireProfileForPersistentTeamSave(actionLabel: string) {
    if (profileReady) {
      return true;
    }

    setActiveTab('profile');
    setLastSavedAt(new Date().toISOString());
    setSaveMessage(`${actionLabel} needs a trainer profile first. Add a trainer name in Profile before saving teams.`);
    return false;
  }

  function persistNow(message: string, requiresProfile = false, actionLabel = 'Saving your team data') {
    if (requiresProfile && !requireProfileForPersistentTeamSave(actionLabel)) {
      return;
    }
    saveState(state);
    setLastSavedAt(new Date().toISOString());
    setSaveMessage(message);
  }

  function finishTimedOutSimBattle() {
    setSimBattle((current) => {
      if (!current || current.stage !== 'battle') {
        return current;
      }
      const next = structuredClone(current);
      next.stage = 'finished';
      next.winner = null;
      next.log.unshift('Match timer expired. Under the current Pokemon Champions timeout rule, the battle ends in a draw.');
      return next;
    });
    setSimMatchDeadlineAt(null);
    setSimChoicesLocked(false);
    setSimTurnNotice('Match timer expired. This battle has been recorded as a draw.');
    if (simAnnouncerEnabled) {
      pushAnnouncerLines(['Time is up. This match is ending as a draw.'], true);
    }
  }

  function pushAnnouncerLines(lines: string[], interrupt = false) {
    const nextLines = lines.filter(Boolean);
    if (!simAnnouncerEnabled || !nextLines.length) {
      return;
    }

    setSimAnnouncerFeed((current) => [...nextLines.slice().reverse(), ...current].slice(0, 14));
    speakAnnouncerLines(nextLines, simAnnouncerRate, interrupt);
  }

  function buildSimulatorChoices(
    battle: SimulatorBattleState,
    drafts: Record<number, ChoiceDraft>,
    timedOut = false,
  ) {
    const requiredActors = battle.player.active
      .map((unitIndex, actor) => ({ unitIndex, actor }))
      .filter(({ unitIndex }) => {
        const unit = battle.player.units[unitIndex];
        return unit && !unit.fainted;
      })
      .map(({ actor }) => actor);

    const notices: string[] = [];
    const choices: SimulatorChoice[] = [];
    const reviews: SimulatorTurnReview[] = [];

    for (const actor of requiredActors) {
      const unit = battle.player.units[battle.player.active[actor]];
      if (!unit) {
        continue;
      }

      const legalMoves = legalMovesForUnit(unit);
      const fallbackMove =
        legalMoves[0]
        ?? unit.pokemon.movePool.find((move) => move.id === unit.chargingMoveId)
        ?? unit.pokemon.movePool.find((move) => unit.build.moveIds.includes(move.id))
        ?? unit.pokemon.movePool[0]
        ?? null;
      const liveTargets = livingTargetSlots(battle.opponent);
      const randomTarget = liveTargets[Math.floor(Math.random() * Math.max(1, liveTargets.length))]?.targetIndex ?? 0;
      const draft = drafts[actor];
      let choice: SimulatorChoice;

      if (draft?.type === 'switch') {
        const switchIsLegal = battle.player.bench.includes(draft.switchTarget) && !battle.player.units[draft.switchTarget]?.fainted;
        if (switchIsLegal) {
          choice = {
            type: 'switch',
            actor,
            target: draft.switchTarget,
          } satisfies SimulatorChoice;
        } else {
          choice = {
            type: 'move',
            actor,
            moveId: fallbackMove?.id ?? '',
            target: randomTarget,
          } satisfies SimulatorChoice;
        }
      } else if (draft && fallbackMove) {
        const selectedMove = legalMoves.find((move) => move.id === draft.moveId) ?? fallbackMove;
        const selectedTarget = liveTargets.some((entry) => entry.targetIndex === draft.target) ? draft.target : randomTarget;
        choice = {
          type: draft.type,
          actor,
          moveId: selectedMove.id,
          target: selectedTarget,
        } satisfies SimulatorChoice;
      } else {
        choice = {
          type: 'move',
          actor,
          moveId: fallbackMove?.id ?? '',
          target: randomTarget,
        } satisfies SimulatorChoice;
      }

      const wasAutoSelected =
        timedOut &&
        unit.rechargeTurns <= 0 &&
        unit.chargingTurns <= 0 &&
        (!draft || (draft.type !== 'switch' && !legalMoves.some((move) => move.id === draft.moveId)));
      if (wasAutoSelected) {
        notices.push(`Your ${unit.pokemon.displayName} move was randomly selected due to no selection made.`);
      }

      choices.push(choice);
      const review = buildTurnReviewEntry(battle, actor, choice);
      if (review) {
        reviews.push(review);
      }
    }

    return {
      choices,
      notices,
      reviews,
    };
  }

  function buildReplacementChoices(
    battle: SimulatorBattleState,
    drafts: Record<number, ChoiceDraft>,
    timedOut = false,
  ) {
    const requiredActors = pendingReplacementActors(battle.player);
    const availableBench = battle.player.bench.filter((unitIndex) => unitIndex >= 0 && !battle.player.units[unitIndex]?.fainted);
    const claimedTargets = new Set<number>();
    const notices: string[] = [];
    const choices: SimulatorChoice[] = [];

    for (const actor of requiredActors) {
      const draft = drafts[actor];
      const preferredTarget = draft?.type === 'switch' ? draft.switchTarget : null;
      const replacementTarget =
        typeof preferredTarget === 'number' && availableBench.includes(preferredTarget) && !claimedTargets.has(preferredTarget)
          ? preferredTarget
          : availableBench.find((unitIndex) => !claimedTargets.has(unitIndex)) ?? null;
      if (replacementTarget === null) {
        continue;
      }

      claimedTargets.add(replacementTarget);
      choices.push({
        type: 'switch',
        actor,
        target: replacementTarget,
      } satisfies SimulatorChoice);

      if (timedOut && preferredTarget !== replacementTarget) {
        const replacement = battle.player.units[replacementTarget];
        notices.push(`Your replacement for lane ${actor + 1} was auto-selected as ${replacement?.pokemon.displayName ?? 'a legal bench option'} due to no selection made.`);
      }
    }

    return {
      choices,
      notices,
    };
  }

  function resolveSimulatorTurn(timedOut = false) {
    const currentBattle = simBattleRef.current;
    if (!currentBattle || currentBattle.stage !== 'battle') {
      return;
    }
    if (!hasBattleCoreRuntime()) {
      setSimTurnNotice('Battle engine is still loading. Give the simulator a moment and try again.');
      return;
    }

    if (battleHasPendingReplacements(currentBattle)) {
      const { choices, notices } = buildReplacementChoices(currentBattle, simChoiceDraftsRef.current, timedOut);
      const nextBattle = applyReplacementChoices(currentBattle, choices, buildAutoReplacementChoices(currentBattle, 'opponent'));
      setSimBattle(nextBattle);
      setSimChoiceDrafts({});
      setSimChoicesLocked(false);
      setSimTurnNotice(
        notices.length
          ? notices.join(' ')
          : 'Replacement choices are locked. The next turn will begin once the new Pokemon hit the field.',
      );
      return;
    }

    const { choices, notices, reviews } = buildSimulatorChoices(currentBattle, simChoiceDraftsRef.current, timedOut);
    const nextBattle = resolveTurn(currentBattle, choices);
    setSimBattle(nextBattle);
    setSimChoiceDrafts({});
    setSimChoicesLocked(false);
    setSimTurnReviews((current) => [...current, ...reviews]);
    setSimTurnNotice(notices.length ? notices.join(' ') : null);
  }

  function enforceManualItemClause(nextTeam: Team, preferredSlotIndex?: number) {
    if (typeof preferredSlotIndex !== 'number') {
      return sanitizeTeamForChampions(nextTeam);
    }

    const draft = {
      ...nextTeam,
      slots: nextTeam.slots.map((slot) => normalizeBuildForChampions(slot)),
    };
    const preferredBuild = draft.slots[preferredSlotIndex];
    if (preferredBuild?.itemId) {
      const duplicateExists = draft.slots.some((slot, index) => index !== preferredSlotIndex && slot.itemId === preferredBuild.itemId);
      if (duplicateExists) {
        draft.slots[preferredSlotIndex] = {
          ...preferredBuild,
          itemId: null,
        };
      }
    }

    return sanitizeTeamForChampions(draft);
  }

  function updateTeam(mutator: (nextTeam: Team) => Team, preferredSlotIndex?: number) {
    updateState((current) => ({
      ...current,
      teams: current.teams.map((entry) => (
        entry.id === team.id
          ? enforceManualItemClause(mutator(cloneTeam(entry)), preferredSlotIndex)
          : sanitizeTeamForChampions(entry)
      )),
    }));
  }

  function updateSlot(index: number, nextBuild: PokemonBuild) {
    updateTeam((currentTeam) => {
      const nextTeam = cloneTeam(currentTeam);
      nextTeam.slots[index] = normalizeBuildForChampions(nextBuild);
      nextTeam.updatedAt = new Date().toISOString();
      return nextTeam;
    }, index);
  }

  function createNewTeam() {
    if (state.teams.length >= 10) {
      return;
    }

    const nextTeam = createTeam(`New Team ${state.teams.length + 1}`, state.profile.favoriteFormat);
    setState((current) => ({
      ...current,
      teams: [...current.teams, nextTeam],
      activeTeamId: nextTeam.id,
    }));
    setSelectedSlotIndex(0);
  }

  function duplicateCurrentTeam() {
    if (state.teams.length >= 10) {
      return;
    }

    const duplicate = cloneTeam(team);
    duplicate.id = makeId('team');
    duplicate.name = `${team.name} Copy`;
    duplicate.createdAt = new Date().toISOString();
    duplicate.updatedAt = duplicate.createdAt;
    setState((current) => ({
      ...current,
      teams: [...current.teams, duplicate],
      activeTeamId: duplicate.id,
    }));
  }

  function deleteCurrentTeam() {
    if (state.teams.length === 1) {
      return;
    }

    const remaining = state.teams.filter((entry) => entry.id !== team.id);
    setState((current) => ({
      ...current,
      teams: remaining,
      activeTeamId: remaining[0].id,
    }));
    setSelectedSlotIndex(0);
  }

  function importSlotIntoCalc(sourceIndex: number, side: 'attacker' | 'defender') {
    const source = team.slots[sourceIndex];
    if (!source) {
      return;
    }

    const next = copyBuild(source);
    next.id = makeId(side);
    if (side === 'attacker') {
      setCalcAttacker(next);
    } else {
      setCalcDefender(next);
    }
  }

  async function runAiBuilder() {
    if (!teamIntelReady) {
      setAiBuilderMessage('Loading AI team planning, usage reads, and preset logic. Try again in a moment.');
      await ensureTeamIntelRuntime();
      setTeamIntelReady(true);
    }

    const validations = validateLockedPokemonInputs(aiLockedNames, aiFormat);
    const unresolved = validations.filter((validation) => validation.input.trim() && !validation.isValid && !validation.autoReplacement);
    if (unresolved.length) {
      setAiBuilderMessage(`The AI Builder needs live Champions roster matches before it can lock every requested core. Check the replacement suggestions beneath those inputs.`);
      return;
    }

    const resolvedLockedNames = lockedNamesFromValidations(validations);
    const nextLockedNames = displayNamesFromValidations(validations, aiLockedNames);
    if (nextLockedNames.some((name, index) => name !== aiLockedNames[index])) {
      setAiLockedNames(nextLockedNames);
    }

    const replacementNotes = validations
      .filter((validation) => validation.input.trim() && !validation.isValid && validation.autoReplacement)
      .map((validation) => `${validation.input.trim()} -> ${validation.autoReplacement?.displayName}`);
    setAiBuilderMessage(
      replacementNotes.length
        ? `The AI Builder kept your locked core legal with live Champions replacements: ${replacementNotes.join(', ')}.`
        : 'Locked core validated against the live Champions dex.',
    );

    startTransition(() => {
      const plans = generateTeamPlans(
        selectedArchetype,
        aiFormat,
        state.profile.offMetaBias,
        resolvedLockedNames,
        aiVariantCount,
        aiRandomMode,
      );
      const previousSignature = planSignature(selectedGeneratedPlan);
      const preferredPlan = aiRandomMode
        ? plans.find((plan) => planSignature(plan) !== previousSignature) ?? plans[0] ?? null
        : plans[0] ?? null;
      setGeneratedPlans(plans);
      setSelectedGeneratedPlanId(preferredPlan?.id ?? null);
    });
  }

  function applyGeneratedPlan(plan = selectedGeneratedPlan) {
    if (!plan) {
      return;
    }

    updateTeam((currentTeam) => {
      const nextTeam = cloneTeam(currentTeam);
      nextTeam.name = plan.name;
      nextTeam.format = plan.format;
      nextTeam.notes = `${plan.summary}\n\n${plan.reasons.join('\n')}\n\n${plan.expertNotes.join('\n')}`;
      nextTeam.slots = plan.slots.map(copyBuild);
      nextTeam.updatedAt = new Date().toISOString();
      return nextTeam;
    });
    setActiveTab('team-builder');
  }

  function saveGeneratedPlanAsTeam(plan = selectedGeneratedPlan) {
    if (!plan) {
      return;
    }

    if (!requireProfileForPersistentTeamSave('Saving AI teams')) {
      return;
    }

    if (state.teams.length >= 10) {
      setLastSavedAt(new Date().toISOString());
      setSaveMessage('Team cap reached. Remove or duplicate a team before saving another AI draft.');
      return;
    }

    const nextTeam = sanitizeTeamForChampions(buildTeamFromPlan(plan));
    const existingNames = new Set(state.teams.map((entry) => entry.name));
    let nextName = nextTeam.name.trim() || `AI Team ${state.teams.length + 1}`;
    let suffix = 2;
    while (existingNames.has(nextName)) {
      nextName = `${nextTeam.name.trim() || 'AI Team'} ${suffix}`;
      suffix += 1;
    }
    nextTeam.name = nextName;

    setState((current) => ({
      ...current,
      teams: [...current.teams, nextTeam],
      activeTeamId: nextTeam.id,
    }));
    setSelectedSlotIndex(0);
    setActiveTab('team-builder');
    setLastSavedAt(new Date().toISOString());
    setSaveMessage(`Saved ${nextTeam.name} to your team list`);
  }

  function resetEverything() {
    clearState();
    const next = createDefaultState();
    setState(next);
    setCalcAttacker(copyBuild(next.teams[0].slots[0]));
    setCalcDefender(copyBuild(next.teams[0].slots[1]));
    setEnvironment({
      ...defaultEnvironment,
      battleFormat: next.teams[0].format,
    });
    setGeneratedPlans([]);
    setSelectedGeneratedPlanId(null);
    setSimPreview(null);
    setSimBattle(null);
    setSimMatchDeadlineAt(null);
    setSimBringOrder([]);
    setSimChoiceDrafts({});
    setSimChoicesLocked(false);
    setSimTurnReviews([]);
    setSimAnnouncerFeed([]);
    setSimTurnNotice(null);
    setSelectedReplayId(null);
    setSelectedSlotIndex(0);
  }

  async function startSimulatorPreview() {
    if (!battleCoreReady) {
      setSimPreviewMessage('Loading the battle engine and damage runtime. Try again in a moment.');
      void ensureBattleCoreRuntime().then(() => setBattleCoreReady(true));
      return;
    }
    if (!teamIntelReady) {
      setSimPreviewMessage('Loading AI matchup planning and opponent draft logic. Try again in a moment.');
      await ensureTeamIntelRuntime();
      setTeamIntelReady(true);
    }
    const selectable = filledSlotIndices(team);
    if (selectable.length < 4) {
      return;
    }

    const opponentTeam = randomOpponentTeam(simFormat, state.profile.offMetaBias);
    setSimBattlefieldSeed(`sim-preview-${Date.now()}-${opponentTeam.id}-${simFormat}`);
    setSimPreview({
      format: simFormat,
      opponentTeam,
      previewEndsAt: Date.now() + 60_000,
    });
    setSimBringOrder([]);
    setSimPreviewMessage(null);
    setSimBattle(null);
    setSimMatchDeadlineAt(null);
    setSimChoiceDrafts({});
    setSimChoicesLocked(false);
    setSimTurnReviews([]);
    setSimAnnouncerFeed([]);
    setSimTurnNotice(null);
    setSimAnnouncerEnabled(state.profile.announcerDefaultEnabled);
    if (state.profile.announcerDefaultEnabled) {
      const spotlight = filledSlotIndices(opponentTeam)
        .slice(0, 2)
        .map((slotIndex) => {
          const build = opponentTeam.slots[slotIndex];
          return (selectedPokemon(build) ?? resolvePokemonForm(build))?.displayName ?? 'that threat';
        })
        .join(' and ');
      pushAnnouncerLines([
        announcerStyleLine(simAnnouncerStyle, fillAnnouncerLine(pickLine(announcerScripts.preview), { pokemon: spotlight || 'the preview board' })),
        announcerStyleLine(simAnnouncerStyle, fillAnnouncerLine(pickLine(announcerScripts.preview), { pokemon: spotlight || 'the opening core' })),
      ]);
    }
  }

  function toggleBringIndex(slotIndex: number) {
    setSimPreviewMessage(null);
    setSimBringOrder((current) => {
      if (current.includes(slotIndex)) {
        return current.filter((entry) => entry !== slotIndex);
      }
      if (current.length >= 4) {
        return current;
      }
      return [...current, slotIndex];
    });
  }

  function beginSimBattle() {
    if (!simPreview) {
      return;
    }
    if (!battleCoreReady) {
      setSimPreviewMessage('Battle engine still loading. Hold for a moment, then start the match again.');
      return;
    }

    if (simBringOrder.length !== 4) {
      setSimPreviewMessage(`Select exactly 4 Pokemon before starting the battle. Current lock-in: ${simBringOrder.length}/4.`);
      return;
    }

    const playerTeam = cloneTeam(team);
    playerTeam.format = simPreview.format;
    const opponentOrder = chooseOpponentBringOrder(simPreview.format, simPreview.opponentTeam, playerTeam, simBringOrder);
    const battle = advancePreviewToBattle(createSimulatorBattle(simPreview.format, playerTeam, simBringOrder, simPreview.opponentTeam, opponentOrder, simPreview.previewEndsAt));
    if (battle.player.units.length !== simBringOrder.length) {
      setSimPreviewMessage(`One of the selected player slots no longer maps to a legal Champions Pokemon. Re-lock your four and try again.`);
      return;
    }
    if (battle.opponent.units.length !== opponentOrder.length) {
      setSimPreviewMessage(`The generated opponent preview drifted out of sync. Generate a fresh opponent and try again.`);
      return;
    }
    battle.player.name = state.profile.trainerName.trim() || 'Player';
    battle.opponent.name = 'Arena AI';
    setSimBattle(battle);
    setSimMatchDeadlineAt(new Date(Date.now() + 8 * 60_000).toISOString());
    setSimPreview(null);
    setSimPreviewMessage(null);
    setSimChoiceDrafts({});
    setSimChoicesLocked(false);
    setSimTurnClock(30);
    setSimTurnNotice(null);
  }

  function updateChoiceDraft(actor: number, partial: Partial<ChoiceDraft>) {
    setSimChoiceDrafts((current) => mergeChoiceDraftWithSingleMegaRule(
      current,
      actor,
      {
        type: 'move' as const,
        moveId: simBattle?.player.units[simBattle.player.active[actor]]?.build.moveIds[0] ?? '',
        target: 0,
        switchTarget: simBattle?.player.bench[0] ?? 0,
      },
      partial,
    ));
  }

  function updatePvpChoiceDraft(actor: number, partial: Partial<ChoiceDraft>) {
    setPvpChoiceDrafts((current) => mergeChoiceDraftWithSingleMegaRule(
      current,
      actor,
      {
        type: 'move' as const,
        moveId: pvpRoom?.battle?.player.units[pvpRoom.battle.player.active[actor]]?.build.moveIds[0] ?? '',
        target: 0,
        switchTarget: pvpRoom?.battle?.player.bench[0] ?? 0,
      },
      partial,
    ));
  }

  function submitSimTurn() {
    if (simBattle && simBattleNeedsReplacementPhase) {
      resolveSimulatorTurn(false);
      return;
    }

    if (simTurnTimerEnabled && simBattle?.stage === 'battle' && !simBattle.winner) {
      setSimChoicesLocked(false);
      setSimTurnNotice('Choices submitted. Resolving the turn now.');
    }
    resolveSimulatorTurn(false);
  }

  async function registerForOnlineBattles() {
    try {
      const account = await registerOnlineAccount({
        trainerName: state.profile.trainerName.trim() || onlineLookup.trim(),
        email: onlineEmail,
        password: onlinePassword,
      });
      setState((current) => ({
        ...current,
        profile: {
          ...current.profile,
          trainerName: current.profile.trainerName || account.trainerName,
          onlineAccount: account,
        },
      }));
      setOnlineStatusMessage(`Registered ${account.trainerName} for live battles.`);
    } catch (error) {
      setOnlineStatusMessage(error instanceof Error ? error.message : 'Registration failed.');
    }
  }

  async function loginForOnlineBattles() {
    try {
      const account = await loginOnlineAccount({
        trainerNameOrEmail: onlineLookup,
        password: onlinePassword,
      });
      setState((current) => ({
        ...current,
        profile: {
          ...current.profile,
          trainerName: current.profile.trainerName || account.trainerName,
          onlineAccount: account,
        },
      }));
      setOnlineStatusMessage(`Signed in as ${account.trainerName}.`);
    } catch (error) {
      setOnlineStatusMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    }
  }

  async function createPvpRoomNow() {
    if (!onlineAccount) {
      setOnlineStatusMessage('Register or sign in before creating a live battle room.');
      return;
    }

    try {
      const room = await createOnlineRoom({
        account: onlineAccount,
        team: sanitizeTeamForChampions(cloneTeam(team)),
        format: team.format,
        musicTrackId: primaryBattleMusicTrackId(state.profile.preferredBattleTrackId, state.profile.battleMusicPlaylistIds),
        announcerEnabled: state.profile.announcerDefaultEnabled,
      });
      setPvpRoom(room);
      setPvpRoomCodeInput(room.code);
      setPvpBringOrder([]);
      setPvpChoiceDrafts({});
      setPvpMessage(`Room ${room.code} is live. Share the 6-digit code with your opponent.`);
    } catch (error) {
      setPvpMessage(error instanceof Error ? error.message : 'Could not create the live room.');
    }
  }

  async function joinPvpRoomNow() {
    if (!onlineAccount) {
      setOnlineStatusMessage('Register or sign in before joining a live room.');
      return;
    }

    try {
      const room = await joinOnlineRoom({
        account: onlineAccount,
        code: pvpRoomCodeInput.trim(),
        team: sanitizeTeamForChampions(cloneTeam(team)),
        musicTrackId: primaryBattleMusicTrackId(state.profile.preferredBattleTrackId, state.profile.battleMusicPlaylistIds),
        announcerEnabled: state.profile.announcerDefaultEnabled,
      });
      setPvpRoom(room);
      setPvpBringOrder([]);
      setPvpChoiceDrafts({});
      setPvpMessage(`Joined room ${room.code}. Team preview is live.`);
    } catch (error) {
      setPvpMessage(error instanceof Error ? error.message : 'Could not join the live room.');
    }
  }

  function togglePvpBringIndex(slotIndex: number) {
    setPvpMessage(null);
    setPvpBringOrder((current) => {
      if (current.includes(slotIndex)) {
        return current.filter((entry) => entry !== slotIndex);
      }
      if (current.length >= 4) {
        return current;
      }
      return [...current, slotIndex];
    });
  }

  async function submitPvpBringOrderSelection() {
    if (!onlineAccount || !pvpRoom) {
      return;
    }

    try {
      const room = await submitOnlineBringOrder({
        account: onlineAccount,
        code: pvpRoom.code,
        bringOrder: pvpBringOrder,
      });
      setPvpRoom(room);
      setPvpMessage('Bring order submitted. Waiting for the other player if needed.');
    } catch (error) {
      setPvpMessage(error instanceof Error ? error.message : 'Could not lock the bring order.');
    }
  }

  async function submitPvpTurn(timedOut = false) {
    if (!onlineAccount || !pvpRoom?.battle) {
      return;
    }
    if (!hasBattleCoreRuntime()) {
      await ensureBattleCoreRuntime();
      setBattleCoreReady(true);
    }

    try {
      const { choices, notices } = battleHasPendingReplacements(pvpRoom.battle)
        ? buildReplacementChoices(pvpRoom.battle, pvpChoiceDrafts, timedOut)
        : buildSimulatorChoices(pvpRoom.battle, pvpChoiceDrafts, timedOut);
      const room = await submitOnlineChoices({
        account: onlineAccount,
        code: pvpRoom.code,
        choices,
      });
      setPvpRoom(room);
      setPvpChoiceDrafts({});
      const playerLockMessage =
        room.stage === 'battle' && room.playerChoicesLocked && !room.opponentChoicesLocked
          ? 'Choices locked. Your move clock is stopped while the room waits on the opponent.'
          : room.lastActionSummary;
      setPvpMessage(notices[0] ?? playerLockMessage ?? 'Turn submitted.');
    } catch (error) {
      setPvpMessage(error instanceof Error ? error.message : 'Could not submit the turn.');
    }
  }

  async function handlePvpForfeit() {
    if (!onlineAccount || !pvpRoom) {
      return;
    }

    try {
      const room = await forfeitOnlineRoom({
        account: onlineAccount,
        code: pvpRoom.code,
      });
      setPvpRoom(room);
      setPvpMessage('You forfeited the battle. The result counts as a loss.');
    } catch (error) {
      setPvpMessage(error instanceof Error ? error.message : 'Could not forfeit the room.');
    }
  }

  return (
    <div className={`app-shell layout-${state.profile.layoutMode.toLowerCase()}${state.profile.resizablePanels ? ' panels-resizable' : ''}`}>
      {state.profile.battleMusicEnabled && (aiBattleMusicActive || pvpBattleMusicActive) ? (
        <BattleMusicPlayer
          trackId={activeBattleMusicTrackId}
          mode={state.profile.battleMusicMode}
          playlistIds={state.profile.battleMusicPlaylistIds}
          enabled={state.profile.battleMusicEnabled}
          volume={state.profile.battleMusicVolume}
          active={aiBattleMusicActive || pvpBattleMusicActive}
          sessionKey={battleMusicSessionKey}
        />
      ) : null}
      <BattleMusicPlayer
        trackId={primaryBattleMusicTrackId(state.profile.preferredBattleTrackId, state.profile.battleMusicPlaylistIds)}
        mode={state.profile.battleMusicMode}
        playlistIds={state.profile.battleMusicPlaylistIds}
        enabled
        volume={state.profile.battleMusicVolume}
        active={profileMusicPreviewActive}
        sessionKey={`profile-preview-${profileMusicPreviewSession}`}
      />
      <aside className="sidebar">
        <div className="brand-panel">
          <div className="brand-kicker">Pokemon Champions Lab</div>
          <h1>Damage Calculator + Team Builder</h1>
          <p>Source-backed against Serebii's Champions pages and layered with current community usage reads for spreads, synergy, preview planning, and battle sandbox work.</p>
          <div className="brand-sprite-row">
            {brandPokemonIcons.map((name) => {
              const pokemon = dataset.pokemon.find((entry) => entry.displayName === name) ?? null;
              return <PokemonSpriteFrame key={name} pokemon={pokemon} size="mini" label={name} />;
            })}
          </div>
        </div>

        <div className="profile-chip">
          <div>
            <strong>{state.profile.trainerName || 'Unregistered Trainer'}</strong>
            <span>{profileSummary(state.teams.length)}</span>
          </div>
          <div className="pill">{state.profile.favoriteFormat}</div>
        </div>

        <nav className="side-nav">
          {appTabs.map((tab) => (
            <button key={tab.id} className={tab.id === activeTab ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab(tab.id)}>
              <span>{tab.short}</span>
              <div>
                <strong>{tab.label}</strong>
                <small>{tab.description}</small>
              </div>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="info-card compact">
            <span>Champions Data</span>
            <strong>{dataset.pokemon.length} forms / {dataset.moves.length} moves / {dataset.items.length} items</strong>
            <small>Release date confirmed from Serebii: {dataset.mechanics.releaseDate}</small>
          </div>
          <div className="info-card compact">
            <span>Live Site Pulse</span>
            <strong>{presenceStats.activeUsers} online now</strong>
            <small>{presenceStats.totalVisits} total visits tracked | {presenceStats.activeBattles} live battles</small>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-intro">
            <p className="eyebrow">Current squad</p>
            <h2>{team.name}</h2>
            <span>{analysis.overview}</span>
          </div>
          <div className="topbar-side">
            <div className="topbar-actions">
              <InfoStat label="Format" value={team.format} />
              <InfoStat label="Synergy" value={`${analysis.synergyScore}`} />
              <InfoStat label="Survivability" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityScore}`} />
              <InfoStat label="Stable Turns" value={`${analysis.survivabilityTurns}`} />
              <InfoStat label="Est. Win Rate" value={`${analysis.estimatedWinRate}%`} />
              <InfoStat label="Win Range" value={`${analysis.estimatedWinRateLow}-${analysis.estimatedWinRateHigh}%`} />
              <InfoStat label="Meta Label" value={analysis.teamUsage.label} />
              <InfoStat label="Off-Meta Bias" value={getNinetalesBiasLabel(state.profile.offMetaBias)} />
            </div>
            <MetricNotes analysis={analysis} compact />
            <div className="layout-toolbar">
              <label className="field toolbar-field">
                <span>Layout Width</span>
                <select
                  value={state.profile.layoutMode}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        layoutMode: event.target.value as LayoutMode,
                      },
                    }))
                  }
                >
                  {layoutModes.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
              <ToggleField
                label="Resizable Panels"
                checked={state.profile.resizablePanels}
                onChange={(checked) =>
                  setState((current) => ({
                    ...current,
                    profile: {
                      ...current.profile,
                      resizablePanels: checked,
                    },
                  }))
                }
              />
            </div>
          </div>
        </header>

        {activeTab === 'team-builder' && (
          <section className="page-grid page-grid-wide">
            <div className="team-builder-sidebar-stack">
              <div className="panel">
                <SectionHeader title="Saved Teams" subtitle="Create, duplicate, rename, and rotate through up to ten squads." />
                <div className="team-actions">
                  <button className="action-button primary" onClick={createNewTeam} disabled={state.teams.length >= 10}>New Team</button>
                  <button className="action-button" onClick={duplicateCurrentTeam} disabled={state.teams.length >= 10}>Duplicate</button>
                  <button className="action-button danger" onClick={deleteCurrentTeam}>Delete</button>
                </div>
                <div className="saved-team-list scroll-stack">
                  {state.teams.map((savedTeam) => (
                    <button key={savedTeam.id} className={savedTeam.id === team.id ? 'saved-team-card active' : 'saved-team-card'} onClick={() => setState((current) => ({ ...current, activeTeamId: savedTeam.id }))}>
                      <div>
                        <strong>{savedTeam.name}</strong>
                        <small>{savedTeam.format} - {savedTeam.slots.filter((slot) => slot.pokemonId).length}/6 filled</small>
                      </div>
                      <span>{new Date(savedTeam.updatedAt).toLocaleDateString()}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel selected-slot-panel">
                <SelectedSlotSpotlight build={selectedTeamSlot} format={team.format} slotIndex={selectedSlotIndex} />
              </div>
            </div>

            <div className="panel span-two">
              <SectionHeader title="Active Team" subtitle="Click a slot to edit species, moves, nature, EVs, item, Mega plan, and role identity." />
              <div className="team-meta-row">
                <label className="field">
                  <span>Team Name</span>
                  <input value={team.name} onChange={(event) => updateTeam((currentTeam) => ({ ...currentTeam, name: event.target.value, updatedAt: new Date().toISOString() }))} />
                </label>
                <label className="field">
                  <span>Format</span>
                  <select value={team.format} onChange={(event) => updateTeam((currentTeam) => ({ ...currentTeam, format: event.target.value as BattleFormat, updatedAt: new Date().toISOString() }))}>
                    {battleFormats.map((format) => (
                      <option key={format} value={format}>{format}</option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span>Notes</span>
                  <input value={team.notes} onChange={(event) => updateTeam((currentTeam) => ({ ...currentTeam, notes: event.target.value, updatedAt: new Date().toISOString() }))} placeholder="Matchup notes, Mega plan, ladder pocket..." />
                </label>
              </div>
              <div className="save-status-row">
                <span>{saveStatusLabel}</span>
                <button className="action-button" disabled={!profileReady} onClick={() => persistNow('Team saved locally', true, 'Saving this team')}>
                  {profileReady ? 'Save Team' : 'Profile Needed'}
                </button>
              </div>

              <div className="slot-grid">
                {team.slots.map((slot, index) => {
                  const pokemon = resolvePokemonForm(slot);
                  const usage = getPokemonUsageInsight(pokemon, team.format);
                  const slotStats = pokemon ? buildStats(pokemon.baseStats, slot.evs, slot.natureId) : null;
                  const effortSummary = `${totalEffortPoints(slot.evs)} / ${totalEffortBudget}`;
                  return (
                    <button key={slot.id} className={index === selectedSlotIndex ? 'slot-card active' : 'slot-card'} onClick={() => setSelectedSlotIndex(index)}>
                      <div className="slot-card-top">
                        <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                        <div>
                          <strong>{pokemon ? buildLabel(slot, pokemon) : `Slot ${index + 1}`}</strong>
                          <small>{pokemon ? pokemon.types.join(' / ') : 'Select a Pokemon'}</small>
                          {pokemon ? <UsagePill insight={usage} /> : null}
                        </div>
                      </div>
                      <div className="slot-card-stats">
                        <span>{slot.itemId ? getItemById(slot.itemId)?.name : 'No item'}</span>
                        <span>{pokemon ? describeBuildRole(slot, team.format) : 'Open slot'}</span>
                        <span>{pokemon ? describeMegaState(slot, selectedPokemon(slot)) : 'No Mega'}</span>
                      </div>
                      {pokemon ? (
                        <div className="slot-nature-row">
                          <span>{natureBenefitLabel(slot.natureId)}</span>
                          <span>{`EV Pts ${effortSummary}`}</span>
                        </div>
                      ) : null}
                      {slotStats ? (
                        <div className="slot-stat-grid">
                          {statOrder.map((stat) => (
                            <div key={stat} className="slot-stat-pill">
                              <small>{statLabels[stat]}</small>
                              <strong>{slotStats[stat]}</strong>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="move-chip-row">
                        {slot.moveIds.slice(0, 4).map((moveId) => {
                          const move = pokemon?.movePool.find((entry) => entry.id === moveId);
                          return <span key={moveId} className="move-chip">{move?.name ?? 'Move'}</span>;
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="panel tall inspector-summary-panel">
              <SectionHeader title="Inspector + Summary" subtitle="This editor updates the live team and the summary panel beneath it." />
              <BuildEditor
                build={selectedTeamSlot}
                onChange={(next) => updateSlot(selectedSlotIndex, next)}
                title={`Slot ${selectedSlotIndex + 1}`}
                format={team.format}
                blockedItemIds={selectedSlotBlockedItemIds}
              />
              <div className="subpanel team-summary-subpanel">
                <SectionHeader title="Team Summary" subtitle="The same AI labels and survivability notes are reflected live inside Team Builder." compact />
                <div className="result-grid">
                  <InfoStat label="Meta" value={analysis.teamUsage.label} />
                  <InfoStat label="Survivability" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityScore}`} />
                  <InfoStat label="Turns" value={`${analysis.survivabilityTurns}`} />
                  <InfoStat label="Win Rate" value={`${analysis.estimatedWinRate}%`} />
                  <InfoStat label="Roles" value={`${roleSummary(team).length}`} />
                  <InfoStat label="Easy Wins" value={`${analysis.easyTargets.length}`} />
                </div>
                <div className="notes-list team-summary-list">
                  <MetricNotes analysis={analysis} compact />
                  {roleSummary(team).map((note) => (
                    <div key={note} className="note-row">{note}</div>
                  ))}
                  {analysis.archetypeSuggestions.map((note) => (
                    <div key={note} className="note-row">Suggested archetype fit: {note}</div>
                  ))}
                  {analysis.previewPlans.map((note) => (
                    <div key={note} className="note-row">{note}</div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'damage-lab' && (
          <section className="page-grid page-grid-wide">
            <div className="panel tall">
              <SectionHeader title="Attacker" subtitle="Pull from your team or build a manual line for outbound damage." />
              <div className="calc-import-row">
                {team.slots.map((slot, index) => (
                  <button key={slot.id} className="mini-button" onClick={() => importSlotIntoCalc(index, 'attacker')}>Import Slot {index + 1}</button>
                ))}
              </div>
              <BuildEditor build={attackerBuild} onChange={setCalcAttacker} title="Attacking Build" format={team.format} condensed />
            </div>

            <div className="panel tall">
              <SectionHeader title="Environment" subtitle="Toggle battle state, then swap directions to see the reverse line." />
              <div className="control-grid two">
                <label className="field">
                  <span>Battle Format</span>
                  <select value={environment.battleFormat} onChange={(event) => setEnvironment((current) => ({ ...current, battleFormat: event.target.value as BattleFormat, spreadTargetsHit: event.target.value === 'Doubles' ? current.spreadTargetsHit : 1 }))}>
                    {battleFormats.map((format) => (
                      <option key={format} value={format}>{format}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Weather</span>
                  <select value={environment.weather} onChange={(event) => setEnvironment((current) => ({ ...current, weather: event.target.value as EnvironmentState['weather'] }))}>
                    {weatherOptions.map((weather) => (
                      <option key={weather} value={weather}>{weather}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Terrain</span>
                  <select value={environment.terrain} onChange={(event) => setEnvironment((current) => ({ ...current, terrain: event.target.value as EnvironmentState['terrain'] }))}>
                    {terrainOptions.map((terrain) => (
                      <option key={terrain} value={terrain}>{terrain}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Spread Targets Hit</span>
                  <select value={environment.spreadTargetsHit} onChange={(event) => setEnvironment((current) => ({ ...current, spreadTargetsHit: Number(event.target.value) === 2 ? 2 : 1 }))} disabled={environment.battleFormat !== 'Doubles'}>
                    <option value={1}>1 target</option>
                    <option value={2}>2 targets</option>
                  </select>
                </label>
                <ToggleField label="Critical hit" checked={environment.criticalHit} onChange={(checked) => setEnvironment((current) => ({ ...current, criticalHit: checked }))} />
                <ToggleField label="Helping Hand" checked={environment.helpingHand} onChange={(checked) => setEnvironment((current) => ({ ...current, helpingHand: checked }))} />
                <ToggleField label="Gravity" checked={environment.gravity} onChange={(checked) => setEnvironment((current) => ({ ...current, gravity: checked }))} />
                <ToggleField label="Magic Room" checked={environment.magicRoom} onChange={(checked) => setEnvironment((current) => ({ ...current, magicRoom: checked }))} />
                <ToggleField label="Wonder Room" checked={environment.wonderRoom} onChange={(checked) => setEnvironment((current) => ({ ...current, wonderRoom: checked }))} />
                <ToggleField label="Reflect" checked={environment.reflect} onChange={(checked) => setEnvironment((current) => ({ ...current, reflect: checked }))} />
                <ToggleField label="Light Screen" checked={environment.lightScreen} onChange={(checked) => setEnvironment((current) => ({ ...current, lightScreen: checked }))} />
                <ToggleField label="Aurora Veil" checked={environment.auroraVeil} onChange={(checked) => setEnvironment((current) => ({ ...current, auroraVeil: checked }))} />
                <ToggleField label="Auto-resist berries" checked={environment.defenderProtectedByBerry} onChange={(checked) => setEnvironment((current) => ({ ...current, defenderProtectedByBerry: checked }))} />
              </div>
              <button className="action-button" onClick={() => { const nextAttacker = copyBuild(calcDefender); const nextDefender = copyBuild(calcAttacker); setCalcAttacker(nextAttacker); setCalcDefender(nextDefender); }}>
                Reverse Direction
              </button>

                <div className="result-stack">
                  {!battleCoreReady ? <div className="note-row compact-note">Loading the battle calculator runtime for live damage lines...</div> : null}
                  <div className="move-result-grid">
                  {attackerMoveResults.map(({ move, result }) => {
                    return (
                      <button key={move.id} className={selectedDamageMoveId === move.id ? 'damage-chip active' : 'damage-chip'} onClick={() => setSelectedDamageMoveId(move.id)}>
                        <strong>{move.name}</strong>
                        <span>{summaryForResult(result)}</span>
                        <UsagePill insight={getMoveUsageInsight(move.name, team.format)} small />
                      </button>
                    );
                  })}
                </div>

                <div className="damage-hero">
                  <div>
                    <p className="eyebrow">Selected move</p>
                    <h3>{selectedResult?.move.name ?? 'Pick a move'}</h3>
                    <span>{selectedResult ? `${selectedResult.appliedType} - ${selectedResult.hitSummary}` : 'The calculator uses standard level-50 combat math plus Champions move, item, and Mega data.'}</span>
                  </div>
                  <strong>{selectedResult ? summaryForResult(selectedResult) : '--'}</strong>
                </div>

                <div className="result-grid">
                  <InfoStat label="KO line" value={selectedResult?.koSummary ?? '--'} />
                  <InfoStat label="Effect" value={selectedResult ? `${selectedResult.effectiveness}x` : '--'} />
                  <InfoStat label="STAB" value={selectedResult ? `${selectedResult.stab}x` : '--'} />
                  <InfoStat label="Move Meta" value={selectedResult ? getMoveUsageInsight(selectedResult.move.name, team.format).label : '--'} />
                </div>

                <div className="notes-list scroll-stack compact-scroll">
                  {(selectedResult?.notes ?? dataset.mechanics.notes).map((note) => (
                    <div key={note} className="note-row">{note}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Defender" subtitle="Mirror the same controls so you can scout damage coming back into your side." />
              <div className="calc-import-row">
                {team.slots.map((slot, index) => (
                  <button key={slot.id} className="mini-button" onClick={() => importSlotIntoCalc(index, 'defender')}>Import Slot {index + 1}</button>
                ))}
              </div>
              <BuildEditor build={defenderBuild} onChange={setCalcDefender} title="Defending Build" format={team.format} condensed />

              <div className="subpanel">
                <SectionHeader title="Incoming Pressure" subtitle="These are the defender's selected moves into your current attacker." compact />
                <div className="move-result-grid compact">
                  {defenderMoveResults.map(({ move, result }) => {
                    return (
                      <div key={move.id} className="damage-chip static">
                        <strong>{move.name}</strong>
                        <span>{summaryForResult(result)}</span>
                        <UsagePill insight={getMoveUsageInsight(move.name, team.format)} small />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'pokedex' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Champions Roster" subtitle="Search the current available Pokemon, forms, and Mega entries from the Serebii-backed dataset." />
              <label className="field">
                <span>Search Pokemon</span>
                <input value={pokedexSearch} onChange={(event) => setPokedexSearch(event.target.value)} placeholder="Mega Dragonite, Castform, Milotic..." />
              </label>
              <div className="dex-list scroll-stack">
                {pokedexMatches.slice(0, 120).map((pokemon) => (
                  <button key={pokemon.id} className={pokemon.id === selectedPokedexPokemon?.id ? 'dex-row active' : 'dex-row'} onClick={() => setSelectedPokedexId(pokemon.id)}>
                    <PokemonSpriteFrame pokemon={pokemon} size="tiny" />
                    <div>
                      <strong>{pokemon.displayName}</strong>
                      <small>{pokemon.types.join(' / ')}</small>
                    </div>
                    <UsagePill insight={getPokemonUsageInsight(pokemon, team.format)} small />
                  </button>
                ))}
              </div>
            </div>

            <div className="panel tall span-two">
              <SectionHeader title={selectedPokedexPokemon.displayName} subtitle={`${selectedPokedexPokemon.baseSpecies} - ${selectedPokedexPokemon.classification || 'Battle-ready form'}`} />
              <div className="pokedex-hero">
                <PokemonSpriteFrame pokemon={selectedPokedexPokemon} size="pokedex" />
                <div className="pokedex-metadata">
                  <div className="result-grid">
                    <InfoStat label="Singles" value={getPokemonUsageInsight(selectedPokedexPokemon, 'Singles').label} />
                    <InfoStat label="Doubles" value={getPokemonUsageInsight(selectedPokedexPokemon, 'Doubles').label} />
                    <InfoStat label="Role" value={describeBuildRole(prepareBuildForPokemon(selectedTeamSlot, selectedPokedexPokemon.id, team.format), team.format)} />
                    <InfoStat label="Mega Item" value={selectedPokedexPokemon.megaStone ?? 'None'} />
                  </div>
                  <div className="notes-list scroll-stack compact-scroll">
                    <div className="note-row">{getPokemonUsageInsight(selectedPokedexPokemon, team.format).reason}</div>
                    {selectedPokedexPokemon.abilities.map((ability) => (
                      <div key={ability.name} className="note-row"><strong>{ability.name}:</strong> {ability.description}</div>
                    ))}
                    {getPopularPresetSummary(selectedPokedexPokemon, team.format) ? (
                      <div className="note-row">
                        Popular {team.format} set: {getPopularPresetSummary(selectedPokedexPokemon, team.format)?.moveNames.join(', ')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="stats-bar-grid">
                {statOrder.map((stat) => (
                  <div key={stat} className="stat-bar-card">
                    <span>{statLabels[stat]}</span>
                    <strong>{selectedPokedexPokemon.baseStats[stat]}</strong>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (selectedPokedexPokemon.baseStats[stat] / 180) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>

              <div className="move-table">
                <div className="result-grid parity-summary-grid">
                  <InfoStat label="Move Coverage" value={`${overallMoveParity.coveredPercent}%`} />
                  <InfoStat label="Explicit" value={`${overallMoveParity.explicit}`} />
                  <InfoStat label="Rules-aware" value={`${overallMoveParity.rulesAware}`} />
                  <InfoStat label="Damage Core" value={`${overallMoveParity.damageCore}`} />
                  <InfoStat label="Review Needed" value={`${overallMoveParity.reviewNeeded}`} />
                </div>
                <div className="notes-list compact-scroll">
                  {!battleCoreReady ? <div className="note-row">Loading the move parity report for the current Champions roster...</div> : null}
                  <div className="note-row">Parity report is live: explicit means the move has a bespoke simulator hook, rules-aware means it rides on a shared pattern path, damage core means the calculator covers the base hit math cleanly, and review needed marks the remaining edge-case list.</div>
                  {overallMoveParity.topReviewMoves.slice(0, 3).map((entry) => (
                    <div key={entry.moveId} className="note-row">Review queue: <strong>{entry.moveName}</strong> - {entry.summary}</div>
                  ))}
                </div>
                <div className="move-table-head move-table-head-wide">
                  <span>Move</span>
                  <span>Type</span>
                  <span>Cat</span>
                  <span>Power</span>
                  <span>Acc</span>
                  <span>Meta</span>
                  <span>Parity</span>
                  <span>Effect</span>
                </div>
                {selectedPokedexPokemon.movePool.map((move, index) => {
                  const parity = selectedMoveParityEntries[index] ?? moveParityForMove(move);
                  return (
                  <div key={move.id} className="move-table-row move-table-row-wide">
                    <strong>{move.name}</strong>
                    <span>{move.type}</span>
                    <span>{move.category}</span>
                    <span>{move.power ?? '--'}</span>
                    <span>{move.accuracy ?? '--'}</span>
                    <span>{getMoveUsageInsight(move.name, team.format).label}</span>
                    <span>{parity.tier}</span>
                    <small>{move.description || 'No extra rider text on the source page.'}</small>
                  </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'ai-builder' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="AI Team Builder" subtitle="Lock your favorite core, then generate fully built Singles or Doubles teams with up to twenty guided or random variants." />
              <label className="field">
                <span>Archetype</span>
                <select value={selectedArchetype} onChange={(event) => setSelectedArchetype(event.target.value)}>
                  {archetypeOptions.map((archetype) => (
                    <option key={archetype.id} value={archetype.id}>{archetype.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Plan Format</span>
                <select value={aiFormat} onChange={(event) => setAiFormat(event.target.value as BattleFormat)}>
                  {battleFormats.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <div className="locked-team-stack">
                {aiLockedNames.map((name, index) => {
                  const validation = aiLockedValidations[index];
                  const hasInput = Boolean(name.trim());
                  return (
                    <div key={index} className="locked-input-card">
                      <label className="field">
                        <span>{index === 0 ? 'Favorite / Core Pokemon' : `Additional Pokemon ${index}`}</span>
                        <input value={name} onChange={(event) => setAiLockedNames((current) => current.map((entry, currentIndex) => (currentIndex === index ? event.target.value : entry)))} placeholder={index === 0 ? 'Mandatory core like Garchomp, Castform, or Mega Gengar' : 'Optional locked teammate'} />
                      </label>
                      {hasInput ? (
                        <div className={validation.isValid ? 'validation-banner valid' : 'validation-banner invalid'}>
                          <strong>{validation.isValid ? 'Live Dex Match' : 'Replacement Guard Rail'}</strong>
                          <small>{validation.message}</small>
                        </div>
                      ) : null}
                      {!validation.isValid && validation.suggestions.length ? (
                        <div className="replacement-card-list">
                          {validation.suggestions.map((suggestion) => (
                            <button
                              key={`${index}-${suggestion.pokemon.id}`}
                              className="replacement-card"
                              onClick={() =>
                                setAiLockedNames((current) => current.map((entry, currentIndex) => (
                                  currentIndex === index ? suggestion.pokemon.displayName : entry
                                )))
                              }
                            >
                              <div>
                                <strong>{suggestion.pokemon.displayName}</strong>
                                <small>{suggestion.pokemon.types.join(' / ')} · {suggestion.usageLabel}</small>
                              </div>
                              <span>{suggestion.reason}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <label className="field">
                <span>Generated Team Count</span>
                <input type="number" min={3} max={20} value={aiVariantCount} onChange={(event) => setAiVariantCount(Math.max(3, Math.min(20, Number(event.target.value))))} />
              </label>
              <div className="team-actions compact-actions">
                {[3, 5, 10, 20].map((count) => (
                  <button key={count} className={aiVariantCount === count ? 'mini-button active' : 'mini-button'} onClick={() => setAiVariantCount(count)}>
                    {count} Teams
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Off-Meta Bias</span>
                <input type="range" min={0} max={100} value={state.profile.offMetaBias} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, offMetaBias: Number(event.target.value) } }))} />
                <small>{getNinetalesBiasLabel(state.profile.offMetaBias)} - higher values hunt unusual but coherent win paths.</small>
              </label>
              <ToggleField label="Random Team Generator" checked={aiRandomMode} onChange={setAiRandomMode} />
              <button className="action-button primary ai-build-button" onClick={runAiBuilder} disabled={!teamIntelReady}>
                {aiRandomMode ? `Generate ${aiVariantCount} Random Teams` : `Generate ${aiVariantCount} Team Plans`}
              </button>
              {aiBuilderMessage ? <div className="validation-banner info"><strong>AI Builder Update</strong><small>{aiBuilderMessage}</small></div> : null}

              <div className="notes-list scroll-stack compact-scroll">
                {!teamIntelReady ? <div className="note-row">Loading AI planning, matchup scoring, usage reads, and preset recommendations for this tab...</div> : null}
                {coreArchetypeSuggestions.map((note) => (
                  <div key={note} className="note-row">Core fit suggestion: {note}</div>
                ))}
                <div className="note-row">Locked core Pokemon are always included, then the AI rounds the team out with items, abilities, spreads, and role coverage.</div>
                <div className="note-row">Random generator mode keeps your locked core intact while sampling different high-value support, Mega, and matchup branches, and it now refreshes the active team with the first new random result.</div>
                <div className="note-row">Every generated team comes back with synergy, survivability, stable-turn projections, an estimated win-rate band, preview lines, and threat notes.</div>
              </div>
            </div>

            <div className="panel tall span-two">
              <SectionHeader title={selectedGeneratedPlan?.name ?? 'Draft Plans'} subtitle={selectedGeneratedPlan?.summary ?? 'Generate at least three complete plans to preview different archetype branches.'} />
              {generatedPlans.length ? (
                <>
                  <div className="plan-tab-row">
                    {generatedPlans.map((plan) => (
                      <button key={plan.id} className={plan.id === selectedGeneratedPlan?.id ? 'plan-tab active' : 'plan-tab'} onClick={() => setSelectedGeneratedPlanId(plan.id)}>
                        <strong>{plan.planTag}</strong>
                        <small>{plan.analysis.synergyScore} / {plan.analysis.survivabilityGrade} / {plan.analysis.teamUsage.label}</small>
                      </button>
                    ))}
                  </div>
                  {selectedGeneratedPlan ? (
                    <div className="plan-detail-grid">
                      <div className="generated-team-row">
                        {selectedGeneratedPlan.slots.map((slot) => {
                          const pokemon = resolvePokemonForm(slot);
                          const slotStats = pokemon ? buildStats(pokemon.baseStats, slot.evs, slot.natureId) : null;
                          return (
                            <div key={slot.id} className="generated-slot">
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? 'Open'}</strong>
                              <small>{describeBuildRole(slot, selectedGeneratedPlan.format)}</small>
                              <UsagePill insight={getPokemonUsageInsight(pokemon, selectedGeneratedPlan.format)} small />
                              <div className="generated-slot-meta">
                                <span>{getItemById(slot.itemId)?.name ?? 'No item'} - {slot.abilityName ?? pokemon?.abilities[0]?.name ?? 'Ability'}</span>
                                <span>{natureBenefitLabel(slot.natureId)}</span>
                                <span>EV Spread: {effortSpreadLabel(slot.evs)}</span>
                              </div>
                              {slotStats ? (
                                <div className="generated-slot-stat-grid">
                                  {statOrder.map((stat) => (
                                    <div key={stat} className="slot-stat-pill compact">
                                      <small>{statLabels[stat]}</small>
                                      <strong>{slotStats[stat]}</strong>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              <div className="move-chip-row generated-move-chip-row">
                                {slot.moveIds.map((moveId) => {
                                  const move = pokemon?.movePool.find((entry) => entry.id === moveId);
                                  return <span key={moveId} className="move-chip">{move?.name ?? 'Move'}</span>;
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="result-grid">
                        <InfoStat label="Format" value={selectedGeneratedPlan.format} />
                        <InfoStat label="Core" value={selectedGeneratedPlan.favoritePokemon ?? 'Open'} />
                        <InfoStat label="Mega" value={getPokemonById(selectedGeneratedPlan.megaPokemonId)?.displayName ?? 'Flexible'} />
                        <InfoStat label="Archetype" value={selectedGeneratedPlan.archetype} />
                        <InfoStat label="Synergy" value={`${selectedGeneratedPlan.analysis.synergyScore}`} />
                        <InfoStat label="Survivability" value={`${selectedGeneratedPlan.analysis.survivabilityGrade} / ${selectedGeneratedPlan.analysis.survivabilityScore}`} />
                        <InfoStat label="Stable Turns" value={`${selectedGeneratedPlan.analysis.survivabilityTurns}`} />
                        <InfoStat label="Est. Win Rate" value={`${selectedGeneratedPlan.analysis.estimatedWinRate}%`} />
                        <InfoStat label="Win Range" value={`${selectedGeneratedPlan.analysis.estimatedWinRateLow}-${selectedGeneratedPlan.analysis.estimatedWinRateHigh}%`} />
                        <InfoStat label="Meta" value={selectedGeneratedPlan.analysis.teamUsage.label} />
                      </div>

                      <div className="notes-list scroll-stack">
                        <MetricNotes analysis={selectedGeneratedPlan.analysis} compact />
                        {selectedGeneratedPlan.reasons.map((reason) => (
                          <div key={reason} className="note-row">{reason}</div>
                        ))}
                        {selectedGeneratedPlan.expertNotes.map((reason) => (
                          <div key={reason} className="note-row">{reason}</div>
                        ))}
                        <div className="note-row">{selectedGeneratedPlan.megaReason}</div>
                        {selectedGeneratedPlan.analysis.easyTargets.map((reason) => (
                          <div key={reason} className="note-row">{reason}</div>
                        ))}
                      </div>

                      <div className="notes-list scroll-stack compact-scroll">
                        {selectedGeneratedPlan.analysis.previewPlans.map((note) => (
                          <div key={note} className="note-row">{note}</div>
                        ))}
                        {selectedGeneratedPlan.analysis.recommendations.map((note) => (
                          <div key={note} className="note-row">{note}</div>
                        ))}
                      </div>

                      <div className="team-actions">
                        <button className="action-button primary" onClick={() => saveGeneratedPlanAsTeam(selectedGeneratedPlan)} disabled={state.teams.length >= 10 || !profileReady}>
                          {state.teams.length >= 10 ? 'Team List Full (10/10)' : !profileReady ? 'Profile Needed to Save' : 'Save as New Team'}
                        </button>
                        <button className="action-button primary" onClick={() => applyGeneratedPlan(selectedGeneratedPlan)}>Apply to Active Team</button>
                        <button className="action-button" onClick={() => { applyGeneratedPlan(selectedGeneratedPlan); setActiveTab('analyzer'); }}>Apply + Analyze</button>
                        <button className="action-button" onClick={() => { applyGeneratedPlan(selectedGeneratedPlan); setActiveTab('simulator'); }}>Apply + Sim</button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">
                  <strong>No generated team yet.</strong>
                  <span>Lock a core, set a team count, and generate complete plans with items, abilities, spreads, threats, and Mega recommendations.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'analyzer' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Overview" subtitle="A quick read on synergy, survivability, easy wins, and overall team identity." />
              <div className="result-grid">
                <InfoStat label="Synergy" value={`${analysis.synergyScore}/100`} />
                <InfoStat label="Est. Win Rate" value={`${analysis.estimatedWinRate}%`} />
                <InfoStat label="Win Range" value={`${analysis.estimatedWinRateLow}-${analysis.estimatedWinRateHigh}%`} />
                <InfoStat label="Survivability" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityScore}`} />
                <InfoStat label="Stable Turns" value={`${analysis.survivabilityTurns}`} />
                <InfoStat label="Meta Label" value={analysis.teamUsage.label} />
              </div>
              <div className="notes-list scroll-stack">
                <MetricNotes analysis={analysis} />
                {[...analysis.strengths, ...analysis.coverageHighlights, ...analysis.easyTargets].map((note) => (
                  <div key={note} className="note-row">{note}</div>
                ))}
                {analysis.formatNotes.map((note) => (
                  <div key={note} className="note-row">{note}</div>
                ))}
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Threat Radar" subtitle="The biggest pressure pieces against this exact shell plus the safest four to bring." />
              <div className="threat-list scroll-stack">
                {analysis.threats.map((threat) => {
                  const pokemon = getPokemonById(threat.pokemonId);
                  return (
                    <div key={threat.pokemonId} className="threat-card threat-card-block">
                      <div className="threat-top">
                        <PokemonSpriteFrame pokemon={pokemon} size="tiny" />
                        <div>
                          <strong>{threat.name}</strong>
                          <small>{threat.reason}</small>
                        </div>
                        <span>{Math.round(threat.score)}</span>
                      </div>
                      <div className="note-row compact-note">{threat.previewCue}</div>
                      <div className="note-row compact-note">{threat.bringPlan}</div>
                      {threat.counterplay.map((note) => (
                        <div key={note} className="note-row compact-note">{note}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Tuning Notes" subtitle="Recommendations, archetype fits, and ways to push closer to 100% synergy." />
              <div className="notes-list scroll-stack">
                {analysis.archetypeSuggestions.map((note) => (
                  <div key={note} className="note-row">Archetype fit: {note}</div>
                ))}
                {[...analysis.weaknesses, ...analysis.recommendations, ...analysis.balanceHints, ...analysis.previewPlans].map((note) => (
                  <div key={note} className="note-row">{note}</div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'simulator' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Battle Setup" subtitle="Pick the battle type, roll an AI opponent, study the one-minute preview, and lock your four." />
              <label className="field">
                <span>Battle Type</span>
                <select value={simFormat} onChange={(event) => setSimFormat(event.target.value as BattleFormat)}>
                  {battleFormats.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <div className="control-grid two">
                <ToggleField label="30s Turn Timer" checked={simTurnTimerEnabled} onChange={setSimTurnTimerEnabled} />
                <ToggleField label="Announcer" checked={simAnnouncerEnabled} onChange={setSimAnnouncerEnabled} />
              </div>
              {simAnnouncerEnabled ? (
                <div className="control-grid two">
                  <label className="field">
                    <span>Announcer Style</span>
                    <select value={simAnnouncerStyle} onChange={(event) => setSimAnnouncerStyle(event.target.value as AnnouncerStyle)}>
                      {(['Arena', 'Championship', 'Analyst'] as AnnouncerStyle[]).map((style) => (
                        <option key={style} value={style}>{style}</option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Male Announcer Speed</span>
                    <input type="range" min={0.85} max={1.15} step={0.05} value={simAnnouncerRate} onChange={(event) => setSimAnnouncerRate(Number(event.target.value))} />
                    <small>{simAnnouncerRate.toFixed(2)}x speech speed</small>
                  </label>
                </div>
              ) : null}
              <button className="action-button primary" onClick={startSimulatorPreview} disabled={!battleCoreReady || !teamIntelReady}>Generate Viable Opponent</button>
              <div className="notes-list compact-scroll">
                {!battleCoreReady ? <div className="note-row">Loading the battle runtime for simulator, damage math, and parity reports...</div> : null}
                {!teamIntelReady ? <div className="note-row">Loading AI opponent drafting, matchup heuristics, and preview planning...</div> : null}
                <div className="note-row">The simulator uses the live roster, your saved spreads, the current damage engine, and a battle sandbox with targeting, switching, preview order, and AI decisions.</div>
                <div className="note-row">Opponent preview now behaves like ranked team preview: you see all six species, but their items, abilities, and moves stay hidden until battle actions reveal them.</div>
                <div className="note-row">Mega-capable Pokemon can now choose a dedicated Mega Evolve action, trigger their Mega ability before moving, and only one Mega can be used per side in each battle.</div>
                <div className="note-row">Preview stays visible for 60 seconds so you can plan your four before the battle opens, then the AI secretly locks its own four when the battle starts.</div>
                  <div className="note-row">{simTurnTimerEnabled ? 'Turn timer is armed. Locking choices early does not skip the clock; the full 30-second window still runs so the announcer can work the turn before the board resolves. Any slot left without a valid choice at zero will be auto-filled with a random legal line.' : 'Turn timer is off. Resolve turns manually at your own pace.'}</div>
                  <div className="note-row">{simAnnouncerEnabled ? 'Announcer is on with a male-voice speech pass, preview reads, live hit and KO calls, turn-clock reminders, winner reveals, and a Pokemon of the Game spotlight.' : 'Announcer is off. Toggle it on to hear preview commentary, move calls, KO hype, and post-game highlights.'}</div>
              </div>
            </div>

            <div className="panel tall span-two">
              {simPreview ? (
                <>
                  <SectionHeader title="Team Preview" subtitle={`Time left: ${simCountdown}s. Lock your four in order from lead to backline.`} />
                  <div className="sim-preview-grid">
                    <div className="subpanel">
                      <SectionHeader title="Your Team" subtitle={`Selected: ${simBringOrder.length}/4`} compact />
                      <div className="sim-team-preview">
                        {filledSlotIndices(team).map((slotIndex) => {
                          const build = team.slots[slotIndex];
                          const pokemon = selectedPokemon(build) ?? resolvePokemonForm(build);
                          const selected = simBringOrder.includes(slotIndex);
                          return (
                            <button key={build.id} className={selected ? 'sim-team-card active' : 'sim-team-card'} onClick={() => toggleBringIndex(slotIndex)}>
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? `Slot ${slotIndex + 1}`}</strong>
                              <small>{describeBuildRole(build, simFormat)}</small>
                              {selected ? <span>Bring #{simBringOrder.indexOf(slotIndex) + 1}</span> : <span>Select</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="subpanel">
                      <SectionHeader title="Opponent Preview" subtitle="All 6 species revealed. Set details stay hidden." compact />
                      <div className="sim-team-preview">
                        {filledSlotIndices(simPreview.opponentTeam).map((slotIndex) => {
                          const build = simPreview.opponentTeam.slots[slotIndex];
                          const pokemon = selectedPokemon(build) ?? resolvePokemonForm(build);
                          return (
                            <div key={build.id} className="sim-team-card static">
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? `Slot ${slotIndex + 1}`}</strong>
                              <small>Moveset, item, and ability hidden until battle.</small>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="note-row">
                    {simPreviewMessage ?? simulatorBringSummary(team, simPreview.format, simBringOrder)}
                  </div>

                  <div className="team-actions">
                    <button className="action-button primary" onClick={beginSimBattle} disabled={!battleCoreReady}>Start Battle</button>
                    <button className="action-button" onClick={() => setSimPreview(null)}>Cancel Preview</button>
                  </div>

                  <div className="battlefield-showcase-row">
                    <BattlefieldArena
                      title="Preview Battle Camera"
                      subtitle="This larger battle stage now sits in its own dedicated section so you can read the map, sprite spacing, and projected opening lanes more clearly before the match starts."
                      backdrop={simBackdrop}
                      topLabel="Opponent Preview"
                      bottomLabel="Your Locked Order"
                      topSlots={previewBattlefieldSlots(simPreview.opponentTeam, simPreview.format, simPreviewOpponentOrder, 'Species shown, full set still hidden.')}
                      bottomSlots={previewBattlefieldSlots(team, simPreview.format, simPreviewPlayerOrder, 'Projected lead lane from your current bring order.')}
                      topBench={previewBattlefieldBench(simPreview.opponentTeam, simPreview.format, simPreviewOpponentOrder, 'Preview species still hidden in battle order.')}
                      bottomBench={previewBattlefieldBench(team, simPreview.format, simPreviewPlayerOrder, 'Backline order from your current lock.')}
                      conditionSections={simPreviewFieldSections}
                      expansive
                    />
                  </div>
                </>
              ) : simBattle ? (
                <>
                  <SectionHeader title={simBattleResolved ? 'Battle Result' : `Battle Turn ${simBattle.turn}`} subtitle={simBattleResolved ? (simBattle.winner === 'player' ? 'You won the sandbox battle.' : simBattle.winner === 'opponent' ? 'The AI won the sandbox battle.' : 'The sandbox battle ended in a draw on match time.') : 'Select moves or switches for each active Pokemon, then resolve the turn.'} />
                  <div className="sim-battle-grid">
                    <BattleSideView side={simBattle.opponent} format={simBattle.format} />
                    <div className="sim-center-column">
                      <div className="result-grid">
                        <InfoStat label="Weather" value={weatherFieldLabel(simBattle)} />
                        <InfoStat label="Terrain" value={terrainFieldLabel(simBattle)} />
                        <InfoStat label="Trick Room" value={simBattle.trickRoomTurns ? `${simBattle.trickRoomTurns} turns` : 'Off'} />
                        <InfoStat label="Gravity" value={simBattle.gravityTurns ? `${simBattle.gravityTurns} turns` : 'Off'} />
                        <InfoStat label="Your Tailwind" value={simBattle.player.tailwindTurns ? `${simBattle.player.tailwindTurns}` : 'Off'} />
                        <InfoStat label="AI Tailwind" value={simBattle.opponent.tailwindTurns ? `${simBattle.opponent.tailwindTurns}` : 'Off'} />
                        <InfoStat label="Move Clock" value={simTurnTimerEnabled && !simBattleResolved ? `${simTurnClock}s` : 'Off'} />
                        <InfoStat label="Match Clock" value={!simBattleResolved ? `${Math.floor(simMatchClock / 60)}:${`${simMatchClock % 60}`.padStart(2, '0')}` : 'Ended'} />
                      </div>
                      <div className="subpanel sim-field-panel">
                        <SectionHeader title="Board State" subtitle="Live field, screen, and hazard conditions pulled from the simulator state." compact />
                        <div className="sim-field-stack">
                          {simulatorGlobalFieldTags(simBattle).length ? (
                            <div className="sim-field-section">
                              <strong>Global Field</strong>
                              <div className="battle-tag-row">
                                {simulatorGlobalFieldTags(simBattle).map((tag) => (
                                  <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                                    {tag.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {[
                            { label: 'Your Side', side: simBattle.player },
                            { label: 'AI Side', side: simBattle.opponent },
                          ].map(({ label, side }) => {
                            const sideTags = simulatorSideConditionTags(side);
                            return sideTags.length ? (
                              <div key={label} className="sim-field-section">
                                <strong>{label}</strong>
                                <div className="battle-tag-row">
                                  {sideTags.map((tag) => (
                                    <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                                      {tag.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                      {simTurnNotice ? <div className="note-row compact-note">{simTurnNotice}</div> : null}
                      {simAnnouncerEnabled ? (
                        <div className="notes-list compact-scroll announcer-feed">
                          {simAnnouncerFeed.length ? simAnnouncerFeed.map((line, index) => (
                            <div key={`${line}-${index}`} className="note-row compact-note announcer-line">{line}</div>
                          )) : <div className="note-row compact-note">Announcer is standing by for preview reads, live hit calls, KO updates, and the final star-player segment.</div>}
                        </div>
                      ) : null}
                      <div className="notes-list scroll-stack sim-log">
                        <div className="sim-log-turn-banner">{simBattleResolved ? `Final Turn ${simBattle.turn}` : `Turn ${simBattle.turn} Battle Log`}</div>
                        {[...simBattle.log].reverse().map((entry, index) => (
                          <div key={`${entry}-${index}`} className="note-row sim-log-entry">{entry}</div>
                        ))}
                      </div>
                    </div>
                    <BattleSideView side={simBattle.player} format={simBattle.format} friendly />
                  </div>

                  <div className="battlefield-live-combat-row">
                    <div className="battlefield-showcase-row battlefield-showcase-row-live">
                      <BattlefieldArena
                        title="Live Battle Stage"
                        subtitle="This dedicated lower stage stays locked to one battle map for the full match, with larger sprite lanes, clearer HP reads, and room for hit, KO, and ability cues to breathe."
                        backdrop={simBackdrop}
                        topLabel={simBattle.opponent.name}
                        bottomLabel={simBattle.player.name}
                        topSlots={battlefieldActiveSlotsFromSide(simBattle.opponent, simBattle.format)}
                        bottomSlots={battlefieldActiveSlotsFromSide(simBattle.player, simBattle.format, true)}
                        topBench={battlefieldBenchSlotsFromSide(simBattle.opponent)}
                        bottomBench={battlefieldBenchSlotsFromSide(simBattle.player, true)}
                        event={simBattlefieldEvent}
                        conditionSections={simFieldSections}
                        controlDock={<div className="battlefield-control-panel">{simCommandDeck}</div>}
                        expansive
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <strong>No active simulation yet.</strong>
                  <span>Generate an opponent to open team preview, then lock your four and play a live battle sandbox.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'pvp-battles' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Player vs Player" subtitle="Register, lock a saved team, and use a 6-digit room code to battle another live player." />
              <div className="notes-list compact-scroll">
                <div className="note-row">PvP uses the same battle engine as the AI simulator, but the turn clock is always on, opponent backline slots stay hidden until revealed, and a forfeit counts as a loss.</div>
                <div className="note-row">Your active Team Builder squad is the team that gets imported into a live room, so AI-generated teams can be saved, edited, and battled immediately.</div>
                <div className="note-row">Current music preset: {battleTrackLabel(state.profile.preferredBattleTrackId)}. Adjust battle audio, announcer defaults, and volume in the Profile tab.</div>
              </div>

              {!onlineAccount ? (
                <>
                  <div className="team-actions">
                    <button className={onlineAuthMode === 'register' ? 'action-button primary' : 'action-button'} onClick={() => setOnlineAuthMode('register')}>Register</button>
                    <button className={onlineAuthMode === 'login' ? 'action-button primary' : 'action-button'} onClick={() => setOnlineAuthMode('login')}>Sign In</button>
                  </div>
                  {onlineAuthMode === 'register' ? (
                    <>
                      <label className="field">
                        <span>Trainer Name</span>
                        <input value={state.profile.trainerName} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, trainerName: event.target.value } }))} placeholder="Registered battle name" />
                      </label>
                      <label className="field">
                        <span>Email</span>
                        <input value={onlineEmail} onChange={(event) => setOnlineEmail(event.target.value)} placeholder="Optional email for your battle account" />
                      </label>
                      <label className="field">
                        <span>Password</span>
                        <input type="password" value={onlinePassword} onChange={(event) => setOnlinePassword(event.target.value)} placeholder="At least 4 characters" />
                      </label>
                      <button className="action-button primary" onClick={() => { void registerForOnlineBattles(); }}>Register for PvP</button>
                    </>
                  ) : (
                    <>
                      <label className="field">
                        <span>Trainer Name or Email</span>
                        <input value={onlineLookup} onChange={(event) => setOnlineLookup(event.target.value)} placeholder="Use your registered trainer name or email" />
                      </label>
                      <label className="field">
                        <span>Password</span>
                        <input type="password" value={onlinePassword} onChange={(event) => setOnlinePassword(event.target.value)} placeholder="Your battle password" />
                      </label>
                      <button className="action-button primary" onClick={() => { void loginForOnlineBattles(); }}>Sign In</button>
                    </>
                  )}
                  {onlineStatusMessage ? <div className="note-row compact-note">{onlineStatusMessage}</div> : null}
                </>
              ) : (
                <>
                  <div className="result-grid">
                    <InfoStat label="Account" value={onlineAccount.trainerName} />
                    <InfoStat label="Format" value={team.format} />
                    <InfoStat label="Imported Team" value={team.name} />
                    <InfoStat label="Music" value={battleTrackLabel(state.profile.preferredBattleTrackId)} />
                  </div>
                  <div className="team-actions">
                    <button className="action-button primary" onClick={() => { void createPvpRoomNow(); }}>Create 6-Digit Room</button>
                  </div>
                  <label className="field">
                    <span>Join Room Code</span>
                    <input value={pvpRoomCodeInput} onChange={(event) => setPvpRoomCodeInput(event.target.value)} placeholder="Enter a 6-digit code" />
                  </label>
                  <div className="team-actions">
                    <button className="action-button" onClick={() => { void joinPvpRoomNow(); }}>Join Live Room</button>
                    <button className="action-button" onClick={() => {
                      setPvpRoom(null);
                      setPvpBringOrder([]);
                      setPvpChoiceDrafts({});
                      setPvpMessage(null);
                    }}>Clear Room</button>
                  </div>
                  {onlineStatusMessage ? <div className="note-row compact-note">{onlineStatusMessage}</div> : null}
                </>
              )}
            </div>

            <div className="panel tall span-two">
              {!pvpRoom ? (
                <div className="empty-state">
                  <strong>No live room open yet.</strong>
                  <span>Register or sign in, then create a room or join one with a 6-digit code to start PvP preview.</span>
                </div>
              ) : pvpRoom.stage === 'lobby' ? (
                <>
                  <SectionHeader title="Waiting Room" subtitle={`Room ${pvpRoom.code} is open. Share the code and wait for a second battler.`} />
                  <div className="result-grid">
                    <InfoStat label="Host" value={pvpRoom.hostTrainerName} />
                    <InfoStat label="Guest" value={pvpRoom.guestTrainerName ?? 'Waiting'} />
                    <InfoStat label="Timer" value={`${pvpRoom.timerSeconds}s mandatory`} />
                    <InfoStat label="Music" value={battleTrackLabel(pvpRoom.musicTrackId)} />
                  </div>
                  <div className="note-row">{pvpRoom.lastActionSummary}</div>
                </>
              ) : pvpRoom.stage === 'preview' ? (
                <>
                  <SectionHeader title="PvP Team Preview" subtitle={`Room ${pvpRoom.code} | ${pvpCountdown}s left to lock your four.`} />
                  <div className="sim-preview-grid">
                    <div className="subpanel">
                      <SectionHeader title="Opponent Preview" subtitle="All 6 species are visible, but items, abilities, and moves remain hidden." compact />
                      <div className="sim-team-preview">
                        {filledSlotIndices(pvpRoom.opponentTeam ?? createTeam('Empty')).map((slotIndex) => {
                          const build = pvpRoom.opponentTeam?.slots[slotIndex];
                          const pokemon = build ? selectedPokemon(build) ?? resolvePokemonForm(build) : null;
                          return (
                            <div key={build?.id ?? slotIndex} className="sim-team-card static">
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? `Slot ${slotIndex + 1}`}</strong>
                              <span>Live reveal only</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="subpanel">
                      <SectionHeader title="Your Bring Order" subtitle="Select exactly 4 Pokemon in the order you want to bring them." compact />
                      <div className="sim-team-preview">
                        {filledSlotIndices(team).map((slotIndex) => {
                          const build = team.slots[slotIndex];
                          const pokemon = resolvePokemonForm(build);
                          const selected = pvpBringOrder.includes(slotIndex);
                          return (
                            <button key={build.id} className={selected ? 'sim-team-card selectable active' : 'sim-team-card selectable'} onClick={() => togglePvpBringIndex(slotIndex)}>
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" label={selected ? `${pvpBringOrder.indexOf(slotIndex) + 1}` : undefined} />
                              <strong>{pokemon?.displayName ?? `Slot ${slotIndex + 1}`}</strong>
                              <span>{selected ? `Locked #${pvpBringOrder.indexOf(slotIndex) + 1}` : 'Tap to bring'}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="note-row">{pvpMessage ?? `Your opponent has locked ${pvpRoom.opponentBringCount}/4 Pokemon so far.`}</div>
                  <div className="team-actions">
                    <button className="action-button primary" onClick={() => { void submitPvpBringOrderSelection(); }}>Submit Bring Order</button>
                    <button className="action-button" onClick={() => setPvpBringOrder([])}>Clear Picks</button>
                  </div>
                  <div className="battlefield-showcase-row">
                    <BattlefieldArena
                      title="PvP Preview Camera"
                      subtitle="The room preview now keeps a larger dedicated battlefield section reserved below the preview lists so the lead lanes and reveal rules are easier to read."
                      backdrop={pvpBackdrop}
                      topLabel="Opponent Preview"
                      bottomLabel="Your Locked Order"
                      topSlots={previewBattlefieldSlots(pvpRoom.opponentTeam ?? createTeam('Empty'), pvpRoom.format, pvpPreviewOpponentOrder, 'Preview species only, battle order unrevealed.')}
                      bottomSlots={previewBattlefieldSlots(team, pvpRoom.format, pvpPreviewPlayerOrder, 'Projected lead lane from your current bring order.')}
                      topBench={previewBattlefieldBench(pvpRoom.opponentTeam ?? createTeam('Empty'), pvpRoom.format, pvpPreviewOpponentOrder, 'Preview species only until live reveal.')}
                      bottomBench={previewBattlefieldBench(team, pvpRoom.format, pvpPreviewPlayerOrder, 'Backline order from your current lock.')}
                      conditionSections={pvpPreviewFieldSections}
                      expansive
                    />
                  </div>
                </>
              ) : pvpRoom.battle ? (
                <>
                  <SectionHeader title="Live PvP Battle" subtitle={`Room ${pvpRoom.code} | ${pvpBattleResolved ? (pvpRoom.battle.winner === 'player' ? 'You won the room.' : pvpRoom.battle.winner === 'opponent' ? 'Your opponent won the room.' : 'The room ended in a draw on match time.') : `${pvpCountdown}s on the mandatory move clock`}`} />
                  <div className="result-grid">
                    <InfoStat label="Track" value={battleTrackLabel(pvpRoom.musicTrackId)} />
                    <InfoStat label="Clock" value={`${pvpRoom.timerSeconds}s`} />
                    <InfoStat label="Match Clock" value={!pvpBattleResolved ? `${Math.floor(pvpMatchCountdown / 60)}:${`${pvpMatchCountdown % 60}`.padStart(2, '0')}` : 'Ended'} />
                    <InfoStat label="Choices Locked" value={pvpRoom.playerChoicesLocked ? 'Yes' : 'No'} />
                    <InfoStat label="Opponent Locked" value={pvpRoom.opponentChoicesLocked ? 'Yes' : 'No'} />
                  </div>
                  <div className="battle-layout">
                    <BattleSideView side={pvpRoom.battle.opponent} format={pvpRoom.battle.format} />
                    <div className="battle-center">
                      <div className="subpanel sim-field-panel">
                        <SectionHeader title="Active Effects" subtitle="Weather, terrain, rooms, screens, hazards, and live turn counters." compact />
                        <div className="sim-field-stack">
                          {simulatorGlobalFieldTags(pvpRoom.battle).length ? (
                            <div className="sim-field-section">
                              <strong>Global Field</strong>
                              <div className="battle-tag-row">
                                {simulatorGlobalFieldTags(pvpRoom.battle).map((tag) => (
                                  <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                                    {tag.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {[{ label: 'Your Side', side: pvpRoom.battle.player }, { label: 'Opponent Side', side: pvpRoom.battle.opponent }].map(({ label, side }) => {
                            const sideTags = simulatorSideConditionTags(side);
                            return sideTags.length ? (
                              <div key={label} className="sim-field-section">
                                <strong>{label}</strong>
                                <div className="battle-tag-row">
                                  {sideTags.map((tag) => (
                                    <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                                      {tag.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : null;
                          })}
                        </div>
                      </div>
                      <div className="notes-list scroll-stack sim-log">
                        <div className="sim-log-turn-banner">{pvpBattleResolved ? `Final Turn ${pvpRoom.battle.turn}` : `Turn ${pvpRoom.battle.turn} Battle Log`}</div>
                        {[...pvpRoom.battle.log].reverse().map((entry, index) => (
                          <div key={`${entry}-${index}`} className="note-row sim-log-entry">{entry}</div>
                        ))}
                      </div>
                      {pvpAnnouncerFeed.length ? (
                        <div className="notes-list compact-scroll">
                          {pvpAnnouncerFeed.slice(0, 6).map((entry, index) => (
                            <div key={`${entry}-${index}`} className="note-row">{entry}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <BattleSideView side={pvpRoom.battle.player} format={pvpRoom.battle.format} friendly />
                  </div>

                  <div className="battlefield-live-combat-row">
                    <div className="battlefield-showcase-row battlefield-showcase-row-live">
                      <BattlefieldArena
                        title="Live PvP Stage"
                        subtitle="This full-width broadcast field stays locked to one map for the whole room, with larger active lanes, clearer backline reveal space, and more readable battle flow."
                        backdrop={pvpBackdrop}
                        topLabel={pvpRoom.battle.opponent.name}
                        bottomLabel={pvpRoom.battle.player.name}
                        topSlots={battlefieldActiveSlotsFromSide(pvpRoom.battle.opponent, pvpRoom.battle.format)}
                        bottomSlots={battlefieldActiveSlotsFromSide(pvpRoom.battle.player, pvpRoom.battle.format, true)}
                        topBench={battlefieldBenchSlotsFromSide(pvpRoom.battle.opponent)}
                        bottomBench={battlefieldBenchSlotsFromSide(pvpRoom.battle.player, true)}
                        event={pvpBattlefieldEvent}
                        conditionSections={pvpFieldSections}
                        controlDock={<div className="battlefield-control-panel">{pvpCommandDeck}</div>}
                        expansive
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        )}

        {activeTab === 'profile' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Trainer Profile" subtitle="Saved locally so your teams, preferences, and notes persist between sessions." />
              <label className="field">
                <span>Trainer Name</span>
                <input value={state.profile.trainerName} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, trainerName: event.target.value } }))} placeholder="Your ladder or tournament tag" />
              </label>
              <label className="field">
                <span>Favorite Format</span>
                <select value={state.profile.favoriteFormat} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, favoriteFormat: event.target.value as BattleFormat } }))}>
                  {battleFormats.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Player Notes</span>
                <textarea rows={6} value={state.profile.playerNote} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, playerNote: event.target.value } }))} placeholder="Personal metagame reads, comfort picks, anti-meta angles..." />
              </label>
              <div className="notes-list compact-scroll">
                <div className="note-row">{profileReady ? `Profile anchor ready: ${state.profile.trainerName}. Team saves are attached to this profile library.` : 'Team saves now require a named profile. Add a trainer name here before using Save Team or saving an AI draft permanently.'}</div>
                <div className="note-row">Stored local profiles on this browser: {storedProfiles.length ? storedProfiles.join(', ') : 'None yet'}</div>
                <div className="note-row">Profile created: {state.profile.profileCreatedAt ? new Date(state.profile.profileCreatedAt).toLocaleString() : 'Waiting for first profile save'}</div>
              </div>
              <ToggleField
                label="Battle Music"
                checked={state.profile.battleMusicEnabled}
                onChange={(checked) => setState((current) => ({ ...current, profile: { ...current.profile, battleMusicEnabled: checked } }))}
              />
              <label className="field">
                <span>Battle Music Mode</span>
                <select value={state.profile.battleMusicMode} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, battleMusicMode: event.target.value as BattleMusicMode } }))}>
                  <option value="single">Single Track</option>
                  <option value="random">Random Rotation</option>
                  <option value="playlist">Playlist Cycle</option>
                </select>
              </label>
              <label className="field">
                <span>Battle Music Track</span>
                <select value={state.profile.preferredBattleTrackId} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, preferredBattleTrackId: event.target.value } }))}>
                  {battleMusicTracks.map((track) => (
                    <option key={track.id} value={track.id}>{track.generation} - {track.label}</option>
                  ))}
                </select>
              </label>
              <div className="notes-list compact-scroll profile-playlist-stack">
                <div className="note-row">Playlist cycle: {battlePlaylistSummary(state.profile.battleMusicPlaylistIds)}</div>
                {battleMusicTracks.map((track) => {
                  const checked = normalizedPlaylistIds(state.profile.battleMusicPlaylistIds).includes(track.id);
                  return (
                    <label key={track.id} className="playlist-toggle-row">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const currentPlaylist = normalizedPlaylistIds(state.profile.battleMusicPlaylistIds);
                          const nextPlaylist = event.target.checked
                            ? [...new Set([...currentPlaylist, track.id])]
                            : currentPlaylist.filter((entry) => entry !== track.id);
                          setState((current) => ({
                            ...current,
                            profile: {
                              ...current.profile,
                              battleMusicPlaylistIds: nextPlaylist.length ? nextPlaylist : [track.id],
                            },
                          }));
                        }}
                      />
                      <span>{track.generation} - {track.label}</span>
                    </label>
                  );
                })}
              </div>
              <div className="team-actions compact-actions">
                <button className="mini-button active" onClick={() => { setProfileMusicPreviewActive(true); setProfileMusicPreviewSession((current) => current + 1); }}>
                  Preview Current Mode
                </button>
                <button className="mini-button" onClick={() => setState((current) => ({ ...current, profile: { ...current.profile, battleMusicMode: 'random' } }))}>
                  Use Random
                </button>
                <button className="mini-button" onClick={() => setProfileMusicPreviewActive(false)}>
                  Stop Preview
                </button>
              </div>
              <label className="field">
                <span>Battle Music Volume</span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={state.profile.battleMusicVolume}
                  onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, battleMusicVolume: Number(event.target.value) } }))}
                />
                <small>{state.profile.battleMusicVolume}% background volume for AI and PvP battles.</small>
              </label>
              <ToggleField
                label="Announcer Default"
                checked={state.profile.announcerDefaultEnabled}
                onChange={(checked) => setState((current) => ({ ...current, profile: { ...current.profile, announcerDefaultEnabled: checked } }))}
              />
              <div className="notes-list compact-scroll">
                <div className="note-row">Online battle account: {onlineAccount ? `${onlineAccount.trainerName} registered` : 'Not signed in yet'}</div>
                {onlineAccount ? <div className="note-row">Email on file: {onlineAccount.email || 'Not provided'}</div> : null}
                <div className="note-row">Battle music mode: {state.profile.battleMusicMode === 'single' ? 'single selected track' : state.profile.battleMusicMode === 'random' ? 'randomized between battles' : 'playlist cycling between tracks'}</div>
              </div>
              <div className="save-status-row">
                <span>{saveStatusLabel}</span>
                <button className="action-button primary" onClick={() => persistNow('Profile saved locally', true, 'Saving this profile')}>Save Profile</button>
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Battle Growth" subtitle="Track your simulator reps, win rate trend, and the Pokemon that keep carrying your battles." />
              <div className="result-grid">
                <InfoStat label="Matches" value={`${state.profile.matchHistory.length}`} />
                <InfoStat label="Wins" value={`${profileHistorySummary.wins}`} />
                <InfoStat label="Losses" value={`${profileHistorySummary.losses}`} />
                <InfoStat label="Win Rate" value={`${profileHistorySummary.winRate}%`} />
                <InfoStat label="Best Streak" value={`${profileHistorySummary.bestStreak}`} />
                <InfoStat label="Avg Turns" value={profileHistorySummary.averageTurns} />
              </div>
              <div className="subpanel">
                <SectionHeader title="Live Team Analysis" subtitle="The current squad snapshot stays visible here so the profile doubles as a prep dashboard." />
                <div className="result-grid">
                  <InfoStat label="Format" value={analysis.format} />
                  <InfoStat label="Synergy" value={`${analysis.synergyScore}`} />
                  <InfoStat label="Survive" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityTurns}`} />
                  <InfoStat label="Win Rate" value={`${analysis.estimatedWinRate}%`} />
                  <InfoStat label="Meta" value={analysis.teamUsage.label} />
                  <InfoStat label="Off-Meta" value={getNinetalesBiasLabel(state.profile.offMetaBias)} />
                </div>
                <MetricNotes analysis={analysis} compact />
                <div className="notes-list compact-scroll">
                  <div className="note-row"><strong>Overview:</strong> {analysis.overview}</div>
                  <div className="note-row"><strong>Threat Pulse:</strong> {analysis.threats.slice(0, 3).map((threat) => `${threat.name} ${threat.score}%`).join(', ') || 'Not enough live team data yet.'}</div>
                  <div className="note-row"><strong>Easy Wins:</strong> {analysis.easyTargets.join(', ') || 'No easy targets flagged yet.'}</div>
                </div>
              </div>
              <div className="subpanel">
                <SectionHeader title="Ability Parity" subtitle="A live audit snapshot of how much of the Champions ability pool is wired into battle logic today." />
                <div className="result-grid">
                  <InfoStat label="Covered" value={`${overallAbilityParity.coveredPercent}%`} />
                  <InfoStat label="Explicit" value={`${overallAbilityParity.explicit}`} />
                  <InfoStat label="Damage Core" value={`${overallAbilityParity.damageCore}`} />
                  <InfoStat label="Review Left" value={`${overallAbilityParity.reviewNeeded}`} />
                </div>
                <div className="notes-list compact-scroll">
                  <div className="note-row">Explicit ability hooks include live rulings like weather setters, terrain setters, Intimidate, Prankster timing, Good as Gold, Inner Focus, Contrary, Simple, Defiant, Competitive, Clear Body-style shields, Mirror Armor, and Mega Sol timing.</div>
                  <div className="note-row">Damage-core abilities are covered inside the shared calc layer for type conversion, immunities, power modifiers, crits, and stat multipliers.</div>
                  <div className="note-row"><strong>Still queued for bespoke review:</strong> {overallAbilityParity.topReviewAbilities.map((entry) => entry.abilityName).join(', ') || 'No remaining review queue.'}</div>
                </div>
              </div>
              <div className="notes-list scroll-stack growth-chart-list">
                {profileHistorySummary.growthChart.length ? profileHistorySummary.growthChart.map((record) => (
                  <button key={record.id} className={selectedReplay?.id === record.id ? 'saved-team-card active growth-row' : 'saved-team-card growth-row'} onClick={() => setSelectedReplayId(record.id)}>
                    <div className="growth-row-copy">
                      <strong>{new Date(record.playedAt).toLocaleDateString()} - {record.result}</strong>
                      <small>{record.mode} | {record.teamName} | {record.format} | Star: {record.starPokemon ?? 'None logged'}</small>
                    </div>
                    <div className="growth-row-bar">
                      <div className="growth-row-track">
                        <div className="growth-row-fill" style={{ width: `${record.cumulativeWinRate}%` }} />
                      </div>
                      <span>{record.cumulativeWinRate}% trend</span>
                    </div>
                  </button>
                )) : (
                  <div className="note-row">No battle logs yet. Run AI Simulator or PvP battles to build a growth chart and replay library.</div>
                )}
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Replay + Coaching" subtitle="Review full match logs, then study the turns where a stronger line was available." />
              {selectedReplay ? (
                <>
                  <div className="result-grid">
                    <InfoStat label="Result" value={selectedReplay.result} />
                    <InfoStat label="Mode" value={selectedReplay.mode} />
                    <InfoStat label="Format" value={selectedReplay.format} />
                    <InfoStat label="Opponent" value={selectedReplay.opponentName ?? 'Unknown'} />
                    <InfoStat label="Star" value={selectedReplay.starPokemon ?? 'None'} />
                    <InfoStat label="Timer" value={selectedReplay.timerEnabled ? '30s On' : 'Off'} />
                    <InfoStat label="Announcer" value={selectedReplay.announcerEnabled ? 'On' : 'Off'} />
                    <InfoStat label="Turns" value={`${selectedReplay.turns}`} />
                  </div>
                  <div className="notes-list compact-scroll replay-stack">
                    {selectedReplay.roomCode ? <div className="note-row"><strong>Room Code:</strong> {selectedReplay.roomCode}</div> : null}
                    {selectedReplay.musicTrackId ? <div className="note-row"><strong>Battle Music:</strong> {battleTrackLabel(selectedReplay.musicTrackId)}</div> : null}
                    {selectedReplay.resultReason ? <div className="note-row"><strong>Finish:</strong> {selectedReplay.resultReason === 'forfeit' ? 'Ended by forfeit' : 'Normal battle close'}</div> : null}
                    <div className="note-row"><strong>Opponent Preview:</strong> {selectedReplay.opponentPreview.join(', ')}</div>
                    <div className="note-row"><strong>Top Performers:</strong> {selectedReplay.topPerformers.join(', ') || 'No standout logged'}</div>
                    {selectedReplay.turnReviews.map((review, index) => (
                      <div key={`${selectedReplay.id}-review-${index}`} className="note-row">
                        <strong>{`Turn ${review.turn} - ${review.pokemon}`}</strong> {review.chosenAction}. {review.betterAction ? `Better line: ${review.betterAction}.` : 'No clearly stronger line flagged.'} {review.outcomeDelta}
                      </div>
                    ))}
                    {selectedReplay.battleLog.map((entry, index) => (
                      <div key={`${selectedReplay.id}-log-${index}`} className="note-row">{entry}</div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <strong>No replay selected yet.</strong>
                    <span>Your next battle will appear here with replay logs and turn-by-turn coaching notes.</span>
                </div>
              )}
              <div className="notes-list">
                <div className="note-row">Profile saved: {state.profile.trainerName || 'Not yet named'}</div>
                <div className="note-row">Teams saved: {state.teams.length}</div>
                <div className="note-row">Last local save: {lastSavedAt ? new Date(lastSavedAt).toLocaleString() : 'Waiting for first autosave'}</div>
                <div className="note-row">Current roster source pages: {dataset.sourcePages.length}</div>
                <div className="note-row">Layout mode: {state.profile.layoutMode} | Resizable panels: {state.profile.resizablePanels ? 'On' : 'Off'}</div>
              </div>
              <div className="team-actions">
                <button className="action-button" onClick={() => persistNow('Full local save updated', true, 'Saving your profile library')}>Save Everything</button>
                <button className="action-button danger" onClick={resetEverything}>Clear Local Save</button>
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="PvP Room History" subtitle="Browse finished live rooms by code or opponent, then use the replay panel above for the locally stored battle log." />
              <label className="field">
                <span>Filter Room History</span>
                <input value={pvpHistorySearch} onChange={(event) => setPvpHistorySearch(event.target.value)} placeholder="Search by code or opponent name" />
              </label>
              <div className="notes-list scroll-stack compact-scroll replay-stack">
                {filteredPvpHistory.length ? filteredPvpHistory.map((entry) => {
                  const linkedReplay = state.profile.matchHistory.find((record) => record.roomCode === entry.code) ?? null;
                  return (
                  <button
                    key={`${entry.code}-${entry.playedAt}`}
                    className={linkedReplay?.id === selectedReplay?.id ? 'saved-team-card active growth-row' : 'saved-team-card growth-row'}
                    onClick={() => {
                      if (linkedReplay) {
                        setSelectedReplayId(linkedReplay.id);
                      }
                    }}
                  >
                    <div className="growth-row-copy">
                      <strong>{entry.code} - {entry.result}</strong>
                      <small>{new Date(entry.playedAt).toLocaleString()} | {entry.format} | vs {entry.opponentName}</small>
                    </div>
                    <div className="notes-list compact-scroll">
                      <div className="note-row">Winner: {entry.winnerName ?? 'Unknown'} | Finish: {entry.resultReason === 'forfeit' ? 'Forfeit' : 'Normal'} | Turns: {entry.turns}</div>
                      <div className="note-row">Music: {battleTrackLabel(entry.musicTrackId)}{linkedReplay ? ' | Click to open replay' : ' | Replay log not stored on this browser yet'}</div>
                    </div>
                  </button>
                );
                }) : (
                  <div className="note-row">No PvP room history loaded yet. Finish a live room or sign in to fetch room archives from the arena service.</div>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function SectionHeader({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={compact ? 'section-header compact' : 'section-header'}>
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricNotes({ analysis, compact = false }: { analysis: TeamAnalysis; compact?: boolean }) {
  const className = compact ? 'note-row compact-note metric-note' : 'note-row metric-note';
  return (
    <div className="notes-list metric-note-stack">
      <div className={className}><strong>Est. Win Rate:</strong> {analysis.winRateSummary}</div>
      <div className={className}><strong>Survivability:</strong> {analysis.survivabilitySummary}</div>
      {analysis.metricNotes.map((note) => (
        <div key={note} className={className}>{note}</div>
      ))}
    </div>
  );
}

function UsagePill({ insight, small = false }: { insight: ReturnType<typeof getMoveUsageInsight>; small?: boolean }) {
  return <span className={small ? `usage-pill ${insight.label.toLowerCase()} small` : `usage-pill ${insight.label.toLowerCase()}`}>{insight.label}</span>;
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button type="button" className={checked ? 'toggle-switch active' : 'toggle-switch'} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

function PokemonSpriteFrame({
  pokemon,
  size = 'standard',
  label,
  statusBadge = null,
}: {
  pokemon: PokemonEntry | null;
  size?: 'mini' | 'tiny' | 'standard' | 'pokedex';
  label?: string;
  statusBadge?: StatusBadge | null;
}) {
  const sprite = displaySpriteForPokemon(pokemon);
  const syntheticMega = usesMegaSpriteFallback(pokemon);
  const className = `sprite-shell ${size}${syntheticMega ? ' mega-fallback' : ''}`;

  if (!sprite) {
    return <div className={`${className} sprite-fallback`}>{label?.[0] ?? '?'}</div>;
  }

  return (
    <div className={className}>
      <img src={sprite} alt={pokemon?.displayName ?? label ?? 'Pokemon'} className="sprite-image" />
      {statusBadge ? (
        <span className={`status-badge status-${statusBadge.tone}`} title={statusBadge.title}>
          {statusBadge.label}
        </span>
      ) : null}
      {syntheticMega ? <span className="mega-pill">Mega</span> : null}
    </div>
  );
}

function HiddenBenchFrame({ size = 'tiny' }: { size?: 'tiny' | 'mini' | 'standard' }) {
  return (
    <div className={`sprite-shell ${size} pokeball-shell`} aria-label="Hidden opponent backline slot">
      <span className="pokeball-half pokeball-top" />
      <span className="pokeball-half pokeball-bottom" />
      <span className="pokeball-band" />
      <span className="pokeball-core" />
    </div>
  );
}

function SelectedSlotSpotlight({ build, format, slotIndex }: { build: PokemonBuild; format: BattleFormat; slotIndex: number }) {
  const normalizedBuild = normalizeBuildForChampions(build);
  const basePokemon = selectedPokemon(normalizedBuild);
  const activePokemon = resolvePokemonForm(normalizedBuild);
  const stats = activePokemon ? buildStats(activePokemon.baseStats, normalizedBuild.evs, normalizedBuild.natureId) : null;
  const moves = activePokemon
    ? normalizedBuild.moveIds.map((moveId) => activePokemon.movePool.find((move) => move.id === moveId)?.name).filter((name): name is string => Boolean(name))
    : [];
  const usage = getPokemonUsageInsight(activePokemon ?? basePokemon, format);

  if (!activePokemon) {
    return (
      <>
        <SectionHeader title="Selected Slot Preview" subtitle="This space now tracks the slot you are editing so the desktop column stays useful instead of empty." />
        <div className="selected-slot-hero empty">
          <PokemonSpriteFrame pokemon={null} size="pokedex" label={`${slotIndex + 1}`} />
          <div className="selected-slot-meta">
            <div className="validation-banner info">
              <strong>{`Slot ${slotIndex + 1} is open`}</strong>
              <small>Click a slot on the right, then pick a Pokemon from the live Champions roster to see its art, spread, item, and move plan here.</small>
            </div>
            <div className="notes-list">
              <div className="note-row">Use the type filters in the Inspector to narrow the roster before selecting a Pokemon.</div>
              <div className="note-row">Once you pick a species, this panel will show the larger sprite, EV spread, nature bonuses, and move package for that slot.</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SectionHeader title={`${activePokemon.displayName} Spotlight`} subtitle={`Selected slot ${slotIndex + 1} preview with the live spread, nature, and move package for ${format}.`} />
      <div className="selected-slot-hero">
        <PokemonSpriteFrame pokemon={activePokemon} size="pokedex" />
        <div className="selected-slot-meta">
          <div className="selected-slot-title-row">
            <div>
              <strong>{buildLabel(normalizedBuild, activePokemon)}</strong>
              <small>{activePokemon.types.join(' / ')} - {describeBuildRole(normalizedBuild, format)}</small>
            </div>
            <UsagePill insight={usage} />
          </div>

          <div className="result-grid">
            <InfoStat label="Item" value={getItemById(normalizedBuild.itemId)?.name ?? 'No item'} />
            <InfoStat label="Ability" value={normalizedBuild.abilityName ?? activePokemon.abilities[0]?.name ?? 'Ability'} />
            <InfoStat label="Nature" value={natureBenefitLabel(normalizedBuild.natureId)} />
            <InfoStat label="Mega" value={describeMegaState(normalizedBuild, basePokemon)} />
          </div>

          <div className="note-row compact-note">EV Spread: {effortSpreadLabel(normalizedBuild.evs)}</div>

          {stats ? (
            <div className="selected-slot-stat-grid">
              {statOrder.map((stat) => (
                <div key={stat} className="slot-stat-pill compact">
                  <small>{statLabels[stat]}</small>
                  <strong>{stats[stat]}</strong>
                </div>
              ))}
            </div>
          ) : null}

          <div className="move-chip-row generated-move-chip-row">
            {moves.map((moveName) => (
              <span key={moveName} className="move-chip">{moveName}</span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function BattleSideView({ side, format, friendly = false }: { side: SimulatorBattleState['player']; format: BattleFormat; friendly?: boolean }) {
  return (
    <div className={friendly ? 'battle-side friendly' : 'battle-side'}>
      <h3>{side.name}</h3>
      <div className="battle-active-row">
        {side.active.map((unitIndex, index) => {
          const unit = side.units[unitIndex];
          if (!unit) {
            return null;
          }

          const statusBadge = simulatorStatusBadge(unit);
          const battleTags = simulatorBattleTags(unit);
          return (
            <div key={`${unit.pokemon.id}-${index}`} className="battle-card">
              <PokemonSpriteFrame pokemon={unit.pokemon} size="standard" statusBadge={statusBadge} />
              <strong>{unit.pokemon.displayName}</strong>
              <small>{friendly ? describeBuildRole(unit.build, format) : 'Opponent set hidden'}</small>
              {battleTags.length ? (
                <div className="battle-tag-row">
                  {battleTags.map((tag) => (
                    <span key={tag.key} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                      {tag.label}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="hp-bar">
                <div className="hp-fill" style={{ width: `${Math.max(0, (unit.currentHp / unit.maxHp) * 100)}%` }} />
              </div>
              <span>{unit.currentHp} / {unit.maxHp}</span>
            </div>
          );
        })}
      </div>
      <div className="battle-bench-row">
        {side.bench.map((unitIndex) => {
          const unit = side.units[unitIndex];
          const concealed = !friendly && !unit?.revealed;
          return unit ? (
            <div key={`${unit.pokemon.id}-${unitIndex}`} className={concealed ? 'battle-bench-card hidden-bench-card' : 'battle-bench-card'}>
              {concealed ? <HiddenBenchFrame size="tiny" /> : <PokemonSpriteFrame pokemon={unit.pokemon} size="tiny" statusBadge={simulatorStatusBadge(unit)} />}
              <small>{concealed ? 'Hidden backline' : unit.pokemon.displayName}</small>
              {concealed ? <span>Reveals on first switch-in.</span> : null}
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

function battlefieldActiveSlotsFromSide(side: SimSide, format: BattleFormat, friendly = false): BattlefieldSlotModel[] {
  const expected = format === 'Doubles' ? 2 : 1;
  const activeSlots: BattlefieldSlotModel[] = side.active
    .map((unitIndex) => side.units[unitIndex] ?? null)
    .filter((unit): unit is SimUnit => Boolean(unit))
    .map((unit, index) => {
      const concealed = !friendly && !unit.revealed;
      return {
        key: `${side.name}-active-${unit.slotIndex}-${index}`,
        pokemon: concealed ? null : unit.pokemon,
        title: concealed ? 'Hidden active slot' : battleUnitDisplayName(unit),
        subtitle: concealed ? 'Reveals after a live send-out.' : (friendly ? describeBuildRole(unit.build, format) : 'Opponent active'),
        types: concealed ? [] : battlefieldTypesForUnit(unit),
        statusBadge: concealed ? null : simulatorStatusBadge(unit),
        battleTags: concealed ? [] : battlefieldEffectTagsForUnit(unit),
        hidden: concealed,
        hpPercent: concealed ? null : Math.max(0, (unit.currentHp / unit.maxHp) * 100),
        hpLabel: concealed ? null : `${unit.currentHp} / ${unit.maxHp}`,
        fainted: unit.fainted,
      } satisfies BattlefieldSlotModel;
    });

  while (activeSlots.length < expected) {
    activeSlots.push({
      key: `${side.name}-active-empty-${activeSlots.length}`,
      pokemon: null,
      title: expected === 2 ? `Open ${side.name} lane` : 'Open field lane',
      subtitle: 'Waiting for the next send-out.',
      types: [],
      statusBadge: null,
      hidden: false,
      hpPercent: null,
      hpLabel: null,
      fainted: false,
    });
  }

  return activeSlots.slice(0, expected);
}

function battlefieldBenchSlotsFromSide(side: SimSide, friendly = false): BattlefieldSlotModel[] {
  const benchSlots: BattlefieldSlotModel[] = [];
  side.bench.forEach((unitIndex, order) => {
    const unit = side.units[unitIndex];
    if (!unit) {
      return;
    }
    const concealed = !friendly && !unit.revealed;
    benchSlots.push({
      key: `${side.name}-bench-${unit.slotIndex}-${order}`,
      pokemon: concealed ? null : unit.pokemon,
      title: concealed ? 'Hidden backline' : battleUnitDisplayName(unit),
      subtitle: concealed ? 'Reveal on switch-in.' : (unit.fainted ? 'Knocked out' : 'Backline ready'),
      types: concealed ? [] : battlefieldTypesForUnit(unit),
      statusBadge: concealed ? null : simulatorStatusBadge(unit),
      battleTags: concealed ? [] : battlefieldEffectTagsForUnit(unit),
      hidden: concealed,
      hpPercent: concealed ? null : Math.max(0, (unit.currentHp / unit.maxHp) * 100),
      hpLabel: concealed ? null : `${unit.currentHp} / ${unit.maxHp}`,
      fainted: unit.fainted,
    });
  });
  return benchSlots;
}

function previewBattlefieldSlots(team: Team, format: BattleFormat, slotOrder: number[], subtitle: string): BattlefieldSlotModel[] {
  const expected = format === 'Doubles' ? 2 : 1;
  const ordered: BattlefieldSlotModel[] = slotOrder
    .map((slotIndex) => team.slots[slotIndex] ?? null)
    .filter((build): build is PokemonBuild => Boolean(build))
    .map((build, index) => {
      const pokemon = selectedPokemon(build) ?? resolvePokemonForm(build);
      return {
        key: `${team.id}-preview-${build.id}-${index}`,
        pokemon,
        title: build.nickname.trim() || pokemon?.displayName || `Slot ${index + 1}`,
        subtitle,
        types: pokemon?.types ?? [],
      } satisfies BattlefieldSlotModel;
    });

  while (ordered.length < expected) {
    ordered.push({
      key: `${team.id}-preview-empty-${ordered.length}`,
      pokemon: null,
      title: expected === 2 ? `Lead ${ordered.length + 1}` : 'Lead slot',
      subtitle: 'Lock your bring order to project the opening board.',
      types: [],
      statusBadge: null,
      hidden: false,
      hpPercent: null,
      hpLabel: null,
      fainted: false,
    });
  }

  return ordered.slice(0, expected);
}

function previewBattlefieldBench(team: Team, format: BattleFormat, slotOrder: number[], subtitle: string): BattlefieldSlotModel[] {
  const activeCount = format === 'Doubles' ? 2 : 1;
  return slotOrder
    .slice(activeCount)
    .map((slotIndex, order) => {
      const build = team.slots[slotIndex];
      const pokemon = build ? selectedPokemon(build) ?? resolvePokemonForm(build) : null;
      return {
        key: `${team.id}-preview-bench-${build?.id ?? order}`,
        pokemon,
        title: build?.nickname.trim() || pokemon?.displayName || `Bench ${order + 1}`,
        subtitle,
        types: pokemon?.types ?? [],
      } satisfies BattlefieldSlotModel;
    });
}

function battlefieldSlotMatches(slot: BattlefieldSlotModel, unitName?: string | null) {
  if (!unitName) {
    return false;
  }
  return slot.title === unitName || slot.pokemon?.displayName === unitName;
}

function BattlefieldArena({
  title,
  subtitle,
  backdrop,
  topLabel,
  bottomLabel,
  topSlots,
  bottomSlots,
  topBench = [],
  bottomBench = [],
  event = null,
  conditionSections = [],
  expansive = false,
  controlDock = null,
}: {
  title: string;
  subtitle: string;
  backdrop: BattlefieldBackdrop;
  topLabel: string;
  bottomLabel: string;
  topSlots: BattlefieldSlotModel[];
  bottomSlots: BattlefieldSlotModel[];
  topBench?: BattlefieldSlotModel[];
  bottomBench?: BattlefieldSlotModel[];
  event?: BattlefieldPlaybackEvent | null;
  conditionSections?: BattlefieldConditionSection[];
  expansive?: boolean;
  controlDock?: ReactNode;
}) {
  const renderBattlefieldSlot = (slot: BattlefieldSlotModel, orientation: 'top' | 'bottom') => {
    const actor = battlefieldSlotMatches(slot, event?.actorName);
    const target = battlefieldSlotMatches(slot, event?.targetName);
    const className = [
      'battlefield-card',
      orientation === 'top' ? 'battlefield-card-top' : 'battlefield-card-bottom',
      actor ? 'is-actor' : '',
      target ? 'is-target' : '',
      slot.fainted ? 'is-fainted' : '',
    ].filter(Boolean).join(' ');

    return (
      <div key={slot.key} className={className}>
        <div className="battlefield-card-stage">
          {slot.hidden ? <HiddenBenchFrame size="standard" /> : <PokemonSpriteFrame pokemon={slot.pokemon} size="standard" />}
        </div>
        <div className="battlefield-card-copy">
          <div className="battlefield-card-heading">
            <strong>{slot.title}</strong>
            <small>{slot.subtitle}</small>
          </div>
          {typeof slot.hpPercent === 'number' ? (
            <div className="battlefield-vitals-stack">
              <div className="hp-bar battlefield-hp">
                <div className="hp-fill" style={{ width: `${slot.hpPercent}%` }} />
              </div>
              <span className="battlefield-hp-label">{slot.hpLabel}</span>
            </div>
          ) : null}
          <div className="battlefield-card-footer">
            <div className="battlefield-type-row">
              {slot.types?.length ? slot.types.map((type) => (
                <span key={`${slot.key}-${type}`} className="battlefield-type-pill">{type}</span>
              )) : <span className="battlefield-type-pill muted">Awaiting send-out</span>}
            </div>
            <div className="battlefield-status-row">
              {slot.statusBadge ? (
                <span className={`status-badge battlefield-status-chip status-${slot.statusBadge.tone}`} title={slot.statusBadge.title}>
                  {slot.statusBadge.label}
                </span>
              ) : typeof slot.hpPercent === 'number' ? (
                <span className="battlefield-status-clear">Healthy</span>
              ) : null}
            </div>
          </div>
          {slot.battleTags?.length ? (
            <div className="battlefield-effect-row battle-tag-row">
              {slot.battleTags.map((tag) => (
                <span key={`${slot.key}-${tag.key}`} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                  {tag.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const fieldConditionRail = (
    <>
      <div className="battlefield-rail-header">
        <strong>Field Conditions</strong>
        <span>Live timers, rooms, weather, screens, and side pressure.</span>
      </div>
      <div className="battlefield-condition-stack">
        {conditionSections.length ? conditionSections.map((section) => (
          <div key={section.label} className="battlefield-condition-group">
            <strong>{section.label}</strong>
            <div className="battle-tag-row">
              {section.tags.length ? section.tags.map((tag) => (
                <span key={`${section.label}-${tag.key}`} className={`battle-tag battle-tag-${tag.tone}`} title={tag.title}>
                  {tag.label}
                </span>
              )) : <span className="battle-tag battle-tag-neutral">Clear</span>}
            </div>
          </div>
        )) : (
          <div className="battlefield-empty-rail">
            <strong>Stage Notes</strong>
            <span>The stage is armed and ready. Lock the opening order to see a cleaner board projection before the first turn starts.</span>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className={expansive ? 'subpanel battlefield-panel battlefield-panel-expansive' : 'subpanel battlefield-panel'}>
      <SectionHeader title={title} subtitle={subtitle} compact />
      <div className={controlDock ? 'battlefield-layout battlefield-layout-with-controls' : 'battlefield-layout'}>
        <div className="battlefield-main-stack">
          <div className="battlefield-scroll-panel">
            <div className="battlefield-stage-shell">
              <div className={backdrop.pixelated ? 'battlefield-stage battlefield-stage-pixelated' : 'battlefield-stage'} style={{ backgroundImage: `url("${backdrop.image}")` }}>
                <div className="battlefield-stage-overlay" />
                <div className="battlefield-backdrop-meta">
                  <strong>{backdrop.label}</strong>
                  <span>{backdrop.flavor}</span>
                </div>
                {event ? (
                  <div className={`battlefield-event battlefield-event-${event.tone}`} key={event.id}>
                    {event.moveName ? <span>{event.moveName}</span> : null}
                    <strong>{event.message}</strong>
                  </div>
                ) : null}

                <div className="battlefield-side battlefield-side-top">
                  <div className="battlefield-side-label">{topLabel}</div>
                  <div className={`battlefield-active-lanes lanes-${topSlots.length}`}>
                    {topSlots.map((slot) => renderBattlefieldSlot(slot, 'top'))}
                  </div>
                  {topBench.length ? (
                    <div className="battlefield-bench-strip">
                      {topBench.map((slot) => (
                        <div key={slot.key} className={slot.fainted ? 'battlefield-bench-card is-fainted' : 'battlefield-bench-card'}>
                          {slot.hidden ? <HiddenBenchFrame size="tiny" /> : <PokemonSpriteFrame pokemon={slot.pokemon} size="tiny" statusBadge={slot.statusBadge ?? null} />}
                          <div>
                            <strong>{slot.title}</strong>
                            <small>{slot.subtitle}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="battlefield-side battlefield-side-bottom">
                  <div className="battlefield-side-label">{bottomLabel}</div>
                  <div className={`battlefield-active-lanes lanes-${bottomSlots.length}`}>
                    {bottomSlots.map((slot) => renderBattlefieldSlot(slot, 'bottom'))}
                  </div>
                  {bottomBench.length ? (
                    <div className="battlefield-bench-strip">
                      {bottomBench.map((slot) => (
                        <div key={slot.key} className={slot.fainted ? 'battlefield-bench-card is-fainted' : 'battlefield-bench-card'}>
                          {slot.hidden ? <HiddenBenchFrame size="tiny" /> : <PokemonSpriteFrame pokemon={slot.pokemon} size="tiny" statusBadge={slot.statusBadge ?? null} />}
                          <div>
                            <strong>{slot.title}</strong>
                            <small>{slot.subtitle}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            {controlDock ? (
              <div className="battlefield-dock-row">
                <aside className="battlefield-side-rail battlefield-side-rail-inline battlefield-side-rail-docked">
                  {fieldConditionRail}
                </aside>
                <aside className="battlefield-action-rail battlefield-action-rail-docked">
                  <div className="battlefield-action-stack">
                    {controlDock}
                  </div>
                </aside>
              </div>
            ) : null}
          </div>
        </div>

        {!controlDock ? (
          <aside className="battlefield-side-rail">
            {fieldConditionRail}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function BuildEditor({
  build,
  onChange,
  title,
  format,
  condensed = false,
  blockedItemIds = new Set<string>(),
}: {
  build: PokemonBuild;
  onChange: (next: PokemonBuild) => void;
  title: string;
  format: BattleFormat;
  condensed?: boolean;
  blockedItemIds?: Set<string>;
}) {
  const [search, setSearch] = useState('');
  const [primaryTypeFilter, setPrimaryTypeFilter] = useState('Any');
  const [secondaryTypeFilter, setSecondaryTypeFilter] = useState('Any');
  const deferredSearch = useDeferredValue(search);
  const normalizedBuild = normalizeBuildForChampions(build);
  const basePokemon = selectedPokemon(normalizedBuild);
  const activePokemon = resolvePokemonForm(normalizedBuild);
  const megaForm = basePokemon ? findMegaForm(basePokemon) : null;
  const filteredPokemon = useMemo(
    () =>
      dataset.pokemon.filter((entry) => {
        const matchesSearch = pickerLabel(entry).toLowerCase().includes(deferredSearch.toLowerCase());
        const matchesPrimary = primaryTypeFilter === 'Any' || entry.types.includes(primaryTypeFilter);
        const matchesSecondary = secondaryTypeFilter === 'Any' || entry.types.includes(secondaryTypeFilter);
        return matchesSearch && matchesPrimary && matchesSecondary;
      }),
    [deferredSearch, primaryTypeFilter, secondaryTypeFilter],
  );
  const effectiveBuild = activePokemon ? { ...normalizedBuild, moveIds: normalizeMoveSelection(normalizedBuild, activePokemon) } : normalizedBuild;
  const stats = activePokemon ? buildStats(activePokemon.baseStats, effectiveBuild.evs, effectiveBuild.natureId) : null;
  const availableItems = availableItemsForPokemon(basePokemon ?? activePokemon);
  const usage = getPokemonUsageInsight(activePokemon ?? basePokemon, format);
  const presetSummary = getPopularPresetSummary(activePokemon ?? basePokemon, format);
  const effortUsed = totalEffortPoints(effectiveBuild.evs);
  const effortRemaining = Math.max(0, totalEffortBudget - effortUsed);
  const blockedItemNames = [...blockedItemIds].map((itemId) => getItemById(itemId)?.name).filter((name): name is string => Boolean(name));
  const activeTypeFilters = [primaryTypeFilter, secondaryTypeFilter].filter((type) => type !== 'Any');

  function patch(partial: Partial<PokemonBuild>) {
    onChange(normalizeBuildForChampions({
      ...effectiveBuild,
      ...partial,
      evs: partial.evs ? { ...normalizeEffortSpread(partial.evs) } : { ...effectiveBuild.evs },
      moveIds: partial.moveIds ? [...partial.moveIds] : [...effectiveBuild.moveIds],
    }));
  }

  function updateEv(stat: keyof PokemonBuild['evs'], value: number) {
    patch({
      evs: applyEffortValue(effectiveBuild.evs, stat, value),
    });
  }

  return (
    <div className={condensed ? 'editor-stack condensed' : 'editor-stack'}>
      <div className="editor-title-row">
        <div>
          <strong>{title}</strong>
          <small>{activePokemon ? `${activePokemon.displayName} - ${activePokemon.types.join(' / ')}` : 'Pick a Pokemon form from the current Champions roster.'}</small>
        </div>
        <PokemonSpriteFrame pokemon={activePokemon} size="standard" />
      </div>

      <div className="result-grid">
        <InfoStat label="Role" value={activePokemon ? describeBuildRole(effectiveBuild, format) : 'Open'} />
        <InfoStat label="Meta" value={usage.label} />
        <InfoStat label="EV Pts" value={`${effortUsed} / ${totalEffortBudget}`} />
        <InfoStat label="Remaining" value={`${effortRemaining}`} />
        <InfoStat label="IVs" value={`${fixedIvValue} fixed`} />
      </div>

      <label className="field">
        <span>Find Pokemon</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the current Champions roster..." />
      </label>

      <div className="control-grid three type-filter-grid">
        <label className="field">
          <span>Type Filter A</span>
          <select value={primaryTypeFilter} onChange={(event) => setPrimaryTypeFilter(event.target.value)}>
            {pokemonTypeOptions.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Type Filter B</span>
          <select value={secondaryTypeFilter} onChange={(event) => setSecondaryTypeFilter(event.target.value)}>
            {pokemonTypeOptions.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <button className="action-button" onClick={() => { setPrimaryTypeFilter('Any'); setSecondaryTypeFilter('Any'); }}>
          Clear Type Filters
        </button>
      </div>

      <div className="picker-filter-summary">
        <span>{filteredPokemon.length} Pokemon match the current search and type filters.</span>
        {activeTypeFilters.length ? <small>Active filters: {activeTypeFilters.join(' + ')}</small> : <small>Showing the full live Champions roster.</small>}
      </div>

      <div className="picker-list scroll-stack compact-scroll">
        {filteredPokemon.length ? filteredPokemon.slice(0, condensed ? 10 : 14).map((entry) => (
          <button key={entry.id} className={entry.id === activePokemon?.id ? 'picker-row active' : 'picker-row'} onClick={() => onChange(prepareBuildForPokemon(effectiveBuild, entry.id, format))}>
            <PokemonSpriteFrame pokemon={entry} size="tiny" />
            <div>
              <strong>{entry.displayName}</strong>
              <small>{entry.types.join(' / ')}</small>
            </div>
            <UsagePill insight={getPokemonUsageInsight(entry, format)} small />
          </button>
        )) : (
          <div className="empty-inline-state">
            <strong>No live roster matches.</strong>
            <span>Try clearing one of the type filters or broadening the Pokemon search text.</span>
          </div>
        )}
      </div>

      <div className="control-grid two">
        <label className="field">
          <span>Nickname</span>
          <input value={effectiveBuild.nickname} onChange={(event) => patch({ nickname: event.target.value })} placeholder="Optional nickname" />
        </label>
        <label className="field">
          <span>Nature</span>
          <select value={effectiveBuild.natureId} onChange={(event) => patch({ natureId: event.target.value })}>
            {natures.map((nature) => (
              <option key={nature.id} value={nature.id}>{nature.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Base Ability</span>
          <select value={effectiveBuild.abilityName ?? ''} onChange={(event) => patch({ abilityName: event.target.value })} disabled={!basePokemon}>
            {(basePokemon?.abilities ?? []).map((ability) => (
              <option key={ability.name} value={ability.name}>{ability.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Item</span>
          <select value={effectiveBuild.itemId ?? ''} onChange={(event) => patch({ itemId: event.target.value || null })}>
            <option value="">No item</option>
            {availableItems.map((item) => (
              <option key={item.id} value={item.id} disabled={blockedItemIds.has(item.id) && item.id !== effectiveBuild.itemId}>
                {blockedItemIds.has(item.id) && item.id !== effectiveBuild.itemId ? `${item.name} - In use` : item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="control-grid three">
        <ToggleField
          label="Mega Evolve"
          checked={effectiveBuild.useMega}
          onChange={(checked) => {
            const megaStone = findMegaStoneItem(basePokemon, megaForm);
            patch({
              useMega: checked,
              itemId: checked && megaStone ? megaStone.id : effectiveBuild.itemId && getItemById(effectiveBuild.itemId)?.category === 'mega-stone' ? null : effectiveBuild.itemId,
            });
          }}
        />
        <label className="field">
          <span>Status</span>
          <select value={effectiveBuild.status} onChange={(event) => patch({ status: event.target.value as PokemonBuild['status'] })}>
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Current HP %</span>
          <input type="number" min={1} max={100} value={effectiveBuild.currentHpPercent} onChange={(event) => patch({ currentHpPercent: Number(event.target.value) })} />
        </label>
      </div>

      {effectiveBuild.useMega && megaForm ? (
        <div className="mega-ability-stack">
          <label className="field">
            <span>Original Ability</span>
            <input value={effectiveBuild.abilityName ?? basePokemon?.abilities[0]?.name ?? ''} readOnly />
          </label>
          <label className="field">
            <span>Mega Ability</span>
            <input value={megaForm.abilities[0]?.name ?? 'Unknown'} readOnly />
          </label>
        </div>
      ) : null}

      <div className="control-grid five">
        {([
          'attackStage',
          'defenseStage',
          'specialAttackStage',
          'specialDefenseStage',
          'speedStage',
          'accuracyStage',
          'evasionStage',
        ] as const).map((field) => (
          <label key={field} className="field small">
            <span>{
              field === 'attackStage' ? 'Atk' :
              field === 'defenseStage' ? 'Def' :
              field === 'specialAttackStage' ? 'SpA' :
              field === 'specialDefenseStage' ? 'SpD' :
              field === 'speedStage' ? 'Spe' :
              field === 'accuracyStage' ? 'Acc' :
              'Eva'
            }</span>
            <input type="number" min={-6} max={6} value={effectiveBuild[field]} onChange={(event) => patch({ [field]: Math.max(-6, Math.min(6, Number(event.target.value))) } as Partial<PokemonBuild>)} />
          </label>
        ))}
      </div>

      <div className="ev-grid">
        {statOrder.map((stat) => (
          <label key={stat} className="field small">
            <span>{statLabels[stat]} EV Pts</span>
            <input
              type="number"
              min={0}
              max={Math.min(maxEffortValue, remainingEffortPoints(effectiveBuild.evs, stat))}
              step={1}
              value={effectiveBuild.evs[stat]}
              onChange={(event) => updateEv(stat, Number(event.target.value))}
            />
          </label>
        ))}
      </div>

      {stats ? (
        <div className="stats-bar-grid compact">
          {statOrder.map((stat) => (
            <div key={stat} className="stat-bar-card">
              <span>{statLabels[stat]}</span>
              <strong>{stats[stat]}</strong>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (stats[stat] / 220) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="move-selector-grid">
        {[0, 1, 2, 3].map((index) => {
          const move = activePokemon?.movePool.find((entry) => entry.id === effectiveBuild.moveIds[index]);
          return (
            <label key={index} className="field">
              <span>Move {index + 1}</span>
              <select
                value={effectiveBuild.moveIds[index] ?? ''}
                onChange={(event) => {
                  const nextMoveIds = [...effectiveBuild.moveIds];
                  nextMoveIds[index] = event.target.value;
                  patch({ moveIds: nextMoveIds.filter(Boolean) });
                }}
                disabled={!activePokemon}
              >
                {(activePokemon?.movePool ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
              {move ? <UsagePill insight={getMoveUsageInsight(move.name, format)} small /> : null}
            </label>
          );
        })}
      </div>

      {activePokemon ? (
        <div className="notes-list compact-scroll">
          <div className="note-row">Champions stat setup uses a 66-point effort budget with a {maxEffortValue}-point cap per stat, and IVs are fixed at {fixedIvValue}.</div>
          {blockedItemNames.length ? <div className="note-row">Item clause active. Teammates already use: {blockedItemNames.join(', ')}.</div> : null}
          <div className="note-row">{activePokemon.classification || 'Current battle form'} - {describeMegaState(effectiveBuild, basePokemon)}</div>
          {presetSummary ? <div className="note-row">Popular {format} set: {presetSummary.moveNames.join(', ')}</div> : null}
          <div className="note-row">{usage.reason}</div>
          {(basePokemon?.abilities ?? []).slice(0, 2).map((ability) => (
            <div key={ability.name} className="note-row"><strong>{ability.name}:</strong> {ability.description}</div>
          ))}
          {megaForm?.abilities[0] && effectiveBuild.useMega ? <div className="note-row"><strong>{megaForm.abilities[0].name}:</strong> {megaForm.abilities[0].description}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default App;
