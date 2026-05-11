import { calculateDamage } from './damage';
import {
  buildStats,
  defaultEnvironment,
  effectiveTypes,
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
      type: 'switch';
      actor: number;
      target: number;
    };

export interface SimUnit {
  slotIndex: number;
  build: PokemonBuild;
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
  tauntTurns: number;
  encoreTurns: number;
  encoreMoveId: string | null;
  lastMoveId: string | null;
}

export interface SimSide {
  name: string;
  units: SimUnit[];
  active: number[];
  bench: number[];
  selectedOrder: number[];
  tailwindTurns: number;
  reflectTurns: number;
  lightScreenTurns: number;
  stealthRock: boolean;
  spikesLayers: number;
  redirectionUnitIndex: number | null;
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
  log: string[];
  winner: SideId | null;
}

const priorityMoves = new Set(['Fake Out', 'Bullet Punch', 'Sucker Punch', 'Extreme Speed', 'Aqua Jet', 'Ice Shard']);
const healingMoves = new Set(['Recover', 'Roost', 'Slack Off', 'Moonlight', 'Synthesis', 'Wish', 'Shore Up', 'Soft-Boiled']);
const drainingMoves = new Set(['Drain Punch', 'Giga Drain', 'Horn Leech', 'Leech Life', 'Parabolic Charge', 'Draining Kiss']);
const recoilMoves = new Set(['Brave Bird', 'Double-Edge', 'Flare Blitz', 'Head Smash', 'Volt Tackle', 'Wave Crash', 'Wood Hammer']);
const redirectionMoves = new Set(['Follow Me', 'Rage Powder']);
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
]);

function stagePriority(move: PokemonMove) {
  if (move.name === 'Protect') return 4;
  if (move.name === 'Fake Out') return 3;
  if (move.category === 'Status') return 1;
  return 0;
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
    currentHpPercent: Math.max(1, Math.round((unit.currentHp / unit.maxHp) * 100)),
  };
}

function combatSpeed(unit: SimUnit, tailwindTurns: number, trickRoomTurns: number) {
  const stats = buildStats(unit.pokemon.baseStats, unit.build.evs, unit.build.natureId);
  const stageAdjusted = stats.speed * stageMultiplier(unit.build.speedStage);
  const tailwindAdjusted = tailwindTurns > 0 ? stageAdjusted * 2 : stageAdjusted;
  return trickRoomTurns > 0 ? -tailwindAdjusted : tailwindAdjusted;
}

function makeUnit(build: PokemonBuild, slotIndex: number): SimUnit | null {
  const pokemon = resolvePokemonForm(build);
  if (!pokemon) {
    return null;
  }

  const stats = buildStats(pokemon.baseStats, build.evs, build.natureId);
  return {
    slotIndex,
    build: { ...build, moveIds: normalizeMoveSelection(build, pokemon) },
    pokemon,
    currentHp: stats.hp,
    maxHp: stats.hp,
    fainted: false,
    protected: false,
    berrySpent: false,
    turnsActive: 0,
    flinched: false,
    helpingHand: false,
    toxicCounter: 1,
    sleepTurns: build.status === 'sleep' ? 2 : 0,
    tauntTurns: 0,
    encoreTurns: 0,
    encoreMoveId: null,
    lastMoveId: null,
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
    stealthRock: false,
    spikesLayers: 0,
    redirectionUnitIndex: null,
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
  unit.currentHp = Math.max(0, unit.currentHp - amount);
  if (unit.currentHp <= 0) {
    unit.fainted = true;
  }
}

function healUnit(unit: SimUnit, amount: number) {
  unit.currentHp = Math.min(unit.maxHp, unit.currentHp + amount);
}

function stageKeyLabel(field: 'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage') {
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
    default:
      return 'Stat';
  }
}

function applyBoosts(unit: SimUnit, boosts: Partial<Record<'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage', number>>) {
  for (const [key, value] of Object.entries(boosts)) {
    const stageKey = key as 'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage';
    const currentValue = Number(unit.build[stageKey] ?? 0);
    unit.build[stageKey] = Math.max(-6, Math.min(6, currentValue + Number(value ?? 0)));
  }
}

function applySingleStage(unit: SimUnit, stageKey: 'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage', delta: number) {
  unit.build[stageKey] = Math.max(-6, Math.min(6, unit.build[stageKey] + delta));
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
  if (unit.tauntTurns < 0) {
    unit.tauntTurns = 0;
  }
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
}

function applyEntryHazards(state: SimulatorBattleState, side: SimSide, unit: SimUnit) {
  const effectiveTypeSet = effectiveTypes(unit.pokemon, unit.build, state.environment.weather);
  if (side.stealthRock) {
    const multiplier = typeEffectiveness('Rock', effectiveTypeSet);
    const damage = Math.max(1, Math.floor(unit.maxHp * (multiplier / 8)));
    lowerUnitHp(unit, damage);
    state.log.unshift(`${unit.pokemon.displayName} took ${damage} from Stealth Rock.`);
  }

  if (!unit.fainted && side.spikesLayers > 0 && grounded(unit.pokemon, unit.build)) {
    const layerFraction = side.spikesLayers >= 3 ? 0.25 : side.spikesLayers === 2 ? 1 / 6 : 0.125;
    const damage = Math.max(1, Math.floor(unit.maxHp * layerFraction));
    lowerUnitHp(unit, damage);
    state.log.unshift(`${unit.pokemon.displayName} took ${damage} from Spikes.`);
  }
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

function legalMovesForUnit(unit: SimUnit) {
  const allMoves = unit.build.moveIds
    .map((moveId) => findMove(unit, moveId))
    .filter((move): move is PokemonMove => move !== null);

  if (unit.encoreTurns > 0 && unit.encoreMoveId) {
    const encoredMove = allMoves.find((move) => move.id === unit.encoreMoveId);
    if (encoredMove) {
      return unit.tauntTurns > 0 && encoredMove.category === 'Status'
        ? allMoves.filter((move) => move.category !== 'Status')
        : [encoredMove];
    }
  }

  if (unit.tauntTurns > 0) {
    const nonStatusMoves = allMoves.filter((move) => move.category !== 'Status');
    return nonStatusMoves.length ? nonStatusMoves : allMoves;
  }

  return allMoves;
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
  if (priorityMoves.has(move.name)) priority += 1;
  if (move.name === 'Fake Out' && unit.turnsActive === 0) priority += 1;
  return priority;
}

function resolveMoveTarget(state: SimulatorBattleState, defendingSide: SimSide, requestedTarget: number, move: PokemonMove) {
  const directTarget = targetActiveUnit(defendingSide, requestedTarget);
  if (state.format !== 'Doubles') {
    return directTarget;
  }

  if (defendingSide.redirectionUnitIndex === null) {
    return directTarget;
  }

  const redirectTarget = defendingSide.units[defendingSide.redirectionUnitIndex] ?? null;
  if (!redirectTarget || redirectTarget.fainted) {
    return directTarget;
  }

  if (move.name === 'Parting Shot' || move.name === 'Will-O-Wisp' || move.name === 'Thunder Wave' || move.name === 'Taunt' || move.name === 'Encore' || move.name === 'Toxic' || move.name === 'Spore' || move.category !== 'Status') {
    return redirectTarget;
  }

  return directTarget;
}

function maybeInflictStatus(state: SimulatorBattleState, target: SimUnit, status: PokemonBuild['status'], sourceMove: string) {
  if (target.build.status !== 'healthy') {
    return false;
  }

  target.build.status = status;
  if (status === 'sleep') {
    target.sleepTurns = 2;
  }
  if (status === 'toxic') {
    target.toxicCounter = 1;
  }

  state.log.unshift(`${target.pokemon.displayName} was afflicted by ${sourceMove} (${status}).`);
  return true;
}

function resetStageModifiers(state: SimulatorBattleState) {
  for (const side of [state.player, state.opponent]) {
    for (const unit of side.units) {
      unit.build.attackStage = 0;
      unit.build.defenseStage = 0;
      unit.build.specialAttackStage = 0;
      unit.build.specialDefenseStage = 0;
      unit.build.speedStage = 0;
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
  if (move.name === 'Protect') {
    actor.protected = true;
    state.log.unshift(`${actor.pokemon.displayName} protected itself.`);
    return;
  }

  if (healingMoves.has(move.name)) {
    healUnit(actor, Math.round(actor.maxHp * 0.5));
    state.log.unshift(`${actor.pokemon.displayName} recovered health with ${move.name}.`);
    return;
  }

  if (move.name === 'Life Dew') {
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      if (unit && !unit.fainted) {
        healUnit(unit, Math.round(unit.maxHp * 0.25));
      }
    }
    state.log.unshift(`${actor.pokemon.displayName} restored its side with Life Dew.`);
    return;
  }

  if (move.name === 'Tailwind') {
    actingSide.tailwindTurns = 4;
    state.log.unshift(`${actor.pokemon.displayName} set Tailwind for its side.`);
    return;
  }

  if (move.name === 'Trick Room') {
    state.trickRoomTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} twisted the dimensions with Trick Room.`);
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
    defendingSide.reflectTurns = 0;
    defendingSide.lightScreenTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} cleared hazards and screens with Defog.`);
    return;
  }

  if (move.name === 'Rapid Spin') {
    clearSideHazards(actingSide);
    applySingleStage(actor, 'speedStage', 1);
    state.log.unshift(`${actor.pokemon.displayName} cleared its side and boosted Speed with Rapid Spin.`);
    return;
  }

  if (move.name === 'Mortal Spin') {
    clearSideHazards(actingSide);
    if (target) {
      maybeInflictStatus(state, target, 'poison', move.name);
    }
    state.log.unshift(`${actor.pokemon.displayName} spun hazards away with Mortal Spin.`);
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

  if (move.name === 'Will-O-Wisp' && target) {
    maybeInflictStatus(state, target, 'burn', move.name);
    return;
  }

  if (move.name === 'Thunder Wave' && target) {
    maybeInflictStatus(state, target, 'paralysis', move.name);
    return;
  }

  if (move.name === 'Toxic' && target) {
    maybeInflictStatus(state, target, 'toxic', move.name);
    return;
  }

  if (move.name === 'Spore' && target) {
    maybeInflictStatus(state, target, 'sleep', move.name);
    return;
  }

  if (move.name === 'Parting Shot' && target) {
    applySingleStage(target, 'attackStage', -1);
    applySingleStage(target, 'specialAttackStage', -1);
    state.log.unshift(`${actor.pokemon.displayName} softened ${target.pokemon.displayName} with Parting Shot.`);
    return;
  }

  if (move.name === 'Encore' && target) {
    if (target.lastMoveId) {
      target.encoreTurns = 3;
      target.encoreMoveId = target.lastMoveId;
      state.log.unshift(`${actor.pokemon.displayName} encored ${target.pokemon.displayName} into ${findMove(target, target.lastMoveId)?.name ?? 'its last move'}.`);
      return;
    }
  }

  if (move.name === 'Taunt' && target) {
    target.tauntTurns = 3;
    state.log.unshift(`${actor.pokemon.displayName} taunted ${target.pokemon.displayName}.`);
    return;
  }

  if (move.name === 'Haze') {
    resetStageModifiers(state);
    state.log.unshift(`${actor.pokemon.displayName} cleared all stat changes with Haze.`);
    return;
  }

  if (move.name === 'Icy Wind') {
    for (const activeIndex of defendingSide.active) {
      const unit = defendingSide.units[activeIndex];
      if (unit && !unit.fainted) {
        applySingleStage(unit, 'speedStage', -1);
      }
    }
    state.log.unshift(`${actor.pokemon.displayName} slowed the opposing side with Icy Wind.`);
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

function executeDamageMove(
  state: SimulatorBattleState,
  actor: SimUnit,
  target: SimUnit | null,
  move: PokemonMove,
  actingSide: SimSide,
  defendingSide: SimSide,
) {
  if (!target || target.fainted) {
    return;
  }

  if (target.protected) {
    state.log.unshift(`${target.pokemon.displayName} blocked ${move.name} with Protect.`);
    return;
  }

  const result = calculateDamage(currentBuild(actor), currentBuild(target), move, screenAwareEnvironment(state, defendingSide));
  if (!result) {
    state.log.unshift(`${actor.pokemon.displayName} used ${move.name}, but no direct damage line applied.`);
    return;
  }

  let damage = Math.round((result.minDamage + result.maxDamage) / 2);
  if (actor.helpingHand) {
    damage = Math.round(damage * 1.5);
  }

  lowerUnitHp(target, damage);
  state.log.unshift(`${actor.pokemon.displayName} used ${move.name} on ${target.pokemon.displayName} for ${damage} damage.`);

  if (drainingMoves.has(move.name) && damage > 0 && !actor.fainted) {
    healUnit(actor, Math.max(1, Math.round(damage * 0.5)));
    state.log.unshift(`${actor.pokemon.displayName} drained health back.`);
  }

  if (recoilMoves.has(move.name) && damage > 0 && !actor.fainted) {
    const recoil = Math.max(1, Math.round(damage / 3));
    lowerUnitHp(actor, recoil);
    state.log.unshift(`${actor.pokemon.displayName} took ${recoil} recoil from ${move.name}.`);
  }

  if (move.name === 'Fake Out' && target.turnsActive === 0 && !target.fainted) {
    target.flinched = true;
    state.log.unshift(`${target.pokemon.displayName} flinched.`);
  }

  if (move.name === 'Icy Wind' && !target.fainted) {
    applySingleStage(target, 'speedStage', -1);
  }

  actor.helpingHand = false;
}

function processPreMoveStatus(state: SimulatorBattleState, actor: SimUnit) {
  if (actor.build.status === 'sleep') {
    if (actor.sleepTurns > 0) {
      actor.sleepTurns -= 1;
      if (actor.sleepTurns <= 0) {
        actor.build.status = 'healthy';
        state.log.unshift(`${actor.pokemon.displayName} woke up.`);
      } else {
        state.log.unshift(`${actor.pokemon.displayName} is asleep.`);
        return false;
      }
    }
  }

  if (actor.build.status === 'freeze') {
    if (Math.random() < 0.2) {
      actor.build.status = 'healthy';
      state.log.unshift(`${actor.pokemon.displayName} thawed out.`);
    } else {
      state.log.unshift(`${actor.pokemon.displayName} is frozen solid.`);
      return false;
    }
  }

  if (actor.build.status === 'paralysis' && Math.random() < 0.25) {
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
    unit.protected = false;
    unit.flinched = false;
    unit.helpingHand = false;

    if (unit.build.status === 'burn') {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * 0.0625)));
    }

    if (unit.build.status === 'poison') {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * 0.125)));
    }

    if (unit.build.status === 'toxic') {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * (unit.toxicCounter / 16))));
      unit.toxicCounter += 1;
    }

    const item = getItemById(unit.build.itemId);
    if (item?.name === 'Leftovers') {
      healUnit(unit, Math.max(1, Math.round(unit.maxHp * 0.0625)));
    }

    if (!unit.berrySpent && item?.category === 'berry' && unit.currentHp <= unit.maxHp / 2) {
      healUnit(unit, Math.round(unit.maxHp * 0.25));
      unit.berrySpent = true;
    }

    unit.tauntTurns = Math.max(0, unit.tauntTurns - 1);
    unit.encoreTurns = Math.max(0, unit.encoreTurns - 1);
    clearVolatileChoiceLocks(unit);
  }

  side.tailwindTurns = Math.max(0, side.tailwindTurns - 1);
  side.reflectTurns = Math.max(0, side.reflectTurns - 1);
  side.lightScreenTurns = Math.max(0, side.lightScreenTurns - 1);
  side.redirectionUnitIndex = null;
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
    return { type: 'move', actor, moveId: recoveryMove.id, target: actor };
  }

  if (state.turn <= 2 && actingSide.tailwindTurns === 0) {
    const tailwind = legalMoves.find((move) => move.name === 'Tailwind');
    if (tailwind) {
      return { type: 'move', actor, moveId: tailwind.id, target: actor };
    }
  }

  if (state.turn <= 3 && actingSide.reflectTurns === 0) {
    const reflect = legalMoves.find((move) => move.name === 'Reflect');
    if (reflect) {
      return { type: 'move', actor, moveId: reflect.id, target: actor };
    }
  }

  if (state.turn <= 3 && actingSide.lightScreenTurns === 0) {
    const lightScreen = legalMoves.find((move) => move.name === 'Light Screen');
    if (lightScreen) {
      return { type: 'move', actor, moveId: lightScreen.id, target: actor };
    }
  }

  if (state.format === 'Singles' && state.turn <= 3 && !defendingSide.stealthRock) {
    const stealthRock = legalMoves.find((move) => move.name === 'Stealth Rock');
    if (stealthRock) {
      return { type: 'move', actor, moveId: stealthRock.id, target: 0 };
    }
  }

  if (state.format === 'Singles' && state.turn <= 4 && defendingSide.spikesLayers < 2) {
    const spikes = legalMoves.find((move) => move.name === 'Spikes');
    if (spikes) {
      return { type: 'move', actor, moveId: spikes.id, target: 0 };
    }
  }

  if (state.format === 'Doubles' && legalMoves.some((move) => redirectionMoves.has(move.name))) {
    const redirectMove = legalMoves.find((move) => redirectionMoves.has(move.name));
    if (redirectMove && unit.currentHp > unit.maxHp * 0.45 && actingSide.redirectionUnitIndex === null) {
      return { type: 'move', actor, moveId: redirectMove.id, target: actor };
    }
  }

  const setupMove = legalMoves.find((move) => boostMoves.has(move.name));
  if (setupMove && unit.currentHp > unit.maxHp * 0.7) {
    const totalBoosts = unit.build.attackStage + unit.build.specialAttackStage + unit.build.speedStage;
    if (totalBoosts <= 1) {
      return { type: 'move', actor, moveId: setupMove.id, target: actor };
    }
  }

  if (unit.currentHp <= unit.maxHp * 0.25) {
    const protect = legalMoves.find((move) => move.name === 'Protect');
    if (protect) {
      return { type: 'move', actor, moveId: protect.id, target: actor };
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
    return { type: 'move', actor, moveId: best.moveId, target: best.target };
  }

  const firstMove = legalMoves[0];
  return { type: 'move', actor, moveId: firstMove?.id ?? '', target: 0 };
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

  for (const unitIndex of next.player.active) {
    switchInUnit(next, 'player', unitIndex, false);
  }
  for (const unitIndex of next.opponent.active) {
    switchInUnit(next, 'opponent', unitIndex, false);
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
  const normalizedPlayerChoices = playerChoices.map((choice) => normalizeChoiceForUnit(next.player, choice));
  const opponentChoices = generateAiChoices(next, 'opponent').map((choice) => normalizeChoiceForUnit(next.opponent, choice));
  const queued = [
    ...normalizedPlayerChoices.map((choice) => ({ side: 'player' as SideId, choice })),
    ...opponentChoices.map((choice) => ({ side: 'opponent' as SideId, choice })),
  ];

  queued.sort((left, right) => {
    const leftSide = sideForId(next, left.side);
    const rightSide = sideForId(next, right.side);
    const leftUnit = targetActiveUnit(leftSide, left.choice.actor);
    const rightUnit = targetActiveUnit(rightSide, right.choice.actor);
    const leftMove = left.choice.type === 'move' && leftUnit ? findMove(leftUnit, left.choice.moveId) : null;
    const rightMove = right.choice.type === 'move' && rightUnit ? findMove(rightUnit, right.choice.moveId) : null;
    const leftPriority = left.choice.type === 'switch' ? 6 : leftMove && leftUnit ? movePriority(leftMove, leftUnit) : 0;
    const rightPriority = right.choice.type === 'switch' ? 6 : rightMove && rightUnit ? movePriority(rightMove, rightUnit) : 0;

    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, next.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, next.trickRoomTurns) : 0;
    return rightSpeed - leftSpeed;
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
