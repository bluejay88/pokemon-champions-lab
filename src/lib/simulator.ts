import { calculateDamage } from './damage';
import { buildStats, defaultEnvironment, getItemById, getPokemonById, normalizeMoveSelection, resolvePokemonForm, stageMultiplier } from './champions';
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
}

export interface SimSide {
  name: string;
  units: SimUnit[];
  active: number[];
  bench: number[];
  selectedOrder: number[];
  tailwindTurns: number;
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

function stagePriority(move: PokemonMove) {
  if (move.name === 'Protect') return 4;
  if (move.name === 'Fake Out') return 3;
  if (move.category === 'Status') return 1;
  return 0;
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

function activeCount(format: BattleFormat) {
  return format === 'Doubles' ? 2 : 1;
}

function makeUnit(build: PokemonBuild, slotIndex: number) {
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
  } satisfies SimUnit;
}

function makeSide(team: Team, selectedOrder: number[], name: string, format: BattleFormat): SimSide {
  const units = selectedOrder
    .map((slotIndex) => makeUnit(team.slots[slotIndex], slotIndex))
    .filter((unit): unit is SimUnit => Boolean(unit));

  const count = activeCount(format);
  return {
    name,
    units,
    active: units.slice(0, count).map((_, index) => index),
    bench: units.slice(count).map((_, index) => index + count),
    selectedOrder,
    tailwindTurns: 0,
  };
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
  return next;
}

function describeActive(side: SimSide) {
  return side.active
    .map((unitIndex) => side.units[unitIndex]?.pokemon.displayName)
    .filter(Boolean)
    .join(side.active.length > 1 ? ' and ' : '');
}

function targetActiveUnit(side: SimSide, activeSlot: number) {
  const unitIndex = side.active[activeSlot];
  return typeof unitIndex === 'number' ? side.units[unitIndex] ?? null : null;
}

function firstAvailableBench(side: SimSide) {
  return side.bench.find((unitIndex) => !side.units[unitIndex]?.fainted) ?? null;
}

function refillActive(side: SimSide) {
  for (let index = 0; index < side.active.length; index += 1) {
    const unitIndex = side.active[index];
    const unit = typeof unitIndex === 'number' ? side.units[unitIndex] : null;
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

function healUnit(unit: SimUnit, amount: number) {
  unit.currentHp = Math.min(unit.maxHp, unit.currentHp + amount);
}

function lowerUnitHp(unit: SimUnit, amount: number) {
  unit.currentHp = Math.max(0, unit.currentHp - amount);
  if (unit.currentHp <= 0) {
    unit.fainted = true;
  }
}

function movePriority(move: PokemonMove, unit: SimUnit) {
  let priority = stagePriority(move);
  if (priorityMoves.has(move.name)) priority += 1;
  if (move.name === 'Fake Out' && unit.turnsActive === 0) priority += 1;
  return priority;
}

const priorityMoves = new Set(['Fake Out', 'Bullet Punch', 'Sucker Punch', 'Extreme Speed', 'Aqua Jet', 'Ice Shard']);
const healingMoves = new Set(['Recover', 'Roost', 'Slack Off', 'Moonlight', 'Synthesis', 'Wish', 'Shore Up', 'Soft-Boiled']);
const boostMoves = new Map<string, Partial<Record<'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage', number>>>([
  ['Swords Dance', { attackStage: 2 }],
  ['Dragon Dance', { attackStage: 1, speedStage: 1 }],
  ['Calm Mind', { specialAttackStage: 1, specialDefenseStage: 1 }],
  ['Nasty Plot', { specialAttackStage: 2 }],
  ['Bulk Up', { attackStage: 1, defenseStage: 1 }],
  ['Coil', { attackStage: 1, defenseStage: 1 }],
]);

function applyBoosts(unit: SimUnit, boosts: Partial<Record<'attackStage' | 'defenseStage' | 'specialAttackStage' | 'specialDefenseStage' | 'speedStage', number>>) {
  for (const [key, value] of Object.entries(boosts)) {
    const field = key as keyof typeof boosts;
    const stageKey = field as keyof PokemonBuild;
    const currentValue = Number(unit.build[stageKey] ?? 0);
    unit.build[stageKey] = Math.max(-6, Math.min(6, currentValue + Number(value ?? 0))) as never;
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

  if (move.name === 'Helping Hand') {
    const allyIndex = actingSide.active.find((index) => index !== actingSide.units.indexOf(actor));
    if (typeof allyIndex === 'number') {
      actingSide.units[allyIndex].helpingHand = true;
      state.log.unshift(`${actor.pokemon.displayName} boosted its ally with Helping Hand.`);
      return;
    }
  }

  if (move.name === 'Will-O-Wisp' && target && target.build.status === 'healthy') {
    target.build.status = 'burn';
    state.log.unshift(`${target.pokemon.displayName} was burned.`);
    return;
  }

  if (move.name === 'Thunder Wave' && target && target.build.status === 'healthy') {
    target.build.status = 'paralysis';
    state.log.unshift(`${target.pokemon.displayName} was paralyzed.`);
    return;
  }

  if (move.name === 'Parting Shot' && target) {
    target.build.attackStage = Math.max(-6, target.build.attackStage - 1);
    target.build.specialAttackStage = Math.max(-6, target.build.specialAttackStage - 1);
    state.log.unshift(`${actor.pokemon.displayName} softened ${target.pokemon.displayName} with Parting Shot.`);
    return;
  }

  const boosts = boostMoves.get(move.name);
  if (boosts) {
    applyBoosts(actor, boosts);
    state.log.unshift(`${actor.pokemon.displayName} boosted its stats with ${move.name}.`);
    return;
  }

  if (move.name === 'Encore' && target) {
    state.log.unshift(`${actor.pokemon.displayName} locked ${target.pokemon.displayName} into its last line with Encore pressure.`);
    return;
  }

  if (move.name === 'Taunt' && target) {
    state.log.unshift(`${actor.pokemon.displayName} taunted ${target.pokemon.displayName}.`);
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
) {
  if (!target || target.fainted) {
    return;
  }

  if (target.protected) {
    state.log.unshift(`${target.pokemon.displayName} blocked ${move.name} with Protect.`);
    return;
  }

  const attackerBuild = currentBuild(actor);
  const defenderBuild = currentBuild(target);
  const result = calculateDamage(attackerBuild, defenderBuild, move, state.environment);
  let damage = Math.round((result.minDamage + result.maxDamage) / 2);
  if (actor.helpingHand) {
    damage = Math.round(damage * 1.5);
  }

  lowerUnitHp(target, damage);
  state.log.unshift(`${actor.pokemon.displayName} used ${move.name} on ${target.pokemon.displayName} for ${damage} damage.`);

  if (move.name === 'Fake Out' && target.turnsActive === 0 && !target.fainted) {
    target.flinched = true;
    state.log.unshift(`${target.pokemon.displayName} flinched.`);
  }

  if (move.name === 'Will-O-Wisp' && target.build.status === 'healthy') {
    target.build.status = 'burn';
  }

  actor.helpingHand = false;
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

    const item = getItemById(unit.build.itemId);
    if (item?.name === 'Leftovers') {
      healUnit(unit, Math.max(1, Math.round(unit.maxHp * 0.0625)));
    }

    if (!unit.berrySpent && item?.category === 'berry' && unit.currentHp <= unit.maxHp / 2) {
      healUnit(unit, Math.round(unit.maxHp * 0.25));
      unit.berrySpent = true;
    }
  }

  side.tailwindTurns = Math.max(0, side.tailwindTurns - 1);
}

function aiChoiceForUnit(state: SimulatorBattleState, sideId: SideId, actor: number): SimulatorChoice {
  const actingSide = sideId === 'player' ? state.player : state.opponent;
  const defendingSide = sideId === 'player' ? state.opponent : state.player;
  const unit = targetActiveUnit(actingSide, actor);
  if (!unit) {
    return { type: 'move', actor, moveId: actingSide.units[actingSide.active[actor]]?.build.moveIds[0] ?? '', target: 0 };
  }

  const availableMoves = unit.build.moveIds
    .map((moveId) => findMove(unit, moveId))
    .filter((move): move is PokemonMove => Boolean(move));

  const recoveryMove = availableMoves.find((move) => healingMoves.has(move.name));
  if (recoveryMove && unit.currentHp <= unit.maxHp * 0.35) {
    return { type: 'move', actor, moveId: recoveryMove.id, target: actor };
  }

  if (state.turn <= 2 && actingSide.tailwindTurns === 0) {
    const tailwind = availableMoves.find((move) => move.name === 'Tailwind');
    if (tailwind) {
      return { type: 'move', actor, moveId: tailwind.id, target: actor };
    }
  }

  if (unit.currentHp <= unit.maxHp * 0.25) {
    const protect = availableMoves.find((move) => move.name === 'Protect');
    if (protect) {
      return { type: 'move', actor, moveId: protect.id, target: actor };
    }
  }

  let best: { moveId: string; target: number; damage: number } | null = null;
  for (const move of availableMoves) {
    for (let targetIndex = 0; targetIndex < defendingSide.active.length; targetIndex += 1) {
      const target = targetActiveUnit(defendingSide, targetIndex);
      if (!target || move.category === 'Status') {
        continue;
      }
      const result = calculateDamage(currentBuild(unit), currentBuild(target), move, state.environment);
      const damage = (result.minDamage + result.maxDamage) / 2;
      if (!best || damage > best.damage) {
        best = { moveId: move.id, target: targetIndex, damage };
      }
    }
  }

  if (best) {
    return { type: 'move', actor, moveId: best.moveId, target: best.target };
  }

  const firstMove = availableMoves[0];
  return { type: 'move', actor, moveId: firstMove?.id ?? '', target: 0 };
}

export function generateAiChoices(state: SimulatorBattleState, sideId: SideId) {
  const side = sideId === 'player' ? state.player : state.opponent;
  return side.active.map((_, actor) => aiChoiceForUnit(state, sideId, actor));
}

export function resolveTurn(state: SimulatorBattleState, playerChoices: SimulatorChoice[]) {
  const next = structuredClone(state) as SimulatorBattleState;
  const opponentChoices = generateAiChoices(next, 'opponent');
  const queued = [
    ...playerChoices.map((choice) => ({ side: 'player' as SideId, choice })),
    ...opponentChoices.map((choice) => ({ side: 'opponent' as SideId, choice })),
  ];

  queued.sort((left, right) => {
    const leftSide = left.side === 'player' ? next.player : next.opponent;
    const rightSide = right.side === 'player' ? next.player : next.opponent;
    const leftUnit = targetActiveUnit(leftSide, left.choice.actor);
    const rightUnit = targetActiveUnit(rightSide, right.choice.actor);
    const leftMove = left.choice.type === 'move' ? findMove(leftUnit!, left.choice.moveId) : null;
    const rightMove = right.choice.type === 'move' ? findMove(rightUnit!, right.choice.moveId) : null;
    const leftPriority = left.choice.type === 'switch' ? 6 : leftMove ? movePriority(leftMove, leftUnit!) : 0;
    const rightPriority = right.choice.type === 'switch' ? 6 : rightMove ? movePriority(rightMove, rightUnit!) : 0;

    if (leftPriority !== rightPriority) {
      return rightPriority - leftPriority;
    }

    const leftSpeed = leftUnit ? combatSpeed(leftUnit, leftSide.tailwindTurns, next.trickRoomTurns) : 0;
    const rightSpeed = rightUnit ? combatSpeed(rightUnit, rightSide.tailwindTurns, next.trickRoomTurns) : 0;
    return rightSpeed - leftSpeed;
  });

  for (const queuedAction of queued) {
    const actingSide = queuedAction.side === 'player' ? next.player : next.opponent;
    const defendingSide = queuedAction.side === 'player' ? next.opponent : next.player;
    const actor = targetActiveUnit(actingSide, queuedAction.choice.actor);
    if (!actor || actor.fainted) {
      continue;
    }
    if (actor.flinched) {
      next.log.unshift(`${actor.pokemon.displayName} flinched and could not move.`);
      actor.flinched = false;
      continue;
    }

    if (queuedAction.choice.type === 'switch') {
      const currentIndex = actingSide.active[queuedAction.choice.actor];
      const targetIndex = queuedAction.choice.target;
      if (!actingSide.bench.includes(targetIndex) || actingSide.units[targetIndex]?.fainted) {
        continue;
      }
      actingSide.active[queuedAction.choice.actor] = targetIndex;
      actingSide.bench = [...actingSide.bench.filter((entry) => entry !== targetIndex), currentIndex];
      actingSide.units[targetIndex].turnsActive = 0;
      next.log.unshift(`${actor.pokemon.displayName} switched out for ${actingSide.units[targetIndex].pokemon.displayName}.`);
      continue;
    }

    const move = findMove(actor, queuedAction.choice.moveId);
    if (!move) {
      continue;
    }

    const target = targetActiveUnit(defendingSide, queuedAction.choice.target);
    if (move.category === 'Status') {
      applyStatusMove(next, actingSide, defendingSide, actor, move, target);
      continue;
    }

    executeDamageMove(next, actor, target, move, actingSide);
    refillActive(actingSide);
    refillActive(defendingSide);
    updateWinner(next);
    if (next.winner) {
      break;
    }
  }

  endTurnSideEffects(next, next.player);
  endTurnSideEffects(next, next.opponent);
  next.trickRoomTurns = Math.max(0, next.trickRoomTurns - 1);
  refillActive(next.player);
  refillActive(next.opponent);
  updateWinner(next);
  next.turn += 1;

  if (!next.winner) {
    next.log.unshift(`Turn ${next.turn - 1} ended. ${describeActive(next.player)} face ${describeActive(next.opponent)}.`);
  } else {
    next.log.unshift(next.winner === 'player' ? 'You won the simulation.' : 'The AI side won the simulation.');
  }

  return next;
}
