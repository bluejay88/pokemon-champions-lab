import { calculateDamage, calculateDamageWithOverrides, isSoundMove, moveHasSecondaryEffect, moveMakesContact } from './damage';
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
import type { BattleFormat, DamageResult, EnvironmentState, ItemEntry, PokemonBuild, PokemonEntry, PokemonMove, StatBlock, Team } from '../types';

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
  heldItemId: string | null;
  lastConsumedItemId: string | null;
  movePp: Record<string, number>;
  currentHp: number;
  maxHp: number;
  fainted: boolean;
  protected: boolean;
  turnsActive: number;
  actedThisTurn: boolean;
  flinched: boolean;
  helpingHand: boolean;
  beakBlastPrimed: boolean;
  confusionTurns: number;
  infatuatedBySideId: SideId | null;
  infatuatedByUnitIndex: number | null;
  toxicCounter: number;
  sleepTurns: number;
  sleepSource: 'normal' | 'rest' | null;
  freezeTurns: number;
  tauntTurns: number;
  encoreTurns: number;
  encoreMoveId: string | null;
  disableTurns: number;
  disabledMoveId: string | null;
  tormentActive: boolean;
  throatChopTurns: number;
  healingPreventedTurns: number;
  yawnTurns: number;
  perishSongTurns: number;
  destinyBondActive: boolean;
  lastMoveId: string | null;
  protectStreak: number;
  protectSource: string | null;
  endure: boolean;
  substituteHp: number;
  aquaRing: boolean;
  ingrain: boolean;
  stockpileLevel: number;
  seededBySideId: SideId | null;
  saltCure: boolean;
  syrupTurns: number;
  bindingTurns: number;
  bindingDamageRate: number;
  trappedByMove: string | null;
  escapeBlockedBySideId: SideId | null;
  escapeBlockedByUnitIndex: number | null;
  lockOnTurns: number;
  lockOnTargetSideId: SideId | null;
  lockOnTargetUnitIndex: number | null;
  magnetRiseTurns: number;
  critStageBonus: number;
  abilityOverrideName: string | null;
  abilitySuppressed: boolean;
  typeOverride: string[] | null;
  addedTypes: string[];
  statOverrides: Partial<StatBlock>;
  transformed: boolean;
  transformedMoveIds: string[] | null;
  electrifiedTurns: number;
  imprisonActive: boolean;
  electricBoost: boolean;
  statsRaisedThisTurn: boolean;
  statsLoweredThisTurn: boolean;
  pendingAfterYou: boolean;
  quashedThisTurn: boolean;
  megaEvolved: boolean;
  revealed: boolean;
  damageDealt: number;
  knockouts: number;
  rechargeTurns: number;
  rechargeMoveName: string | null;
  chargingTurns: number;
  chargingMoveId: string | null;
  chargingMoveName: string | null;
  chargingTarget: number | null;
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
  auroraVeilTurns: number;
  safeguardTurns: number;
  stealthRock: boolean;
  spikesLayers: number;
  toxicSpikesLayers: number;
  stickyWeb: boolean;
  redirectionUnitIndex: number | null;
  quickGuardActive: boolean;
  wideGuardActive: boolean;
  wishQueue: WishMarker[];
  healingWishPending: boolean;
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
  weatherTurns: number;
  terrainTurns: number;
  trickRoomTurns: number;
  gravityTurns: number;
  magicRoomTurns: number;
  wonderRoomTurns: number;
  fairyLockTurns: number;
  lastResolvedMoveId: string | null;
  lastResolvedMoveSideId: SideId | null;
  log: string[];
  winner: SideId | null;
}

const priorityMoves = new Set(['Fake Out', 'Bullet Punch', 'Sucker Punch', 'Extreme Speed', 'Aqua Jet', 'Ice Shard']);
const healingMoves = new Set(['Morning Sun', 'Recover', 'Roost', 'Slack Off', 'Moonlight', 'Synthesis', 'Wish', 'Shore Up', 'Soft-Boiled']);
const drainingMoves = new Set([
  'Bitter Blade',
  'Drain Punch',
  'Draining Kiss',
  'Giga Drain',
  'Horn Leech',
  'Leech Life',
  'Matcha Gotcha',
  'Parabolic Charge',
]);
const recoilMoves = new Set(['Brave Bird', 'Double-Edge', 'Flare Blitz', 'Head Smash', 'Volt Tackle', 'Wave Crash', 'Wood Hammer']);
const rechargeMoves = new Set(['Blast Burn', 'Eternabeam', 'Frenzy Plant', 'Giga Impact', 'Hydro Cannon', 'Hyper Beam', 'Meteor Assault', 'Prismatic Laser', 'Roar of Time', 'Rock Wrecker']);
const chargeMoves = new Set(['Meteor Beam', 'Razor Wind', 'Sky Attack', 'Skull Bash', 'Solar Beam', 'Solar Blade']);
const redirectionMoves = new Set(['Follow Me', 'Rage Powder']);
const protectionMoves = new Set(['Protect', 'Detect', "King's Shield", 'Spiky Shield', 'Baneful Bunker']);
const sideProtectionMoves = new Set(['Quick Guard', 'Wide Guard']);
const protectionCounterMoves = new Set([...protectionMoves, ...sideProtectionMoves, 'Ally Switch', 'Endure']);
const protectBypassMoves = new Set(['Feint', 'Phantom Force', 'Tearful Look']);
const allAdjacentFoeMoves = new Set([
  'Blizzard',
  'Breaking Swipe',
  'Burning Jealousy',
  'Cotton Spore',
  'Dazzling Gleam',
  'Electroweb',
  'Heat Wave',
  'Hyper Voice',
  'Icy Wind',
  'Matcha Gotcha',
  'Mortal Spin',
  'Muddy Water',
  'Rock Slide',
  'Snarl',
  'String Shot',
  'Struggle Bug',
  'Swift',
  'Sweet Scent',
]);
const allAdjacentPokemonMoves = new Set([
  'Bulldoze',
  'Discharge',
  'Earthquake',
  'Explosion',
  'Lava Plume',
  'Misty Explosion',
  'Parabolic Charge',
  'Self-Destruct',
  'Sludge Wave',
  'Sparkling Aria',
  'Surf',
]);
const pivotMoves = new Set(['Volt Switch', 'U-turn', 'Flip Turn']);
const allyBoostMoves = new Set(['Howl', 'Coaching']);
const selfDestructMoves = new Set(['Explosion', 'Self-Destruct', 'Misty Explosion', 'Final Gambit']);
const itemStealMoves = new Set(['Covet', 'Thief']);
const sleepTalkBlockedMoves = new Set(['Assist', 'Bide', 'Chatter', 'Copycat', 'Focus Punch', 'Me First', 'Metronome', 'Mimic', 'Mirror Move', 'Nature Power', 'Sketch', 'Sleep Talk', 'Struggle', 'Uproar']);
const aromaVeilProtectedMoves = new Set(['Attract', 'Disable', 'Encore', 'Psychic Noise', 'Taunt', 'Torment']);
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
const statDropShieldAbilities = new Set(['Clear Body', 'Full Metal Body', 'White Smoke']);
const statusMoveShieldAbilities = new Set(['Good as Gold']);
const tauntShieldAbilities = new Set(['Oblivious']);
const flinchShieldAbilities = new Set(['Inner Focus']);
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
const struggleMove = {
  id: 'struggle',
  name: 'Struggle',
  type: 'Normal',
  category: 'Physical',
  power: 50,
  accuracy: null,
  pp: null,
  effectChance: null,
  description: 'Used automatically when no other move can be selected. Hits a random foe and damages the user for one quarter of its max HP.',
} satisfies PokemonMove;

type StageKey =
  | 'attackStage'
  | 'defenseStage'
  | 'specialAttackStage'
  | 'specialDefenseStage'
  | 'speedStage'
  | 'accuracyStage'
  | 'evasionStage';

type MoveScope = 'single' | 'all-opponents' | 'all-adjacent';
type QueuedBattleAction = { side: SideId; choice: SimulatorChoice };

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
  ['First Impression', 2],
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
  if (unit.abilitySuppressed) {
    return null;
  }

  if (unit.abilityOverrideName) {
    return unit.abilityOverrideName;
  }

  return resolveAbility(unit.build, unit.pokemon)?.name ?? null;
}

function randomDuration(min: number, max: number) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function moveIdsForUnit(unit: SimUnit) {
  return unit.transformedMoveIds ?? unit.build.moveIds;
}

function effectiveStatsForUnit(unit: SimUnit) {
  return {
    ...buildStats(unit.pokemon.baseStats, unit.build.evs, unit.build.natureId),
    ...unit.statOverrides,
  } satisfies StatBlock;
}

function itemCanBeRemoved(item: ItemEntry | null) {
  if (!item) {
    return false;
  }

  return item.category !== 'mega-stone';
}

function activeItemForUnit(state: SimulatorBattleState, unit: SimUnit): ItemEntry | null {
  const item = getItemById(unit.heldItemId);
  if (!item) {
    return null;
  }

  if (state.magicRoomTurns > 0 && item.category !== 'mega-stone') {
    return null;
  }

  return item;
}

function applyTriggeredAbilityResponse(
  state: SimulatorBattleState,
  actor: SimUnit,
  target: SimUnit,
  move: PokemonMove,
  moveType: string,
) {
  const ability = abilityNameForUnit(target);
  if (!ability) {
    return false;
  }

  const targetTypes = typeListForUnit(state, target);
  const logKickIn = (detail: string) => {
    state.log.unshift(`${target.pokemon.displayName}'s ability ${ability} kicks in and ${detail}.`);
  };

  switch (ability) {
    case 'Lightning Rod':
      if (moveType === 'Electric') {
        applySingleStage(target, 'specialAttackStage', 1);
        logKickIn('absorbs the Electric attack and spikes its Special Attack');
        return true;
      }
      break;
    case 'Storm Drain':
      if (moveType === 'Water') {
        applySingleStage(target, 'specialAttackStage', 1);
        logKickIn('pulls in the Water attack and boosts its Special Attack');
        return true;
      }
      break;
    case 'Motor Drive':
      if (moveType === 'Electric') {
        applySingleStage(target, 'speedStage', 1);
        logKickIn('turns the Electric attack into a Speed boost');
        return true;
      }
      break;
    case 'Sap Sipper':
      if (moveType === 'Grass') {
        applySingleStage(target, 'attackStage', 1);
        logKickIn('drinks up the Grass attack and boosts its Attack');
        return true;
      }
      break;
    case 'Well-Baked Body':
      if (moveType === 'Fire') {
        applySingleStage(target, 'defenseStage', 2);
        logKickIn('shrugs off the Fire attack and sharply boosts its Defense');
        return true;
      }
      break;
    case 'Volt Absorb':
      if (moveType === 'Electric') {
        tryHealUnit(state, target, Math.max(1, Math.floor(target.maxHp / 4)), ability);
        logKickIn('soaks up the Electric attack and recovers health');
        return true;
      }
      break;
    case 'Water Absorb':
      if (moveType === 'Water') {
        tryHealUnit(state, target, Math.max(1, Math.floor(target.maxHp / 4)), ability);
        logKickIn('soaks up the Water attack and recovers health');
        return true;
      }
      break;
    case 'Dry Skin':
      if (moveType === 'Water') {
        tryHealUnit(state, target, Math.max(1, Math.floor(target.maxHp / 4)), ability);
        logKickIn('absorbs the Water attack and restores health');
        return true;
      }
      break;
    case 'Earth Eater':
      if (moveType === 'Ground') {
        tryHealUnit(state, target, Math.max(1, Math.floor(target.maxHp / 4)), ability);
        logKickIn('devours the Ground attack and restores health');
        return true;
      }
      break;
    case 'Flash Fire':
      if (moveType === 'Fire') {
        logKickIn('blanks the Fire attack completely');
        return true;
      }
      break;
    case 'Levitate':
      if (moveType === 'Ground') {
        logKickIn('keeps it floating safely above the Ground attack');
        return true;
      }
      break;
    case 'Soundproof':
      if (isSoundMove(move)) {
        logKickIn('shuts out the sound-based attack');
        return true;
      }
      break;
    case 'Wonder Guard':
      if (typeEffectiveness(moveType, targetTypes) <= 1) {
        logKickIn('nullifies the attack because it is not super effective');
        return true;
      }
      break;
    default:
      break;
  }

  return false;
}

function findMove(unit: SimUnit, moveId: string) {
  if (moveId === struggleMove.id) {
    return struggleMove;
  }
  return unit.pokemon.movePool.find((move) => move.id === moveId) ?? null;
}

function currentMovePp(unit: SimUnit, moveId: string) {
  const move = findMove(unit, moveId);
  if (!move) {
    return 0;
  }

  return unit.movePp[moveId] ?? move.pp ?? 0;
}

function setMovePp(unit: SimUnit, moveId: string, value: number) {
  unit.movePp[moveId] = Math.max(0, value);
}

function spendMovePp(unit: SimUnit, moveId: string, amount = 1) {
  if (moveId === struggleMove.id) {
    return;
  }

  setMovePp(unit, moveId, currentMovePp(unit, moveId) - amount);
}

function clearChargeState(unit: SimUnit) {
  unit.chargingTurns = 0;
  unit.chargingMoveId = null;
  unit.chargingMoveName = null;
  unit.chargingTarget = null;
}

function virtualSunlightForMove(state: SimulatorBattleState, unit: SimUnit, move: PokemonMove | null = null) {
  if (state.environment.weather === 'sun') {
    return true;
  }

  if (!move) {
    return abilityNameForUnit(unit) === 'Mega Sol';
  }

  return abilityNameForUnit(unit) === 'Mega Sol';
}

function chargeBypassReason(state: SimulatorBattleState, actor: SimUnit, move: PokemonMove) {
  if ((move.name === 'Solar Beam' || move.name === 'Solar Blade') && virtualSunlightForMove(state, actor, move)) {
    return 'sunlight';
  }

  const item = activeItemForUnit(state, actor);
  if (item?.name === 'Power Herb' && chargeMoves.has(move.name)) {
    return item.name;
  }

  return null;
}

function applyChargeStartEffects(state: SimulatorBattleState, actor: SimUnit, move: PokemonMove) {
  if (move.name === 'Meteor Beam') {
    applySingleStage(actor, 'specialAttackStage', 1);
    state.log.unshift(`${actor.pokemon.displayName}'s Meteor Beam raised its Sp. Atk.`);
  }

  if (move.name === 'Skull Bash') {
    applySingleStage(actor, 'defenseStage', 1);
    state.log.unshift(`${actor.pokemon.displayName}'s Skull Bash raised its Defense.`);
  }
}

function startChargingMove(state: SimulatorBattleState, actor: SimUnit, move: PokemonMove, target: number) {
  actor.chargingTurns = 1;
  actor.chargingMoveId = move.id;
  actor.chargingMoveName = move.name;
  actor.chargingTarget = target;
  applyChargeStartEffects(state, actor, move);
  state.log.unshift(`${actor.pokemon.displayName} began charging ${move.name}.`);
}

function currentBuild(unit: SimUnit) {
  return {
    ...unit.build,
    useMega: unit.megaEvolved,
    itemId: unit.heldItemId,
    currentHpPercent: Math.max(1, Math.round((unit.currentHp / unit.maxHp) * 100)),
  };
}

function combatSpeed(unit: SimUnit, tailwindTurns: number, trickRoomTurns: number) {
  const stats = effectiveStatsForUnit(unit);
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

  if (allAdjacentFoeMoves.has(move.name) || /\btargets\b/i.test(move.description)) {
    return 'all-opponents';
  }

  return 'single';
}

function unitGroundedInState(state: SimulatorBattleState, unit: SimUnit) {
  if (state.gravityTurns > 0) {
    return true;
  }

  if (unit.magnetRiseTurns > 0) {
    return false;
  }

  return !typeListForUnit(state, unit).includes('Flying') && abilityNameForUnit(unit) !== 'Levitate';
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

function drainFractionForMove(moveName: string) {
  if (moveName === 'Draining Kiss') {
    return 0.75;
  }

  return 0.5;
}

function typeListForUnit(state: SimulatorBattleState, unit: SimUnit) {
  if (unit.typeOverride?.length) {
    return [...unit.typeOverride];
  }

  const baseTypes = effectiveTypes(unit.pokemon, currentBuild(unit), state.environment.weather);
  if (!unit.addedTypes.length) {
    return baseTypes;
  }

  return [...new Set([...baseTypes, ...unit.addedTypes])];
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
    heldItemId: build.itemId,
    lastConsumedItemId: null,
    movePp: Object.fromEntries(
      normalizeMoveSelection(build, basePokemon)
        .map((moveId) => {
          const move = basePokemon.movePool.find((entry) => entry.id === moveId);
          return [moveId, move?.pp ?? 0];
        }),
    ),
    currentHp: stats.hp,
    maxHp: stats.hp,
    fainted: false,
    protected: false,
    turnsActive: 0,
    actedThisTurn: false,
    flinched: false,
    helpingHand: false,
    beakBlastPrimed: false,
    confusionTurns: 0,
    infatuatedBySideId: null,
    infatuatedByUnitIndex: null,
    toxicCounter: 1,
    sleepTurns: 0,
    freezeTurns: 0,
    tauntTurns: 0,
    encoreTurns: 0,
    encoreMoveId: null,
    disableTurns: 0,
    disabledMoveId: null,
    throatChopTurns: 0,
    healingPreventedTurns: 0,
    yawnTurns: 0,
    perishSongTurns: 0,
    destinyBondActive: false,
    lastMoveId: null,
    protectStreak: 0,
    protectSource: null,
    endure: false,
    substituteHp: 0,
    aquaRing: false,
    ingrain: false,
    stockpileLevel: 0,
    seededBySideId: null,
    saltCure: false,
    syrupTurns: 0,
    bindingTurns: 0,
    bindingDamageRate: 0,
    trappedByMove: null,
    escapeBlockedBySideId: null,
    escapeBlockedByUnitIndex: null,
    lockOnTurns: 0,
    lockOnTargetSideId: null,
    lockOnTargetUnitIndex: null,
    magnetRiseTurns: 0,
    critStageBonus: 0,
    abilityOverrideName: null,
    abilitySuppressed: false,
    typeOverride: null,
    addedTypes: [],
    statOverrides: {},
    transformed: false,
    transformedMoveIds: null,
    electrifiedTurns: 0,
    imprisonActive: false,
    electricBoost: false,
    statsRaisedThisTurn: false,
    statsLoweredThisTurn: false,
    pendingAfterYou: false,
    quashedThisTurn: false,
    megaEvolved: false,
    sleepSource: null,
    tormentActive: false,
    revealed: false,
    damageDealt: 0,
    knockouts: 0,
    rechargeTurns: 0,
    rechargeMoveName: null,
    chargingTurns: 0,
    chargingMoveId: null,
    chargingMoveName: null,
    chargingTarget: null,
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
    auroraVeilTurns: 0,
    safeguardTurns: 0,
    stealthRock: false,
    spikesLayers: 0,
    toxicSpikesLayers: 0,
    stickyWeb: false,
    redirectionUnitIndex: null,
    quickGuardActive: false,
    wideGuardActive: false,
    wishQueue: [],
    healingWishPending: false,
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

function livingActiveTargets(side: SimSide) {
  return side.active
    .map((unitIndex, activeSlot) => ({ unitIndex, activeSlot, unit: typeof unitIndex === 'number' ? side.units[unitIndex] ?? null : null }))
    .filter((entry): entry is { unitIndex: number; activeSlot: number; unit: SimUnit } => Boolean(entry.unit && !entry.unit.fainted));
}

function firstAvailableBench(side: SimSide) {
  return side.bench.find((unitIndex) => unitIndex >= 0 && !side.units[unitIndex]?.fainted) ?? null;
}

function livingBenchTargets(side: SimSide) {
  return side.bench.filter((unitIndex) => unitIndex >= 0 && !side.units[unitIndex]?.fainted);
}

function pendingReplacementActorsForSide(side: SimSide) {
  const livingBench = livingBenchTargets(side);
  if (!livingBench.length) {
    return [];
  }

  return side.active.flatMap((unitIndex, activeSlot) => {
    const unit = typeof unitIndex === 'number' && unitIndex >= 0 ? side.units[unitIndex] ?? null : null;
    return !unit || unit.fainted ? [activeSlot] : [];
  });
}

export function pendingReplacementActors(side: SimSide) {
  return pendingReplacementActorsForSide(side);
}

export function battleHasPendingReplacements(state: SimulatorBattleState) {
  return pendingReplacementActorsForSide(state.player).length > 0 || pendingReplacementActorsForSide(state.opponent).length > 0;
}

function canUnitSwitchOut(state: SimulatorBattleState, unit: SimUnit) {
  if (unit.escapeBlockedBySideId && unit.escapeBlockedByUnitIndex !== null) {
    const sourceSide = sideForId(state, unit.escapeBlockedBySideId);
    const sourceUnit = sourceSide.units[unit.escapeBlockedByUnitIndex] ?? null;
    const sourceStillActive = Boolean(
      sourceUnit &&
      !sourceUnit.fainted &&
      sourceSide.active.includes(unit.escapeBlockedByUnitIndex),
    );
    if (!sourceStillActive) {
      unit.escapeBlockedBySideId = null;
      unit.escapeBlockedByUnitIndex = null;
    }
  }

  const fairyLocked = state.fairyLockTurns > 0;
  const directlyTrapped = unit.escapeBlockedBySideId !== null && unit.escapeBlockedByUnitIndex !== null;
  return !fairyLocked && !directlyTrapped && !unit.trappedByMove && unit.bindingTurns <= 0 && unit.rechargeTurns <= 0 && unit.chargingTurns <= 0;
}

function unitAbilitiesMatch(unit: SimUnit, names: Set<string>) {
  const ability = abilityNameForUnit(unit);
  return ability ? names.has(ability) : false;
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

function tryHealUnit(state: SimulatorBattleState, unit: SimUnit, amount: number, source: string) {
  if (unit.healingPreventedTurns > 0) {
    state.log.unshift(`${unit.pokemon.displayName} could not recover HP from ${source} because healing is blocked by Psychic Noise.`);
    return false;
  }

  healUnit(unit, amount);
  return true;
}

function triggerFlinch(state: SimulatorBattleState, target: SimUnit, move: PokemonMove, chance: number) {
  if (
    target.fainted ||
    target.actedThisTurn ||
    unitAbilitiesMatch(target, flinchShieldAbilities) ||
    abilityNameForUnit(target) === 'Shield Dust'
  ) {
    return false;
  }
  if (!chanceRoll(chance)) {
    return false;
  }
  target.flinched = true;
  state.log.unshift(`${target.pokemon.displayName} flinched because of ${move.name}.`);
  return true;
}

function secondaryEffectsSuppressedByAbility(actor: SimUnit, move: PokemonMove) {
  return abilityNameForUnit(actor) === 'Sheer Force' && move.category !== 'Status' && moveHasSecondaryEffect(move);
}

function protectedByAromaVeil(state: SimulatorBattleState, target: SimUnit) {
  const side = sideForId(state, unitSideId(state, target));
  return side.active.some((unitIndex) => {
    const ally = side.units[unitIndex];
    return Boolean(ally && !ally.fainted && abilityNameForUnit(ally) === 'Aroma Veil');
  });
}

function modifiedStageDelta(unit: SimUnit, delta: number) {
  let adjusted = delta;
  const ability = abilityNameForUnit(unit);
  if (ability === 'Contrary') {
    adjusted *= -1;
  }
  if (ability === 'Simple') {
    adjusted *= 2;
  }
  return adjusted;
}

function applyStageDeltaRaw(unit: SimUnit, stageKey: StageKey, delta: number) {
  const before = unit.build[stageKey];
  const after = Math.max(-6, Math.min(6, before + delta));
  const actualDelta = after - before;
  unit.build[stageKey] = after;
  if (actualDelta > 0) {
    unit.statsRaisedThisTurn = true;
  }
  if (actualDelta < 0) {
    unit.statsLoweredThisTurn = true;
  }
  return actualDelta;
}

function applyBoosts(unit: SimUnit, boosts: Partial<Record<StageKey, number>>) {
  for (const [key, value] of Object.entries(boosts)) {
    const stageKey = key as StageKey;
    const delta = modifiedStageDelta(unit, Number(value ?? 0));
    applyStageDeltaRaw(unit, stageKey, delta);
  }
}

function applySingleStage(unit: SimUnit, stageKey: StageKey, delta: number) {
  return applyStageDeltaRaw(unit, stageKey, modifiedStageDelta(unit, delta));
}

function applyReactiveDropAbilities(state: SimulatorBattleState, target: SimUnit, cause: string) {
  const ability = abilityNameForUnit(target);
  if (ability === 'Defiant') {
    applyStageDeltaRaw(target, 'attackStage', modifiedStageDelta(target, 2));
    state.log.unshift(`${target.pokemon.displayName} answered ${cause} with Defiant.`);
  }
  if (ability === 'Competitive') {
    applyStageDeltaRaw(target, 'specialAttackStage', modifiedStageDelta(target, 2));
    state.log.unshift(`${target.pokemon.displayName} answered ${cause} with Competitive.`);
  }
}

function applyStageChangesFromSource(
  state: SimulatorBattleState,
  source: SimUnit | null,
  target: SimUnit,
  boosts: Partial<Record<StageKey, number>>,
  cause: string,
  options: { treatAsOpposing?: boolean; allowMirrorArmor?: boolean } = {},
) {
  const sourceIsOpponent = options.treatAsOpposing ?? (source ? unitSideId(state, source) !== unitSideId(state, target) : false);
  const targetAbility = abilityNameForUnit(target);
  let changed = false;
  let loweredByOpponent = false;
  let blockedDrop = false;
  const reflectedBoosts: Partial<Record<StageKey, number>> = {};

  for (const [key, value] of Object.entries(boosts)) {
    const stageKey = key as StageKey;
    const rawDelta = Number(value ?? 0);
    if (!rawDelta) {
      continue;
    }

    if (sourceIsOpponent && rawDelta < 0) {
      if ((stageKey !== 'accuracyStage' && stageKey !== 'evasionStage') && statDropShieldAbilities.has(targetAbility ?? '')) {
        blockedDrop = true;
        continue;
      }
      if (targetAbility === 'Mirror Armor' && options.allowMirrorArmor !== false && source) {
        reflectedBoosts[stageKey] = (reflectedBoosts[stageKey] ?? 0) + rawDelta;
        continue;
      }
    }

    const actualDelta = applyStageDeltaRaw(target, stageKey, modifiedStageDelta(target, rawDelta));
    if (actualDelta !== 0) {
      changed = true;
    }
    if (sourceIsOpponent && actualDelta < 0) {
      loweredByOpponent = true;
    }
  }

  if (blockedDrop) {
    state.log.unshift(`${target.pokemon.displayName} ignored ${cause} because ${targetAbility} blocks opposing stat drops.`);
  }

  if (Object.keys(reflectedBoosts).length && source) {
    state.log.unshift(`${target.pokemon.displayName} reflected ${cause} back with Mirror Armor.`);
    applyStageChangesFromSource(state, target, source, reflectedBoosts, `${cause} (reflected)`, {
      treatAsOpposing: true,
      allowMirrorArmor: false,
    });
  }

  if (loweredByOpponent) {
    applyReactiveDropAbilities(state, target, cause);
  }

  return changed;
}

function clearSideHazards(side: SimSide) {
  side.stealthRock = false;
  side.spikesLayers = 0;
  side.toxicSpikesLayers = 0;
  side.stickyWeb = false;
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
  unit.beakBlastPrimed = false;
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

  return getItemById(unit.heldItemId)?.category === 'mega-stone';
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
  if (!unit.heldItemId || unit.build.status === 'healthy') {
    return false;
  }

  const item = activeItemForUnit(state, unit);
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
  unit.sleepSource = null;
  unit.freezeTurns = 0;
  unit.lastConsumedItemId = unit.heldItemId;
  unit.heldItemId = null;
  state.log.unshift(`${unit.pokemon.displayName} cured its ${clearedStatus} with ${item.name}.`);
  return true;
}

function maybeTriggerHealingBerry(state: SimulatorBattleState, unit: SimUnit) {
  if (!unit.heldItemId || unit.fainted || unit.currentHp > unit.maxHp / 2) {
    return false;
  }

  const item = getItemById(unit.heldItemId);
  if (!item) {
    return false;
  }

  const berryValue = healingBerries.get(item.name);
  if (!berryValue) {
    return false;
  }

  const heal = berryValue < 1 ? healAmount(unit, berryValue) : berryValue;
  if (!tryHealUnit(state, unit, heal, item.name)) {
    return false;
  }
  unit.lastConsumedItemId = unit.heldItemId;
  unit.heldItemId = null;
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

  const targetSideId = unitSideId(state, target);
  const targetUnitIndex = sideForUnit(state, target).units.indexOf(target);
  if (
    actor.lockOnTurns > 0 &&
    actor.lockOnTargetSideId === targetSideId &&
    actor.lockOnTargetUnitIndex === targetUnitIndex
  ) {
    return true;
  }

  if (move.name === 'Toxic' && typeListForUnit(state, actor).includes('Poison')) {
    return true;
  }

  if (move.name === 'Blizzard' && state.environment.weather === 'snow') {
    return true;
  }

  if ((move.name === 'Thunder' || move.name === 'Hurricane') && state.environment.weather === 'rain') {
    return true;
  }

  let accuracy = move.accuracy;
  if ((move.name === 'Thunder' || move.name === 'Hurricane') && state.environment.weather === 'sun') {
    accuracy = 50;
  }
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
    if (applyStageChangesFromSource(state, target, attacker, { attackStage: -1 }, "King's Shield")) {
      state.log.unshift(`${attacker.pokemon.displayName}'s Attack fell after contacting King's Shield.`);
    }
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

function clearFaintedActiveSlots(side: SimSide) {
  for (let index = 0; index < side.active.length; index += 1) {
    const unitIndex = side.active[index];
    const unit = typeof unitIndex === 'number' && unitIndex >= 0 ? side.units[unitIndex] ?? null : null;
    if (!unit || unit.fainted) {
      side.active[index] = -1;
    }
  }

  side.bench = side.bench.filter((entry) => entry >= 0 && !side.units[entry]?.fainted && !side.active.includes(entry));
  if (
    side.redirectionUnitIndex !== null
    && (!side.units[side.redirectionUnitIndex] || side.units[side.redirectionUnitIndex].fainted || !side.active.includes(side.redirectionUnitIndex))
  ) {
    side.redirectionUnitIndex = null;
  }
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
    battleFormat: state.format,
    gravity: state.gravityTurns > 0,
    magicRoom: state.magicRoomTurns > 0,
    wonderRoom: state.wonderRoomTurns > 0,
    helpingHand: false,
    reflect: defendingSide.reflectTurns > 0,
    lightScreen: defendingSide.lightScreenTurns > 0,
    auroraVeil: defendingSide.auroraVeilTurns > 0,
  };
}

function switchOutUnit(side: SimSide, unitIndex: number) {
  const unit = side.units[unitIndex];
  if (!unit) {
    return;
  }
  const wasTransformed = unit.transformed;

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
  unit.saltCure = false;
  unit.syrupTurns = 0;
  unit.bindingTurns = 0;
  unit.bindingDamageRate = 0;
  unit.trappedByMove = null;
  unit.electricBoost = false;
  unit.tauntTurns = 0;
  unit.encoreTurns = 0;
  unit.encoreMoveId = null;
  unit.disableTurns = 0;
  unit.disabledMoveId = null;
  unit.throatChopTurns = 0;
  unit.healingPreventedTurns = 0;
  unit.tormentActive = false;
  unit.yawnTurns = 0;
  unit.perishSongTurns = 0;
  unit.destinyBondActive = false;
  unit.rechargeTurns = 0;
  unit.rechargeMoveName = null;
  clearChargeState(unit);
  unit.confusionTurns = 0;
  unit.infatuatedBySideId = null;
  unit.infatuatedByUnitIndex = null;
  unit.lockOnTurns = 0;
  unit.lockOnTargetSideId = null;
  unit.lockOnTargetUnitIndex = null;
  unit.magnetRiseTurns = 0;
  unit.typeOverride = null;
  unit.addedTypes = [];
  unit.statOverrides = {};
  unit.substituteHp = 0;
  unit.escapeBlockedBySideId = null;
  unit.escapeBlockedByUnitIndex = null;
  unit.electrifiedTurns = 0;
  unit.imprisonActive = false;
  unit.transformed = false;
  unit.transformedMoveIds = null;
  unit.stockpileLevel = 0;
  unit.critStageBonus = 0;
  unit.abilitySuppressed = false;
  unit.pokemon = unit.megaEvolved ? (unit.megaPokemon ?? unit.basePokemon) : unit.basePokemon;
  if (wasTransformed) {
    unit.movePp = Object.fromEntries(
      moveIdsForUnit(unit).map((moveId) => {
        const move = findMove(unit, moveId);
        return [moveId, move?.pp ?? 0];
      }),
    );
  }
}

function applyEntryHazards(state: SimulatorBattleState, side: SimSide, unit: SimUnit) {
  const effectiveTypeSet = effectiveTypes(unit.pokemon, unit.build, state.environment.weather);
  const groundedTarget = unitGroundedInState(state, unit);
  if (side.stealthRock) {
    const multiplier = typeEffectiveness('Rock', effectiveTypeSet);
    const damage = Math.max(1, Math.floor(unit.maxHp * (multiplier / 8)));
    lowerUnitHp(unit, damage);
    state.log.unshift(`${unit.pokemon.displayName} took ${damage} from Stealth Rock.`);
  }

  if (!unit.fainted && side.spikesLayers > 0 && groundedTarget) {
    const layerFraction = side.spikesLayers >= 3 ? 0.25 : side.spikesLayers === 2 ? 1 / 6 : 0.125;
    const damage = Math.max(1, Math.floor(unit.maxHp * layerFraction));
    lowerUnitHp(unit, damage);
    state.log.unshift(`${unit.pokemon.displayName} took ${damage} from Spikes.`);
  }

  if (!unit.fainted && side.stickyWeb && groundedTarget) {
    if (applyStageChangesFromSource(state, null, unit, { speedStage: -1 }, 'Sticky Web', { treatAsOpposing: true })) {
      state.log.unshift(`${unit.pokemon.displayName} was slowed by Sticky Web.`);
    }
  }

  if (!unit.fainted && side.toxicSpikesLayers > 0 && groundedTarget) {
    if (effectiveTypeSet.includes('Poison')) {
      side.toxicSpikesLayers = 0;
      state.log.unshift(`${unit.pokemon.displayName} absorbed the Toxic Spikes.`);
    } else if (!effectiveTypeSet.includes('Steel')) {
      maybeInflictStatus(state, null, unit, side.toxicSpikesLayers >= 2 ? 'toxic' : 'poison', 'Toxic Spikes');
    }
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
    state.weatherTurns = 5;
    state.log.unshift(`${unit.pokemon.displayName} set ${weather} with ${ability}.`);
  }

  const terrain = terrainAbilities.get(ability);
  if (terrain) {
    state.environment.terrain = terrain;
    state.terrainTurns = 5;
    state.log.unshift(`${unit.pokemon.displayName} set ${terrain} terrain with ${ability}.`);
  }

  if (ability === 'Intimidate') {
    let intimidatedAnyTarget = false;
    for (const activeIndex of defendingSide.active) {
      const target = defendingSide.units[activeIndex];
      if (!target || target.fainted) {
        continue;
      }
      if (unitAbilitiesMatch(target, flinchShieldAbilities)) {
        state.log.unshift(`${target.pokemon.displayName} stood firm against Intimidate with Inner Focus.`);
        continue;
      }
      intimidatedAnyTarget = applyStageChangesFromSource(state, unit, target, { attackStage: -1 }, 'Intimidate') || intimidatedAnyTarget;
    }
    if (intimidatedAnyTarget) {
      state.log.unshift(`${unit.pokemon.displayName} lowered the opposing side's Attack with Intimidate.`);
    }
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

  unit.revealed = true;

  if (announce) {
    state.log.unshift(`${actingSide.name} sent out ${unit.pokemon.displayName}.`);
  }

  applyEntryHazards(state, actingSide, unit);
  if (unit.fainted) {
    state.log.unshift(`${unit.pokemon.displayName} fainted on entry.`);
    return;
  }

  if (actingSide.healingWishPending) {
    unit.currentHp = unit.maxHp;
    unit.build.status = 'healthy';
    unit.toxicCounter = 1;
    unit.sleepTurns = 0;
    unit.sleepSource = null;
    unit.freezeTurns = 0;
    actingSide.healingWishPending = false;
    state.log.unshift(`${unit.pokemon.displayName} was restored by Healing Wish on entry.`);
  }

  applySwitchInAbility(state, sideId, unit);
}

function forceSwitchTarget(state: SimulatorBattleState, targetRef: TargetRef, reason: string) {
  const replacement = firstAvailableBench(targetRef.side);
  if (replacement === null || targetRef.activeSlot < 0) {
    state.log.unshift(`${targetRef.unit.pokemon.displayName} had no bench replacement for ${reason}.`);
    return false;
  }

  switchOutUnit(targetRef.side, targetRef.unitIndex);
  targetRef.side.active[targetRef.activeSlot] = replacement;
  targetRef.side.bench = [...targetRef.side.bench.filter((entry) => entry !== replacement), targetRef.unitIndex];
  targetRef.side.units[replacement].turnsActive = 0;
  state.log.unshift(`${targetRef.unit.pokemon.displayName} was forced out by ${reason}.`);
  switchInUnit(state, targetRef.sideId, replacement, true);
  return true;
}

function normalizeReplacementChoicesForSide(state: SimulatorBattleState, sideId: SideId, choices: SimulatorChoice[]) {
  const side = sideForId(state, sideId);
  const pendingActors = pendingReplacementActorsForSide(side);
  const livingBench = livingBenchTargets(side);
  const usedTargets = new Set<number>();
  const normalized: Extract<SimulatorChoice, { type: 'switch' }>[] = [];

  for (const actor of pendingActors) {
    const submitted = choices.find((choice) => choice.type === 'switch' && choice.actor === actor);
    const preferredTarget = submitted?.target ?? null;
    const resolvedTarget =
      typeof preferredTarget === 'number' && livingBench.includes(preferredTarget) && !usedTargets.has(preferredTarget)
        ? preferredTarget
        : livingBench.find((unitIndex) => !usedTargets.has(unitIndex)) ?? null;
    if (resolvedTarget === null) {
      continue;
    }

    usedTargets.add(resolvedTarget);
    normalized.push({
      type: 'switch',
      actor,
      target: resolvedTarget,
    });
  }

  return normalized;
}

function applyReplacementChoice(state: SimulatorBattleState, sideId: SideId, actor: number, targetIndex: number) {
  const actingSide = sideForId(state, sideId);
  const replacement = actingSide.units[targetIndex] ?? null;
  if (!replacement || replacement.fainted || !actingSide.bench.includes(targetIndex)) {
    return;
  }

  actingSide.active[actor] = targetIndex;
  actingSide.bench = actingSide.bench.filter((entry) => entry !== targetIndex);
  replacement.turnsActive = 0;
  switchInUnit(state, sideId, targetIndex, true);
  clearFaintedActiveSlots(actingSide);
}

export function buildAutoReplacementChoices(state: SimulatorBattleState, sideId: SideId) {
  return normalizeReplacementChoicesForSide(state, sideId, []);
}

export function applyReplacementChoices(
  state: SimulatorBattleState,
  playerChoices: SimulatorChoice[],
  opponentChoices: SimulatorChoice[],
) {
  const next = structuredClone(state) as SimulatorBattleState;
  const normalizedPlayerChoices = normalizeReplacementChoicesForSide(next, 'player', playerChoices);
  const normalizedOpponentChoices = normalizeReplacementChoicesForSide(next, 'opponent', opponentChoices);
  const queued = [
    ...normalizedPlayerChoices.map((choice) => ({ sideId: 'player' as SideId, choice })),
    ...normalizedOpponentChoices.map((choice) => ({ sideId: 'opponent' as SideId, choice })),
  ];

  queued.sort((left, right) => {
    const leftSide = sideForId(next, left.sideId);
    const rightSide = sideForId(next, right.sideId);
    const leftUnit = leftSide.units[left.choice.target] ?? null;
    const rightUnit = rightSide.units[right.choice.target] ?? null;
    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, next.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, next.trickRoomTurns) : 0;
    return compareActionSpeed(leftSpeed, rightSpeed);
  });

  for (const queuedChoice of queued) {
    applyReplacementChoice(next, queuedChoice.sideId, queuedChoice.choice.actor, queuedChoice.choice.target);
  }

  clearFaintedActiveSlots(next.player);
  clearFaintedActiveSlots(next.opponent);
  updateWinner(next);
  if (!next.winner && queued.length) {
    next.log.unshift(`Turn ${next.turn} replacement send-outs are complete. Choose moves for the new board.`);
  }
  return next;
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

function moveBlockedByImprison(state: SimulatorBattleState | undefined, sideId: SideId | undefined, unit: SimUnit, moveId: string) {
  if (!state || !sideId) {
    return false;
  }

  const opposing = opposingSide(state, sideId);
  return opposing.active.some((unitIndex) => {
    const target = opposing.units[unitIndex];
    return Boolean(target && !target.fainted && target.imprisonActive && moveIdsForUnit(target).includes(moveId) && target !== unit);
  });
}

export function legalMovesForUnit(unit: SimUnit, state?: SimulatorBattleState, sideId?: SideId) {
  if (unit.rechargeTurns > 0 || unit.chargingTurns > 0) {
    return [];
  }

  const fullMoveList = moveIdsForUnit(unit)
    .map((moveId) => findMove(unit, moveId))
    .filter((move): move is PokemonMove => move !== null)
    .filter((move) => (unit.movePp[move.id] ?? move.pp ?? 0) > 0 || move.id === struggleMove.id);
  let allMoves =
    unit.disableTurns > 0 && unit.disabledMoveId
      ? fullMoveList.filter((move) => move.id !== unit.disabledMoveId)
      : fullMoveList;

  if (unit.tormentActive && unit.lastMoveId) {
    allMoves = allMoves.filter((move) => move.id !== unit.lastMoveId);
  }

  if (unit.encoreTurns > 0 && unit.encoreMoveId) {
    const encoredMove = fullMoveList.find((move) => move.id === unit.encoreMoveId);
    if (encoredMove) {
      if (
        (unit.disableTurns > 0 && unit.disabledMoveId === encoredMove.id) ||
        (unit.tormentActive && unit.lastMoveId === encoredMove.id) ||
        (unit.throatChopTurns > 0 && isSoundMove(encoredMove))
      ) {
        return [struggleMove];
      }
      return unit.tauntTurns > 0 && encoredMove.category === 'Status'
        ? (allMoves.filter((move) => move.category !== 'Status').length ? allMoves.filter((move) => move.category !== 'Status') : [struggleMove])
        : [encoredMove];
    }
  }

  if (unit.tauntTurns > 0) {
    const nonStatusMoves = allMoves.filter((move) => move.category !== 'Status');
    allMoves = nonStatusMoves.length ? nonStatusMoves : [struggleMove];
  }

  allMoves = allMoves.filter((move) => !moveBlockedByImprison(state, sideId, unit, move.id));
  allMoves = allMoves.filter((move) => !(unit.throatChopTurns > 0 && isSoundMove(move)));

  return allMoves.length ? allMoves : [struggleMove];
}

function normalizeChoiceForUnit(side: SimSide, choice: SimulatorChoice, state?: SimulatorBattleState, sideId?: SideId): SimulatorChoice {
  if (choice.type === 'switch') {
    return choice;
  }

  const unit = targetActiveUnit(side, choice.actor);
  if (!unit) {
    return choice;
  }

  const legalMoves = legalMovesForUnit(unit, state, sideId);
  const chosenMove = legalMoves.find((move) => move.id === choice.moveId) ?? legalMoves[0] ?? null;
  if (!chosenMove) {
    return choice;
  }

  return {
    ...choice,
    moveId: chosenMove.id,
  };
}

function movePriority(move: PokemonMove, unit: SimUnit, state?: SimulatorBattleState) {
  let priority = stagePriority(move);
  const ability = abilityNameForUnit(unit);
  if (ability === 'Prankster' && move.category === 'Status') {
    priority += 1;
  }
  if (ability === 'Triage' && (healingMoves.has(move.name) || drainingMoves.has(move.name) || move.name === 'Life Dew' || move.name === 'Heal Pulse' || move.name === 'Strength Sap')) {
    priority += 3;
  }
  if (state && move.name === 'Grassy Glide' && state.environment.terrain === 'grassy' && unitGroundedInState(state, unit)) {
    priority += 1;
  }
  if (!movePriorityOverrides.has(move.name) && priorityMoves.has(move.name)) priority += 1;
  return priority;
}

function pranksterBlockedByDarkTarget(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  if (move.category !== 'Status' || abilityNameForUnit(actor) !== 'Prankster') {
    return false;
  }

  if (unitSideId(state, actor) === unitSideId(state, target)) {
    return false;
  }

  return typeListForUnit(state, target).includes('Dark');
}

function resolveMoveTarget(state: SimulatorBattleState, defendingSide: SimSide, requestedTarget: number, move: PokemonMove) {
  const liveTargets = livingActiveTargets(defendingSide);
  if (move.name === 'Struggle') {
    return liveTargets[Math.floor(Math.random() * Math.max(1, liveTargets.length))]?.unit ?? null;
  }

  const directTarget = targetActiveUnit(defendingSide, requestedTarget);
  const resolvedDirectTarget = directTarget && !directTarget.fainted ? directTarget : (liveTargets[0]?.unit ?? null);
  if (state.format !== 'Doubles' || moveScope(move) !== 'single') {
    return resolvedDirectTarget;
  }

  if (defendingSide.redirectionUnitIndex === null) {
    return resolvedDirectTarget;
  }

  const redirectTarget = defendingSide.units[defendingSide.redirectionUnitIndex] ?? null;
  if (!redirectTarget || redirectTarget.fainted) {
    return resolvedDirectTarget;
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
      'Magic Room',
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
      'Sticky Web',
      'Sunny Day',
      'Swords Dance',
      'Tailwind',
      'Tailwind',
      'Toxic Spikes',
      'Trick Room',
      'Wonder Room',
      'Wide Guard',
    ]);
    return exemptStatusMoves.has(move.name) ? resolvedDirectTarget : redirectTarget;
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
  target.sleepSource = status === 'sleep' ? 'normal' : null;
  target.freezeTurns = 0;
  target.toxicCounter = 1;
  state.log.unshift(`${target.pokemon.displayName} was afflicted by ${sourceMove} (${status}).`);
  maybeConsumeStatusBerry(state, target);
  return target.build.status === status;
}

function maybeInflictConfusion(state: SimulatorBattleState, target: SimUnit, sourceMove: string) {
  if (target.confusionTurns > 0) {
    return false;
  }

  target.confusionTurns = randomDuration(2, 5);
  state.log.unshift(`${target.pokemon.displayName} became confused by ${sourceMove}.`);
  return true;
}

function applyEscapeBlock(state: SimulatorBattleState, source: SimUnit, target: SimUnit, sourceMove: string) {
  target.escapeBlockedBySideId = unitSideId(state, source);
  target.escapeBlockedByUnitIndex = sideForUnit(state, source).units.indexOf(source);
  state.log.unshift(`${target.pokemon.displayName} can no longer switch because of ${sourceMove}.`);
}

function removeHeldItem(state: SimulatorBattleState, target: SimUnit, sourceMove: string) {
  const item = getItemById(target.heldItemId);
  if (!item || !itemCanBeRemoved(item)) {
    return false;
  }

  target.heldItemId = null;
  state.log.unshift(`${target.pokemon.displayName} lost its ${item.name} because of ${sourceMove}.`);
  return true;
}

function resetStageModifiers(state: SimulatorBattleState) {
  for (const side of [state.player, state.opponent]) {
    for (const unit of side.units) {
      resetUnitStageModifiers(unit);
    }
  }
}

function resetUnitStageModifiers(unit: SimUnit) {
  unit.build.attackStage = 0;
  unit.build.defenseStage = 0;
  unit.build.specialAttackStage = 0;
  unit.build.specialDefenseStage = 0;
  unit.build.speedStage = 0;
  unit.build.accuracyStage = 0;
  unit.build.evasionStage = 0;
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
  const priority = movePriority(move, actor, state);
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
    if (pranksterBlockedByDarkTarget(state, actor, targetRef.unit, move)) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} ignored ${move.name} because Dark-types are immune to opposing Prankster status moves.`);
      return false;
    }

    const targetAbility = abilityNameForUnit(targetRef.unit);
    if (targetAbility && statusMoveShieldAbilities.has(targetAbility) && unitSideId(state, actor) !== targetRef.sideId) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} ignored ${move.name} because ${targetAbility} blocks opposing status moves.`);
      return false;
    }
    if (move.name === 'Taunt' && targetAbility && tauntShieldAbilities.has(targetAbility)) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} ignored Taunt because of ${targetAbility}.`);
      return false;
    }
    if (aromaVeilProtectedMoves.has(move.name) && protectedByAromaVeil(state, targetRef.unit)) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} ignored ${move.name} because Aroma Veil protects its side from move-locking effects.`);
      return false;
    }
    if (isSoundMove(move) && targetAbility === 'Soundproof') {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} ignored ${move.name} because Soundproof blocks sound-based moves.`);
      return false;
    }

    const sideProtection = blockedBySideProtection(move, priority, targetRef);
    if (sideProtection) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} was shielded by ${sideProtection}.`);
      return false;
    }

    if (targetRef.unit.protected && !moveBypassesProtect(actor, move)) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} blocked ${move.name} with ${targetRef.unit.protectSource ?? 'Protect'}.`);
      return false;
    }

    if (targetRef.unit.substituteHp > 0) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName}'s substitute blocked ${move.name}.`);
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
  const allyTargets = actingSide.active
    .map((unitIndex, activeSlot) => ({ unitIndex, activeSlot, unit: actingSide.units[unitIndex] }))
    .filter((entry): entry is { unitIndex: number; activeSlot: number; unit: SimUnit } => Boolean(entry.unit && !entry.unit.fainted && entry.unit !== actor))
    .map((entry) => ({ sideId: actingSideId, side: actingSide, ally: true, ...entry })) satisfies TargetRef[];
  const allOtherTargets = [
    ...allyTargets,
    ...accurateOpponentTargets,
  ];

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
      amount = virtualSunlightForMove(state, actor, move)
        ? healAmount(actor, 2 / 3)
        : state.environment.weather === 'clear'
          ? healAmount(actor, 0.5)
          : healAmount(actor, 0.25);
    }
    if (tryHealUnit(state, actor, amount, move.name)) {
      state.log.unshift(`${actor.pokemon.displayName} recovered health with ${move.name}.`);
    }
    return;
  }

  if (move.name === 'Rest') {
    if (actor.currentHp >= actor.maxHp) {
      state.log.unshift(`${actor.pokemon.displayName}'s Rest failed because it is already at full HP.`);
      return;
    }
    if (actor.healingPreventedTurns > 0) {
      state.log.unshift(`${actor.pokemon.displayName}'s Rest failed because healing is blocked by Psychic Noise.`);
      return;
    }
    actor.currentHp = actor.maxHp;
    actor.build.status = 'sleep';
    actor.sleepTurns = 0;
    actor.sleepSource = 'rest';
    actor.freezeTurns = 0;
    actor.toxicCounter = 1;
    state.log.unshift(`${actor.pokemon.displayName} fully restored itself with Rest.`);
    return;
  }

  if (move.name === 'Life Dew') {
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      if (unit && !unit.fainted) {
        tryHealUnit(state, unit, healAmount(unit, 0.25), 'Life Dew');
      }
    }
    state.log.unshift(`${actor.pokemon.displayName} restored its side with Life Dew.`);
    return;
  }

  if (move.name === 'Heal Pulse') {
    const ally = actingSide.active
      .map((unitIndex) => actingSide.units[unitIndex])
      .find((unit) => unit && unit !== actor && !unit.fainted) ?? null;
    if (!ally) {
      state.log.unshift(`${actor.pokemon.displayName}'s Heal Pulse failed because no ally was available.`);
      return;
    }
    if (tryHealUnit(state, ally, healAmount(ally, 0.5), 'Heal Pulse')) {
      state.log.unshift(`${actor.pokemon.displayName} restored ${ally.pokemon.displayName} with Heal Pulse.`);
    }
    return;
  }

  if (move.name === 'Heal Bell') {
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      if (!unit || abilityNameForUnit(unit) === 'Soundproof') {
        continue;
      }
      unit.build.status = 'healthy';
      unit.toxicCounter = 1;
      unit.sleepTurns = 0;
      unit.sleepSource = null;
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
    state.gravityTurns = state.gravityTurns > 0 ? 0 : 5;
    state.environment.gravity = state.gravityTurns > 0;
    state.log.unshift(
      state.gravityTurns > 0
        ? `${actor.pokemon.displayName} intensified gravity for five turns.`
        : `${actor.pokemon.displayName} returned gravity to normal.`,
    );
    return;
  }

  if (move.name === 'Chilly Reception') {
    state.environment.weather = 'snow';
    state.weatherTurns = 5;
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

  if (move.name === 'Magic Room') {
    state.magicRoomTurns = state.magicRoomTurns > 0 ? 0 : 5;
    state.environment.magicRoom = state.magicRoomTurns > 0;
    state.log.unshift(
      state.magicRoomTurns > 0
        ? `${actor.pokemon.displayName} warped the field with Magic Room.`
        : `${actor.pokemon.displayName} ended Magic Room.`,
    );
    return;
  }

  if (move.name === 'Wonder Room') {
    state.wonderRoomTurns = state.wonderRoomTurns > 0 ? 0 : 5;
    state.environment.wonderRoom = state.wonderRoomTurns > 0;
    state.log.unshift(
      state.wonderRoomTurns > 0
        ? `${actor.pokemon.displayName} warped the field with Wonder Room.`
        : `${actor.pokemon.displayName} ended Wonder Room.`,
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
    if (state.environment.weather !== 'snow') {
      state.log.unshift(`${actor.pokemon.displayName}'s Aurora Veil failed because snow is not active.`);
      return;
    }
    actingSide.auroraVeilTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} put up Aurora Veil.`);
    return;
  }

  if (move.name === 'Helping Hand') {
    const allyIndex = actingSide.active.find((index) => index >= 0 && index !== actingSide.units.indexOf(actor));
    const ally = typeof allyIndex === 'number' && allyIndex >= 0 ? actingSide.units[allyIndex] ?? null : null;
    if (ally && !ally.fainted) {
      ally.helpingHand = true;
      state.log.unshift(`${actor.pokemon.displayName} boosted its ally with Helping Hand.`);
      return;
    }
    state.log.unshift(`${actor.pokemon.displayName}'s Helping Hand failed because no ally was available.`);
    return;
  }

  if (redirectionMoves.has(move.name)) {
    actingSide.redirectionUnitIndex = actingSide.units.indexOf(actor);
    state.log.unshift(`${actor.pokemon.displayName} redirected pressure with ${move.name}.`);
    return;
  }

  if (allyBoostMoves.has(move.name)) {
    const allies = actingSide.active
      .map((unitIndex) => actingSide.units[unitIndex])
      .filter((unit): unit is SimUnit => Boolean(unit && !unit.fainted && unit !== actor));
    if (move.name === 'Coaching' && !allies.length) {
      state.log.unshift(`${actor.pokemon.displayName}'s Coaching failed because no ally was available.`);
      return;
    }

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

  if (move.name === 'Sticky Web') {
    defendingSide.stickyWeb = true;
    state.log.unshift(`${actor.pokemon.displayName} spread Sticky Web on the opposing side.`);
    return;
  }

  if (move.name === 'Toxic Spikes') {
    defendingSide.toxicSpikesLayers = Math.min(2, defendingSide.toxicSpikesLayers + 1);
    state.log.unshift(`${actor.pokemon.displayName} added Toxic Spikes (${defendingSide.toxicSpikesLayers}).`);
    return;
  }

  if (move.name === 'Defog') {
    clearSideHazards(actingSide);
    clearSideHazards(defendingSide);
    actingSide.reflectTurns = 0;
    actingSide.lightScreenTurns = 0;
    actingSide.auroraVeilTurns = 0;
    actingSide.safeguardTurns = 0;
    defendingSide.reflectTurns = 0;
    defendingSide.lightScreenTurns = 0;
    defendingSide.auroraVeilTurns = 0;
    defendingSide.safeguardTurns = 0;
    state.environment.terrain = 'none';
    state.terrainTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} cleared hazards and screens with Defog.`);
    return;
  }

  const nextWeather = weatherMoves.get(move.name);
  if (nextWeather) {
    state.environment.weather = nextWeather;
    state.weatherTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} changed the weather to ${nextWeather}.`);
    return;
  }

  const nextTerrain = terrainMoves.get(move.name);
  if (nextTerrain) {
    state.environment.terrain = nextTerrain;
    state.terrainTurns = 5;
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

  if (move.name === 'Toxic Thread') {
    accurateOpponentTargets.forEach((targetRef) => {
      applyStageChangesFromSource(state, actor, targetRef.unit, { speedStage: -2 }, move.name);
      maybeInflictStatus(state, actor, targetRef.unit, 'poison', move.name);
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} tangled the target with Toxic Thread.`);
    }
    return;
  }

  if (move.name === 'Parting Shot' || move.name === 'Tearful Look' || move.name === 'Noble Roar') {
    let changed = false;
    accurateOpponentTargets.forEach((targetRef) => {
      changed = applyStageChangesFromSource(state, actor, targetRef.unit, { attackStage: -1, specialAttackStage: -1 }, move.name) || changed;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} softened the opposing side with ${move.name}.`);
      if (move.name === 'Parting Shot' && changed) {
        autoPivotToBench(state, actingSideId, actor, move.name, false);
      }
      return;
    }
  }

  if (move.name === 'Baby-Doll Eyes') {
    accurateOpponentTargets.forEach((targetRef) => applyStageChangesFromSource(state, actor, targetRef.unit, { attackStage: -1 }, move.name));
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} lowered Attack with Baby-Doll Eyes.`);
    }
    return;
  }

  if (move.name === 'Fake Tears' || move.name === 'Metal Sound') {
    accurateOpponentTargets.forEach((targetRef) => applyStageChangesFromSource(state, actor, targetRef.unit, { specialDefenseStage: -2 }, move.name));
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} harshly lowered Sp. Def with ${move.name}.`);
    }
    return;
  }

  if (move.name === 'Eerie Impulse') {
    accurateOpponentTargets.forEach((targetRef) => applyStageChangesFromSource(state, actor, targetRef.unit, { specialAttackStage: -2 }, move.name));
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} harshly lowered Sp. Atk with Eerie Impulse.`);
    }
    return;
  }

  if (move.name === 'Encore') {
    accurateOpponentTargets.forEach((targetRef) => {
      if (targetRef.unit.lastMoveId) {
        targetRef.unit.encoreTurns = randomDuration(3, 5);
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
        targetRef.unit.disableTurns = randomDuration(3, 5);
        targetRef.unit.disabledMoveId = targetRef.unit.lastMoveId;
      }
    });
    if (accurateOpponentTargets.some((targetRef) => Boolean(targetRef.unit.lastMoveId))) {
      state.log.unshift(`${actor.pokemon.displayName} disabled its target's last move.`);
      return;
    }
  }

  if (move.name === 'Torment') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.tormentActive = true;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} applied Torment. The target cannot repeat its last move until it switches out.`);
      return;
    }
  }

  if (move.name === 'Yawn') {
    accurateOpponentTargets.forEach((targetRef) => {
      if (targetRef.unit.build.status === 'healthy') {
        targetRef.unit.yawnTurns = 2;
      }
    });
    if (accurateOpponentTargets.some((targetRef) => targetRef.unit.build.status === 'healthy')) {
      state.log.unshift(`${actor.pokemon.displayName} made the opposing side drowsy with Yawn.`);
      return;
    }
  }

  if (move.name === 'Perish Song') {
    for (const side of [state.player, state.opponent]) {
      for (const activeIndex of side.active) {
        const unit = side.units[activeIndex];
        if (unit && !unit.fainted) {
          unit.perishSongTurns = 4;
        }
      }
    }
    state.log.unshift(`${actor.pokemon.displayName} started a Perish Song countdown for all active Pokemon.`);
    return;
  }

  if (move.name === 'Roar' || move.name === 'Whirlwind') {
    const targetRef = accurateOpponentTargets[0] ?? null;
    if (targetRef && forceSwitchTarget(state, targetRef, move.name)) {
      return;
    }
    state.log.unshift(`${actor.pokemon.displayName}'s ${move.name} failed because no forced switch was available.`);
    return;
  }

  if (move.name === 'Pain Split') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const sharedHp = Math.max(1, Math.floor((actor.currentHp + chosenTarget.currentHp) / 2));
      actor.currentHp = Math.min(actor.maxHp, sharedHp);
      chosenTarget.currentHp = Math.min(chosenTarget.maxHp, sharedHp);
      state.log.unshift(`${actor.pokemon.displayName} shared HP totals with Pain Split.`);
      return;
    }
  }

  if (move.name === 'Destiny Bond') {
    actor.destinyBondActive = true;
    state.log.unshift(`${actor.pokemon.displayName} is waiting to drag a foe down with Destiny Bond.`);
    return;
  }

  if (move.name === 'Belly Drum') {
    if (actor.currentHp <= Math.floor(actor.maxHp / 2)) {
      state.log.unshift(`${actor.pokemon.displayName}'s Belly Drum failed because it did not have enough HP.`);
      return;
    }
    lowerUnitHp(actor, Math.max(1, Math.floor(actor.maxHp / 2)));
    actor.build.attackStage = 6;
    actor.statsRaisedThisTurn = true;
    state.log.unshift(`${actor.pokemon.displayName} cut its HP and maximized its Attack with Belly Drum.`);
    maybeTriggerHealingBerry(state, actor);
    return;
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

  if (move.name === 'Stockpile') {
    if (actor.stockpileLevel >= 3) {
      state.log.unshift(`${actor.pokemon.displayName}'s Stockpile failed because it is already stocked to the limit.`);
      return;
    }
    actor.stockpileLevel += 1;
    applyBoosts(actor, { defenseStage: 1, specialDefenseStage: 1 });
    state.log.unshift(`${actor.pokemon.displayName} stockpiled and boosted its defenses.`);
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
      const stats = effectiveStatsForUnit(chosenTarget);
      const currentAttack = Math.max(1, Math.round(stats.attack * stageMultiplier(chosenTarget.build.attackStage)));
      tryHealUnit(state, actor, currentAttack, 'Strength Sap');
      applySingleStage(chosenTarget, 'attackStage', -1);
      state.log.unshift(`${actor.pokemon.displayName} drained strength from ${chosenTarget.pokemon.displayName}.`);
      return;
    }
  }

  if (move.name === 'Clangorous Soul') {
    const hpCost = Math.max(1, Math.floor(actor.maxHp / 3));
    if (actor.currentHp <= hpCost) {
      state.log.unshift(`${actor.pokemon.displayName}'s Clangorous Soul failed because it lacked the HP to pay for it.`);
      return;
    }
    lowerUnitHp(actor, hpCost);
    applyBoosts(actor, {
      attackStage: 1,
      defenseStage: 1,
      specialAttackStage: 1,
      specialDefenseStage: 1,
      speedStage: 1,
    });
    state.log.unshift(`${actor.pokemon.displayName} traded HP to power up with Clangorous Soul.`);
    return;
  }

  if (move.name === 'After You') {
    const chosenTarget = allyTargets[0]?.unit ?? null;
    if (!chosenTarget) {
      state.log.unshift(`${actor.pokemon.displayName}'s After You failed because no ally was available.`);
      return;
    }
    chosenTarget.pendingAfterYou = true;
    state.log.unshift(`${actor.pokemon.displayName} pushed ${chosenTarget.pokemon.displayName} to move next with After You.`);
    return;
  }

  if (move.name === 'Sleep Talk') {
    if (actor.build.status !== 'sleep') {
      state.log.unshift(`${actor.pokemon.displayName}'s Sleep Talk failed because it is not asleep.`);
      return;
    }
    const callableMoves = moveIdsForUnit(actor)
      .filter((moveId) => moveId !== move.id)
      .map((moveId) => findMove(actor, moveId))
      .filter((candidate): candidate is PokemonMove => Boolean(candidate))
      .filter((candidate) => !sleepTalkBlockedMoves.has(candidate.name) && !chargeMoves.has(candidate.name));
    if (!callableMoves.length) {
      state.log.unshift(`${actor.pokemon.displayName}'s Sleep Talk failed because it had no callable moves.`);
      return;
    }
    const chosenMove = callableMoves[Math.floor(Math.random() * callableMoves.length)];
    state.log.unshift(`${actor.pokemon.displayName}'s Sleep Talk called ${chosenMove.name}.`);
    if (chosenMove.category === 'Status') {
      applyStatusMove(state, actingSide, defendingSide, actor, chosenMove, target);
    } else {
      executeDamageMove(state, actor, target, chosenMove, actingSide, defendingSide);
    }
    return;
  }

  if (move.name === 'Attract') {
    let applied = false;
    accurateOpponentTargets.forEach((targetRef) => {
      const targetAbility = abilityNameForUnit(targetRef.unit);
      if (targetAbility === 'Oblivious' || targetRef.unit.basePokemon.baseSpecies === actor.basePokemon.baseSpecies) {
        return;
      }
      targetRef.unit.infatuatedBySideId = actingSideId;
      targetRef.unit.infatuatedByUnitIndex = actingSide.units.indexOf(actor);
      applied = true;
    });
    if (applied) {
      state.log.unshift(`${actor.pokemon.displayName} infatuated its target with Attract.`);
      return;
    }
  }

  if (move.name === 'Block' || move.name === 'Mean Look') {
    accurateOpponentTargets.forEach((targetRef) => applyEscapeBlock(state, actor, targetRef.unit, move.name));
    if (accurateOpponentTargets.length) {
      return;
    }
  }

  if (move.name === 'Confuse Ray' || move.name === 'Sweet Kiss') {
    accurateOpponentTargets.forEach((targetRef) => maybeInflictConfusion(state, targetRef.unit, move.name));
    return;
  }

  if (move.name === 'Copycat') {
    if (!state.lastResolvedMoveId || state.lastResolvedMoveId === move.id) {
      state.log.unshift(`${actor.pokemon.displayName}'s Copycat failed because no copyable move had been used yet.`);
      return;
    }
    const copiedMove = dataset.moves.find((entry) => entry.id === state.lastResolvedMoveId) ?? null;
    if (!copiedMove) {
      state.log.unshift(`${actor.pokemon.displayName}'s Copycat failed.`);
      return;
    }
    actor.lastMoveId = copiedMove.id;
    state.log.unshift(`${actor.pokemon.displayName} copied ${copiedMove.name}.`);
    if (copiedMove.category === 'Status') {
      applyStatusMove(state, actingSide, defendingSide, actor, copiedMove, target);
    } else {
      executeDamageMove(state, actor, target, copiedMove, actingSide, defendingSide);
    }
    return;
  }

  if (move.name === 'Corrosive Gas') {
    const removedAny = allOtherTargets.some((targetRef) => removeHeldItem(state, targetRef.unit, move.name));
    if (removedAny) {
      state.log.unshift(`${actor.pokemon.displayName} dissolved held items with Corrosive Gas.`);
      return;
    }
  }

  if (move.name === 'Dragon Cheer') {
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      if (!unit || unit.fainted) {
        continue;
      }
      const boost = typeListForUnit(state, unit).includes('Dragon') ? 2 : 1;
      unit.critStageBonus = Math.min(3, unit.critStageBonus + boost);
    }
    state.log.unshift(`${actor.pokemon.displayName} raised its side's critical-hit ratio with Dragon Cheer.`);
    return;
  }

  if (move.name === 'Electrify') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.electrifiedTurns = 1;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} electrified its target for this turn.`);
      return;
    }
  }

  if (move.name === 'Entrainment') {
    const sourceAbility = abilityNameForUnit(actor);
    if (!sourceAbility) {
      state.log.unshift(`${actor.pokemon.displayName}'s Entrainment failed because it has no active Ability to share.`);
      return;
    }
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.abilitySuppressed = false;
      targetRef.unit.abilityOverrideName = sourceAbility;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} shared ${sourceAbility} with its target through Entrainment.`);
      return;
    }
  }

  if (move.name === 'Fairy Lock') {
    state.fairyLockTurns = Math.max(state.fairyLockTurns, 2);
    state.log.unshift(`${actor.pokemon.displayName} sealed the field with Fairy Lock.`);
    return;
  }

  if (move.name === 'Focus Energy') {
    actor.critStageBonus = Math.min(3, actor.critStageBonus + 2);
    state.log.unshift(`${actor.pokemon.displayName} focused for critical hits.`);
    return;
  }

  if (move.name === "Forest's Curse") {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.addedTypes = [...new Set([...targetRef.unit.addedTypes, 'Grass'])];
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} added Grass typing with Forest's Curse.`);
      return;
    }
  }

  if (move.name === 'Gastro Acid') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.abilitySuppressed = true;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} suppressed the target's Ability with Gastro Acid.`);
      return;
    }
  }

  if (move.name === 'Guard Split') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const actorStats = effectiveStatsForUnit(actor);
      const targetStats = effectiveStatsForUnit(chosenTarget);
      const sharedDefense = Math.floor((actorStats.defense + targetStats.defense) / 2);
      const sharedSpecialDefense = Math.floor((actorStats.specialDefense + targetStats.specialDefense) / 2);
      actor.statOverrides = { ...actor.statOverrides, defense: sharedDefense, specialDefense: sharedSpecialDefense };
      chosenTarget.statOverrides = { ...chosenTarget.statOverrides, defense: sharedDefense, specialDefense: sharedSpecialDefense };
      actor.build.defenseStage = 0;
      actor.build.specialDefenseStage = 0;
      chosenTarget.build.defenseStage = 0;
      chosenTarget.build.specialDefenseStage = 0;
      state.log.unshift(`${actor.pokemon.displayName} shared defensive stats with Guard Split.`);
      return;
    }
  }

  if (move.name === 'Guard Swap') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      [actor.build.defenseStage, chosenTarget.build.defenseStage] = [chosenTarget.build.defenseStage, actor.build.defenseStage];
      [actor.build.specialDefenseStage, chosenTarget.build.specialDefenseStage] = [chosenTarget.build.specialDefenseStage, actor.build.specialDefenseStage];
      state.log.unshift(`${actor.pokemon.displayName} swapped defensive stat stages with Guard Swap.`);
      return;
    }
  }

  if (move.name === 'Healing Wish') {
    actingSide.healingWishPending = true;
    lowerUnitHp(actor, actor.currentHp);
    state.log.unshift(`${actor.pokemon.displayName} fainted and left a Healing Wish behind.`);
    return;
  }

  if (move.name === 'Memento') {
    let changed = false;
    accurateOpponentTargets.forEach((targetRef) => {
      changed = applyStageChangesFromSource(state, actor, targetRef.unit, { attackStage: -2, specialAttackStage: -2 }, move.name) || changed;
    });
    if (changed) {
      lowerUnitHp(actor, actor.currentHp);
      state.log.unshift(`${actor.pokemon.displayName} gave itself up with Memento.`);
      return;
    }
  }

  if (move.name === 'Imprison') {
    actor.imprisonActive = true;
    state.log.unshift(`${actor.pokemon.displayName} sealed matching moves with Imprison.`);
    return;
  }

  if (move.name === 'Instruct') {
    const chosenTarget = allyTargets[0]?.unit ?? null;
    if (!chosenTarget || !chosenTarget.lastMoveId || chosenTarget.lastMoveId === 'instruct') {
      state.log.unshift(`${actor.pokemon.displayName}'s Instruct failed.`);
      return;
    }
    const repeatedMove = findMove(chosenTarget, chosenTarget.lastMoveId) ?? dataset.moves.find((entry) => entry.id === chosenTarget.lastMoveId) ?? null;
    if (!repeatedMove || repeatedMove.name === 'Instruct' || repeatedMove.name === 'Copycat') {
      state.log.unshift(`${actor.pokemon.displayName}'s Instruct failed.`);
      return;
    }
    state.log.unshift(`${actor.pokemon.displayName} ordered ${chosenTarget.pokemon.displayName} to repeat ${repeatedMove.name}.`);
    if (repeatedMove.category === 'Status') {
      applyStatusMove(state, sideForUnit(state, chosenTarget), opposingSide(state, unitSideId(state, chosenTarget)), chosenTarget, repeatedMove, resolveMoveTarget(state, opposingSide(state, unitSideId(state, chosenTarget)), 0, repeatedMove));
    } else {
      executeDamageMove(state, chosenTarget, resolveMoveTarget(state, opposingSide(state, unitSideId(state, chosenTarget)), 0, repeatedMove), repeatedMove, sideForUnit(state, chosenTarget), opposingSide(state, unitSideId(state, chosenTarget)));
    }
    return;
  }

  if (move.name === 'Lock-On') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      actor.lockOnTurns = 2;
      actor.lockOnTargetSideId = unitSideId(state, chosenTarget);
      actor.lockOnTargetUnitIndex = sideForUnit(state, chosenTarget).units.indexOf(chosenTarget);
      state.log.unshift(`${actor.pokemon.displayName} locked on to ${chosenTarget.pokemon.displayName}.`);
      return;
    }
  }

  if (move.name === 'Magic Powder') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.typeOverride = ['Psychic'];
      targetRef.unit.addedTypes = [];
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} changed the target to Psychic-type with Magic Powder.`);
      return;
    }
  }

  if (move.name === 'Magnet Rise') {
    actor.magnetRiseTurns = 5;
    state.log.unshift(`${actor.pokemon.displayName} rose into the air with Magnet Rise.`);
    return;
  }

  if (move.name === 'Magnetic Flux') {
    let boosted = false;
    for (const activeIndex of actingSide.active) {
      const unit = actingSide.units[activeIndex];
      const ability = unit ? abilityNameForUnit(unit) : null;
      if (!unit || unit.fainted || (ability !== 'Plus' && ability !== 'Minus')) {
        continue;
      }
      boosted = applyStageChangesFromSource(state, actor, unit, { defenseStage: 1, specialDefenseStage: 1 }, move.name, { treatAsOpposing: false }) || boosted;
    }
    if (boosted) {
      state.log.unshift(`${actor.pokemon.displayName} energized Plus and Minus allies with Magnetic Flux.`);
      return;
    }
  }

  if (move.name === 'Power Split') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const actorStats = effectiveStatsForUnit(actor);
      const targetStats = effectiveStatsForUnit(chosenTarget);
      const sharedAttack = Math.floor((actorStats.attack + targetStats.attack) / 2);
      const sharedSpecialAttack = Math.floor((actorStats.specialAttack + targetStats.specialAttack) / 2);
      actor.statOverrides = { ...actor.statOverrides, attack: sharedAttack, specialAttack: sharedSpecialAttack };
      chosenTarget.statOverrides = { ...chosenTarget.statOverrides, attack: sharedAttack, specialAttack: sharedSpecialAttack };
      actor.build.attackStage = 0;
      actor.build.specialAttackStage = 0;
      chosenTarget.build.attackStage = 0;
      chosenTarget.build.specialAttackStage = 0;
      state.log.unshift(`${actor.pokemon.displayName} shared offensive stats with Power Split.`);
      return;
    }
  }

  if (move.name === 'Power Swap') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      [actor.build.attackStage, chosenTarget.build.attackStage] = [chosenTarget.build.attackStage, actor.build.attackStage];
      [actor.build.specialAttackStage, chosenTarget.build.specialAttackStage] = [chosenTarget.build.specialAttackStage, actor.build.specialAttackStage];
      state.log.unshift(`${actor.pokemon.displayName} swapped offensive stat stages with Power Swap.`);
      return;
    }
  }

  if (move.name === 'Power Trick') {
    const actorStats = effectiveStatsForUnit(actor);
    actor.statOverrides = {
      ...actor.statOverrides,
      attack: actorStats.defense,
      defense: actorStats.attack,
    };
    state.log.unshift(`${actor.pokemon.displayName} swapped its Attack and Defense with Power Trick.`);
    return;
  }

  if (move.name === 'Psych Up') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      copyBoostState(chosenTarget, actor);
      state.log.unshift(`${actor.pokemon.displayName} copied stat changes with Psych Up.`);
      return;
    }
  }

  if (move.name === 'Quash') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.quashedThisTurn = true;
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} pushed its target to the end of the turn with Quash.`);
      return;
    }
  }

  if (move.name === 'Recycle') {
    if (!actor.heldItemId && actor.lastConsumedItemId) {
      actor.heldItemId = actor.lastConsumedItemId;
      actor.lastConsumedItemId = null;
      state.log.unshift(`${actor.pokemon.displayName} restored its item with Recycle.`);
      return;
    }
    state.log.unshift(`${actor.pokemon.displayName}'s Recycle failed.`);
    return;
  }

  if (move.name === 'Reflect Type') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      actor.typeOverride = typeListForUnit(state, chosenTarget);
      actor.addedTypes = [];
      state.log.unshift(`${actor.pokemon.displayName} copied ${chosenTarget.pokemon.displayName}'s typing with Reflect Type.`);
      return;
    }
  }

  if (move.name === 'Role Play') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    const copiedAbility = chosenTarget ? abilityNameForUnit(chosenTarget) : null;
    if (copiedAbility) {
      actor.abilitySuppressed = false;
      actor.abilityOverrideName = copiedAbility;
      state.log.unshift(`${actor.pokemon.displayName} copied ${copiedAbility} with Role Play.`);
      return;
    }
  }

  if (move.name === 'Shed Tail') {
    const hpCost = Math.max(1, Math.floor(actor.maxHp / 2));
    const replacement = firstAvailableBench(actingSide);
    const currentIndex = actingSide.units.indexOf(actor);
    const activeSlot = actingSide.active.findIndex((entry) => entry === currentIndex);
    if (actor.currentHp <= hpCost || replacement === null || activeSlot < 0) {
      state.log.unshift(`${actor.pokemon.displayName}'s Shed Tail failed.`);
      return;
    }
    lowerUnitHp(actor, hpCost);
    const substituteHp = Math.max(1, Math.floor(actor.maxHp / 4));
    switchOutUnit(actingSide, currentIndex);
    actingSide.active[activeSlot] = replacement;
    actingSide.bench = [...actingSide.bench.filter((entry) => entry !== replacement), currentIndex];
    actingSide.units[replacement].turnsActive = 0;
    actingSide.units[replacement].substituteHp = substituteHp;
    state.log.unshift(`${actor.pokemon.displayName} passed a substitute with Shed Tail to ${actingSide.units[replacement].pokemon.displayName}.`);
    switchInUnit(state, actingSideId, replacement, false);
    return;
  }

  if (move.name === 'Simple Beam') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.abilitySuppressed = false;
      targetRef.unit.abilityOverrideName = 'Simple';
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} changed the target's Ability to Simple.`);
      return;
    }
  }

  if (move.name === 'Skill Swap') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const actorAbility = abilityNameForUnit(actor);
      const targetAbility = abilityNameForUnit(chosenTarget);
      actor.abilitySuppressed = false;
      chosenTarget.abilitySuppressed = false;
      actor.abilityOverrideName = targetAbility;
      chosenTarget.abilityOverrideName = actorAbility;
      state.log.unshift(`${actor.pokemon.displayName} swapped Abilities with ${chosenTarget.pokemon.displayName}.`);
      return;
    }
  }

  if (move.name === 'Soak') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.typeOverride = ['Water'];
      targetRef.unit.addedTypes = [];
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} soaked the target into Water typing.`);
      return;
    }
  }

  if (move.name === 'Speed Swap') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const actorSpeed = effectiveStatsForUnit(actor).speed;
      const targetSpeed = effectiveStatsForUnit(chosenTarget).speed;
      actor.statOverrides = { ...actor.statOverrides, speed: targetSpeed };
      chosenTarget.statOverrides = { ...chosenTarget.statOverrides, speed: actorSpeed };
      actor.build.speedStage = 0;
      chosenTarget.build.speedStage = 0;
      state.log.unshift(`${actor.pokemon.displayName} swapped Speed with ${chosenTarget.pokemon.displayName}.`);
      return;
    }
  }

  if (move.name === 'Spite') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget?.lastMoveId) {
      spendMovePp(chosenTarget, chosenTarget.lastMoveId, 4);
      state.log.unshift(`${actor.pokemon.displayName} drained PP from ${chosenTarget.pokemon.displayName}'s last move with Spite.`);
      return;
    }
  }

  if (move.name === 'Substitute') {
    const hpCost = Math.max(1, Math.floor(actor.maxHp / 4));
    if (actor.currentHp <= hpCost || actor.substituteHp > 0) {
      state.log.unshift(`${actor.pokemon.displayName}'s Substitute failed.`);
      return;
    }
    lowerUnitHp(actor, hpCost);
    actor.substituteHp = hpCost;
    state.log.unshift(`${actor.pokemon.displayName} made a Substitute.`);
    return;
  }

  if (move.name === 'Swallow') {
    if (actor.stockpileLevel <= 0) {
      state.log.unshift(`${actor.pokemon.displayName}'s Swallow failed without Stockpile.`);
      return;
    }
    const healFraction = actor.stockpileLevel >= 3 ? 1 : actor.stockpileLevel === 2 ? 0.5 : 0.25;
    tryHealUnit(state, actor, healAmount(actor, healFraction), 'Swallow');
    actor.stockpileLevel = 0;
    state.log.unshift(`${actor.pokemon.displayName} restored HP with Swallow.`);
    return;
  }

  if (move.name === 'Switcheroo' || move.name === 'Trick') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      const actorItem = getItemById(actor.heldItemId);
      const targetItem = getItemById(chosenTarget.heldItemId);
      if ((actorItem && !itemCanBeRemoved(actorItem)) || (targetItem && !itemCanBeRemoved(targetItem))) {
        state.log.unshift(`${actor.pokemon.displayName}'s ${move.name} failed because one item could not be exchanged.`);
        return;
      }
      [actor.heldItemId, chosenTarget.heldItemId] = [chosenTarget.heldItemId, actor.heldItemId];
      state.log.unshift(`${actor.pokemon.displayName} swapped held items with ${chosenTarget.pokemon.displayName} using ${move.name}.`);
      return;
    }
  }

  if (move.name === 'Teatime') {
    let ateAnyBerry = false;
    for (const side of [state.player, state.opponent]) {
      for (const activeIndex of side.active) {
        const unit = side.units[activeIndex];
        const item = unit ? activeItemForUnit(state, unit) : null;
        if (!unit || !item || item.category !== 'berry') {
          continue;
        }
        ateAnyBerry = true;
        if (healingBerries.has(item.name)) {
          const berryValue = healingBerries.get(item.name) ?? 0.25;
          tryHealUnit(state, unit, berryValue < 1 ? healAmount(unit, berryValue) : berryValue, `${item.name} via Teatime`);
        } else if (unit.build.status !== 'healthy') {
          maybeConsumeStatusBerry(state, unit);
          continue;
        }
        unit.lastConsumedItemId = unit.heldItemId;
        unit.heldItemId = null;
        state.log.unshift(`${unit.pokemon.displayName} ate its ${item.name} because of Teatime.`);
      }
    }
    if (ateAnyBerry) {
      return;
    }
  }

  if (move.name === 'Teeter Dance') {
    allOtherTargets.forEach((targetRef) => {
      maybeInflictConfusion(state, targetRef.unit, move.name);
    });
    state.log.unshift(`${actor.pokemon.displayName} confused the field with Teeter Dance.`);
    return;
  }

  if (move.name === 'Transform') {
    const chosenTarget = accurateOpponentTargets[0]?.unit ?? null;
    if (chosenTarget) {
      actor.transformed = true;
      actor.pokemon = chosenTarget.pokemon;
      actor.abilitySuppressed = chosenTarget.abilitySuppressed;
      actor.abilityOverrideName = abilityNameForUnit(chosenTarget);
      actor.typeOverride = typeListForUnit(state, chosenTarget);
      actor.addedTypes = [];
      const targetStats = effectiveStatsForUnit(chosenTarget);
      actor.statOverrides = {
        attack: targetStats.attack,
        defense: targetStats.defense,
        specialAttack: targetStats.specialAttack,
        specialDefense: targetStats.specialDefense,
        speed: targetStats.speed,
      };
      actor.transformedMoveIds = moveIdsForUnit(chosenTarget).slice(0, 4);
      actor.movePp = Object.fromEntries(actor.transformedMoveIds.map((moveId) => [moveId, 5]));
      copyBoostState(chosenTarget, actor);
      state.log.unshift(`${actor.pokemon.displayName} transformed into ${chosenTarget.pokemon.displayName}.`);
      return;
    }
  }

  if (move.name === 'Trick-or-Treat') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.addedTypes = [...new Set([...targetRef.unit.addedTypes, 'Ghost'])];
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} added Ghost typing with Trick-or-Treat.`);
      return;
    }
  }

  if (move.name === 'Worry Seed') {
    accurateOpponentTargets.forEach((targetRef) => {
      targetRef.unit.abilitySuppressed = false;
      targetRef.unit.abilityOverrideName = 'Insomnia';
    });
    if (accurateOpponentTargets.length) {
      state.log.unshift(`${actor.pokemon.displayName} changed the target's Ability to Insomnia.`);
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

function confusionSelfHitDamage(unit: SimUnit) {
  const stats = effectiveStatsForUnit(unit);
  const attack = Math.max(1, Math.round(stats.attack * stageMultiplier(unit.build.attackStage)));
  const defense = Math.max(1, Math.round(stats.defense * stageMultiplier(unit.build.defenseStage)));
  const base = Math.floor(((((2 * 50) / 5 + 2) * 40 * attack) / defense) / 50) + 2;
  return Math.max(1, Math.floor(base * 0.92));
}

function criticalStageForMove(unit: SimUnit, move: PokemonMove) {
  const highCritMoves = new Set(['Air Cutter', 'Blaze Kick', 'Cross Poison', 'Drill Run', 'Leaf Blade', 'Night Slash', 'Psycho Cut', 'Razor Leaf', 'Shadow Claw', 'Slash', 'Stone Edge']);
  return unit.critStageBonus + (highCritMoves.has(move.name) ? 1 : 0);
}

function criticalHitRoll(unit: SimUnit, move: PokemonMove) {
  const stage = criticalStageForMove(unit, move);
  if (stage >= 3) {
    return true;
  }
  if (stage === 2) {
    return Math.random() < 0.5;
  }
  if (stage === 1) {
    return Math.random() < 0.125;
  }
  return Math.random() < 1 / 24;
}

function applyTargetStatEffect(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  if (abilityNameForUnit(target) === 'Shield Dust' && unitSideId(state, actor) !== unitSideId(state, target)) {
    return;
  }
  if (secondaryEffectsSuppressedByAbility(actor, move) && unitSideId(state, actor) !== unitSideId(state, target)) {
    return;
  }
  switch (move.name) {
    case 'Clear Smog':
      resetUnitStageModifiers(target);
      state.log.unshift(`${target.pokemon.displayName}'s stat changes were erased by Clear Smog.`);
      return;
    case 'Snarl':
    case 'Struggle Bug':
    case 'Mystical Fire':
      if (applyStageChangesFromSource(state, actor, target, { specialAttackStage: -1 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Sp. Atk fell because of ${move.name}.`);
      }
      return;
    case 'Breaking Swipe':
    case 'Bitter Malice':
    case 'Chilling Water':
    case 'Lunge':
      if (applyStageChangesFromSource(state, actor, target, { attackStage: -1 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Attack fell because of ${move.name}.`);
      }
      return;
    case 'Acid Spray':
    case 'Lumina Crash':
      if (applyStageChangesFromSource(state, actor, target, { specialDefenseStage: -2 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Sp. Def sharply fell because of ${move.name}.`);
      }
      return;
    case 'Apple Acid':
      if (applyStageChangesFromSource(state, actor, target, { specialDefenseStage: -1 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Sp. Def fell because of ${move.name}.`);
      }
      return;
    case 'Fire Lash':
      if (applyStageChangesFromSource(state, actor, target, { defenseStage: -1 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Defense fell because of ${move.name}.`);
      }
      return;
    case 'Rock Tomb':
    case 'Mud Shot':
    case 'Icy Wind':
    case 'Bulldoze':
    case 'Electroweb':
    case 'Low Sweep':
      if (applyStageChangesFromSource(state, actor, target, { speedStage: -1 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Speed fell because of ${move.name}.`);
      }
      return;
    case 'Mud-Slap':
      if (applyStageChangesFromSource(state, actor, target, { accuracyStage: -1 }, move.name)) {
        state.log.unshift(`${target.pokemon.displayName}'s Accuracy fell because of ${move.name}.`);
      }
      return;
    default:
      break;
  }

  if (move.name === 'Muddy Water' && chanceRoll(30)) {
    if (applyStageChangesFromSource(state, actor, target, { accuracyStage: -1 }, move.name)) {
      state.log.unshift(`${target.pokemon.displayName}'s Accuracy fell because of Muddy Water.`);
    }
    return;
  }

  if (move.name === 'Night Daze' && chanceRoll(40)) {
    if (applyStageChangesFromSource(state, actor, target, { accuracyStage: -1 }, move.name)) {
      state.log.unshift(`${target.pokemon.displayName}'s Accuracy fell because of Night Daze.`);
    }
    return;
  }

  if ((move.name === 'Bug Buzz' || move.name === 'Earth Power' || move.name === 'Energy Ball' || move.name === 'Flash Cannon') && chanceRoll(10)) {
    if (applyStageChangesFromSource(state, actor, target, { specialDefenseStage: -1 }, move.name)) {
      state.log.unshift(`${target.pokemon.displayName}'s Sp. Def fell because of ${move.name}.`);
    }
    return;
  }

  if (move.name === 'Crunch' && chanceRoll(20)) {
    if (applyStageChangesFromSource(state, actor, target, { defenseStage: -1 }, move.name)) {
      state.log.unshift(`${target.pokemon.displayName}'s Defense fell because of Crunch.`);
    }
  }

  if (move.name === 'Grav Apple') {
    if (applyStageChangesFromSource(state, actor, target, { defenseStage: -1 }, move.name)) {
      state.log.unshift(`${target.pokemon.displayName}'s Defense fell because of Grav Apple.`);
    }
  }
}

function applyTargetStatusEffect(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  if (abilityNameForUnit(target) === 'Shield Dust' && unitSideId(state, actor) !== unitSideId(state, target)) {
    return;
  }
  if (secondaryEffectsSuppressedByAbility(actor, move) && unitSideId(state, actor) !== unitSideId(state, target)) {
    return;
  }
  switch (move.name) {
    case 'Inferno':
      maybeInflictStatus(state, actor, target, 'burn', move.name);
      return;
    case 'Salt Cure':
      target.saltCure = true;
      state.log.unshift(`${target.pokemon.displayName} was afflicted by Salt Cure.`);
      return;
    case 'Spirit Shackle':
      target.trappedByMove = move.name;
      state.log.unshift(`${target.pokemon.displayName} can no longer switch because of Spirit Shackle.`);
      return;
    case 'Psychic Noise':
      if (protectedByAromaVeil(state, target)) {
        state.log.unshift(`${target.pokemon.displayName} ignored Psychic Noise's recovery lock because Aroma Veil protects its side.`);
        return;
      }
      if (target.healingPreventedTurns <= 0) {
        target.healingPreventedTurns = 2;
        state.log.unshift(`${target.pokemon.displayName} cannot recover HP for two turns because of Psychic Noise.`);
      }
      return;
    case 'Throat Chop':
      target.throatChopTurns = Math.max(target.throatChopTurns, 2);
      state.log.unshift(`${target.pokemon.displayName} cannot use sound-based moves for two turns because of Throat Chop.`);
      return;
    case 'Syrup Bomb':
      target.syrupTurns = Math.max(target.syrupTurns, 3);
      state.log.unshift(`${target.pokemon.displayName} became syrupy for three turns.`);
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

  if (move.name === 'Infernal Parade' && chanceRoll(30)) {
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
    defendingSide.auroraVeilTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} broke opposing screens with Brick Break.`);
  }

  if (move.name === 'Psychic Fangs' && landedHit) {
    const defendingSide = opposingSide(state, unitSideId(state, actor));
    defendingSide.reflectTurns = 0;
    defendingSide.lightScreenTurns = 0;
    defendingSide.auroraVeilTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} shattered opposing screens with Psychic Fangs.`);
  }

  if (move.name === 'Ice Spinner' && landedHit) {
    state.environment.terrain = 'none';
    state.terrainTurns = 0;
    state.log.unshift(`${actor.pokemon.displayName} removed the terrain with Ice Spinner.`);
  }

  if (move.name === 'Psyshield Bash' && landedHit) {
    applySingleStage(actor, 'defenseStage', 1);
    state.log.unshift(`${actor.pokemon.displayName} boosted its Defense with Psyshield Bash.`);
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
  const isStruggle = move.id === struggleMove.id;
  const activeMove = actor.electrifiedTurns > 0 && move.category !== 'Status'
    ? { ...move, type: 'Electric' as const }
    : move;
  if (move.name === 'Fake Out' && actor.turnsActive > 0) {
    state.log.unshift(`${actor.pokemon.displayName}'s Fake Out failed because it is no longer freshly sent out.`);
    return;
  }

  if (move.name === 'First Impression' && actor.turnsActive > 0) {
    state.log.unshift(`${actor.pokemon.displayName}'s First Impression failed because it is no longer freshly sent out.`);
    return;
  }

  if (move.name === 'Snore' && actor.build.status !== 'sleep') {
    state.log.unshift(`${actor.pokemon.displayName}'s Snore failed because it is not asleep.`);
    return;
  }

  if (actor.throatChopTurns > 0 && isSoundMove(move)) {
    state.log.unshift(`${actor.pokemon.displayName} could not use ${move.name} because Throat Chop is still active.`);
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

  if (move.name === 'Expanding Force' && state.environment.terrain === 'psychic' && unitGroundedInState(state, actor)) {
    targetRefs = defendingSide.active
      .map((unitIndex, activeSlot) => ({ sideId: (actingSideId === 'player' ? 'opponent' : 'player') as SideId, side: defendingSide, unit: defendingSide.units[unitIndex], activeSlot, unitIndex, ally: false }))
      .filter((entry): entry is TargetRef => Boolean(entry.unit && !entry.unit.fainted));
  }

  if (move.name === 'Dragon Darts') {
    const liveOpponents = defendingSide.active
      .map((unitIndex, activeSlot) => ({ sideId: (actingSideId === 'player' ? 'opponent' : 'player') as SideId, side: defendingSide, unit: defendingSide.units[unitIndex], activeSlot, unitIndex, ally: false }))
      .filter((entry): entry is TargetRef => Boolean(entry.unit && !entry.unit.fainted));
    if (liveOpponents.length > 1) {
      targetRefs = liveOpponents.slice(0, 2);
    } else if (targetRefs.length === 1) {
      targetRefs = [targetRefs[0], { ...targetRefs[0] }];
    }
  }

  if (!targetRefs.length) {
    return;
  }

  const priority = movePriority(move, actor, state);
  const spreadTargetsHit = moveScope(move) !== 'single' && targetRefs.length > 1 ? 2 : 1;
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

    if (targetRef.unit.beakBlastPrimed && moveMakesContact(move)) {
      maybeInflictStatus(state, targetRef.unit, actor, 'burn', 'Beak Blast');
    }

    let damage = 0;
    let result: DamageResult | null = null;
    if (move.name === 'Final Gambit') {
      damage = actor.currentHp;
    } else {
      const criticalHit = criticalHitRoll(actor, activeMove);
      result = calculateDamageWithOverrides(currentBuild(actor), currentBuild(targetRef.unit), activeMove, {
        ...screenAwareEnvironment(state, targetRef.side),
        helpingHand: actor.helpingHand,
        spreadTargetsHit,
        criticalHit,
      }, {
        attackerPokemon: actor.pokemon,
        defenderPokemon: targetRef.unit.pokemon,
        attackerStats: effectiveStatsForUnit(actor),
        defenderStats: effectiveStatsForUnit(targetRef.unit),
        attackerTypes: typeListForUnit(state, actor),
        defenderTypes: typeListForUnit(state, targetRef.unit),
        attackerAbility: abilityNameForUnit(actor),
        defenderAbility: abilityNameForUnit(targetRef.unit),
        attackerGrounded: unitGroundedInState(state, actor),
        defenderGrounded: unitGroundedInState(state, targetRef.unit),
        attackerSpeed: combatSpeed(actor, actingSide.tailwindTurns, state.trickRoomTurns),
        defenderSpeed: combatSpeed(targetRef.unit, targetRef.side.tailwindTurns, state.trickRoomTurns),
      });
      if (!result) {
        state.log.unshift(`${actor.pokemon.displayName} used ${move.name}, but no direct damage line applied.`);
        continue;
      }
      if (result.koSummary === 'Immune' || result.averageDamage <= 0) {
        if (!applyTriggeredAbilityResponse(state, actor, targetRef.unit, activeMove, result.appliedType)) {
          state.log.unshift(`${actor.pokemon.displayName}'s ${move.name} had no effect on ${targetRef.unit.pokemon.displayName}.`);
        }
        continue;
      }
      damage = Math.round((result.minDamage + result.maxDamage) / 2);
    }
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

    if (targetRef.unit.substituteHp > 0) {
      const dealtToSubstitute = Math.min(targetRef.unit.substituteHp, damage);
      targetRef.unit.substituteHp = Math.max(0, targetRef.unit.substituteHp - dealtToSubstitute);
      landedHit = true;
      totalDamage += dealtToSubstitute;
      actor.damageDealt += dealtToSubstitute;
      state.log.unshift(`${actor.pokemon.displayName} hit ${targetRef.unit.pokemon.displayName}'s substitute for ${dealtToSubstitute} damage.`);
      if (targetRef.unit.substituteHp <= 0) {
        state.log.unshift(`${targetRef.unit.pokemon.displayName}'s substitute broke.`);
      }
      continue;
    }

    const dealt = lowerUnitHp(targetRef.unit, damage);
    if (dealt <= 0) {
      continue;
    }

    landedHit = true;
    totalDamage += dealt;
    actor.damageDealt += dealt;
    state.log.unshift(`${actor.pokemon.displayName} used ${move.name} on ${targetRef.unit.pokemon.displayName} for ${dealt} damage.`);
    if (result && result.effectiveness >= 2) {
      state.log.unshift(`It's super effective against ${targetRef.unit.pokemon.displayName}.`);
    } else if (result && result.effectiveness > 0 && result.effectiveness < 1) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} resisted the hit.`);
    }
    if (targetRef.unit.fainted) {
      actor.knockouts += 1;
      state.log.unshift(`${targetRef.unit.pokemon.displayName} was knocked out by ${actor.pokemon.displayName} using ${move.name}.`);
      if (targetRef.unit.destinyBondActive && !actor.fainted) {
        lowerUnitHp(actor, actor.currentHp);
        state.log.unshift(`${actor.pokemon.displayName} was taken down by Destiny Bond.`);
      }
    }
    maybeTriggerHealingBerry(state, targetRef.unit);
    applyProtectionContactRebound(state, targetRef.unit, actor, move);

    if (move.name === 'Knock Off') {
      removeHeldItem(state, targetRef.unit, move.name);
    }

    if (itemStealMoves.has(move.name) && !actor.heldItemId) {
      const stolenItem = getItemById(targetRef.unit.heldItemId);
      if (stolenItem && itemCanBeRemoved(stolenItem)) {
        actor.heldItemId = targetRef.unit.heldItemId;
        targetRef.unit.heldItemId = null;
        state.log.unshift(`${actor.pokemon.displayName} stole ${targetRef.unit.pokemon.displayName}'s ${stolenItem.name} with ${move.name}.`);
      }
    }

    if (
      move.name === 'Fake Out' &&
      targetRef.unit.turnsActive === 0 &&
      !targetRef.unit.fainted &&
      !unitAbilitiesMatch(targetRef.unit, flinchShieldAbilities) &&
      !secondaryEffectsSuppressedByAbility(actor, move)
    ) {
      targetRef.unit.flinched = true;
      state.log.unshift(`${targetRef.unit.pokemon.displayName} flinched.`);
    } else if (move.name === 'Fake Out' && targetRef.unit.turnsActive === 0 && unitAbilitiesMatch(targetRef.unit, flinchShieldAbilities)) {
      state.log.unshift(`${targetRef.unit.pokemon.displayName} held steady through Fake Out with Inner Focus.`);
    }

    if (move.name !== 'Fake Out' && !secondaryEffectsSuppressedByAbility(actor, move)) {
      const effectChance = move.effectChance ?? 0;
      if (/flinch/i.test(move.description) && effectChance > 0) {
        triggerFlinch(state, targetRef.unit, move, effectChance);
      }
    }

    applyTargetStatEffect(state, actor, targetRef.unit, move);
    applyTargetStatusEffect(state, actor, targetRef.unit, move);
    if (!targetRef.unit.fainted && (move.name === 'Dragon Tail' || move.name === 'Circle Throw')) {
      forceSwitchTarget(state, targetRef, move.name);
    }
  }

  if (drainingMoves.has(move.name) && totalDamage > 0 && !actor.fainted) {
    const recoveredHp = Math.max(1, Math.round(totalDamage * drainFractionForMove(move.name)));
    if (tryHealUnit(state, actor, recoveredHp, move.name)) {
      state.log.unshift(`${actor.pokemon.displayName} drained health back.`);
    }
  }

  if (move.name === 'Beak Blast') {
    actor.beakBlastPrimed = false;
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

  if (isStruggle && landedHit && !actor.fainted) {
    const recoil = Math.max(1, Math.floor(actor.maxHp / 4));
    lowerUnitHp(actor, recoil);
    state.log.unshift(`${actor.pokemon.displayName} took ${recoil} recoil from Struggle.`);
    maybeTriggerHealingBerry(state, actor);
  }

  if (rechargeMoves.has(move.name) && landedHit && !actor.fainted) {
    actor.rechargeTurns = 1;
    actor.rechargeMoveName = move.name;
    state.log.unshift(`${actor.pokemon.displayName} must recharge after ${move.name}.`);
  }

  if (selfDestructMoves.has(move.name) && !actor.fainted) {
    lowerUnitHp(actor, actor.currentHp);
    state.log.unshift(`${actor.pokemon.displayName} fainted after using ${move.name}.`);
  }

  applySelfAfterAttack(state, actor, move, landedHit);
  actor.helpingHand = false;
}

function processPreMoveStatus(state: SimulatorBattleState, actor: SimUnit, selectedMoveName: string | null = null) {
  maybeConsumeStatusBerry(state, actor);
  const sleepUsableMove = selectedMoveName === 'Sleep Talk' || selectedMoveName === 'Snore';

  if (actor.infatuatedBySideId && actor.infatuatedByUnitIndex !== null) {
    const sourceSide = sideForId(state, actor.infatuatedBySideId);
    const sourceUnit = sourceSide.units[actor.infatuatedByUnitIndex] ?? null;
    const sourceStillActive = Boolean(
      sourceUnit &&
      !sourceUnit.fainted &&
      sourceSide.active.includes(actor.infatuatedByUnitIndex),
    );
    if (!sourceStillActive) {
      actor.infatuatedBySideId = null;
      actor.infatuatedByUnitIndex = null;
    } else if (Math.random() < 0.5) {
      state.log.unshift(`${actor.pokemon.displayName} is immobilized by infatuation.`);
      return false;
    }
  }

  if (actor.confusionTurns > 0) {
    actor.confusionTurns = Math.max(0, actor.confusionTurns - 1);
    if (Math.random() < 1 / 3) {
      const damage = confusionSelfHitDamage(actor);
      lowerUnitHp(actor, damage);
      state.log.unshift(`${actor.pokemon.displayName} hurt itself in confusion for ${damage} damage.`);
      maybeTriggerHealingBerry(state, actor);
      return false;
    }

    if (actor.confusionTurns === 0) {
      state.log.unshift(`${actor.pokemon.displayName} snapped out of confusion.`);
    }
  }

  if (actor.build.status === 'sleep') {
    actor.sleepTurns += 1;
    let stillAsleep = false;
    if (actor.sleepSource === 'rest') {
      stillAsleep = actor.sleepTurns < 3;
      if (stillAsleep && !sleepUsableMove) {
        state.log.unshift(`${actor.pokemon.displayName} is asleep.`);
        return false;
      }
    } else {
      if (actor.sleepTurns === 1) {
        stillAsleep = true;
      } else if (actor.sleepTurns === 2 && Math.random() > 1 / 3) {
        stillAsleep = true;
      }

      if (stillAsleep && !sleepUsableMove) {
        state.log.unshift(`${actor.pokemon.displayName} is asleep.`);
        return false;
      }
    }

    if (stillAsleep) {
      return true;
    }

    actor.build.status = 'healthy';
    actor.sleepTurns = 0;
    actor.sleepSource = null;
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

  if (actor.lockOnTurns > 0) {
    actor.lockOnTurns = Math.max(0, actor.lockOnTurns - 1);
    if (actor.lockOnTurns === 0) {
      actor.lockOnTargetSideId = null;
      actor.lockOnTargetUnitIndex = null;
    }
  }

  return true;
}

function endTurnSideEffects(state: SimulatorBattleState, side: SimSide) {
  for (const unit of side.units) {
    if (unit.fainted) {
      continue;
    }

    const activeOnField = side.active.includes(side.units.indexOf(unit));
    unit.turnsActive += activeOnField ? 1 : 0;
    clearProtectionState(unit);
    unit.flinched = false;
  unit.helpingHand = false;
  unit.actedThisTurn = false;
    unit.beakBlastPrimed = false;
    unit.pendingAfterYou = false;
    unit.quashedThisTurn = false;
    const ability = abilityNameForUnit(unit);
    const types = typeListForUnit(state, unit);

    if (!activeOnField) {
      continue;
    }

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
      tryHealUnit(state, unit, healAmount(unit, 0.125), 'Poison Heal');
    }

    if (unit.saltCure) {
      const saltDamageRate = types.includes('Water') || types.includes('Steel') ? 0.25 : 0.125;
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * saltDamageRate)));
    }

    if (unit.bindingTurns > 0) {
      lowerUnitHp(unit, Math.max(1, Math.round(unit.maxHp * Math.max(unit.bindingDamageRate, 0.125))));
      unit.bindingTurns = Math.max(0, unit.bindingTurns - 1);
      if (unit.bindingTurns <= 0) {
        unit.bindingDamageRate = 0;
        unit.trappedByMove = null;
      }
    }

    if (unit.syrupTurns > 0) {
      applySingleStage(unit, 'speedStage', -1);
      unit.syrupTurns = Math.max(0, unit.syrupTurns - 1);
    }

    if (unit.yawnTurns > 0) {
      unit.yawnTurns = Math.max(0, unit.yawnTurns - 1);
      if (unit.yawnTurns === 0 && unit.build.status === 'healthy') {
        maybeInflictStatus(state, null, unit, 'sleep', 'Yawn');
      }
    }

    if (unit.perishSongTurns > 0) {
      unit.perishSongTurns = Math.max(0, unit.perishSongTurns - 1);
      if (unit.perishSongTurns > 0) {
        state.log.unshift(`${unit.pokemon.displayName}'s perish count fell to ${unit.perishSongTurns}.`);
      } else {
        lowerUnitHp(unit, unit.currentHp);
        state.log.unshift(`${unit.pokemon.displayName} fainted because of Perish Song.`);
      }
    }

    if (unit.fainted) {
      continue;
    }

    const item = activeItemForUnit(state, unit);
    if (item?.name === 'Leftovers') {
      tryHealUnit(state, unit, healAmount(unit, 0.0625), 'Leftovers');
    }

    if (item?.name === 'Black Sludge') {
      if (types.includes('Poison')) {
        tryHealUnit(state, unit, healAmount(unit, 0.0625), 'Black Sludge');
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
      tryHealUnit(state, unit, healAmount(unit, 0.0625), 'Grassy Terrain');
    }

    if (unit.aquaRing) {
      tryHealUnit(state, unit, healAmount(unit, 0.0625), 'Aqua Ring');
    }

    if (unit.ingrain) {
      tryHealUnit(state, unit, healAmount(unit, 0.0625), 'Ingrain');
    }

    if (unit.seededBySideId && !typeListForUnit(state, unit).includes('Grass')) {
      const leeched = Math.max(1, Math.round(unit.maxHp * 0.125));
      lowerUnitHp(unit, leeched);
      const healingSide = sideForId(state, unit.seededBySideId);
      const healingTarget = healingSide.active.map((unitIndex) => healingSide.units[unitIndex]).find((candidate) => candidate && !candidate.fainted) ?? null;
      if (healingTarget) {
        tryHealUnit(state, healingTarget, leeched, 'Leech Seed');
      }
    }

    maybeTriggerHealingBerry(state, unit);

    unit.tauntTurns = Math.max(0, unit.tauntTurns - 1);
    unit.encoreTurns = Math.max(0, unit.encoreTurns - 1);
    unit.disableTurns = Math.max(0, unit.disableTurns - 1);
    unit.throatChopTurns = Math.max(0, unit.throatChopTurns - 1);
    unit.healingPreventedTurns = Math.max(0, unit.healingPreventedTurns - 1);
    unit.magnetRiseTurns = Math.max(0, unit.magnetRiseTurns - 1);
    unit.electrifiedTurns = Math.max(0, unit.electrifiedTurns - 1);
    unit.actedThisTurn = false;
    clearVolatileChoiceLocks(unit);
  }

  side.tailwindTurns = Math.max(0, side.tailwindTurns - 1);
  side.reflectTurns = Math.max(0, side.reflectTurns - 1);
  side.lightScreenTurns = Math.max(0, side.lightScreenTurns - 1);
  side.auroraVeilTurns = Math.max(0, side.auroraVeilTurns - 1);
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
        if (tryHealUnit(state, receiver, wish.healAmount, 'Wish')) {
          state.log.unshift(`${receiver.pokemon.displayName} received a delayed Wish heal.`);
        }
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

type AiThreatProfile = {
  maxDamage: number;
  maxRatio: number;
  physicalPressure: number;
  specialPressure: number;
  fasterThreats: number;
};

type AiActionCandidate = {
  choice: SimulatorChoice;
  score: number;
};

function aiAccuracyFactor(state: SimulatorBattleState, actor: SimUnit, target: SimUnit, move: PokemonMove) {
  if (!move.accuracy || move.accuracy >= 101) {
    return 1;
  }
  if (move.name === 'Toxic' && typeListForUnit(state, actor).includes('Poison')) {
    return 1;
  }
  if (move.name === 'Blizzard' && state.environment.weather === 'snow') {
    return 1;
  }
  if (move.name === 'Thunder' && state.environment.weather === 'rain') {
    return 1;
  }
  if ((move.name === 'Thunder' || move.name === 'Hurricane') && state.environment.weather === 'sun') {
    return 0.5;
  }
  return Math.max(0.55, Math.min(1, move.accuracy / 100));
}

function aiProjectedDamage(
  state: SimulatorBattleState,
  actingSide: SimSide,
  defendingSide: SimSide,
  attacker: SimUnit,
  target: SimUnit,
  move: PokemonMove,
) {
  const spreadTargetsHit = moveScope(move) !== 'single' && livingActiveTargets(defendingSide).length > 1 ? 2 : 1;
  const result = calculateDamageWithOverrides(currentBuild(attacker), currentBuild(target), move, {
    ...screenAwareEnvironment(state, defendingSide),
    helpingHand: attacker.helpingHand,
    spreadTargetsHit,
  }, {
    attackerPokemon: attacker.pokemon,
    defenderPokemon: target.pokemon,
    attackerStats: effectiveStatsForUnit(attacker),
    defenderStats: effectiveStatsForUnit(target),
    attackerTypes: typeListForUnit(state, attacker),
    defenderTypes: typeListForUnit(state, target),
    attackerAbility: abilityNameForUnit(attacker),
    defenderAbility: abilityNameForUnit(target),
    attackerGrounded: unitGroundedInState(state, attacker),
    defenderGrounded: unitGroundedInState(state, target),
    attackerSpeed: combatSpeed(attacker, actingSide.tailwindTurns, state.trickRoomTurns),
    defenderSpeed: combatSpeed(target, defendingSide.tailwindTurns, state.trickRoomTurns),
  });

  if (!result || result.koSummary === 'Immune' || result.averageDamage <= 0) {
    return null;
  }

  return {
    result,
    spreadTargetsHit,
    averageDamage: Math.round((result.minDamage + result.maxDamage) / 2),
  };
}

function aiThreatProfileForUnit(state: SimulatorBattleState, sideId: SideId, unit: SimUnit) {
  const actingSide = sideForId(state, sideId);
  const opposingSideId: SideId = sideId === 'player' ? 'opponent' : 'player';
  const defendingSide = opposingSide(state, sideId);
  let maxDamage = 0;
  let maxRatio = 0;
  let physicalPressure = 0;
  let specialPressure = 0;
  let fasterThreats = 0;
  const unitSpeed = combatSpeed(unit, actingSide.tailwindTurns, state.trickRoomTurns);

  for (const foeRef of livingActiveTargets(defendingSide)) {
    const foe = foeRef.unit;
    const foeSpeed = combatSpeed(foe, defendingSide.tailwindTurns, state.trickRoomTurns);
    if (foeSpeed > unitSpeed) {
      fasterThreats += 1;
    }

    const moveList =
      foe.chargingTurns > 0 && foe.chargingMoveId
        ? [findMove(foe, foe.chargingMoveId)].filter((entry): entry is PokemonMove => Boolean(entry))
        : legalMovesForUnit(foe, state, opposingSideId);

    for (const move of moveList) {
      if (move.category === 'Status') {
        continue;
      }

      const projection = aiProjectedDamage(state, defendingSide, actingSide, foe, unit, move);
      if (!projection) {
        continue;
      }

      const adjustedDamage = Math.max(1, Math.round(projection.averageDamage * aiAccuracyFactor(state, foe, unit, move)));
      const ratio = adjustedDamage / Math.max(1, unit.currentHp);
      maxDamage = Math.max(maxDamage, adjustedDamage);
      maxRatio = Math.max(maxRatio, ratio);
      if (move.category === 'Physical') {
        physicalPressure = Math.max(physicalPressure, ratio);
      } else if (move.category === 'Special') {
        specialPressure = Math.max(specialPressure, ratio);
      }
    }
  }

  return {
    maxDamage,
    maxRatio,
    physicalPressure,
    specialPressure,
    fasterThreats,
  } satisfies AiThreatProfile;
}

function aiAverageCombatSpeed(state: SimulatorBattleState, side: SimSide) {
  const liveUnits = livingActiveTargets(side);
  if (!liveUnits.length) {
    return 0;
  }

  return liveUnits.reduce((sum, entry) => sum + combatSpeed(entry.unit, side.tailwindTurns, state.trickRoomTurns), 0) / liveUnits.length;
}

function aiStatusMoveCount(unit: SimUnit) {
  return moveIdsForUnit(unit)
    .map((moveId) => findMove(unit, moveId))
    .filter((move): move is PokemonMove => Boolean(move))
    .filter((move) => move.category === 'Status').length;
}

function aiOffensiveChoiceScore(
  state: SimulatorBattleState,
  sideId: SideId,
  actorSlot: number,
  unit: SimUnit,
  move: PokemonMove,
  targetSlot: number,
) {
  const actingSide = sideForId(state, sideId);
  const defendingSide = opposingSide(state, sideId);
  if ((move.name === 'Fake Out' || move.name === 'First Impression') && unit.turnsActive > 0) {
    return null;
  }
  const target = targetActiveUnit(defendingSide, targetSlot);
  if (!target || target.fainted) {
    return null;
  }

  const projection = aiProjectedDamage(state, actingSide, defendingSide, unit, target, move);
  if (!projection) {
    return null;
  }

  const accuracyFactor = aiAccuracyFactor(state, unit, target, move);
  let score = projection.averageDamage / Math.max(1, target.currentHp) * 92 * accuracyFactor;
  score += projection.result.effectiveness > 1 ? projection.result.effectiveness * 18 : 0;
  score -= projection.result.effectiveness > 0 && projection.result.effectiveness < 1 ? (1 - projection.result.effectiveness) * 18 : 0;

  if (projection.result.minDamage >= target.currentHp) {
    score += 130;
  } else if (projection.result.maxDamage >= target.currentHp) {
    score += 78;
  }

  if (movePriority(move, unit, state) > 0 && combatSpeed(unit, actingSide.tailwindTurns, state.trickRoomTurns) < combatSpeed(target, defendingSide.tailwindTurns, state.trickRoomTurns)) {
    score += 12;
  }
  if (move.name === 'Fake Out') {
    const targetThreat = aiThreatProfileForUnit(state, sideId === 'player' ? 'opponent' : 'player', target);
    score += 58 + targetThreat.maxRatio * 18;
  }

  if (moveScope(move) !== 'single') {
    const otherTargets = livingActiveTargets(defendingSide).filter((entry) => entry.activeSlot !== targetSlot);
    for (const otherTargetRef of otherTargets) {
      const otherProjection = aiProjectedDamage(state, actingSide, defendingSide, unit, otherTargetRef.unit, move);
      if (!otherProjection) {
        continue;
      }
      score += otherProjection.averageDamage / Math.max(1, otherTargetRef.unit.currentHp) * 42 * aiAccuracyFactor(state, unit, otherTargetRef.unit, move);
      if (otherProjection.result.minDamage >= otherTargetRef.unit.currentHp) {
        score += 55;
      }
    }
  }

  if (moveScope(move) === 'all-adjacent' && state.format === 'Doubles') {
    for (const allyRef of livingActiveTargets(actingSide).filter((entry) => entry.activeSlot !== actorSlot)) {
      const collateralProjection = aiProjectedDamage(state, actingSide, actingSide, unit, allyRef.unit, move);
      if (!collateralProjection) {
        continue;
      }
      score -= collateralProjection.averageDamage / Math.max(1, allyRef.unit.currentHp) * 68;
      if (collateralProjection.result.minDamage >= allyRef.unit.currentHp) {
        score -= 120;
      }
    }
  }

  if ((move.name === 'Icy Wind' || move.name === 'Electroweb' || move.name === 'Bulldoze' || move.name === 'Mud Shot' || move.name === 'Low Sweep' || move.name === 'Rock Tomb') && state.format === 'Doubles') {
    const foesFasterNow = livingActiveTargets(defendingSide).filter((entry) =>
      combatSpeed(entry.unit, defendingSide.tailwindTurns, state.trickRoomTurns) > combatSpeed(unit, actingSide.tailwindTurns, state.trickRoomTurns),
    ).length;
    score += foesFasterNow * 16;
  }

  return score;
}

function aiBestDamageScoreForUnit(state: SimulatorBattleState, sideId: SideId, actorSlot: number, unit: SimUnit) {
  const opposing = opposingSide(state, sideId);
  let bestScore = -Infinity;
  for (const move of legalMovesForUnit(unit, state, sideId)) {
    if (move.category === 'Status') {
      continue;
    }
    for (const targetRef of livingActiveTargets(opposing)) {
      const score = aiOffensiveChoiceScore(state, sideId, actorSlot, unit, move, targetRef.activeSlot);
      if (score !== null) {
        bestScore = Math.max(bestScore, score);
      }
    }
  }
  return Number.isFinite(bestScore) ? bestScore : 0;
}

function aiSwitchInBonus(state: SimulatorBattleState, sideId: SideId, candidate: SimUnit) {
  const opposing = opposingSide(state, sideId);
  const opposingTypes = new Set<string>();
  for (const foeRef of livingActiveTargets(opposing)) {
    for (const move of legalMovesForUnit(foeRef.unit, state, sideId === 'player' ? 'opponent' : 'player')) {
      opposingTypes.add(move.type);
    }
  }

  const ability = abilityNameForUnit(candidate);
  switch (ability) {
    case 'Intimidate':
      return 20;
    case 'Lightning Rod':
      return opposingTypes.has('Electric') ? 18 : 8;
    case 'Storm Drain':
    case 'Water Absorb':
      return opposingTypes.has('Water') ? 18 : 8;
    case 'Flash Fire':
      return opposingTypes.has('Fire') ? 18 : 8;
    case 'Volt Absorb':
      return opposingTypes.has('Electric') ? 16 : 6;
    case 'Sap Sipper':
      return opposingTypes.has('Grass') ? 14 : 4;
    case 'Drought':
    case 'Drizzle':
    case 'Sand Stream':
    case 'Snow Warning':
      return state.weatherTurns <= 1 ? 14 : 6;
    case 'Electric Surge':
    case 'Grassy Surge':
    case 'Misty Surge':
    case 'Psychic Surge':
      return state.terrainTurns <= 1 ? 12 : 5;
    default:
      return 0;
  }
}

function aiBestSwitchChoice(
  state: SimulatorBattleState,
  sideId: SideId,
  actorSlot: number,
  unit: SimUnit,
  bestMoveScore: number,
  threat: AiThreatProfile,
) {
  const actingSide = sideForId(state, sideId);
  if (!canUnitSwitchOut(state, unit) || !livingBenchTargets(actingSide).length) {
    return null;
  }

  const hpRatio = unit.currentHp / Math.max(1, unit.maxHp);
  const shouldLookForSwitch = threat.maxRatio >= 0.95 || (hpRatio <= 0.38 && threat.maxRatio >= 0.55);
  if (!shouldLookForSwitch) {
    return null;
  }

  let bestCandidate: AiActionCandidate | null = null;
  for (const benchIndex of livingBenchTargets(actingSide)) {
    const benchUnit = actingSide.units[benchIndex] ?? null;
    if (!benchUnit || benchUnit.fainted) {
      continue;
    }

    const benchThreat = aiThreatProfileForUnit(state, sideId, benchUnit);
    const offensivePressure = aiBestDamageScoreForUnit(state, sideId, actorSlot, benchUnit);
    const healthScore = benchUnit.currentHp / Math.max(1, benchUnit.maxHp) * 24;
    const safetyScore = (1 - Math.min(1.4, benchThreat.maxRatio)) * 58;
    const switchInScore = aiSwitchInBonus(state, sideId, benchUnit);
    const candidateScore = offensivePressure * 0.72 + safetyScore + healthScore + switchInScore;
    if (!bestCandidate || candidateScore > bestCandidate.score) {
      bestCandidate = {
        choice: { type: 'switch', actor: actorSlot, target: benchIndex },
        score: candidateScore,
      };
    }
  }

  if (!bestCandidate) {
    return null;
  }

  return bestCandidate.score > bestMoveScore + 10 ? bestCandidate : null;
}

function aiChoiceForUnit(state: SimulatorBattleState, sideId: SideId, actor: number): SimulatorChoice {
  const actingSide = sideForId(state, sideId);
  const defendingSide = opposingSide(state, sideId);
  const unit = targetActiveUnit(actingSide, actor);
  if (!unit) {
    return { type: 'move', actor, moveId: actingSide.units[actingSide.active[actor]]?.build.moveIds[0] ?? '', target: 0 };
  }

  const legalMoves = legalMovesForUnit(unit, state, sideId);
  const liveOpponents = livingActiveTargets(defendingSide);
  const liveAllies = livingActiveTargets(actingSide).filter((entry) => entry.activeSlot !== actor);
  const threat = aiThreatProfileForUnit(state, sideId, unit);
  const hpRatio = unit.currentHp / Math.max(1, unit.maxHp);
  const ally = liveAllies[0]?.unit ?? null;
  const allyThreat = ally ? aiThreatProfileForUnit(state, sideId, ally) : null;
  const actingAverageSpeed = aiAverageCombatSpeed(state, actingSide);
  const defendingAverageSpeed = aiAverageCombatSpeed(state, defendingSide);
  const totalBoosts = unit.build.attackStage + unit.build.specialAttackStage + unit.build.speedStage + unit.build.defenseStage + unit.build.specialDefenseStage;
  const candidates: AiActionCandidate[] = [];

  for (const move of legalMoves) {
    if (move.category !== 'Status') {
      for (const targetRef of liveOpponents) {
        const score = aiOffensiveChoiceScore(state, sideId, actor, unit, move, targetRef.activeSlot);
        if (score !== null) {
          candidates.push({
            choice: { type: 'move', actor, moveId: move.id, target: targetRef.activeSlot },
            score,
          });
        }
      }
      continue;
    }

    if (redirectionMoves.has(move.name)) {
      if (state.format === 'Doubles' && allyThreat && actingSide.redirectionUnitIndex === null) {
        const redirectScore = allyThreat.maxRatio >= 0.8 && hpRatio >= 0.5 && threat.maxRatio < 1.15
          ? 98 + Math.min(20, allyThreat.maxRatio * 22)
          : 32;
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score: redirectScore });
      }
      continue;
    }

    if (move.name === 'Helping Hand') {
      if (ally) {
        const allyBest = aiBestDamageScoreForUnit(state, sideId, liveAllies[0]?.activeSlot ?? actor, ally);
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score: 36 + allyBest * 0.92 });
      }
      continue;
    }

    if (allyBoostMoves.has(move.name)) {
      if (ally && threat.maxRatio < 0.7) {
        const allyPhysicalBias = effectiveStatsForUnit(ally).attack >= effectiveStatsForUnit(ally).specialAttack;
        const coachingScore = 54 + (allyPhysicalBias ? 18 : 6) + Math.max(0, 18 - threat.maxRatio * 18);
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score: coachingScore });
      }
      continue;
    }

    if (healingMoves.has(move.name)) {
      const recoveryScore =
        hpRatio <= 0.3
          ? threat.maxRatio < 0.95 ? 118 : 44
          : hpRatio <= 0.5
            ? threat.maxRatio < 0.8 ? 86 : 28
            : 12;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score: move.name === 'Wish' ? recoveryScore - 18 : recoveryScore });
      continue;
    }

    if (move.name === 'Rest') {
      const score =
        hpRatio <= 0.4 || unit.build.status !== 'healthy'
          ? threat.maxRatio < 0.9 ? 104 : 40
          : 8;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (move.name === 'Tailwind') {
      const score = state.format === 'Doubles' && actingSide.tailwindTurns === 0 && state.trickRoomTurns === 0
        ? 82 + Math.max(0, defendingAverageSpeed - actingAverageSpeed) * 0.18 + threat.fasterThreats * 8
        : 8;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (move.name === 'Trick Room') {
      const speedGap = defendingAverageSpeed - actingAverageSpeed;
      const score = state.trickRoomTurns === 0
        ? speedGap > 8 ? 84 + Math.min(24, speedGap * 0.35) : 12
        : actingAverageSpeed > defendingAverageSpeed ? 62 : 8;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (move.name === 'Reflect') {
      const score = actingSide.reflectTurns === 0 ? 44 + threat.physicalPressure * 54 : 6;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (move.name === 'Light Screen') {
      const score = actingSide.lightScreenTurns === 0 ? 44 + threat.specialPressure * 54 : 6;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (move.name === 'Aurora Veil') {
      const score = actingSide.auroraVeilTurns === 0 && state.environment.weather === 'snow'
        ? 68 + Math.max(threat.physicalPressure, threat.specialPressure) * 45
        : 0;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (protectionMoves.has(move.name) || sideProtectionMoves.has(move.name) || move.name === 'Endure') {
      const fieldStallBonus =
        Math.max(state.trickRoomTurns, actingSide.tailwindTurns, defendingSide.tailwindTurns, state.weatherTurns, state.terrainTurns) > 1
          ? 16
          : 0;
      const protectScore =
        unit.protectStreak === 0
          ? 24 + threat.maxRatio * 78 + fieldStallBonus
          : 12 + threat.maxRatio * 28;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score: protectScore });
      continue;
    }

    if (move.name === 'Stealth Rock') {
      const score = state.format === 'Singles' && !defendingSide.stealthRock && state.turn <= 5 ? 64 : 6;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: 0 }, score });
      continue;
    }

    if (move.name === 'Spikes') {
      const score = state.format === 'Singles' && defendingSide.spikesLayers < 2 && state.turn <= 6 ? 58 - defendingSide.spikesLayers * 8 : 4;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: 0 }, score });
      continue;
    }

    if (move.name === 'Will-O-Wisp' || move.name === 'Thunder Wave' || move.name === 'Glare' || move.name === 'Toxic') {
      for (const targetRef of liveOpponents) {
        const status =
          move.name === 'Will-O-Wisp'
            ? 'burn'
            : move.name === 'Toxic'
              ? 'toxic'
              : 'paralysis';
        if (statusImmunityReason(state, unit, targetRef.unit, status)) {
          continue;
        }
        const targetStats = effectiveStatsForUnit(targetRef.unit);
        const isPhysicalTarget = targetStats.attack >= targetStats.specialAttack;
        const targetThreat = aiThreatProfileForUnit(state, sideId === 'player' ? 'opponent' : 'player', targetRef.unit);
        const statusScore =
          move.name === 'Will-O-Wisp'
            ? 50 + (isPhysicalTarget ? 24 : 0) + targetThreat.maxRatio * 18
            : 48 + (targetThreat.fasterThreats > 0 ? 12 : 0) + (targetStats.speed > effectiveStatsForUnit(unit).speed ? 18 : 0);
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: targetRef.activeSlot }, score: statusScore });
      }
      continue;
    }

    if (move.name === 'Strength Sap') {
      for (const targetRef of liveOpponents) {
        const targetStats = effectiveStatsForUnit(targetRef.unit);
        const targetThreat = aiThreatProfileForUnit(state, sideId === 'player' ? 'opponent' : 'player', targetRef.unit);
        const score = hpRatio <= 0.55 ? 40 + targetStats.attack * 0.16 + targetThreat.maxRatio * 18 : 8;
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: targetRef.activeSlot }, score });
      }
      continue;
    }

    if (move.name === 'Heal Pulse' || move.name === 'Life Dew') {
      if (ally) {
        const allyHpRatio = ally.currentHp / Math.max(1, ally.maxHp);
        const score = allyHpRatio <= 0.55 ? 72 + Math.max(0, 20 - allyHpRatio * 20) : 18;
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      }
      continue;
    }

    if (move.name === 'Taunt') {
      for (const targetRef of liveOpponents) {
        const statusCount = aiStatusMoveCount(targetRef.unit);
        const score = targetRef.unit.tauntTurns > 0 ? 0 : 26 + statusCount * 10 + (targetRef.unit.lastMoveId ? 8 : 0);
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: targetRef.activeSlot }, score });
      }
      continue;
    }

    if (move.name === 'Encore') {
      for (const targetRef of liveOpponents) {
        const lastMove = targetRef.unit.lastMoveId ? findMove(targetRef.unit, targetRef.unit.lastMoveId) : null;
        const score =
          lastMove && targetRef.unit.encoreTurns <= 0
            ? 40 + (lastMove.category === 'Status' ? 34 : 10) + (protectionMoves.has(lastMove.name) ? 30 : 0) + (boostMoves.has(lastMove.name) ? 20 : 0)
            : 0;
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: targetRef.activeSlot }, score });
      }
      continue;
    }

    if (move.name === 'Disable') {
      for (const targetRef of liveOpponents) {
        const lastMove = targetRef.unit.lastMoveId ? findMove(targetRef.unit, targetRef.unit.lastMoveId) : null;
        const score =
          lastMove && targetRef.unit.disableTurns <= 0
            ? 38 + (lastMove.category === 'Status' ? 8 : 22) + (lastMove.power ? Math.min(20, lastMove.power / 8) : 0)
            : 0;
        candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: targetRef.activeSlot }, score });
      }
      continue;
    }

    if (move.name === 'Gravity') {
      const score = state.gravityTurns === 0 && threat.fasterThreats > 0 ? 40 : 10;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score });
      continue;
    }

    if (boostMoves.has(move.name)) {
      const setupScore = hpRatio > 0.65 && threat.maxRatio < 0.55 && totalBoosts <= 2 ? 74 + (0.7 - threat.maxRatio) * 26 : 10;
      candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: actor }, score: setupScore });
      continue;
    }

    candidates.push({ choice: { type: 'move', actor, moveId: move.id, target: 0 }, score: 6 });
  }

  const bestMoveCandidate =
    candidates.sort((left, right) => right.score - left.score)[0] ??
    { choice: { type: 'move', actor, moveId: legalMoves[0]?.id ?? '', target: 0 } satisfies SimulatorChoice, score: 0 };

  const switchCandidate = aiBestSwitchChoice(state, sideId, actor, unit, bestMoveCandidate.score, threat);
  const selected = switchCandidate && switchCandidate.score > bestMoveCandidate.score ? switchCandidate.choice : bestMoveCandidate.choice;
  return maybeUpgradeChoiceToMega(state, sideId, actor, selected);
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

function reorderQueuedRemainder(state: SimulatorBattleState, queued: QueuedBattleAction[], startIndex: number) {
  const remaining = queued.slice(startIndex);
  remaining.sort((left, right) => {
    const leftSide = sideForId(state, left.side);
    const rightSide = sideForId(state, right.side);
    const leftUnit = targetActiveUnit(leftSide, left.choice.actor);
    const rightUnit = targetActiveUnit(rightSide, right.choice.actor);

    const leftAfterYou = leftUnit?.pendingAfterYou ? 1 : 0;
    const rightAfterYou = rightUnit?.pendingAfterYou ? 1 : 0;
    if (leftAfterYou !== rightAfterYou) {
      return rightAfterYou - leftAfterYou;
    }

    const leftQuashed = leftUnit?.quashedThisTurn ? 1 : 0;
    const rightQuashed = rightUnit?.quashedThisTurn ? 1 : 0;
    if (leftQuashed !== rightQuashed) {
      return leftQuashed - rightQuashed;
    }

    const leftMove = left.choice.type !== 'switch' && leftUnit ? findMove(leftUnit, left.choice.moveId) : null;
    const rightMove = right.choice.type !== 'switch' && rightUnit ? findMove(rightUnit, right.choice.moveId) : null;
    const leftPriority = left.choice.type === 'switch' ? 6 : leftMove && leftUnit ? movePriority(leftMove, leftUnit, state) : 0;
    const rightPriority = right.choice.type === 'switch' ? 6 : rightMove && rightUnit ? movePriority(rightMove, rightUnit, state) : 0;
    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, state.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, state.trickRoomTurns) : 0;
    return compareActionSpeed(leftSpeed, rightSpeed);
  });
  queued.splice(startIndex, remaining.length, ...remaining);
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
    environment: { ...defaultEnvironment, battleFormat: format },
    weatherTurns: 0,
    terrainTurns: 0,
    trickRoomTurns: 0,
    gravityTurns: 0,
    magicRoomTurns: 0,
    wonderRoomTurns: 0,
    fairyLockTurns: 0,
    lastResolvedMoveId: null,
    lastResolvedMoveSideId: null,
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

  clearFaintedActiveSlots(next.player);
  clearFaintedActiveSlots(next.opponent);
  updateWinner(next);
  return next;
}

export function generateAiChoices(state: SimulatorBattleState, sideId: SideId) {
  const side = sideForId(state, sideId);
  return side.active.map((_, actor) => aiChoiceForUnit(state, sideId, actor));
}

export function randomChoicesForSide(state: SimulatorBattleState, sideId: SideId) {
  const side = sideForId(state, sideId);
  const defendingSide = opposingSide(state, sideId);
  const choices: SimulatorChoice[] = [];
  const liveDefendingSlots = defendingSide.active
    .map((unitIndex, index) => ({ unit: defendingSide.units[unitIndex], index }))
    .filter((entry): entry is { unit: SimUnit; index: number } => Boolean(entry.unit && !entry.unit.fainted))
    .map((entry) => entry.index);

  for (const [actor, unitIndex] of side.active.entries()) {
    const unit = side.units[unitIndex];
    if (!unit || unit.fainted) {
      continue;
    }

    const legalMoves = legalMovesForUnit(unit, state, sideId);
    const move = legalMoves[Math.floor(Math.random() * Math.max(1, legalMoves.length))]
      ?? legalMoves[0]
      ?? findMove(unit, unit.chargingMoveId ?? '')
      ?? findMove(unit, moveIdsForUnit(unit)[0] ?? '')
      ?? null;
    if (!move) {
      continue;
    }

    const targetChoices =
      moveScope(move) === 'single' && liveDefendingSlots.length
        ? liveDefendingSlots
        : [0];
    const target = targetChoices[Math.floor(Math.random() * Math.max(1, targetChoices.length))] ?? 0;
    choices.push({
      type: 'move',
      actor,
      moveId: move.id,
      target,
    });
  }

  return choices;
}

export function resolveTurnWithChoices(
  state: SimulatorBattleState,
  playerChoices: SimulatorChoice[],
  opponentSideChoices: SimulatorChoice[],
) {
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
    playerChoices.map((choice) => normalizeChoiceForUnit(next.player, choice, next, 'player')),
  );
  const normalizedOpponentChoices = normalizeMegaChoicesForSide(
    next,
    'opponent',
    opponentSideChoices.map((choice) => normalizeChoiceForUnit(next.opponent, choice, next, 'opponent')),
  );

  for (const side of [next.player, next.opponent]) {
    for (const unit of side.units) {
      unit.beakBlastPrimed = false;
    }
  }
  for (const queuedChoice of [
    ...normalizedPlayerChoices.map((choice) => ({ sideId: 'player' as SideId, choice })),
    ...normalizedOpponentChoices.map((choice) => ({ sideId: 'opponent' as SideId, choice })),
  ]) {
    if (queuedChoice.choice.type === 'switch') {
      continue;
    }
    const actingSide = sideForId(next, queuedChoice.sideId);
    const unit = targetActiveUnit(actingSide, queuedChoice.choice.actor);
    const move = unit ? findMove(unit, queuedChoice.choice.moveId) : null;
    if (unit && move?.name === 'Beak Blast') {
      unit.beakBlastPrimed = true;
    }
  }

  const megaQueue = [
    ...normalizedPlayerChoices.filter((choice): choice is Extract<SimulatorChoice, { type: 'mega' }> => choice.type === 'mega').map((choice) => ({ side: 'player' as SideId, choice })),
    ...normalizedOpponentChoices.filter((choice): choice is Extract<SimulatorChoice, { type: 'mega' }> => choice.type === 'mega').map((choice) => ({ side: 'opponent' as SideId, choice })),
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

  const queued: QueuedBattleAction[] = [
    ...normalizedPlayerChoices.map((choice) => ({ side: 'player' as SideId, choice })),
    ...normalizedOpponentChoices.map((choice) => ({ side: 'opponent' as SideId, choice })),
  ];

  queued.sort((left, right) => {
    const leftSide = sideForId(next, left.side);
    const rightSide = sideForId(next, right.side);
    const leftUnit = targetActiveUnit(leftSide, left.choice.actor);
    const rightUnit = targetActiveUnit(rightSide, right.choice.actor);
    const leftMove = left.choice.type !== 'switch' && leftUnit ? findMove(leftUnit, left.choice.moveId) : null;
    const rightMove = right.choice.type !== 'switch' && rightUnit ? findMove(rightUnit, right.choice.moveId) : null;
    const leftPriority = left.choice.type === 'switch' ? 6 : leftMove && leftUnit ? movePriority(leftMove, leftUnit, next) : 0;
    const rightPriority = right.choice.type === 'switch' ? 6 : rightMove && rightUnit ? movePriority(rightMove, rightUnit, next) : 0;

    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, next.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, next.trickRoomTurns) : 0;
    return compareActionSpeed(leftSpeed, rightSpeed);
  });

  for (let queueIndex = 0; queueIndex < queued.length; queueIndex += 1) {
    const queuedAction = queued[queueIndex];
    const actingSide = sideForId(next, queuedAction.side);
    const defendingSide = opposingSide(next, queuedAction.side);
    const actor = targetActiveUnit(actingSide, queuedAction.choice.actor);
    if (!actor || actor.fainted) {
      continue;
    }

    if (actor.rechargeTurns > 0) {
      const rechargeMoveName = actor.rechargeMoveName ?? 'its last move';
      actor.rechargeTurns = Math.max(0, actor.rechargeTurns - 1);
      if (actor.rechargeTurns === 0) {
        actor.rechargeMoveName = null;
      }
      actor.actedThisTurn = true;
      next.log.unshift(`${actor.pokemon.displayName} is recharging after ${rechargeMoveName}.`);
      continue;
    }

    if (queuedAction.choice.type === 'switch') {
      const currentIndex = actingSide.active[queuedAction.choice.actor];
      const targetIndex = queuedAction.choice.target;
      if (!canUnitSwitchOut(next, actor)) {
        const switchBlockReason = actor.chargingTurns > 0 && actor.chargingMoveName
          ? `it is locked into ${actor.chargingMoveName}`
          : actor.escapeBlockedBySideId !== null
            ? 'it is trapped'
            : next.fairyLockTurns > 0
              ? 'Fairy Lock is active'
              : actor.trappedByMove
                ? `it is trapped by ${actor.trappedByMove}`
                : 'it cannot leave the field right now';
        next.log.unshift(`${actor.pokemon.displayName} could not switch because ${switchBlockReason}.`);
        continue;
      }
      if (!actingSide.bench.includes(targetIndex) || actingSide.units[targetIndex]?.fainted) {
        continue;
      }

      switchOutUnit(actingSide, currentIndex);
      actingSide.active[queuedAction.choice.actor] = targetIndex;
      actingSide.bench = [...actingSide.bench.filter((entry) => entry !== targetIndex), currentIndex];
      actingSide.units[targetIndex].turnsActive = 0;
      actor.actedThisTurn = true;
      next.log.unshift(`${actor.pokemon.displayName} switched out for ${actingSide.units[targetIndex].pokemon.displayName}.`);
      switchInUnit(next, queuedAction.side, targetIndex, false);
      clearFaintedActiveSlots(actingSide);
      updateWinner(next);
      if (next.winner) {
        break;
      }
      continue;
    }

    if (actor.flinched) {
      if (actor.chargingTurns > 0 && actor.chargingMoveName) {
        next.log.unshift(`${actor.pokemon.displayName} lost its ${actor.chargingMoveName} charge.`);
        clearChargeState(actor);
      }
      next.log.unshift(`${actor.pokemon.displayName} flinched and could not move.`);
      actor.flinched = false;
      actor.actedThisTurn = true;
      continue;
    }

    const movePreview = findMove(actor, (queuedAction.choice as Extract<SimulatorChoice, { type: 'move' | 'mega' }>).moveId);
    if (!processPreMoveStatus(next, actor, movePreview?.name ?? null)) {
      if (actor.chargingTurns > 0 && actor.chargingMoveName) {
        next.log.unshift(`${actor.pokemon.displayName} lost its ${actor.chargingMoveName} charge.`);
        clearChargeState(actor);
      }
      actor.actedThisTurn = true;
      continue;
    }

    const actionChoice = queuedAction.choice as Extract<SimulatorChoice, { type: 'move' | 'mega' }>;
    const forcedChargeMove = actor.chargingTurns > 0 && actor.chargingMoveId ? findMove(actor, actor.chargingMoveId) : null;
    const actionLegalMoves = forcedChargeMove ? [] : legalMovesForUnit(actor, next, queuedAction.side);
    const move = forcedChargeMove
      ?? actionLegalMoves.find((entry) => entry.id === actionChoice.moveId)
      ?? actionLegalMoves[0]
      ?? findMove(actor, actionChoice.moveId)
      ?? null;
    if (!move) {
      if (actor.chargingTurns > 0) {
        clearChargeState(actor);
      }
      continue;
    }

    if (!forcedChargeMove) {
      spendMovePp(actor, move.id);
    }

    if (move.name !== 'Destiny Bond') {
      actor.destinyBondActive = false;
    }

    const forcedChargeTarget = actor.chargingTurns > 0 ? actor.chargingTarget ?? actionChoice.target : actionChoice.target;
    if (actor.chargingTurns > 0 && actor.chargingMoveName) {
      next.log.unshift(`${actor.pokemon.displayName} unleashed ${actor.chargingMoveName}.`);
      clearChargeState(actor);
    } else if (chargeMoves.has(move.name)) {
      const bypassReason = chargeBypassReason(next, actor, move);
      if (!bypassReason) {
        actor.lastMoveId = move.id;
        if (!protectionCounterMoves.has(move.name)) {
          actor.protectStreak = 0;
        }
        actor.actedThisTurn = true;
        startChargingMove(next, actor, move, actionChoice.target);
        continue;
      }

      applyChargeStartEffects(next, actor, move);
      if (bypassReason === 'sunlight') {
        next.log.unshift(`${actor.pokemon.displayName} fired ${move.name} immediately thanks to sunlight conditions.`);
      } else {
        actor.lastConsumedItemId = actor.heldItemId;
        actor.heldItemId = null;
        next.log.unshift(`${actor.pokemon.displayName} consumed ${bypassReason} and fired ${move.name} immediately.`);
      }
    }

    const target = resolveMoveTarget(next, defendingSide, forcedChargeTarget, move);
    actor.lastMoveId = move.id;
    if (!protectionCounterMoves.has(move.name)) {
      actor.protectStreak = 0;
    }

    if (move.category === 'Status') {
      applyStatusMove(next, actingSide, defendingSide, actor, move, target);
    } else {
      executeDamageMove(next, actor, target, move, actingSide, defendingSide);
    }
    actor.actedThisTurn = true;
    next.lastResolvedMoveId = actor.lastMoveId ?? move.id;
    next.lastResolvedMoveSideId = queuedAction.side;

    clearFaintedActiveSlots(next.player);
    clearFaintedActiveSlots(next.opponent);
    updateWinner(next);
    if (next.winner) {
      break;
    }

    reorderQueuedRemainder(next, queued, queueIndex + 1);
  }

  endTurnSideEffects(next, next.player);
  endTurnSideEffects(next, next.opponent);
  if (next.weatherTurns > 0) {
    next.weatherTurns = Math.max(0, next.weatherTurns - 1);
    if (next.weatherTurns === 0 && next.environment.weather !== 'clear') {
      next.log.unshift(`The ${next.environment.weather} faded.`);
      next.environment.weather = 'clear';
    }
  }
  if (next.terrainTurns > 0) {
    next.terrainTurns = Math.max(0, next.terrainTurns - 1);
    if (next.terrainTurns === 0 && next.environment.terrain !== 'none') {
      next.log.unshift(`The ${next.environment.terrain} terrain faded.`);
      next.environment.terrain = 'none';
    }
  }
  next.trickRoomTurns = Math.max(0, next.trickRoomTurns - 1);
  next.fairyLockTurns = Math.max(0, next.fairyLockTurns - 1);
  if (next.gravityTurns > 0) {
    next.gravityTurns = Math.max(0, next.gravityTurns - 1);
    if (next.gravityTurns === 0) {
      next.log.unshift('Gravity returned to normal.');
      next.environment.gravity = false;
    }
  }
  if (next.magicRoomTurns > 0) {
    next.magicRoomTurns = Math.max(0, next.magicRoomTurns - 1);
    if (next.magicRoomTurns === 0) {
      next.log.unshift('Magic Room faded.');
      next.environment.magicRoom = false;
    }
  }
  if (next.wonderRoomTurns > 0) {
    next.wonderRoomTurns = Math.max(0, next.wonderRoomTurns - 1);
    if (next.wonderRoomTurns === 0) {
      next.log.unshift('Wonder Room faded.');
      next.environment.wonderRoom = false;
    }
  }
  clearFaintedActiveSlots(next.player);
  clearFaintedActiveSlots(next.opponent);
  updateWinner(next);
  next.turn += 1;

  if (!next.winner) {
    next.log.unshift(`Turn ${next.turn - 1} ended. ${describeActive(next.player)} face ${describeActive(next.opponent)}.`);
  } else {
    const winningName = next.winner === 'player' ? next.player.name : next.opponent.name;
    next.log.unshift(`${winningName} won the battle.`);
  }

  return next;
}

export function resolveTurn(state: SimulatorBattleState, playerChoices: SimulatorChoice[]) {
  return resolveTurnWithChoices(state, playerChoices, generateAiChoices(state, 'opponent'));
}
