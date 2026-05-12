import { calculateDamage, moveMakesContact } from './damage';
import {
  buildStats,
  defaultEnvironment,
  dataset,
  effectiveTypes,
  findMegaForm,
  getItemById,
  grounded,
  normalizeMoveSelection,
  resolveAbility,
  resolvePokemonForm,
  stageMultiplier,
  typeEffectiveness,
} from './champions';
import type { BattleFormat, EnvironmentState, PokemonBuild, PokemonEntry, PokemonMove, Team } from '../types';

export type SimulatorStage = 'preview' | 'battle' | 'finished';
export type SideId = 'player' | 'opponent';

export type SimulatorChoice =
  | {
      type: 'move';
      actor: number;
      moveId: string;
      target: number;
    }
  | {
      type: 'mega';
      actor: number;
      moveId: string;
      target: number;
    }
  | {
      type: 'switch';
      actor: number;
      target: number;
    };

export interface SimUnit {
  slotIndex: number;
  build: PokemonBuild;
  basePokemon: PokemonEntry;
  megaPokemon: PokemonEntry | null;
  pokemon: PokemonEntry;
  currentHp: number;
  maxHp: number;
  fainted: boolean;
  protected: boolean;
  berrySpent: boolean;
  turnsActive: number;
  flinched: boolean;
  helpingHand: boolean;
  toxicCounter: number;
  sleepTurns: number;
  freezeTurns: number;
  tauntTurns: number;
  encoreTurns: number;
  encoreMoveId: string | null;
  disableTurns: number;
  disabledMoveId: string | null;
  lastMoveId: string | null;
  protectStreak: number;
  protectSource: string | null;
  endure: boolean;
  aquaRing: boolean;
  ingrain: boolean;
  seededBySideId: SideId | null;
  electricBoost: boolean;
  statsRaisedThisTurn: boolean;
  statsLoweredThisTurn: boolean;
  megaEvolved: boolean;
}

type WishMarker = {
  activeSlot: number;
  turns: number;
  healAmount: number;
};

export interface SimSide {
  name: string;
  units: SimUnit[];
  active: number[];
  bench: number[];
  selectedOrder: number[];
  tailwindTurns: number;
  reflectTurns: number;
  lightScreenTurns: number;
  safeguardTurns: number;
  stealthRock: boolean;
  spikesLayers: number;
  redirectionUnitIndex: number | null;
  quickGuardActive: boolean;
  wideGuardActive: boolean;
  wishQueue: WishMarker[];
  megaUsed: boolean;
  megaUnitIndex: number | null;
}

export interface SimulatorBattleState {
  format: BattleFormat;
  stage: SimulatorStage;
  turn: number;
  previewEndsAt: number | null;
  player: SimSide;
  opponent: SimSide;
  environment: EnvironmentState;
  trickRoomTurns: number;
  gravityTurns: number;
  log: string[];
  winner: SideId | null;
}

const priorityMoves = new Set(['Fake Out', 'Bullet Punch', 'Sucker Punch', 'Extreme Speed', 'Aqua Jet', 'Ice Shard']);
const healingMoves = new Set(['Recover', 'Roost', 'Slack Off', 'Moonlight', 'Synthesis', 'Wish', 'Shore Up', 'Soft-Boiled']);
const drainingMoves = new Set(['Drain Punch', 'Giga Drain', 'Horn Leech', 'Leech Life', 'Parabolic Charge', 'Draining Kiss']);
const recoilMoves = new Set(['Brave Bird', 'Double-Edge', 'Flare Blitz', 'Head Smash', 'Volt Tackle', 'Wave Crash', 'Wood Hammer']);
const redirectionMoves = new Set(['Follow Me', 'Rage Powder']);
const protectionMoves = new Set(['Protect', 'Detect', "King's Shield", 'Spiky Shield', 'Baneful Bunker']);
const sideProtectionMoves = new Set(['Quick Guard', 'Wide Guard']);
const protectionCounterMoves = new Set([...protectionMoves, ...sideProtectionMoves, 'Ally Switch', 'Endure']);
const protectBypassMoves = new Set(['Feint', 'Phantom Force', 'Tearful Look']);
const allAdjacentFoeMoves = new Set([
  'Blizzard',
  'Breaking Swipe',
  'Dazzling Gleam',
  'Heat Wave',
  'Hyper Voice',
  'Icy Wind',
  'Muddy Water',
  'Rock Slide',
  'Snarl',
  'Struggle Bug',
  'Swift',
]);
const allAdjacentPokemonMoves = new Set([
  'Bulldoze',
  'Discharge',
  'Earthquake',
  'Lava Plume',
  'Surf',
]);
const pivotMoves = new Set(['Volt Switch', 'U-turn', 'Flip Turn']);
const allyBoostMoves = new Set(['Howl', 'Coaching']);
const directStatusMoves = new Map<string, PokemonBuild['status']>([
  ['Glare', 'paralysis'],
  ['Hypnosis', 'sleep'],
  ['Will-O-Wisp', 'burn'],
  ['Thunder Wave', 'paralysis'],
  ['Toxic', 'toxic'],
  ['Spore', 'sleep'],
]);
const curingBerries: Partial<Record<Exclude<PokemonBuild['status'], 'healthy'>, string>> = {
  burn: 'Rawst Berry',
  freeze: 'Aspear Berry',
  paralysis: 'Cheri Berry',
  poison: 'Pecha Berry',
  toxic: 'Pecha Berry',
  sleep: 'Chesto Berry',
};
const healingBerries = new Map<string, number>([
  ['Oran Berry', 10],
  ['Sitrus Berry', 0.25],
]);
const weatherMoves = new Map<string, EnvironmentState['weather']>([
  ['Sunny Day', 'sun'],
  ['Rain Dance', 'rain'],
  ['Sandstorm', 'sand'],
  ['Snowscape', 'snow'],
  ['Hail', 'snow'],
]);
const terrainMoves = new Map<string, EnvironmentState['terrain']>([
  ['Electric Terrain', 'electric'],
  ['Grassy Terrain', 'grassy'],
  ['Misty Terrain', 'misty'],
  ['Psychic Terrain', 'psychic'],
]);
const weatherAbilities = new Map<string, EnvironmentState['weather']>([
  ['Drought', 'sun'],
  ['Drizzle', 'rain'],
  ['Sand Stream', 'sand'],
  ['Snow Warning', 'snow'],
]);
const terrainAbilities = new Map<string, EnvironmentState['terrain']>([
  ['Electric Surge', 'electric'],
  ['Grassy Surge', 'grassy'],
  ['Misty Surge', 'misty'],
  ['Psychic Surge', 'psychic'],
]);
const boostMoves = new Map<string, Partial<Record<'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage', number>>>([
  ['Swords Dance', { attackStage: 2 }],
  ['Dragon Dance', { attackStage: 1, speedStage: 1 }],
  ['Calm Mind', { specialAttackStage: 1, specialDefenseStage: 1 }],
  ['Nasty Plot', { specialAttackStage: 2 }],
  ['Bulk Up', { attackStage: 1, defenseStage: 1 }],
  ['Coil', { attackStage: 1, defenseStage: 1 }],
  ['Agility', { speedStage: 2 }],
  ['Amnesia', { specialDefenseStage: 2 }],
  ['Iron Defense', { defenseStage: 2 }],
  ['Acid Armor', { defenseStage: 2 }],
  ['Cosmic Power', { defenseStage: 1, specialDefenseStage: 1 }],
  ['Cotton Guard', { defenseStage: 3 }],
]);

type StageKey =
  | 'attackStage'
  | 'defenseStage'
  | 'specialAttackStage'
  | 'specialDefenseStage'
  | 'speedStage'
  | 'accuracyStage'
  | 'evasionStage';

type MoveScope = 'single' | 'all-opponents' | 'all-adjacent';

const movePriorityOverrides = new Map<string, number>([
  ['Helping Hand', 5],
  ['Protect', 4],
  ['Detect', 4],
  ["King's Shield", 4],
  ['Spiky Shield', 4],
  ['Baneful Bunker', 4],
  ['Endure', 4],
  ['Quick Guard', 3],
  ['Wide Guard', 3],
  ['Fake Out', 3],
  ['Ally Switch', 2],
  ['Extreme Speed', 2],
  ['Sucker Punch', 1],
  ['Aqua Jet', 1],
  ['Bullet Punch', 1],
  ['Ice Shard', 1],
  ['Mach Punch', 1],
  ['Quick Attack', 1],
  ['Shadow Sneak', 1],
  ['Vacuum Wave', 1],
  ['Feint', 2],
  ['Trick Room', -7],
]);

function stagePriority(move: PokemonMove) {
  return movePriorityOverrides.get(move.name) ?? 0;
}

function activeCount(format: BattleFormat) {
  return format === 'Doubles' ? 2 : 1;
}

function abilityNameForUnit(unit: SimUnit) {
  return resolveAbility(unit.build, unit.pokemon)?.name ?? null;
}

function findMove(unit: SimUnit, moveId: string) {
  return unit.pokemon.movePool.find((move) => move.id === moveId) ?? null;
}

function currentBuild(unit: SimUnit) {
  return {
    ...unit.build,
    useMega: unit.megaEvolved,
    currentHpPercent: Math.max(1, Math.round((unit.currentHp / unit.maxHp) * 100)),
  };
}

function combatSpeed(unit: SimUnit, tailwindTurns: number, trickRoomTurns: number) {
  const stats = buildStats(unit.pokemon.baseStats, unit.build.evs, unit.build.natureId);
  const stageAdjusted = stats.speed * stageMultiplier(unit.build.speedStage);
  const tailwindAdjusted = tailwindTurns > 0 ? stageAdjusted * 2 : stageAdjusted;
  return trickRoomTurns > 0 ? -tailwindAdjusted : tailwindAdjusted;
}

type TargetRef = {
  sideId: SideId;
  side: SimSide;
  unit: SimUnit;
  activeSlot: number;
  unitIndex: number;
  ally: boolean;
};

function accuracyStageMultiplier(stage: number) {
  if (stage >= 0) {
    return (3 + stage) / 3;
  }

  return 3 / (3 - stage);
}

function moveScope(move: PokemonMove): MoveScope {
  if (allAdjacentPokemonMoves.has(move.name) || /all other Pok(?:e|é)mon on the field/i.test(move.description)) {
    return 'all-adjacent';
  }

  if (allAdjacentFoeMoves.has(move.name) || /targets'/i.test(move.description)) {
    return 'all-opponents';
  }

  return 'single';
}

function unitGroundedInState(state: SimulatorBattleState, unit: SimUnit) {
  if (state.gravityTurns > 0) {
    return true;
  }

  return grounded(unit.pokemon, unit.build);
}

function protectionSuccessChance(streak: number) {
  if (streak <= 0) {
    return 1;
  }

  const capped = Math.min(6, streak);
  return 1 / 3 ** capped;
}

function healAmount(unit: SimUnit, fraction: number) {
  return Math.max(1, Math.round(unit.maxHp * fraction));
}

function typeListForUnit(state: SimulatorBattleState, unit: SimUnit) {
  return effectiveTypes(unit.pokemon, unit.build, state.environment.weather);
}

function stageLabel(field: StageKey) {
  switch (field) {
    case 'attackStage':
      return 'Attack';
    case 'defenseStage':
      return 'Defense';
    case 'specialAttackStage':
      return 'Sp. Atk';
    case 'specialDefenseStage':
      return 'Sp. Def';
    case 'speedStage':
      return 'Speed';
    case 'accuracyStage':
      return 'Accuracy';
    case 'evasionStage':
      return 'Evasion';
    default:
      return 'Stat';
  }
}

function makeUnit(build: PokemonBuild, slotIndex: number): SimUnit | null {
  const selected = resolvePokemonForm({ ...build, useMega: false });
  if (!selected) {
    return null;
  }

  const basePokemon =
    selected.isMega
      ? dataset.pokemon.find((entry) => entry.baseSpecies === selected.baseSpecies && !entry.isMega) ?? selected
      : selected;
  const megaPokemon = getItemById(build.itemId)?.category === 'mega-stone'
    ? resolvePokemonForm({ ...build, useMega: true })
    : null;
  const stats = buildStats(basePokemon.baseStats, build.evs, build.natureId);
  return {
    slotIndex,
    build: { ...build, useMega: false, moveIds: normalizeMoveSelection(build, basePokemon) },
    basePokemon,
    megaPokemon: megaPokemon?.isMega ? megaPokemon : null,
    pokemon: basePokemon,
    currentHp: stats.hp,
    maxHp: stats.hp,
    fainted: false,
    protected: false,
    berrySpent: false,
    turnsActive: 0,
    flinched: false,
    helpingHand: false,
    toxicCounter: 1,
    sleepTurns: 0,
    freezeTurns: 0,
    tauntTurns: 0,
    encoreTurns: 0,
    encoreMoveId: null,
    disableTurns: 0,
    disabledMoveId: null,
    lastMoveId: null,
    protectStreak: 0,
    protectSource: null,
    endure: false,
    aquaRing: false,
    ingrain: false,
    seededBySideId: null,
    electricBoost: false,
    statsRaisedThisTurn: false,
    statsLoweredThisTurn: false,
    megaEvolved: false,
  };
}

function makeSide(team: Team, selectedOrder: number[], name: string, format: BattleFormat): SimSide {
  const units = selectedOrder
    .map((slotIndex) => makeUnit(team.slots[slotIndex], slotIndex))
    .filter((unit): unit is SimUnit => unit !== null);

  const count = activeCount(format);
  return {
    name,
    units,
    active: units.slice(0, count).map((_, index) => index),
    bench: units.slice(count).map((_, index) => index + count),
    selectedOrder,
    tailwindTurns: 0,
    reflectTurns: 0,
    lightScreenTurns: 0,
    safeguardTurns: 0,
    stealthRock: false,
    spikesLayers: 0,
    redirectionUnitIndex: null,
    quickGuardActive: false,
    wideGuardActive: false,
    wishQueue: [],
    megaUsed: false,
    megaUnitIndex: null,
  };
}

function sideForId(state: SimulatorBattleState, sideId: SideId) {
  return sideId === 'player' ? state.player : state.opponent;
}

function opposingSide(state: SimulatorBattleState, sideId: SideId) {
  return sideId === 'player' ? state.opponent : state.player;
}

function describeActive(side: SimSide) {
  return side.active
    .map((unitIndex) => side.units[unitIndex]?.pokemon.displayName)
    .filter((name): name is string => Boolean(name))
    .join(side.active.length > 1 ? ' and ' : '');
}

function targetActiveUnit(side: SimSide, activeSlot: number) {
  const unitIndex = side.active[activeSlot];
  return typeof unitIndex === 'number' ? side.units[unitIndex] ?? null : null;
}

function firstAvailableBench(side: SimSide) {
  return side.bench.find((unitIndex) => !side.units[unitIndex]?.fainted) ?? null;
}

function lowerUnitHp(unit: SimUnit, amount: number) {
  const startingHp = unit.currentHp;
  const nextHp = Math.max(0, unit.currentHp - Math.max(0, amount));
  if (unit.endure && nextHp <= 0 && !unit.fainted) {
    unit.currentHp = 1;
    unit.endure = false;
    return Math.max(0, startingHp - unit.currentHp);
  }

  unit.currentHp = nextHp;
  if (unit.currentHp <= 0) {
    unit.fainted = true;
  }
  return Math.max(0, startingHp - unit.currentHp);
}

function healUnit(unit: SimUnit, amount: number) {
  unit.currentHp = Math.min(unit.maxHp, unit.currentHp + amount);
}

function applyBoosts(unit: SimUnit, boosts: Partial<Record<StageKey, number>>) {
  for (const [key, value] of Object.entries(boosts)) {
    const stageKey = key as StageKey;
    const currentValue = Number(unit.build[stageKey] ?? 0);
    const delta = Number(value ?? 0);
    unit.build[stageKey] = Math.max(-6, Math.min(6, currentValue + delta));
    if (delta > 0) {
      unit.statsRaisedThisTurn = true;
    }
    if (delta < 0) {
      unit.statsLoweredThisTurn = true;
    }
  }
}

function applySingleStage(unit: SimUnit, stageKey: StageKey, delta: number) {
  unit.build[stageKey] = Math.max(-6, Math.min(6, unit.build[stageKey] + delta));
  if (delta > 0) {
    unit.statsRaisedThisTurn = true;
  }
  if (delta < 0) {
    unit.statsLoweredThisTurn = true;
  }
}

function clearSideHazards(side: SimSide) {
  side.stealthRock = false;
  side.spikesLayers = 0;
}

function clearVolatileChoiceLocks(unit: SimUnit) {
  if (unit.encoreTurns <= 0) {
    unit.encoreMoveId = null;
    unit.encoreTurns = 0;
  }
  if (unit.disableTurns <= 0) {
    unit.disabledMoveId = null;
    unit.disableTurns = 0;
  }
  if (unit.tauntTurns < 0) {
    unit.tauntTurns = 0;
  }
}

function clearProtectionState(unit: SimUnit) {
  unit.protected = false;
  unit.protectSource = null;
  unit.endure = false;
}

function unitSideId(state: SimulatorBattleState, unit: SimUnit): SideId {
  return state.player.units.includes(unit) ? 'player' : 'opponent';
}

function sideForUnit(state: SimulatorBattleState, unit: SimUnit) {
  return sideForId(state, unitSideId(state, unit));
}

function compareActionSpeed(leftSpeed: number, rightSpeed: number) {
  if (leftSpeed !== rightSpeed) {
    return rightSpeed - leftSpeed;
  }

  return Math.random() < 0.5 ? -1 : 1;
}

function canUnitMegaEvolve(side: SimSide, unit: SimUnit) {
  if (side.megaUsed || unit.megaEvolved || !unit.megaPokemon) {
    return false;
  }

  return getItemById(unit.build.itemId)?.category === 'mega-stone';
}

function performMegaEvolution(state: SimulatorBattleState, sideId: SideId, actor: number) {
  const actingSide = sideForId(state, sideId);
  const unit = targetActiveUnit(actingSide, actor);
  if (!unit || !canUnitMegaEvolve(actingSide, unit) || !unit.megaPokemon) {
    return false;
  }

  unit.megaEvolved = true;
  unit.pokemon = unit.megaPokemon;
  unit.build.useMega = true;
  actingSide.megaUsed = true;
  actingSide.megaUnitIndex = actingSide.units.indexOf(unit);
  state.log.unshift(`${unit.basePokemon.displayName} Mega Evolved into ${unit.pokemon.displayName}.`);
  applySwitchInAbility(state, sideId, unit);
  return true;
}

function copyBoostState(from: SimUnit, to: SimUnit) {
  for (const field of ['attackStage', 'defenseStage', 'specialAttackStage', 'specialDefenseStage', 'speedStage', 'accuracyStage', 'evasionStage'] as const) {
    to.build[field] = from.build[field];
  }
}

function autoPivotToBench(state: SimulatorBattleState, sideId: SideId, actor: SimUnit, reason: string, passBoosts = false) {
  const side = sideForId(state, sideId);
  const currentIndex = side.units.indexOf(actor);
  const replacement = firstAvailableBench(side);
  const activeSlot = side.active.findIndex((entry) => entry === currentIndex);
  if (replacement === null || activeSlot < 0) {
    return false;
  }

  switchOutUnit(side, currentIndex);
  side.active[activeSlot] = replacement;
  side.bench = [...side.bench.filter((entry) => entry !== replacement), currentIndex];
  side.units[replacement].turnsActive = 0;
  if (passBoosts) {
    copyBoostState(actor, side.units[replacement]);
  }
  state.log.unshift(`${actor.pokemon.displayName} pivoted out with ${reason} for ${side.units[replacement].pokemon.displayName}.`);
  switchInUnit(state, sideId, replacement, false);
  return true;
}

function maybeConsumeStatusBerry(state: SimulatorBattleState, unit: SimUnit) {
  if (unit.berrySpent || unit.build.status === 'healthy') {
    return false;
  }

  const item = getItemById(unit.build.itemId);
  if (!item) {
    return false;
  }

  const requiredBerry = curingBerries[unit.build.status];
  if (item.name !== 'Lum Berry' && item.name !== requiredBerry) {
    return false;
  }

  const clearedStatus = unit.build.status;
  unit.build.status = 'healthy';
  unit.toxicCounter = 1;
  unit.sleepTurns = 0;
  unit.freezeTurns = 0;
  unit.berrySpent = true;
  state.log.unshift(`${unit.pokemon.displayName} cured its ${clearedStatus} with ${item.name}.`);
  return true;
}

function maybeTriggerHealingBerry(state: SimulatorBattleState, unit: SimUnit) {
  if (unit.berrySpent || unit.fainted || unit.currentHp > unit.maxHp / 2) {
    return false;
  }

  const item = getItemById(unit.build.itemId);
  if (!item) {
    return false;
  }

  const berryValue = healingBerries.get(item.name);
  if (!berryValue) {
    return false;
  }

  const heal = berryValue < 1 ? healAmount(unit, berryValue) : berryValue;
  healUnit(unit, heal);
  unit.berrySpent = true;
  state.log.unshift(`${unit.pokemon.displayName} restored HP with ${item.name}.`);
  return true;
}

function statusImmunityReason(state: SimulatorBattleState, source: SimUnit | null, target: SimUnit, status: PokemonBuild['status']) {
  if (target.build.status !== 'healthy') {
    return 'already statused';
  }

  const targetTypes = typeListForUnit(state, target);
  const targetAbility = abilityNameForUnit(target);
  const sourceAbility = source ? abilityNameForUnit(source) : null;
  const groundedTarget = unitGroundedInState(state, target);
  const targetSide = state.player.units.includes(target) ? state.player : state.opponent;

  if (targetSide.safeguardTurns > 0) {
    return 'Safeguard';
  }

  if (state.environment.terrain === 'misty' && groundedTarget) {
    return 'Misty Terrain';
  }

  if (status === 'sleep' && state.environment.terrain === 'electric' && groundedTarget) {
    return 'Electric Terrain';
  }

  if (status === 'burn') {
    if (targetTypes.includes('Fire') || targetAbility === 'Water Veil') {
      return 'burn immunity';
    }
  }

  if (status === 'freeze' && (targetTypes.includes('Ice') || targetAbility === 'Magma Armor')) {
    return 'freeze immunity';
  }

  if (status === 'paralysis' && targetTypes.includes('Electric')) {
    return 'paralysis immunity';
  }

  if (status === 'poison' || status === 'toxic') {
    if (targetAbility === 'Immunity') {
      return 'poison immunity';
    }

    if (sourceAbility !== 'Corrosion' && (targetTypes.includes('Poison') || targetTypes.includes('Steel'))) {
      return 'poison typing immunity';
    }
  }

  return null;
}

function resolveTargetRefs(
  state: SimulatorBattleState,
  sideId: SideId,
  actingSide: SimSide,
  defendingSide: SimSide,
  actor: SimUnit,
  requestedTarget: number,
  move: PokemonMove,
) {
  const actorUnitIndex = actingSide.units.indexOf(actor);
  const scope = moveScope(move);
  const opposingSideId: SideId = sideId === 'player' ? 'opponent' : 'player';

  if (scope === 'single') {
    const target = resolveMoveTarget(state, defendingSide, requestedTarget, move);
    if (!target) {
      return [] as TargetRef[];
    }
    const unitIndex = defendingSide.units.indexOf(target);
    const activeSlot = defendingSide.active.findIndex((entry) => entry === unitIndex);
    if (activeSlot < 0) {
      return [] as TargetRef[];
    }
    return [{ sideId: opposingSideId, side: defendingSide, unit: target, activeSlot, unitIndex, ally: false }];
  }

  if (scope === 'all-opponents') {
    return defendingSide.active
      .map((unitIndex, activeSlot) => ({ sideId: opposingSideId, side: defendingSide, unit: defendingSide.units[unitIndex], activeSlot, unitIndex, ally: false }))
      .filter((entry): entry is TargetRef => Boolean(entry.unit && !entry.unit.fainted));
  }

  return [
    ...actingSide.active
      .filter((unitIndex) => unitIndex !== actorUnitIndex)
      .map((unitIndex, activeSlot) => ({ sideId, side: actingSide, unit: actingSide.units[unitIndex], activeSlot, unitIndex, ally: true }))
      .filter((entry): entry is TargetRef => Boolean(entry.unit && !entry.unit.fainted)),
    ...defendingSide.active
      .map((unitIndex, activeSlot) => ({ sideId: opposingSideId, side: defendingSide, unit: defendingSide.units[unitIndex], activeSlot, unitIndex, ally: false }))
      .filter((entry): entry is TargetRef => Boolean(entry.unit && !entry.unit.fainted)),
  ];
}

function protectionSucceeded(state: SimulatorBattleState, actor: SimUnit, move: PokemonMove) {
  const chance = protectionSuccessChance(actor.protectStreak);
  if (Math.random() > chance) {
    actor.protectStreak = 0;
    state.log.unshift(`${actor.pokemon.displayName}'s ${move.name} failed.`);
    return false;
  }

  actor.protectStreak = Math.min(6, actor.protectStreak + 1);
  return true;
}

function accuracyCheck(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  const actorAbility = abilityNameForUnit(actor);
  const targetAbility = abilityNameForUnit(target);
  if (!move.accuracy || move.accuracy >= 101 || actorAbility === 'No Guard' || targetAbility === 'No Guard') {
    return true;
  }

  if (move.name === 'Blizzard' && state.environment.weather === 'snow') {
    return true;
  }

  if ((move.name === 'Thunder' || move.name === 'Hurricane') && state.environment.weather === 'rain') {
    return true;
  }

  let accuracy = move.accuracy;
  if (state.gravityTurns > 0) {
    accuracy *= 5 / 3;
  }

  accuracy *= accuracyStageMultiplier(actor.build.accuracyStage);
  if (!/ignores the target's evasiveness|never misses/i.test(move.description)) {
    accuracy /= accuracyStageMultiplier(target.build.evasionStage);
  }

  const chance = Math.max(0, Math.min(1, accuracy / 100));
  return Math.random() <= chance;
}

function moveBypassesProtect(actor: SimUnit, move: PokemonMove) {
  if (protectBypassMoves.has(move.name) || /can hit a target using a move such as Protect/i.test(move.description)) {
    return true;
  }

  const actorAbility = abilityNameForUnit(actor);
  return actorAbility === 'Unseen Fist' && moveMakesContact(move);
}

function applyProtectionContactRebound(state: SimulatorBattleState, target: SimUnit, attacker: SimUnit, move: PokemonMove) {
  if (!target.protectSource || !moveMakesContact(move) || attacker.fainted) {
    return;
  }

  if (target.protectSource === "King's Shield") {
    applySingleStage(attacker, 'attackStage', -1);
    state.log.unshift(`${attacker.pokemon.displayName}'s Attack fell after contacting King's Shield.`);
    return;
  }

  if (target.protectSource === 'Spiky Shield') {
    const chip = Math.max(1, Math.floor(attacker.maxHp / 8));
    lowerUnitHp(attacker, chip);
    state.log.unshift(`${attacker.pokemon.displayName} took ${chip} from Spiky Shield.`);
    maybeTriggerHealingBerry(state, attacker);
    return;
  }

  if (target.protectSource === 'Baneful Bunker') {
    maybeInflictStatus(state, target, attacker, 'poison', target.protectSource);
  }
}

function blockedBySideProtection(move: PokemonMove, priority: number, targetRef: TargetRef) {
  if (targetRef.side.quickGuardActive && priority > 0 && !protectBypassMoves.has(move.name)) {
    return 'Quick Guard';
  }

  if (targetRef.side.wideGuardActive && moveScope(move) !== 'single' && !protectBypassMoves.has(move.name)) {
    return 'Wide Guard';
  }

  return null;
}

function refillActive(side: SimSide) {
  const replacements: number[] = [];
  for (let index = 0; index < side.active.length; index += 1) {
    const unitIndex = side.active[index];
    const unit = typeof unitIndex === 'number' ? side.units[unitIndex] ?? null : null;
    if (unit && !unit.fainted) {
      continue;
    }

    const replacement = firstAvailableBench(side);
    if (replacement === null) {
      continue;
    }

    side.active[index] = replacement;
    side.bench = side.bench.filter((entry) => entry !== replacement);
    side.units[replacement].turnsActive = 0;
    replacements.push(replacement);
  }
  return replacements;
}

function updateWinner(state: SimulatorBattleState) {
  const playerAlive = state.player.units.some((unit) => !unit.fainted);
  const opponentAlive = state.opponent.units.some((unit) => !unit.fainted);
  if (!playerAlive) state.winner = 'opponent';
  if (!opponentAlive) state.winner = 'player';
  if (state.winner) {
    state.stage = 'finished';
  }
}

function screenAwareEnvironment(state: SimulatorBattleState, defendingSide: SimSide): EnvironmentState {
  return {
    ...state.environment,
    reflect: defendingSide.reflectTurns > 0,
    lightScreen: defendingSide.lightScreenTurns > 0,
  };
}

function switchOutUnit(side: SimSide, unitIndex: number) {
  const unit = side.units[unitIndex];
  if (!unit) {
    return;
  }

  if (side.redirectionUnitIndex === unitIndex) {
    side.redirectionUnitIndex = null;
  }

  const ability = abilityNameForUnit(unit);
  if (ability === 'Regenerator' && !unit.fainted) {
    healUnit(unit, Math.max(1, Math.round(unit.maxHp / 3)));
  }

  unit.protectStreak = 0;
  clearProtectionState(unit);
  unit.seededBySideId = null;
  unit.electricBoost = false;
  unit.tauntTurns = 0;
  unit.encoreTurns = 0;
  unit.encoreMoveId = null;
  unit.disableTurns = 0;
  unit.disabledMoveId = null;
}

function applyEntryHazards(state: SimulatorBattleState, side: SimSide, unit: SimUnit) {
  const effectiveTypeSet = effectiveTypes(unit.pokemon, unit.build, state.environment.weather);
  if (side.stealthRock) {
    const multiplier = typeEffectiveness('Rock', effectiveTypeSet);
    const damage = Math.max(1, Math.floor(unit.maxHp * (multiplier / 8)));
    lowerUnitHp(unit, damage);
    state.log.unshift(`${unit.pokemon.displayName} took ${damage} from Stealth Rock.`);
  }

  if (!unit.fainted && side.spikesLayers > 0 && unitGroundedInState(state, unit)) {
    const layerFraction = side.spikesLayers >= 3 ? 0.25 : side.spikesLayers === 2 ? 1 / 6 : 0.125;
    const damage = Math.max(1, Math.floor(unit.maxHp * layerFraction));
    lowerUnitHp(unit, damage);
    state.log.unshift(`${unit.pokemon.displayName} took ${damage} from Spikes.`);
  }

  maybeTriggerHealingBerry(state, unit);
}

function applySwitchInAbility(state: SimulatorBattleState, sideId: SideId, unit: SimUnit) {
  const actingSide = sideForId(state, sideId);
  const defendingSide = opposingSide(state, sideId);
  const ability = abilityNameForUnit(unit);
  if (!ability) {
    return;
  }

  const weather = weatherAbilities.get(ability);
  if (weather) {
    state.environment.weather = weather;
    state.log.unshift(`${unit.pokemon.displayName} set ${weather} with ${ability}.`);
  }

  const terrain = terrainAbilities.get(ability);
  if (terrain) {
    state.environment.terrain = terrain;
    state.log.unshift(`${unit.pokemon.displayName} set ${terrain} terrain with ${ability}.`);
  }

  if (ability === 'Intimidate') {
    for (const activeIndex of defendingSide.active) {
      const target = defendingSide.units[activeIndex];
      if (!target || target.fainted) {
        continue;
      }
      applySingleStage(target, 'attackStage', -1);
    }
    state.log.unshift(`${unit.pokemon.displayName} lowered the opposing side's Attack with Intimidate.`);
  }

  if (ability === 'Intrepid Sword') {
    applySingleStage(unit, 'attackStage', 1);
    state.log.unshift(`${unit.pokemon.displayName} boosted its Attack with Intrepid Sword.`);
  }

  if (ability === 'Dauntless Shield') {
    applySingleStage(unit, 'defenseStage', 1);
    state.log.unshift(`${unit.pokemon.displayName} boosted its Defense with Dauntless Shield.`);
  }

  actingSide.redirectionUnitIndex = actingSide.redirectionUnitIndex === null ? null : actingSide.redirectionUnitIndex;
}

function switchInUnit(state: SimulatorBattleState, sideId: SideId, unitIndex: number, announce = true) {
  const actingSide = sideForId(state, sideId);
  const unit = actingSide.units[unitIndex];
  if (!unit || unit.fainted) {
    return;
  }

  if (announce) {
    state.log.unshift(`${actingSide.name} sent out ${unit.pokemon.displayName}.`);
  }

  applyEntryHazards(state, actingSide, unit);
  if (unit.fainted) {
    state.log.unshift(`${unit.pokemon.displayName} fainted on entry.`);
    return;
  }

  applySwitchInAbility(state, sideId, unit);
}

function integrateReplacements(state: SimulatorBattleState, sideId: SideId) {
  const replacements = refillActive(sideForId(state, sideId));
  for (const unitIndex of replacements) {
    switchInUnit(state, sideId, unitIndex, true);
  }
}

function simultaneousSwitchInOrder(state: SimulatorBattleState) {
  const queued = [
    ...state.player.active.map((unitIndex) => ({ sideId: 'player' as SideId, unitIndex })),
    ...state.opponent.active.map((unitIndex) => ({ sideId: 'opponent' as SideId, unitIndex })),
  ];

  queued.sort((left, right) => {
    const leftSide = sideForId(state, left.sideId);
    const rightSide = sideForId(state, right.sideId);
    const leftUnit = leftSide.units[left.unitIndex];
    const rightUnit = rightSide.units[right.unitIndex];
    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, state.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, state.trickRoomTurns) : 0;
    return compareActionSpeed(leftSpeed, rightSpeed);
  });

  return queued;
}

function legalMovesForUnit(unit: SimUnit) {
  const fullMoveList = unit.build.moveIds
    .map((moveId) => findMove(unit, moveId))
    .filter((move): move is PokemonMove => move !== null);
  const allMoves =
    unit.disableTurns > 0 && unit.disabledMoveId
      ? fullMoveList.filter((move) => move.id !== unit.disabledMoveId)
      : fullMoveList;

  if (unit.encoreTurns > 0 && unit.encoreMoveId) {
    const encoredMove = fullMoveList.find((move) => move.id === unit.encoreMoveId);
    if (encoredMove) {
      if (unit.disableTurns > 0 && unit.disabledMoveId === encoredMove.id) {
        const fallbackMoves = allMoves.filter((move) => unit.tauntTurns <= 0 || move.category !== 'Status');
        return fallbackMoves.length ? fallbackMoves : allMoves;
      }
      return unit.tauntTurns > 0 && encoredMove.category === 'Status'
        ? allMoves.filter((move) => move.category !== 'Status')
        : [encoredMove];
    }
  }

  if (unit.tauntTurns > 0) {
    const nonStatusMoves = allMoves.filter((move) => move.category !== 'Status');
    return nonStatusMoves.length ? nonStatusMoves : allMoves;
  }

  return allMoves.length ? allMoves : fullMoveList;
}

function normalizeChoiceForUnit(side: SimSide, choice: SimulatorChoice): SimulatorChoice {
  if (choice.type === 'switch') {
    return choice;
  }

  const unit = targetActiveUnit(side, choice.actor);
  if (!unit) {
    return choice;
  }

  const legalMoves = legalMovesForUnit(unit);
  const chosenMove = legalMoves.find((move) => move.id === choice.moveId) ?? legalMoves[0] ?? null;
  if (!chosenMove) {
    return choice;
  }

  return {
    ...choice,
    moveId: chosenMove.id,
  };
}

function movePriority(move: PokemonMove, unit: SimUnit) {
  let priority = stagePriority(move);
  if (!movePriorityOverrides.has(move.name) && priorityMoves.has(move.name)) priority += 1;
  return priority;
}

function resolveMoveTarget(state: SimulatorBattleState, defendingSide: SimSide, requestedTarget: number, move: PokemonMove) {
  const directTarget = targetActiveUnit(defendingSide, requestedTarget);
  if (state.format !== 'Doubles' || moveScope(move) !== 'single') {
    return directTarget;
  }

  if (defendingSide.redirectionUnitIndex === null) {
    return directTarget;
  }

  const redirectTarget = defendingSide.units[defendingSide.redirectionUnitIndex] ?? null;
  if (!redirectTarget || redirectTarget.fainted) {
    return directTarget;
  }

  if (move.category === 'Status') {
    const exemptStatusMoves = new Set([
      'Acupressure',
      'Ally Switch',
      'Aqua Ring',
      'Aurora Veil',
      'Calm Mind',
      'Coil',
      'Defog',
      'Detect',
      'Double Team',
      'Dragon Dance',
      'Endure',
      'Gravity',
      'Haze',
      'Helping Hand',
      'Howl',
      'Ingrain',
      "King's Shield",
      'Light Screen',
      'Nasty Plot',
      'Protect',
      'Quick Guard',
      'Rage Powder',
      'Rain Dance',
      'Reflect',
      'Safeguard',
      'Sandstorm',
      'Snowscape',
      'Spikes',
      'Stealth Rock',
      'Sunny Day',
      'Swords Dance',
      'Tailwind',
      'Tailwind',
      'Trick Room',
      'Wide Guard',
    ]);
    return exemptStatusMoves.has(move.name) ? directTarget : redirectTarget;
  }

  return redirectTarget;
}

function maybeInflictStatus(
  state: SimulatorBattleState,
  source: SimUnit | null,
  target: SimUnit,
  status: PokemonBuild['status'],
  sourceMove: string,
) {
  const immunityReason = statusImmunityReason(state, source, target, status);
  if (immunityReason) {
    if (immunityReason !== 'already statused') {
      state.log.unshift(`${target.pokemon.displayName} ignored ${sourceMove} because of ${immunityReason}.`);
    }
    return false;
  }

  target.build.status = status;
  target.sleepTurns = 0;
  target.freezeTurns = 0;
  target.toxicCounter = 1;
  state.log.unshift(`${target.pokemon.displayName} was afflicted by ${sourceMove} (${status}).`);
  maybeConsumeStatusBerry(state, target);
  return target.build.status === status;
}

function resetStageModifiers(state: SimulatorBattleState) {
  for (const side of [state.player, state.opponent]) {
    for (const unit of side.units) {
      unit.build.attackStage = 0;
      unit.build.defenseStage = 0;
      unit.build.specialAttackStage = 0;
      unit.build.specialDefenseStage = 0;
      unit.build.speedStage = 0;
      unit.build.accuracyStage = 0;
      unit.build.evasionStage = 0;
    }
  }
}

function applyStatusMove(
  state: SimulatorBattleState,
  actingSide: SimSide,
  defendingSide: SimSide,
  actor: SimUnit,
  move: PokemonMove,
  target: SimUnit | null,
) {
  const actingSideId: SideId = state.player === actingSide ? 'player' : 'opponent';
  const actorActiveSlot = actingSide.active.findIndex((entry) => entry === actingSide.units.indexOf(actor));
  const priority = movePriority(move, actor);
  const singleTargetRef: TargetRef | null = target
    ? {
        sideId: (actingSideId === 'player' ? 'opponent' : 'player') as SideId,
        side: defendingSide,
        unit: target,
        unitIndex: defendingSide.units.indexOf(target),
        activeSlot: defendingSide.active.findIndex((entry) => entry === defendingSide.units.indexOf(target)),
        ally: false,
      } as TargetRef
    : null;
  let opponentTargets: TargetRef[] = [];
  if (moveScope(move) === 'single') {
    opponentTargets = singleTargetRef && singleTargetRef.activeSlot >= 0 ? [singleTargetRef] : [];
  } else {
    opponentTargets = resolveTargetRefs(state, actingSideId, actingSide, defendingSide, actor, 0, move).filter((entry) => !entry.ally);
  }
  const legalOpponentTargets = opponentTargets.filter((targetRef) => {
    const sideProtection = blockedBySideProtection(move, priority, targetRef);
    if (sideProtection) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} was shielded by ${sideProtection}.`);
      return false;
    }

    if (targetRef.unit.protected && !moveBypassesProtect(actor, move)) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} blocked ${move.name} with ${targetRef.unit.protectSource ?? 'Protect'}.`);
      return false;
    }

    return true;
  });
  const accurateOpponentTargets = legalOpponentTargets.filter((targetRef) => {
    if (!accuracyCheck(state, actor, targetRef.unit, move)) {
      state.log.unshift(`${actor.pokemon.displayName}'s ${move.name} missed ${targetRef.unit.pokemon.displayName}.`);
      return false;
    }

    return true;
  });

  if (protectionMoves.has(move.name)) {
    if (!protectionSucceeded(state, actor, move)) {
      return;
    }
    actor.protected = true;
    actor.protectSource = move.name;
    state.log.unshift(`${actor.pokemon.displayName} braced itself with ${move.name}.`);
    return;
  }

  if (sideProtectionMoves.has(move.name)) {
    if (!protectionSucceeded(state, actor, move)) {
      return;
    }
    if (move.name === 'Quick Guard') {
      actingSide.quickGuardActive = true;
    }
    if (move.name === 'Wide Guard') {
      actingSide.wideGuardActive = true;
    }
    state.log.unshift(`${actor.pokemon.displayName} set ${move.name} for its side.`);
    return;
  }

  if (move.name === 'Endure') {
    if (!protectionSucceeded(state, actor, move)) {
      return;
    }
    actor.endure = true;
    state.log.unshift(`${actor.pokemon.displayName} braced itself with Endure.`);
    return;
  }

  if (move.name === 'Ally Switch') {
    if (!protectionSucceeded(state, actor, move)) {
      return;
    }
    if (actingSide.active.length < 2) {
      actor.protectStreak = 0;
      state.log.unshift(`${actor.pokemon.displayName}'s Ally Switch failed.`);
      return;
    }
    actingSide.active = [actingSide.active[1], actingSide.active[0]];
    state.log.unshift(`${actor.pokemon.displayName} swapped positions with its ally.`);
    return;
  }

  if (healingMoves.has(move.name)) {
    if (move.name === 'Wish') {
      if (actorActiveSlot >= 0) {
        actingSide.wishQueue.push({
          activeSlot: actorActiveSlot,
          turns: 2,
          healAmount: healAmount(actor, 0.5),
        });
        state.log.unshift(`${actor.pokemon.displayName} made a Wish for its side.`);
      }
      return;
    }

    let amount = healAmount(actor, 0.5);
    if (move.name === 'Morning Sun' || move.name === 'Moonlight' || move.name === 'Synthesis') {
      amount = state.environment.weather === 'sun'
        ? healAmount(actor, 2 / 3)
        : state.environment.weather === 'clear'
          ? healAmount(actor, 0.5)
          : healAmount(actor, 0.25);
    }
    healUnit(actor, amount);
    state.log.unshift(`${actor.pokemon.displayName} recovered health with ${move.name}.`);
    return;
  }

  if (move.name === 'Rest') {
    if (actor.currentHp >= actor.maxHp) {
      state.log.unshift(`${actor.pokemon.displayName}'s Rest failed because it is already at full HP.`);
      return;
    }
    actor.currentHp = actor.maxHp;
    actor.build.status = 'sleep';
    actor.sleepTurns = 0;
    actor.freezeTurns = 0;
    actor.toxicCounter = 1;
    state.log.unshift(`${actor.pokemon.displayName} fully restored itself with Rest.`);
    return;
  }

  if (move.name === 'Life Dew') {
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      if (unit && !unit.fainted) {
        healUnit(unit, healAmount(unit, 0.25));
      }
    }
    state.log.unshift(`${actor.pokemon.displayName} restored its side with Life Dew.`);
    return;
  }

  if (move.name === 'Heal Pulse') {
    healUnit(actor, healAmount(actor, 0.5));
    state.log.unshift(`${actor.pokemon.displayName} restored HP with Heal Pulse.`);
    return;
  }

  if (move.name === 'Heal Bell') {
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      if (!unit) {
        continue;
      }
      unit.build.status = 'healthy';
      unit.toxicCounter = 1;
      unit.sleepTurns = 0;
      unit.freezeTurns = 0;
    }
    state.log.unshift(`${actor.pokemon.displayName} cured its side with Heal Bell.`);
    return;
  }

  if (move.name === 'Safeguard') {
    actingSide.safeguardTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} wrapped its side in Safeguard.`);
    return;
  }

  if (move.name === 'Gravity') {
    state.gravityTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} intensified gravity for five turns.`);
    return;
  }

  if (move.name === 'Chilly Reception') {
    state.environment.weather = 'snow';
    state.log.unshift(`${actor.pokemon.displayName} called in snow with Chilly Reception.`);
    autoPivotToBench(state, actingSideId, actor, move.name, false);
    return;
  }

  if (move.name === 'Tailwind') {
    actingSide.tailwindTurns = 4;
    state.log.unshift(`${actor.pokemon.displayName} set Tailwind for its side.`);
    return;
  }

  if (move.name === 'Trick Room') {
    state.trickRoomTurns = state.trickRoomTurns > 0 ? 0 : 5;
    state.log.unshift(
      state.trickRoomTurns > 0
        ? `${actor.pokemon.displayName} twisted the dimensions with Trick Room.`
        : `${actor.pokemon.displayName} returned the dimensions to normal.`,
    );
    return;
  }

  if (move.name === 'Reflect') {
    actingSide.reflectTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} set Reflect.`);
    return;
  }

  if (move.name === 'Light Screen') {
    actingSide.lightScreenTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} set Light Screen.`);
    return;
  }

  if (move.name === 'Aurora Veil') {
    actingSide.reflectTurns = 5;
    actingSide.lightScreenTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} put up Aurora Veil.`);
    return;
  }

  if (move.name === 'Helping Hand') {
    const allyIndex = actingSide.active.find((index) => index !== actingSide.units.indexOf(actor));
    if (typeof allyIndex === 'number') {
      actingSide.units[allyIndex].helpingHand = true;
      state.log.unshift(`${actor.pokemon.displayName} boosted its ally with Helping Hand.`);
      return;
    }
  }

  if (redirectionMoves.has(move.name)) {
    actingSide.redirectionUnitIndex = actingSide.units.indexOf(actor);
    state.log.unshift(`${actor.pokemon.displayName} redirected pressure with ${move.name}.`);
    return;
  }

  if (allyBoostMoves.has(move.name)) {
    for (const unitIndex of actingSide.active) {
      const unit = actingSide.units[unitIndex];
      if (!unit || unit.fainted) {
        continue;
      }
      if (move.name === 'Howl') {
        applySingleStage(unit, 'attackStage', 1);
      }
      if (move.name === 'Coaching' && unit !== actor) {
        applySingleStage(unit, 'attackStage', 1);
        applySingleStage(unit, 'defenseStage', 1);
      }
    }
    state.log.unshift(`${actor.pokemon.displayName} supported its side with ${move.name}.`);
    return;
  }

  if (move.name === 'Aqua Ring') {
    actor.aquaRing = true;
    state.log.unshift(`${actor.pokemon.displayName} surrounded itself with Aqua Ring.`);
    return;
  }

  if (move.name === 'Ingrain') {
    actor.ingrain = true;
    state.log.unshift(`${actor.pokemon.displayName} planted its roots with Ingrain.`);
    return;
  }

  if (move.name === 'Leech Seed') {
    accurateOpponentTargets.forEach((targetRef) => {
      if (typeListForUnit(state, targetRef.unit).includes('Grass')) {
        state.log.unshift(`${targetRef.unit.pokemon.displayName} shrugged off Leech Seed.`);
        return;
      }
      targetRef.unit.seededBySideId = actingSideId;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} scattered Leech Seed.`);
    }
    return;
  }

  if (move.name === 'Stealth Rock') {
    defendingSide.stealthRock = true;
    state.log.unshift(`${actor.pokemon.displayName} scattered Stealth Rock.`);
    return;
  }

  if (move.name === 'Spikes') {
    defendingSide.spikesLayers = Math.min(3, defendingSide.spikesLayers + 1);
    state.log.unshift(`${actor.pokemon.displayName} added a layer of Spikes (${defendingSide.spikesLayers}).`);
    return;
  }

  if (move.name === 'Defog') {
    clearSideHazards(actingSide);
    clearSideHazards(defendingSide);
    actingSide.reflectTurns = 0;
    actingSide.lightScreenTurns = 0;
    actingSide.safeguardTurns = 0;
    defendingSide.reflectTurns = 0;
    defendingSide.lightScreenTurns = 0;
    defendingSide.safeguardTurns = 0;
    state.environment.terrain = 'none';
    state.log.unshift(`${actor.pokemon.displayName} cleared hazards and screens with Defog.`);
    return;
  }

  const nextWeather = weatherMoves.get(move.name);
  if (nextWeather) {
    state.environment.weather = nextWeather;
    state.log.unshift(`${actor.pokemon.displayName} changed the weather to ${nextWeather}.`);
    return;
  }

  const nextTerrain = terrainMoves.get(move.name);
  if (nextTerrain) {
    state.environment.terrain = nextTerrain;
    state.log.unshift(`${actor.pokemon.displayName} changed the terrain to ${nextTerrain}.`);
    return;
  }

  if (directStatusMoves.has(move.name)) {
    accurateOpponentTargets.forEach((targetRef) => maybeInflictStatus(state, actor, targetRef.unit, directStatusMoves.get(move.name) as PokemonBuild['status'], move.name));
    return;
  }

  if (move.name === 'Will-O-Wisp') {
    accurateOpponentTargets.forEach((targetRef) => maybeInflictStatus(state, actor, targetRef.unit, 'burn', move.name));
    return;
  }

  if (move.name === 'Thunder Wave') {
    accurateOpponentTargets.forEach((targetRef) => maybeInflictStatus(state, actor, targetRef.unit, 'paralysis', move.name));
    return;
  }

  if (move.name === 'Toxic') {
    accurateOpponentTargets.forEach((targetRef) => maybeInflictStatus(state, actor, targetRef.unit, 'toxic', move.name));
    return;
  }

  if (move.name === 'Spore') {
    accurateOpponentTargets.forEach((targetRef) => maybeInflictStatus(state, actor, targetRef.unit, 'sleep', move.name));
    return;
  }

  if (move.name === 'Parting Shot' || move.name === 'Tearful Look' || move.name === 'Noble Roar') {
    accurateOpponentTargets.forEach((targetRef) => {
      applySingleStage(targetRef.unit, 'attackStage', -1);
      applySingleStage(targetRef.unit, 'specialAttackStage', -1);
    });
    state.log.unshift(`${actor.pokemon.displayName} softened the opposing side with ${move.name}.`);
    return;
  }

  if (move.name === 'Baby-Doll Eyes') {
    accurateOpponentTargets.forEach((targetRef) => applySingleStage(targetRef.unit, 'attackStage', -1));
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} lowered Attack with Baby-Doll Eyes.`);
    }
    return;
  }

  if (move.name === 'Fake Tears' || move.name === 'Metal Sound') {
    accurateOpponentTargets.forEach((targetRef) => applySingleStage(targetRef.unit, 'specialDefenseStage', -2));
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} harshly lowered Sp. Def with ${move.name}.`);
    }
    return;
  }

  if (move.name === 'Eerie Impulse') {
    accurateOpponentTargets.forEach((targetRef) => applySingleStage(targetRef.unit, 'specialAttackStage', -2));
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} harshly lowered Sp. Atk with Eerie Impulse.`);
    }
    return;
  }

  if (move.name === 'Encore') {
    accurateOpponentTargets.forEach((targetRef) => {
      if (targetRef.unit.lastMoveId) {
        targetRef.unit.encoreTurns = 3;
        targetRef.unit.encoreMoveId = targetRef.unit.lastMoveId;
      }
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} locked in an Encore.`);
      return;
    }
  }

  if (move.name === 'Disable') {
    accurateOpponentTargets.forEach((targetRef) => {
      if (targetRef.unit.lastMoveId) {
        targetRef.unit.disableTurns = 4;
        targetRef.unit.disabledMoveId = targetRef.unit.lastMoveId;
      }
    });
    if (accurateOpponentTargets.some((targetRef) => Boolean(targetRef.unit.lastMoveId))) {
      state.log.unshift(`${actor.pokemon.displayName} disabled its target's last move.`);
      return;
    }
  }

  if (move.name === 'Taunt') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.tauntTurns = 3;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} taunted its target.`);
      return;
    }
  }

  if (move.name === 'Haze') {
    resetStageModifiers(state);
    state.log.unshift(`${actor.pokemon.displayName} cleared all stat changes with Haze.`);
    return;
  }

  if (move.name === 'Acupressure') {
    const targetUnit = actor;
    const boostOrder: StageKey[] = ['speedStage', 'specialAttackStage', 'attackStage', 'defenseStage', 'specialDefenseStage', 'accuracyStage', 'evasionStage'];
    const chosenStage = boostOrder.find((stage) => targetUnit.build[stage] < 6) ?? 'attackStage';
    applySingleStage(targetUnit, chosenStage, 2);
    state.log.unshift(`${actor.pokemon.displayName} sharply boosted ${stageLabel(chosenStage)} with Acupressure.`);
    return;
  }

  if (move.name === 'Double Team') {
    applySingleStage(actor, 'evasionStage', 1);
    state.log.unshift(`${actor.pokemon.displayName} boosted its Evasion.`);
    return;
  }

  if (move.name === 'Sweet Scent') {
    accurateOpponentTargets.forEach((targetRef) => applySingleStage(targetRef.unit, 'evasionStage', -2));
    state.log.unshift(`${actor.pokemon.displayName} lowered the opposing side's Evasion.`);
    return;
  }

  if (move.name === 'Coil') {
    applyBoosts(actor, { attackStage: 1, defenseStage: 1, accuracyStage: 1 });
    state.log.unshift(`${actor.pokemon.displayName} coiled up and boosted Attack, Defense, and Accuracy.`);
    return;
  }

  if (move.name === 'Charge') {
    applySingleStage(actor, 'specialDefenseStage', 1);
    actor.electricBoost = true;
    state.log.unshift(`${actor.pokemon.displayName} charged up its next Electric strike.`);
    return;
  }

  if (move.name === 'Growth') {
    const growthBoost = state.environment.weather === 'sun' ? 2 : 1;
    applyBoosts(actor, { attackStage: growthBoost, specialAttackStage: growthBoost });
    state.log.unshift(`${actor.pokemon.displayName} grew stronger with Growth.`);
    return;
  }

  if (move.name === 'Strength Sap') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const stats = buildStats(chosenTarget.pokemon.baseStats, chosenTarget.build.evs, chosenTarget.build.natureId);
      const currentAttack = Math.max(1, Math.round(stats.attack * stageMultiplier(chosenTarget.build.attackStage)));
      healUnit(actor, currentAttack);
      applySingleStage(chosenTarget, 'attackStage', -1);
      state.log.unshift(`${actor.pokemon.displayName} drained strength from ${chosenTarget.pokemon.displayName}.`);
      return;
    }
  }

  if (move.name === 'Baton Pass') {
    autoPivotToBench(state, actingSideId, actor, move.name, true);
    return;
  }

  const boosts = boostMoves.get(move.name);
  if (boosts) {
    applyBoosts(actor, boosts);
    state.log.unshift(`${actor.pokemon.displayName} boosted its stats with ${move.name}.`);
    return;
  }

  state.log.unshift(`${actor.pokemon.displayName} used ${move.name}.`);
}

function chanceRoll(percent: number) {
  return Math.random() <= percent / 100;
}

function applyTargetStatEffect(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  switch (move.name) {
    case 'Snarl':
    case 'Struggle Bug':
    case 'Mystical Fire':
      applySingleStage(target, 'specialAttackStage', -1);
      state.log.unshift(`${target.pokemon.displayName}'s Sp. Atk fell because of ${move.name}.`);
      return;
    case 'Breaking Swipe':
    case 'Bitter Malice':
    case 'Chilling Water':
    case 'Lunge':
      applySingleStage(target, 'attackStage', -1);
      state.log.unshift(`${target.pokemon.displayName}'s Attack fell because of ${move.name}.`);
      return;
    case 'Acid Spray':
    case 'Lumina Crash':
      applySingleStage(target, 'specialDefenseStage', -2);
      state.log.unshift(`${target.pokemon.displayName}'s Sp. Def sharply fell because of ${move.name}.`);
      return;
    case 'Apple Acid':
      applySingleStage(target, 'specialDefenseStage', -1);
      state.log.unshift(`${target.pokemon.displayName}'s Sp. Def fell because of ${move.name}.`);
      return;
    case 'Fire Lash':
      applySingleStage(target, 'defenseStage', -1);
      state.log.unshift(`${target.pokemon.displayName}'s Defense fell because of ${move.name}.`);
      return;
    case 'Rock Tomb':
    case 'Mud Shot':
    case 'Icy Wind':
    case 'Bulldoze':
    case 'Electroweb':
    case 'Low Sweep':
      applySingleStage(target, 'speedStage', -1);
      state.log.unshift(`${target.pokemon.displayName}'s Speed fell because of ${move.name}.`);
      return;
    case 'Mud-Slap':
      applySingleStage(target, 'accuracyStage', -1);
      state.log.unshift(`${target.pokemon.displayName}'s Accuracy fell because of ${move.name}.`);
      return;
    default:
      break;
  }

  if (move.name === 'Muddy Water' && chanceRoll(30)) {
    applySingleStage(target, 'accuracyStage', -1);
    state.log.unshift(`${target.pokemon.displayName}'s Accuracy fell because of Muddy Water.`);
    return;
  }

  if (move.name === 'Night Daze' && chanceRoll(40)) {
    applySingleStage(target, 'accuracyStage', -1);
    state.log.unshift(`${target.pokemon.displayName}'s Accuracy fell because of Night Daze.`);
    return;
  }

  if ((move.name === 'Bug Buzz' || move.name === 'Earth Power' || move.name === 'Energy Ball' || move.name === 'Flash Cannon') && chanceRoll(10)) {
    applySingleStage(target, 'specialDefenseStage', -1);
    state.log.unshift(`${target.pokemon.displayName}'s Sp. Def fell because of ${move.name}.`);
    return;
  }

  if (move.name === 'Crunch' && chanceRoll(20)) {
    applySingleStage(target, 'defenseStage', -1);
    state.log.unshift(`${target.pokemon.displayName}'s Defense fell because of Crunch.`);
  }
}

function applyTargetStatusEffect(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  switch (move.name) {
    case 'Inferno':
      maybeInflictStatus(state, actor, target, 'burn', move.name);
      return;
    case 'Mortal Spin':
      maybeInflictStatus(state, actor, target, 'poison', move.name);
      return;
    case 'Nuzzle':
      maybeInflictStatus(state, actor, target, 'paralysis', move.name);
      return;
    case 'Burning Jealousy':
      if (target.statsRaisedThisTurn) {
        maybeInflictStatus(state, actor, target, 'burn', move.name);
      }
      return;
    case 'Sparkling Aria':
      if (target.build.status === 'burn') {
        target.build.status = 'healthy';
        state.log.unshift(`${target.pokemon.displayName}'s burn was washed away by Sparkling Aria.`);
      }
      return;
    default:
      break;
  }

  if (move.name === 'Discharge' && chanceRoll(30)) {
    maybeInflictStatus(state, actor, target, 'paralysis', move.name);
    return;
  }

  if (move.name === 'Thunder' && chanceRoll(30)) {
    maybeInflictStatus(state, actor, target, 'paralysis', move.name);
    return;
  }

  if (move.name === 'Blizzard' && chanceRoll(10)) {
    maybeInflictStatus(state, actor, target, 'freeze', move.name);
    return;
  }

  if (move.name === 'Body Slam' && chanceRoll(30)) {
    maybeInflictStatus(state, actor, target, 'paralysis', move.name);
    return;
  }

  if (move.name === 'Gunk Shot' && chanceRoll(30)) {
    maybeInflictStatus(state, actor, target, 'poison', move.name);
    return;
  }

  if (move.name === 'Lava Plume' && chanceRoll(30)) {
    maybeInflictStatus(state, actor, target, 'burn', move.name);
    return;
  }

  if (move.name === 'Dire Claw' && chanceRoll(30)) {
    const roll = Math.random();
    const nextStatus: PokemonBuild['status'] = roll < 1 / 3 ? 'poison' : roll < 2 / 3 ? 'paralysis' : 'sleep';
    maybeInflictStatus(state, actor, target, nextStatus, move.name);
    return;
  }

  if ((move.name === 'Flamethrower' || move.name === 'Fire Blast' || move.name === 'Flare Blitz' || move.name === 'Fire Punch') && chanceRoll(10)) {
    maybeInflictStatus(state, actor, target, 'burn', move.name);
    return;
  }

  if ((move.name === 'Blaze Kick' || move.name === 'Heat Wave' || move.name === 'Fire Fang') && chanceRoll(10)) {
    maybeInflictStatus(state, actor, target, 'burn', move.name);
  }
}

function applySelfAfterAttack(state: SimulatorBattleState, actor: SimUnit, move: PokemonMove, landedHit: boolean) {
  if (move.name === 'Rapid Spin' && landedHit) {
    clearSideHazards(sideForUnit(state, actor));
    applySingleStage(actor, 'speedStage', 1);
    state.log.unshift(`${actor.pokemon.displayName} cleared hazards and boosted Speed with Rapid Spin.`);
  }

  if (move.name === 'Mortal Spin' && landedHit) {
    clearSideHazards(sideForUnit(state, actor));
    state.log.unshift(`${actor.pokemon.displayName} cleared hazards with Mortal Spin.`);
  }

  if (move.name === 'Brick Break' && landedHit) {
    const defendingSide = opposingSide(state, unitSideId(state, actor));
    defendingSide.reflectTurns = 0;
    defendingSide.lightScreenTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} broke opposing screens with Brick Break.`);
  }

  if (move.name === 'Ice Spinner' && landedHit) {
    state.environment.terrain = 'none';
    state.log.unshift(`${actor.pokemon.displayName} removed the terrain with Ice Spinner.`);
  }

  if (move.name === 'Close Combat') {
    applySingleStage(actor, 'defenseStage', -1);
    applySingleStage(actor, 'specialDefenseStage', -1);
    return;
  }

  if (move.name === 'Superpower') {
    applySingleStage(actor, 'attackStage', -1);
    applySingleStage(actor, 'defenseStage', -1);
    return;
  }

  if (move.name === 'Headlong Rush' || move.name === 'Armor Cannon') {
    applySingleStage(actor, 'defenseStage', -1);
    applySingleStage(actor, 'specialDefenseStage', -1);
    return;
  }

  if (move.name === 'Overheat' || move.name === 'Draco Meteor' || move.name === 'Leaf Storm') {
    applySingleStage(actor, 'specialAttackStage', -2);
    return;
  }

  if (move.name === 'Clanging Scales') {
    applySingleStage(actor, 'defenseStage', -1);
    return;
  }

  if (move.name === 'Aqua Step' || move.name === 'Flame Charge') {
    applySingleStage(actor, 'speedStage', 1);
    return;
  }

  if (move.name === 'Ice Hammer') {
    applySingleStage(actor, 'speedStage', -1);
    return;
  }

  if (move.name === 'Hammer Arm') {
    applySingleStage(actor, 'speedStage', -1);
    return;
  }

  if (pivotMoves.has(move.name) && landedHit) {
    autoPivotToBench(state, unitSideId(state, actor), actor, move.name, false);
  }
}

function executeDamageMove(
  state: SimulatorBattleState,
  actor: SimUnit,
  target: SimUnit | null,
  move: PokemonMove,
  actingSide: SimSide,
  defendingSide: SimSide,
) {
  if (move.name === 'Fake Out' && actor.turnsActive > 0) {
    state.log.unshift(`${actor.pokemon.displayName}'s Fake Out failed because it is no longer freshly sent out.`);
    return;
  }

  const actingSideId: SideId = state.player === actingSide ? 'player' : 'opponent';
  let targetRefs: TargetRef[] = [];
  if (moveScope(move) === 'single') {
    targetRefs = target && !target.fainted
      ? [{
          sideId: (actingSideId === 'player' ? 'opponent' : 'player') as SideId,
          side: defendingSide,
          unit: target,
          unitIndex: defendingSide.units.indexOf(target),
          activeSlot: defendingSide.active.findIndex((entry) => entry === defendingSide.units.indexOf(target)),
          ally: false,
        } as TargetRef]
      : [];
  } else {
    targetRefs = resolveTargetRefs(state, actingSideId, actingSide, defendingSide, actor, 0, move);
  }

  if (!targetRefs.length) {
    return;
  }

  const priority = movePriority(move, actor);
  const spreadPenalty = moveScope(move) !== 'single' && targetRefs.length > 1 ? 0.75 : 1;
  let totalDamage = 0;
  let landedHit = false;

  for (const targetRef of targetRefs) {
    const sideProtection = blockedBySideProtection(move, priority, targetRef);
    if (sideProtection) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} was shielded by ${sideProtection}.`);
      continue;
    }

    const protectBypass = moveBypassesProtect(actor, move);
    const unseenFistThroughShield = targetRef.unit.protected && abilityNameForUnit(actor) === 'Unseen Fist' && moveMakesContact(move);
    if (targetRef.unit.protected && !protectBypass) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} blocked ${move.name} with ${targetRef.unit.protectSource ?? 'Protect'}.`);
      applyProtectionContactRebound(state, targetRef.unit, actor, move);
      continue;
    }

    if (targetRef.unit.protected && move.name === 'Feint') {
      clearProtectionState(targetRef.unit);
      state.log.unshift(`${actor.pokemon.displayName} broke through the shield with Feint.`);
    }

    if (!accuracyCheck(state, actor, targetRef.unit, move)) {
      state.log.unshift(`${actor.pokemon.displayName}'s ${move.name} missed ${targetRef.unit.pokemon.displayName}.`);
      continue;
    }

    const result = calculateDamage(currentBuild(actor), currentBuild(targetRef.unit), move, screenAwareEnvironment(state, targetRef.side));
    if (!result) {
      state.log.unshift(`${actor.pokemon.displayName} used ${move.name}, but no direct damage line applied.`);
      continue;
    }

    let damage = Math.round((result.minDamage + result.maxDamage) / 2);
    damage = Math.max(1, Math.round(damage * spreadPenalty));
    if (actor.helpingHand) {
      damage = Math.round(damage * 1.5);
    }
    if (actor.electricBoost && move.type === 'Electric') {
      damage = Math.max(1, Math.round(damage * 2));
    }
    if (unseenFistThroughShield) {
      damage = Math.max(1, Math.round(damage * 0.25));
      state.log.unshift(`${actor.pokemon.displayName} pierced protection with Unseen Fist at reduced damage.`);
    }

    const dealt = lowerUnitHp(targetRef.unit, damage);
    if (dealt <= 0) {
      continue;
    }

    landedHit = true;
    totalDamage += dealt;
    state.log.unshift(`${actor.pokemon.displayName} used ${move.name} on ${targetRef.unit.pokemon.displayName} for ${dealt} damage.`);
    maybeTriggerHealingBerry(state, targetRef.unit);
    applyProtectionContactRebound(state, targetRef.unit, actor, move);

    if (move.name === 'Fake Out' && targetRef.unit.turnsActive === 0 && !targetRef.unit.fainted) {
      targetRef.unit.flinched = true;
      state.log.unshift(`${targetRef.unit.pokemon.displayName} flinched.`);
    }

    applyTargetStatEffect(state, actor, targetRef.unit, move);
    applyTargetStatusEffect(state, actor, targetRef.unit, move);
  }

  if (drainingMoves.has(move.name) && totalDamage > 0 && !actor.fainted) {
    healUnit(actor, Math.max(1, Math.round(totalDamage * 0.5)));
    state.log.unshift(`${actor.pokemon.displayName} drained health back.`);
  }

  if (actor.electricBoost && move.type === 'Electric') {
    actor.electricBoost = false;
  }

  if (recoilMoves.has(move.name) && totalDamage > 0 && !actor.fainted) {
    const recoil = Math.max(1, Math.round(totalDamage / 3));
    lowerUnitHp(actor, recoil);
    state.log.unshift(`${actor.pokemon.displayName} took ${recoil} recoil from ${move.name}.`);
    maybeTriggerHealingBerry(state, actor);
  }

  applySelfAfterAttack(state, actor, move, landedHit);
  actor.helpingHand = false;
}

function processPreMoveStatus(state: SimulatorBattleState, actor: SimUnit) {
  maybeConsumeStatusBerry(state, actor);

  if (actor.build.status === 'sleep') {
    actor.sleepTurns += 1;
    if (actor.sleepTurns === 1) {
      state.log.unshift(`${actor.pokemon.displayName} is asleep.`);
      return false;
    }

    if (actor.sleepTurns === 2 && Math.random() > 1 / 3) {
      state.log.unshift(`${actor.pokemon.displayName} is asleep.`);
      return false;
    }

    actor.build.status = 'healthy';
    actor.sleepTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} woke up.`);
  }

  if (actor.build.status === 'freeze') {
    actor.freezeTurns += 1;
    if (actor.freezeTurns >= 3 || Math.random() < 0.25) {
      actor.build.status = 'healthy';
      actor.freezeTurns = 0;
      state.log.unshift(`${actor.pokemon.displayName} thawed out.`);
    } else {
      state.log.unshift(`${actor.pokemon.displayName} is frozen solid.`);
      return false;
    }
  }

  if (actor.build.status === 'paralysis' && Math.random() < 0.125) {
    state.log.unshift(`${actor.pokemon.displayName} is fully paralyzed.`);
    return false;
  }

  return true;
}

function endTurnSideEffects(state: SimulatorBattleState, side: SimSide) {
  for (const unit of side.units) {
    if (unit.fainted) {
      continue;
    }

    unit.turnsActive += side.active.includes(side.units.indexOf(unit)) ? 1 : 0;
    clearProtectionState(unit);
    unit.flinched = false;
    unit.helpingHand = false;
    const ability = abilityNameForUnit(unit);
    const types = typeListForUnit(state, unit);

    if (unit.build.status === 'burn') {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * 0.0625)));
    }

    if (unit.build.status === 'poison' && ability !== 'Poison Heal') {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * 0.125)));
    }

    if (unit.build.status === 'toxic' && ability !== 'Poison Heal') {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * (unit.toxicCounter / 16))));
      unit.toxicCounter += 1;
    }

    if ((unit.build.status === 'poison' || unit.build.status === 'toxic') && ability === 'Poison Heal') {
      healUnit(unit, healAmount(unit, 0.125));
    }

    if (unit.fainted) {
      continue;
    }

    const item = getItemById(unit.build.itemId);
    if (item?.name === 'Leftovers') {
      healUnit(unit, healAmount(unit, 0.0625));
    }

    if (item?.name === 'Black Sludge') {
      if (types.includes('Poison')) {
        healUnit(unit, healAmount(unit, 0.0625));
      } else {
        lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * 0.125)));
      }
    }

    if (unit.fainted) {
      continue;
    }

    if (state.environment.weather === 'sand') {
      const sandImmuneTypes = new Set(['Rock', 'Ground', 'Steel']);
      const sandImmuneAbilities = new Set(['Magic Guard', 'Overcoat', 'Sand Force', 'Sand Rush', 'Sand Veil']);
      if (!types.some((type) => sandImmuneTypes.has(type)) && !sandImmuneAbilities.has(ability ?? '')) {
        lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * 0.0625)));
      }
    }

    if (unit.fainted) {
      continue;
    }

    if (side.active.includes(side.units.indexOf(unit)) && state.environment.terrain === 'grassy' && unitGroundedInState(state, unit)) {
      healUnit(unit, healAmount(unit, 0.0625));
    }

    if (unit.aquaRing) {
      healUnit(unit, healAmount(unit, 0.0625));
    }

    if (unit.ingrain) {
      healUnit(unit, healAmount(unit, 0.0625));
    }

    if (unit.seededBySideId && !typeListForUnit(state, unit).includes('Grass')) {
      const leeched = Math.max(1, Math.round(unit.maxHp * 0.125));
      lowerUnitHp(unit, leeched);
      const healingSide = sideForId(state, unit.seededBySideId);
      const healingTarget = healingSide.active.map((unitIndex) => healingSide.units[unitIndex]).find((candidate) => candidate && !candidate.fainted) ?? null;
      if (healingTarget) {
        healUnit(healingTarget, leeched);
      }
    }

    maybeTriggerHealingBerry(state, unit);

    unit.tauntTurns = Math.max(0, unit.tauntTurns - 1);
    unit.encoreTurns = Math.max(0, unit.encoreTurns - 1);
    unit.disableTurns = Math.max(0, unit.disableTurns - 1);
    clearVolatileChoiceLocks(unit);
  }

  side.tailwindTurns = Math.max(0, side.tailwindTurns - 1);
  side.reflectTurns = Math.max(0, side.reflectTurns - 1);
  side.lightScreenTurns = Math.max(0, side.lightScreenTurns - 1);
  side.safeguardTurns = Math.max(0, side.safeguardTurns - 1);
  side.redirectionUnitIndex = null;
  side.quickGuardActive = false;
  side.wideGuardActive = false;
  side.wishQueue = side.wishQueue
    .map((wish) => ({ ...wish, turns: wish.turns - 1 }))
    .filter((wish) => {
      if (wish.turns > 0) {
        return true;
      }
      const receiverIndex = side.active[wish.activeSlot];
      const receiver = typeof receiverIndex === 'number' ? side.units[receiverIndex] ?? null : null;
      if (receiver && !receiver.fainted) {
        healUnit(receiver, wish.healAmount);
        state.log.unshift(`${receiver.pokemon.displayName} received a delayed Wish heal.`);
      }
      return false;
    });
}

function maybeUpgradeChoiceToMega(state: SimulatorBattleState, sideId: SideId, actor: number, choice: SimulatorChoice): SimulatorChoice {
  if (choice.type === 'switch') {
    return choice;
  }

  const actingSide = sideForId(state, sideId);
  const unit = targetActiveUnit(actingSide, actor);
  if (!unit || !canUnitMegaEvolve(actingSide, unit)) {
    return choice;
  }

  const megaAbility = resolveAbility({ ...unit.build, useMega: true }, unit.megaPokemon)?.name ?? null;
  const weatherOrTerrainMega = weatherAbilities.has(megaAbility ?? '') || terrainAbilities.has(megaAbility ?? '');
  const shouldMegaNow = weatherOrTerrainMega || state.turn <= 3 || unit.currentHp > unit.maxHp * 0.45;
  return shouldMegaNow ? ({ ...choice, type: 'mega' } satisfies SimulatorChoice) : choice;
}

function aiChoiceForUnit(state: SimulatorBattleState, sideId: SideId, actor: number): SimulatorChoice {
  const actingSide = sideForId(state, sideId);
  const defendingSide = opposingSide(state, sideId);
  const unit = targetActiveUnit(actingSide, actor);
  if (!unit) {
    return { type: 'move', actor, moveId: actingSide.units[actingSide.active[actor]]?.build.moveIds[0] ?? '', target: 0 };
  }

  const legalMoves = legalMovesForUnit(unit);
  const recoveryMove = legalMoves.find((move) => healingMoves.has(move.name));
  if (recoveryMove && unit.currentHp <= unit.maxHp * 0.35) {
    return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: recoveryMove.id, target: actor });
  }

  if (state.turn <= 2 && actingSide.tailwindTurns === 0) {
    const tailwind = legalMoves.find((move) => move.name === 'Tailwind');
    if (tailwind) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: tailwind.id, target: actor });
    }
  }

  if (state.turn <= 3 && actingSide.reflectTurns === 0) {
    const reflect = legalMoves.find((move) => move.name === 'Reflect');
    if (reflect) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: reflect.id, target: actor });
    }
  }

  if (state.turn <= 3 && actingSide.lightScreenTurns === 0) {
    const lightScreen = legalMoves.find((move) => move.name === 'Light Screen');
    if (lightScreen) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: lightScreen.id, target: actor });
    }
  }

  if (state.format === 'Singles' && state.turn <= 3 && !defendingSide.stealthRock) {
    const stealthRock = legalMoves.find((move) => move.name === 'Stealth Rock');
    if (stealthRock) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: stealthRock.id, target: 0 });
    }
  }

  if (state.format === 'Singles' && state.turn <= 4 && defendingSide.spikesLayers < 2) {
    const spikes = legalMoves.find((move) => move.name === 'Spikes');
    if (spikes) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: spikes.id, target: 0 });
    }
  }

  if (state.format === 'Doubles' && legalMoves.some((move) => redirectionMoves.has(move.name))) {
    const redirectMove = legalMoves.find((move) => redirectionMoves.has(move.name));
    if (redirectMove && unit.currentHp > unit.maxHp * 0.45 && actingSide.redirectionUnitIndex === null) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: redirectMove.id, target: actor });
    }
  }

  const setupMove = legalMoves.find((move) => boostMoves.has(move.name));
  if (setupMove && unit.currentHp > unit.maxHp * 0.7) {
    const totalBoosts = unit.build.attackStage + unit.build.specialAttackStage + unit.build.speedStage;
    if (totalBoosts <= 1) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: setupMove.id, target: actor });
    }
  }

  if (unit.currentHp <= unit.maxHp * 0.25) {
    const protect = legalMoves.find((move) => move.name === 'Protect');
    if (protect) {
      return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: protect.id, target: actor });
    }
  }

  let best: { moveId: string; target: number; damage: number } | null = null;
  for (const move of legalMoves) {
    for (let targetIndex = 0; targetIndex < defendingSide.active.length; targetIndex += 1) {
      const target = targetActiveUnit(defendingSide, targetIndex);
      if (!target || move.category === 'Status') {
        continue;
      }
      const result = calculateDamage(currentBuild(unit), currentBuild(target), move, screenAwareEnvironment(state, defendingSide));
      if (!result) {
        continue;
      }
      const damage = (result.minDamage + result.maxDamage) / 2;
      if (!best || damage > best.damage) {
        best = { moveId: move.id, target: targetIndex, damage };
      }
    }
  }

  if (best) {
    return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: best.moveId, target: best.target });
  }

  const firstMove = legalMoves[0];
  return maybeUpgradeChoiceToMega(state, sideId, actor, { type: 'move', actor, moveId: firstMove?.id ?? '', target: 0 });
}

function normalizeMegaChoicesForSide(state: SimulatorBattleState, sideId: SideId, choices: SimulatorChoice[]) {
  const side = sideForId(state, sideId);
  let megaReserved = side.megaUsed;
  return choices.map((choice) => {
    if (choice.type !== 'mega') {
      return choice;
    }

    const unit = targetActiveUnit(side, choice.actor);
    if (!unit || megaReserved || !canUnitMegaEvolve(side, unit)) {
      return { ...choice, type: 'move' } satisfies SimulatorChoice;
    }

    megaReserved = true;
    return choice;
  });
}

export function createSimulatorBattle(
  format: BattleFormat,
  playerTeam: Team,
  playerOrder: number[],
  opponentTeam: Team,
  opponentOrder: number[],
  previewEndsAt: number | null,
) {
  return {
    format,
    stage: 'preview',
    turn: 1,
    previewEndsAt,
    player: makeSide(playerTeam, playerOrder, 'Player', format),
    opponent: makeSide(opponentTeam, opponentOrder, 'Opponent', format),
    environment: { ...defaultEnvironment },
    trickRoomTurns: 0,
    gravityTurns: 0,
    log: ['Team preview started. Choose your bring order and prepare the lead plan.'],
    winner: null,
  } satisfies SimulatorBattleState;
}

export function advancePreviewToBattle(state: SimulatorBattleState) {
  const next = structuredClone(state) as SimulatorBattleState;
  next.stage = 'battle';
  next.previewEndsAt = null;
  next.log.unshift(`${next.player.name} sent out ${describeActive(next.player)}.`);
  next.log.unshift(`${next.opponent.name} sent out ${describeActive(next.opponent)}.`);

  for (const entry of simultaneousSwitchInOrder(next)) {
    switchInUnit(next, entry.sideId, entry.unitIndex, false);
  }

  integrateReplacements(next, 'player');
  integrateReplacements(next, 'opponent');
  updateWinner(next);
  return next;
}

export function generateAiChoices(state: SimulatorBattleState, sideId: SideId) {
  const side = sideForId(state, sideId);
  return side.active.map((_, actor) => aiChoiceForUnit(state, sideId, actor));
}

export function resolveTurn(state: SimulatorBattleState, playerChoices: SimulatorChoice[]) {
  const next = structuredClone(state) as SimulatorBattleState;
  for (const side of [next.player, next.opponent]) {
    for (const unit of side.units) {
      unit.statsRaisedThisTurn = false;
      unit.statsLoweredThisTurn = false;
    }
  }
  const normalizedPlayerChoices = normalizeMegaChoicesForSide(
    next,
    'player',
    playerChoices.map((choice) => normalizeChoiceForUnit(next.player, choice)),
  );
  const opponentChoices = normalizeMegaChoicesForSide(
    next,
    'opponent',
    generateAiChoices(next, 'opponent').map((choice) => normalizeChoiceForUnit(next.opponent, choice)),
  );
  const megaQueue = [
    ...normalizedPlayerChoices.filter((choice): choice is Extract<SimulatorChoice, { type: 'mega' }> => choice.type === 'mega').map((choice) => ({ side: 'player' as SideId, choice })),
    ...opponentChoices.filter((choice): choice is Extract<SimulatorChoice, { type: 'mega' }> => choice.type === 'mega').map((choice) => ({ side: 'opponent' as SideId, choice })),
  ];

  megaQueue.sort((left, right) => {
    const leftSide = sideForId(next, left.side);
    const rightSide = sideForId(next, right.side);
    const leftUnit = targetActiveUnit(leftSide, left.choice.actor);
    const rightUnit = targetActiveUnit(rightSide, right.choice.actor);
    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, next.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, next.trickRoomTurns) : 0;
    return compareActionSpeed(leftSpeed, rightSpeed);
  });

  for (const queuedMega of megaQueue) {
    performMegaEvolution(next, queuedMega.side, queuedMega.choice.actor);
  }

  const queued = [
    ...normalizedPlayerChoices.map((choice) => ({ side: 'player' as SideId, choice })),
    ...opponentChoices.map((choice) => ({ side: 'opponent' as SideId, choice })),
  ];

  queued.sort((left, right) => {
    const leftSide = sideForId(next, left.side);
    const rightSide = sideForId(next, right.side);
    const leftUnit = targetActiveUnit(leftSide, left.choice.actor);
    const rightUnit = targetActiveUnit(rightSide, right.choice.actor);
    const leftMove = left.choice.type !== 'switch' && leftUnit ? findMove(leftUnit, left.choice.moveId) : null;
    const rightMove = right.choice.type !== 'switch' && rightUnit ? findMove(rightUnit, right.choice.moveId) : null;
    const leftPriority = left.choice.type === 'switch' ? 6 : leftMove && leftUnit ? movePriority(leftMove, leftUnit) : 0;
    const rightPriority = right.choice.type === 'switch' ? 6 : rightMove && rightUnit ? movePriority(rightMove, rightUnit) : 0;

    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, next.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, next.trickRoomTurns) : 0;
    return compareActionSpeed(leftSpeed, rightSpeed);
  });

  for (const queuedAction of queued) {
    const actingSide = sideForId(next, queuedAction.side);
    const defendingSide = opposingSide(next, queuedAction.side);
    const actor = targetActiveUnit(actingSide, queuedAction.choice.actor);
    if (!actor || actor.fainted) {
      continue;
    }

    if (actor.flinched) {
      next.log.unshift(`${actor.pokemon.displayName} flinched and could not move.`);
      actor.flinched = false;
      continue;
    }

    if (!processPreMoveStatus(next, actor)) {
      continue;
    }

    if (queuedAction.choice.type === 'switch') {
      const currentIndex = actingSide.active[queuedAction.choice.actor];
      const targetIndex = queuedAction.choice.target;
      if (!actingSide.bench.includes(targetIndex) || actingSide.units[targetIndex]?.fainted) {
        continue;
      }

      switchOutUnit(actingSide, currentIndex);
      actingSide.active[queuedAction.choice.actor] = targetIndex;
      actingSide.bench = [...actingSide.bench.filter((entry) => entry !== targetIndex), currentIndex];
      actingSide.units[targetIndex].turnsActive = 0;
      next.log.unshift(`${actor.pokemon.displayName} switched out for ${actingSide.units[targetIndex].pokemon.displayName}.`);
      switchInUnit(next, queuedAction.side, targetIndex, false);
      updateWinner(next);
      if (next.winner) {
        break;
      }
      continue;
    }

    const move = findMove(actor, queuedAction.choice.moveId) ?? legalMovesForUnit(actor)[0] ?? null;
    if (!move) {
      continue;
    }

    const target = resolveMoveTarget(next, defendingSide, queuedAction.choice.target, move);
    actor.lastMoveId = move.id;
    if (!protectionCounterMoves.has(move.name)) {
      actor.protectStreak = 0;
    }

    if (move.category === 'Status') {
      applyStatusMove(next, actingSide, defendingSide, actor, move, target);
    } else {
      executeDamageMove(next, actor, target, move, actingSide, defendingSide);
    }

    integrateReplacements(next, 'player');
    integrateReplacements(next, 'opponent');
    updateWinner(next);
    if (next.winner) {
      break;
    }
  }

  endTurnSideEffects(next, next.player);
  endTurnSideEffects(next, next.opponent);
  next.trickRoomTurns = Math.max(0, next.trickRoomTurns - 1);
  next.gravityTurns = Math.max(0, next.gravityTurns - 1);
  integrateReplacements(next, 'player');
  integrateReplacements(next, 'opponent');
  updateWinner(next);
  next.turn += 1;

  if (!next.winner) {
    next.log.unshift(`Turn ${next.turn - 1} ended. ${describeActive(next.player)} face ${describeActive(next.opponent)}.`);
  } else {
    next.log.unshift(next.winner === 'player' ? 'You won the simulation.' : 'The AI side won the simulation.');
  }

  return next;
}
