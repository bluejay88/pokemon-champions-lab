import {
  bestAttackingStat,
  buildStats,
  effectiveTypes,
  formatPercent,
  grounded,
  resolveAbility,
  resolveHeldItem,
  resolvePokemonForm,
  resistBerryType,
  stageMultiplier,
  typeBoostItemMap,
  typeEffectiveness,
} from './champions';
import type {
  DamageResult,
  EnvironmentState,
  PokemonBuild,
  PokemonEntry,
  PokemonMove,
  StatBlock,
  StatKey,
  StatusCondition,
} from '../types';

const slicingMoves = new Set([
  'Air Cutter',
  'Air Slash',
  'Aerial Ace',
  'Ceaseless Edge',
  'Cross Poison',
  'Cut',
  'Leaf Blade',
  'Night Slash',
  'Psycho Cut',
  'Razor Leaf',
  'Sacred Sword',
  'Solar Blade',
  'Stone Axe',
  'X-Scissor',
]);

const punchMoves = new Set([
  'Bullet Punch',
  'Drain Punch',
  'Dynamic Punch',
  'Fire Punch',
  'Focus Punch',
  'Hammer Arm',
  'Ice Hammer',
  'Ice Punch',
  'Mach Punch',
  'Meteor Mash',
  'Shadow Punch',
  'Sky Uppercut',
  'Thunder Punch',
]);

const biteMoves = new Set([
  'Bite',
  'Crunch',
  'Fire Fang',
  'Fishious Rend',
  'Hyper Fang',
  'Ice Fang',
  'Jaw Lock',
  'Poison Fang',
  'Psychic Fangs',
  'Thunder Fang',
]);

const pulseMoves = new Set([
  'Aura Sphere',
  'Dark Pulse',
  'Dragon Pulse',
  'Heal Pulse',
  'Origin Pulse',
  'Terrain Pulse',
  'Water Pulse',
]);

const soundMoves = new Set([
  'Bug Buzz',
  'Clanging Scales',
  'Disarming Voice',
  'Echoed Voice',
  'Growl',
  'Heal Bell',
  'Howl',
  'Hyper Voice',
  'Metal Sound',
  'Noble Roar',
  'Overdrive',
  'Parting Shot',
  'Perish Song',
  'Psychic Noise',
  'Relic Song',
  'Roar',
  'Round',
  'Screech',
  'Sing',
  'Snarl',
  'Snore',
  'Sparkling Aria',
  'Supersonic',
  'Torch Song',
  'Uproar',
]);

const ballBombMoves = new Set([
  'Aura Sphere',
  'Bullet Seed',
  'Electro Ball',
  'Energy Ball',
  'Focus Blast',
  'Ice Ball',
  'Magnet Bomb',
  'Mist Ball',
  'Octazooka',
  'Pollen Puff',
  'Pyro Ball',
  'Rock Blast',
  'Seed Bomb',
  'Shadow Ball',
  'Sludge Bomb',
  'Weather Ball',
  'Zap Cannon',
]);

const spreadMoves = new Set([
  'Blizzard',
  'Breaking Swipe',
  'Bulldoze',
  'Dazzling Gleam',
  'Discharge',
  'Earthquake',
  'Heat Wave',
  'Hyper Voice',
  'Icy Wind',
  'Lava Plume',
  'Muddy Water',
  'Rock Slide',
  'Snarl',
  'Struggle Bug',
  'Surf',
  'Swift',
]);

const recoilMoves = new Set([
  'Brave Bird',
  'Double-Edge',
  'Flare Blitz',
  'Head Smash',
  'Take Down',
  'Volt Tackle',
  'Wave Crash',
  'Wood Hammer',
]);

const drainingMoves = new Set([
  'Drain Punch',
  'Giga Drain',
  'Horn Leech',
  'Leech Life',
  'Matcha Gotcha',
  'Oblivion Wing',
  'Parabolic Charge',
  'Draining Kiss',
]);

const highPriorityImmunityAbilities = new Set(['Bulletproof', 'Dry Skin', 'Earth Eater', 'Flash Fire', 'Levitate', 'Lightning Rod', 'Motor Drive', 'Sap Sipper', 'Soundproof', 'Storm Drain', 'Volt Absorb', 'Water Absorb', 'Well-Baked Body', 'Wonder Guard']);
const moldBreakerAbilities = new Set(['Mold Breaker', 'Teravolt', 'Turboblaze']);
const normalConversionAbilities = new Set(['Aerilate', 'Galvanize', 'Pixilate', 'Refrigerate']);
const burnImmuneFacade = new Set(['Facade']);
const multiHitWeights = [
  { hits: 2, weight: 0.35 },
  { hits: 3, weight: 0.35 },
  { hits: 4, weight: 0.15 },
  { hits: 5, weight: 0.15 },
];
const randomRollFactors = Array.from({ length: 16 }, (_, index) => 85 + index);
const attackStageFields = {
  attack: 'attackStage',
  specialAttack: 'specialAttackStage',
  defense: 'defenseStage',
  specialDefense: 'specialDefenseStage',
  speed: 'speedStage',
} as const satisfies Record<'attack' | 'specialAttack' | 'defense' | 'specialDefense' | 'speed', keyof PokemonBuild>;

type DamageDistribution = Map<number, number>;
type MutableAttackStatKey = 'attack' | 'specialAttack' | 'defense';
type MutableDefenseStatKey = 'defense' | 'specialDefense';

type PowerContext = {
  attacker: PokemonEntry;
  defender: PokemonEntry;
  attackerBuild: PokemonBuild;
  defenderBuild: PokemonBuild;
  attackerAbility: string | null;
  defenderAbility: string | null;
  attackerStats: StatBlock;
  defenderStats: StatBlock;
  attackerGrounded: boolean;
  defenderGrounded: boolean;
  environment: EnvironmentState;
  moveWeather: EnvironmentState['weather'];
  moveType: string;
  attackerSpeed: number;
  defenderSpeed: number;
  attackerItemName: string | null;
  defenderItemName: string | null;
  notes: string[];
};

type MoveProfile = {
  attackStat: MutableAttackStatKey;
  defenseStat: MutableDefenseStatKey;
  useTargetAttack: boolean;
};

export interface DamageRuntimeOverrides {
  attackerPokemon?: PokemonEntry;
  defenderPokemon?: PokemonEntry;
  attackerStats?: StatBlock;
  defenderStats?: StatBlock;
  attackerTypes?: string[];
  defenderTypes?: string[];
  attackerAbility?: string | null;
  defenderAbility?: string | null;
  attackerGrounded?: boolean;
  defenderGrounded?: boolean;
  attackerSpeed?: number;
  defenderSpeed?: number;
  attackerItemName?: string | null;
  defenderItemName?: string | null;
}

function currentStats(build: PokemonBuild, pokemon: PokemonEntry) {
  return buildStats(pokemon.baseStats, build.evs, build.natureId);
}

function currentHp(stats: StatBlock, build: PokemonBuild) {
  return Math.max(1, Math.round(stats.hp * Math.max(1, Math.min(100, build.currentHpPercent)) / 100));
}

export function isSoundMove(move: PokemonMove) {
  return soundMoves.has(move.name);
}

function isBallBombMove(move: PokemonMove) {
  return ballBombMoves.has(move.name);
}

export function moveMakesContact(move: PokemonMove) {
  const name = move.name.toLowerCase();
  return move.name === 'Struggle' || punchMoves.has(move.name) || biteMoves.has(move.name) || ['tackle', 'claw', 'fang', 'whip', 'kick', 'bash', 'headbutt', 'tail', 'slam', 'jab', 'jab'].some((keyword) => name.includes(keyword));
}

export function moveHasSecondaryEffect(move: PokemonMove) {
  return Boolean(move.effectChance) || /chance|lowers|boosts|flinch|burn|poison|paraly|freeze|confus/i.test(move.description);
}

function hitCountSummary(move: PokemonMove, attackerItemName: string | null) {
  const text = move.description;
  if (/attacks twice/i.test(text) || /used twice/i.test(text)) {
    return { minHits: 2, maxHits: 2, label: '2 hits', weights: [{ hits: 2, weight: 1 }] };
  }

  if (/2 to 5 times/i.test(text)) {
    if (attackerItemName === 'Loaded Dice') {
      return {
        minHits: 4,
        maxHits: 5,
        label: '4-5 hits',
        weights: [{ hits: 4, weight: 0.5 }, { hits: 5, weight: 0.5 }],
      };
    }

    return { minHits: 2, maxHits: 5, label: '2-5 hits', weights: multiHitWeights };
  }

  if (/3 times/i.test(text)) {
    return { minHits: 3, maxHits: 3, label: '3 hits', weights: [{ hits: 3, weight: 1 }] };
  }

  return { minHits: 1, maxHits: 1, label: '1 hit', weights: [{ hits: 1, weight: 1 }] };
}

function positiveStageTotal(build: PokemonBuild) {
  return [build.attackStage, build.defenseStage, build.specialAttackStage, build.specialDefenseStage, build.speedStage]
    .filter((stage) => stage > 0)
    .reduce((sum, stage) => sum + stage, 0);
}

function parseWeightKg(weight: string) {
  const value = Number.parseFloat(weight.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (/lb/i.test(weight)) {
    return value * 0.45359237;
  }

  return value;
}

function speedStat(build: PokemonBuild, pokemon: PokemonEntry, environment: EnvironmentState, abilityName: string | null) {
  let speed = currentStats(build, pokemon).speed * stageMultiplier(build.speedStage);

  if (abilityName === 'Chlorophyll' && environment.weather === 'sun') speed *= 2;
  if (abilityName === 'Swift Swim' && environment.weather === 'rain') speed *= 2;
  if (abilityName === 'Sand Rush' && environment.weather === 'sand') speed *= 2;
  if (abilityName === 'Slush Rush' && environment.weather === 'snow') speed *= 2;
  if (build.status === 'paralysis') speed *= 0.5;

  return Math.max(1, speed);
}

function adjustedMoveType(
  move: PokemonMove,
  attackerAbilityName: string | null,
  environment: EnvironmentState,
  attackerGrounded: boolean,
  notes: string[],
) {
  if (move.name === 'Weather Ball' && environment.weather !== 'clear') {
    const weatherTypeMap: Record<EnvironmentState['weather'], string> = {
      clear: 'Normal',
      sun: 'Fire',
      rain: 'Water',
      sand: 'Rock',
      snow: 'Ice',
    };
    const nextType = weatherTypeMap[environment.weather];
    notes.push(`Weather Ball becomes ${nextType} in ${environment.weather}.`);
    return nextType;
  }

  if (move.name === 'Terrain Pulse' && attackerGrounded && environment.terrain !== 'none') {
    const terrainTypeMap: Record<Exclude<EnvironmentState['terrain'], 'none'>, string> = {
      electric: 'Electric',
      grassy: 'Grass',
      misty: 'Fairy',
      psychic: 'Psychic',
    };
    const nextType = terrainTypeMap[environment.terrain];
    notes.push(`Terrain Pulse becomes ${nextType} on ${environment.terrain} terrain.`);
    return nextType;
  }

  if (move.type !== 'Normal') {
    return move.type;
  }

  switch (attackerAbilityName) {
    case 'Aerilate':
      return 'Flying';
    case 'Galvanize':
      return 'Electric';
    case 'Pixilate':
      return 'Fairy';
    case 'Refrigerate':
      return 'Ice';
    default:
      return move.type;
  }
}

function moveProfile(move: PokemonMove, attackerStats: StatBlock): MoveProfile {
  if (move.name === 'Body Press') {
    return { attackStat: 'defense', defenseStat: 'defense', useTargetAttack: false };
  }

  if (move.name === 'Foul Play') {
    return { attackStat: 'attack', defenseStat: 'defense', useTargetAttack: true };
  }

  if (['Psyshock', 'Psystrike', 'Secret Sword'].includes(move.name)) {
    return { attackStat: 'specialAttack', defenseStat: 'defense', useTargetAttack: false };
  }

  if (move.name === 'Photon Geyser') {
    return attackerStats.attack >= attackerStats.specialAttack
      ? { attackStat: 'attack', defenseStat: 'defense', useTargetAttack: false }
      : { attackStat: 'specialAttack', defenseStat: 'specialDefense', useTargetAttack: false };
  }

  return move.category === 'Physical'
    ? { attackStat: 'attack', defenseStat: 'defense', useTargetAttack: false }
    : { attackStat: 'specialAttack', defenseStat: 'specialDefense', useTargetAttack: false };
}

function resolvedMovePower(move: PokemonMove, context: PowerContext) {
  let power = move.power ?? 0;

  switch (move.name) {
    case 'Facade':
      if (context.attackerBuild.status !== 'healthy') {
        power *= 2;
        context.notes.push('Facade doubles because the attacker has a status condition.');
      }
      break;
    case 'Hex':
    case 'Infernal Parade':
      if (context.defenderBuild.status !== 'healthy') {
        power *= 2;
        context.notes.push(`${move.name} doubles because the defender is statused.`);
      }
      break;
    case 'Venoshock':
      if (context.defenderBuild.status === 'poison' || context.defenderBuild.status === 'toxic') {
        power *= 2;
        context.notes.push('Venoshock doubles because the defender is poisoned.');
      }
      break;
    case 'Brine':
      if (context.defenderBuild.currentHpPercent <= 50) {
        power *= 2;
        context.notes.push('Brine doubles because the defender is at or below half HP.');
      }
      break;
    case 'Acrobatics':
      if (!context.attackerItemName) {
        power *= 2;
        context.notes.push('Acrobatics doubles because the attacker has no item.');
      }
      break;
    case 'Knock Off':
      if (context.defenderItemName && resolveHeldItem(context.defenderBuild)?.category !== 'mega-stone') {
        power *= 1.5;
        context.notes.push('Knock Off gets its stronger first-hit damage because the defender is holding an item.');
      }
      break;
    case 'Weather Ball':
      if (context.moveWeather !== 'clear') {
        power = 100;
      }
      break;
    case 'Terrain Pulse':
      if (context.attackerGrounded && context.environment.terrain !== 'none') {
        power = 100;
      }
      break;
    case 'Expanding Force':
      if (context.attackerGrounded && context.environment.terrain === 'psychic') {
        power = Math.floor(power * 1.5);
        context.notes.push('Expanding Force is boosted by Psychic Terrain.');
      }
      break;
    case 'Misty Explosion':
      if (context.attackerGrounded && context.environment.terrain === 'misty') {
        power = Math.floor(power * 1.5);
        context.notes.push('Misty Explosion is boosted by Misty Terrain.');
      }
      break;
    case 'Grav Apple':
      if (context.environment.gravity) {
        power = Math.floor(power * 1.5);
        context.notes.push('Grav Apple is boosted by Gravity.');
      }
      break;
    case 'Solar Beam':
    case 'Solar Blade':
      if (['rain', 'sand', 'snow'].includes(context.moveWeather)) {
        power *= 0.5;
        context.notes.push(`${move.name} is weakened outside sun because of the current weather.`);
      }
      break;
    case 'Electro Ball': {
      const ratio = context.attackerSpeed / Math.max(1, context.defenderSpeed);
      power = ratio >= 4 ? 150 : ratio >= 3 ? 120 : ratio >= 2 ? 80 : ratio >= 1 ? 60 : 40;
      context.notes.push(`Electro Ball resolves to ${power} power from the current speed ratio.`);
      break;
    }
    case 'Gyro Ball':
      power = Math.max(1, Math.min(150, Math.floor((25 * context.defenderSpeed) / Math.max(1, context.attackerSpeed))));
      context.notes.push(`Gyro Ball resolves to ${power} power from the current speed ratio.`);
      break;
    case 'Eruption':
    case 'Water Spout':
      power = Math.max(1, Math.floor(150 * currentHp(context.attackerStats, context.attackerBuild) / context.attackerStats.hp));
      context.notes.push(`${move.name} scales to ${power} power from the attacker's remaining HP.`);
      break;
    case 'Flail':
    case 'Reversal': {
      const hpRatio = currentHp(context.attackerStats, context.attackerBuild) / Math.max(1, context.attackerStats.hp);
      power = hpRatio <= 0.0417 ? 200 :
        hpRatio <= 0.1042 ? 150 :
          hpRatio <= 0.2083 ? 100 :
            hpRatio <= 0.3542 ? 80 :
              hpRatio <= 0.6875 ? 40 : 20;
      context.notes.push(`${move.name} scales to ${power} power from the attacker's remaining HP.`);
      break;
    }
    case 'Low Kick':
    case 'Grass Knot': {
      const weightKg = parseWeightKg(context.defender.weight);
      power = weightKg >= 200 ? 120 :
        weightKg >= 100 ? 100 :
          weightKg >= 50 ? 80 :
            weightKg >= 25 ? 60 :
              weightKg >= 10 ? 40 : 20;
      context.notes.push(`${move.name} resolves to ${power} power from the defender's weight.`);
      break;
    }
    case 'Stored Power':
    case 'Power Trip':
      power = 20 + positiveStageTotal(context.attackerBuild) * 20;
      context.notes.push(`${move.name} scales to ${power} power from the attacker's boost count.`);
      break;
    case 'Final Gambit':
      power = currentHp(context.attackerStats, context.attackerBuild);
      context.notes.push('Final Gambit deals damage equal to the attacker\'s current HP.');
      break;
    default:
      break;
  }

  return Math.max(1, power);
}

function offensiveItemModifier(
  itemName: string | null,
  move: PokemonMove,
  moveType: string,
  attacker: PokemonEntry,
  attackerBuild: PokemonBuild,
  effectiveness: number,
  environment: EnvironmentState,
) {
  if (!itemName || environment.magicRoom) {
    return 1;
  }

  const typeBoost = typeBoostItemMap(itemName);
  if (typeBoost && typeBoost === moveType) {
    return 1.2;
  }

  if (itemName === 'Light Ball' && attacker.baseSpecies === 'Pikachu') {
    return move.category === 'Physical' || move.category === 'Special' ? 2 : 1;
  }

  if (itemName === 'Scope Lens') {
    return 1;
  }

  if (itemName === 'Shell Bell' || itemName === 'Focus Sash' || itemName === 'Focus Band' || itemName === 'Quick Claw' || itemName === 'White Herb' || itemName === 'Mental Herb' || itemName === 'Choice Scarf') {
    return 1;
  }

  if (itemName === 'Bright Powder') {
    return 1;
  }

  if (itemName === 'King\'s Rock') {
    return 1;
  }

  if (itemName === 'Expert Belt' && effectiveness > 1) {
    return 1.2;
  }

  if (itemName === 'Life Orb') {
    return 1.3;
  }

  if (itemName === 'Choice Band' && move.category === 'Physical') {
    return 1.5;
  }

  if (itemName === 'Choice Specs' && move.category === 'Special') {
    return 1.5;
  }

  if (itemName === 'Muscle Band' && move.category === 'Physical') {
    return 1.1;
  }

  if (itemName === 'Wise Glasses' && move.category === 'Special') {
    return 1.1;
  }

  if (itemName === 'Charcoal' && moveType === 'Fire') return 1.2;
  if (itemName === 'Magnet' && moveType === 'Electric') return 1.2;
  if (itemName === 'Mystic Water' && moveType === 'Water') return 1.2;
  if (itemName === 'Black Glasses' && moveType === 'Dark') return 1.2;
  if (itemName === 'Twisted Spoon' && moveType === 'Psychic') return 1.2;
  if (itemName === 'Dragon Fang' && moveType === 'Dragon') return 1.2;
  if (itemName === 'Sharp Beak' && moveType === 'Flying') return 1.2;
  if (itemName === 'Metal Coat' && moveType === 'Steel') return 1.2;
  if (itemName === 'Miracle Seed' && moveType === 'Grass') return 1.2;
  if (itemName === 'Hard Stone' && moveType === 'Rock') return 1.2;
  if (itemName === 'Fairy Feather' && moveType === 'Fairy') return 1.2;
  if (itemName === 'Spell Tag' && moveType === 'Ghost') return 1.2;
  if (itemName === 'Silk Scarf' && moveType === 'Normal') return 1.2;
  if (itemName === 'Poison Barb' && moveType === 'Poison') return 1.2;
  if (itemName === 'Never-Melt Ice' && moveType === 'Ice') return 1.2;
  if (itemName === 'Silver Powder' && moveType === 'Bug') return 1.2;
  if (itemName === 'Soft Sand' && moveType === 'Ground') return 1.2;
  if (itemName === 'Black Belt' && moveType === 'Fighting') return 1.2;

  if (itemName === 'Focus Band' || itemName === 'Focus Sash') {
    return 1;
  }

  if (itemName === 'White Herb' && attackerBuild.attackStage < 0) {
    return 1;
  }

  return 1;
}

function abilityAttackModifier(
  attackerAbilityName: string | null,
  move: PokemonMove,
  moveType: string,
  environment: EnvironmentState,
  attackerBuild: PokemonBuild,
  effectiveness: number,
) {
  if (!attackerAbilityName) {
    return 1;
  }

  if (move.name === 'Struggle') {
    if (attackerAbilityName === 'Huge Power' || attackerAbilityName === 'Pure Power') {
      return move.category === 'Physical' ? 2 : 1;
    }
    if (attackerAbilityName === 'Guts') {
      return move.category === 'Physical' && attackerBuild.status !== 'healthy' ? 1.5 : 1;
    }
    if (attackerAbilityName === 'Hustle') {
      return move.category === 'Physical' ? 1.5 : 1;
    }
    if (attackerAbilityName === 'Tough Claws') {
      return moveMakesContact(move) ? 1.3 : 1;
    }
    return 1;
  }

  if (
    (attackerAbilityName === 'Blaze' && moveType === 'Fire') ||
    (attackerAbilityName === 'Overgrow' && moveType === 'Grass') ||
    (attackerAbilityName === 'Torrent' && moveType === 'Water') ||
    (attackerAbilityName === 'Swarm' && moveType === 'Bug')
  ) {
    return attackerBuild.currentHpPercent <= 33 ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Huge Power' || attackerAbilityName === 'Pure Power') {
    return move.category === 'Physical' ? 2 : 1;
  }

  if (attackerAbilityName === 'Guts') {
    return move.category === 'Physical' && attackerBuild.status !== 'healthy' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Hustle') {
    return move.category === 'Physical' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Technician') {
    return (move.power ?? 0) <= 60 ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Sheer Force') {
    return moveHasSecondaryEffect(move) ? 1.3 : 1;
  }

  if (attackerAbilityName === 'Sharpness') {
    return slicingMoves.has(move.name) ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Iron Fist') {
    return punchMoves.has(move.name) ? 1.2 : 1;
  }

  if (attackerAbilityName === 'Strong Jaw') {
    return biteMoves.has(move.name) ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Mega Launcher') {
    return pulseMoves.has(move.name) ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Solar Power') {
    return environment.weather === 'sun' && move.category === 'Special' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Tough Claws') {
    return moveMakesContact(move) ? 1.3 : 1;
  }

  if (attackerAbilityName === 'Tinted Lens') {
    return effectiveness < 1 ? 2 : 1;
  }

  if (attackerAbilityName === 'Sand Force') {
    return environment.weather === 'sand' && ['Rock', 'Ground', 'Steel'].includes(moveType) ? 1.3 : 1;
  }

  if (normalConversionAbilities.has(attackerAbilityName)) {
    return move.type === 'Normal' ? 1.2 : 1;
  }

  if (attackerAbilityName === 'Punk Rock') {
    return isSoundMove(move) ? 1.3 : 1;
  }

  if (attackerAbilityName === 'Flare Boost') {
    return move.category === 'Special' && attackerBuild.status === 'burn' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Toxic Boost') {
    return move.category === 'Physical' && (attackerBuild.status === 'poison' || attackerBuild.status === 'toxic') ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Reckless') {
    return recoilMoves.has(move.name) ? 1.2 : 1;
  }

  if (attackerAbilityName === 'Rocky Payload') {
    return moveType === 'Rock' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Dragon\'s Maw') {
    return moveType === 'Dragon' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Transistor') {
    return moveType === 'Electric' ? 1.3 : 1;
  }

  if (attackerAbilityName === 'Steelworker' || attackerAbilityName === 'Steely Spirit') {
    return moveType === 'Steel' ? 1.5 : 1;
  }

  if (attackerAbilityName === 'Neuroforce') {
    return effectiveness > 1 ? 1.25 : 1;
  }

  return 1;
}

function defensiveAbilityModifier(
  defenderAbilityName: string | null,
  move: PokemonMove,
  moveType: string,
  effectiveness: number,
  defenderBuild: PokemonBuild,
) {
  if (!defenderAbilityName) {
    return 1;
  }

  if (defenderAbilityName === 'Thick Fat' && (moveType === 'Fire' || moveType === 'Ice')) {
    return 0.5;
  }

  if (['Filter', 'Solid Rock', 'Prism Armor'].includes(defenderAbilityName) && effectiveness > 1) {
    return 0.75;
  }

  if (['Multiscale', 'Shadow Shield'].includes(defenderAbilityName) && defenderBuild.currentHpPercent >= 100) {
    return 0.5;
  }

  if (defenderAbilityName === 'Heatproof' && moveType === 'Fire') {
    return 0.5;
  }

  if (defenderAbilityName === 'Water Bubble' && moveType === 'Fire') {
    return 0.5;
  }

  if (defenderAbilityName === 'Dry Skin' && moveType === 'Fire') {
    return 1.25;
  }

  if (defenderAbilityName === 'Punk Rock' && isSoundMove(move)) {
    return 0.5;
  }

  if (defenderAbilityName === 'Purifying Salt' && moveType === 'Ghost') {
    return 0.5;
  }

  if (defenderAbilityName === 'Fluffy') {
    if (moveType === 'Fire') {
      return 2;
    }
    return moveMakesContact(move) ? 0.5 : 1;
  }

  return 1;
}

function immunityFromAbility(defenderAbilityName: string | null, move: PokemonMove, moveType: string, effectiveness: number) {
  if (!defenderAbilityName || !highPriorityImmunityAbilities.has(defenderAbilityName)) {
    return false;
  }

  const map: Record<string, string[]> = {
    'Dry Skin': ['Water'],
    'Earth Eater': ['Ground'],
    'Flash Fire': ['Fire'],
    'Levitate': ['Ground'],
    'Lightning Rod': ['Electric'],
    'Motor Drive': ['Electric'],
    'Sap Sipper': ['Grass'],
    'Storm Drain': ['Water'],
    'Volt Absorb': ['Electric'],
    'Water Absorb': ['Water'],
    'Well-Baked Body': ['Fire'],
  };

  if ((map[defenderAbilityName] ?? []).includes(moveType)) {
    return true;
  }

  if (defenderAbilityName === 'Soundproof' && isSoundMove(move)) {
    return true;
  }

  if (defenderAbilityName === 'Bulletproof' && isBallBombMove(move)) {
    return true;
  }

  if (defenderAbilityName === 'Wonder Guard' && effectiveness <= 1) {
    return true;
  }

  return false;
}

function abilityStatMultiplier(
  abilityName: string | null,
  stat: StatKey,
  moveType: string,
  category: PokemonMove['category'],
  environment: EnvironmentState,
  build: PokemonBuild,
) {
  if (!abilityName) {
    return 1;
  }

  if (abilityName === 'Marvel Scale' && stat === 'defense' && build.status !== 'healthy') {
    return 1.5;
  }

  if (abilityName === 'Fur Coat' && stat === 'defense') {
    return 2;
  }

  if (abilityName === 'Ice Scales' && stat === 'specialDefense') {
    return 2;
  }

  if (abilityName === 'Chlorophyll' && stat === 'speed' && environment.weather === 'sun') {
    return 2;
  }

  if (abilityName === 'Swift Swim' && stat === 'speed' && environment.weather === 'rain') {
    return 2;
  }

  if (abilityName === 'Sand Rush' && stat === 'speed' && environment.weather === 'sand') {
    return 2;
  }

  if (abilityName === 'Slush Rush' && stat === 'speed' && environment.weather === 'snow') {
    return 2;
  }

  if (abilityName === 'Water Bubble' && category !== 'Status' && moveType === 'Water' && (stat === 'attack' || stat === 'specialAttack')) {
    return 2;
  }

  return 1;
}

function defensiveItemModifier(itemName: string | null, moveType: string, effectiveness: number, environment: EnvironmentState) {
  if (!itemName || environment.magicRoom || !environment.defenderProtectedByBerry) {
    return 1;
  }

  const resistType = resistBerryType(itemName);
  if (resistType && resistType === moveType && effectiveness > 1) {
    return 0.5;
  }

  return 1;
}

function defensiveStatItemMultiplier(itemName: string | null, stat: 'defense' | 'specialDefense', environment: EnvironmentState) {
  if (!itemName || environment.magicRoom) {
    return 1;
  }

  if (itemName === 'Assault Vest' && stat === 'specialDefense') {
    return 1.5;
  }

  return 1;
}

function terrainModifier(move: PokemonMove, moveType: string, environment: EnvironmentState, attackerGrounded: boolean, defenderGrounded: boolean) {
  if (environment.terrain === 'electric' && moveType === 'Electric' && attackerGrounded) {
    return 1.3;
  }

  if (environment.terrain === 'grassy' && moveType === 'Grass' && attackerGrounded) {
    return 1.3;
  }

  if (environment.terrain === 'psychic' && moveType === 'Psychic' && attackerGrounded) {
    return 1.3;
  }

  if (environment.terrain === 'misty' && moveType === 'Dragon' && defenderGrounded) {
    return 0.5;
  }

  if (environment.terrain === 'grassy' && defenderGrounded && ['Earthquake', 'Bulldoze', 'Magnitude'].includes(move.name)) {
    return 0.5;
  }

  return 1;
}

function weatherModifier(moveType: string, environment: EnvironmentState) {
  if (environment.weather === 'sun') {
    if (moveType === 'Fire') {
      return 1.5;
    }
    if (moveType === 'Water') {
      return 0.5;
    }
  }

  if (environment.weather === 'rain') {
    if (moveType === 'Water') {
      return 1.5;
    }
    if (moveType === 'Fire') {
      return 0.5;
    }
  }

  return 1;
}

function helpingHandModifier(environment: EnvironmentState) {
  return environment.helpingHand ? 1.5 : 1;
}

function spreadModifier(move: PokemonMove, environment: EnvironmentState) {
  if (environment.battleFormat !== 'Doubles' || environment.spreadTargetsHit <= 1) {
    return 1;
  }

  return spreadMoves.has(move.name) ? 0.75 : 1;
}

function screenModifier(move: PokemonMove, environment: EnvironmentState, attackerAbilityName: string | null) {
  if (environment.criticalHit || attackerAbilityName === 'Infiltrator') {
    return 1;
  }

  const reduction =
    environment.battleFormat === 'Doubles' && environment.spreadTargetsHit > 1
      ? 2 / 3
      : 0.5;

  if (environment.auroraVeil) {
    return reduction;
  }

  if (move.category === 'Physical' && environment.reflect) {
    return reduction;
  }

  if (move.category === 'Special' && environment.lightScreen) {
    return reduction;
  }

  return 1;
}

function critModifier(environment: EnvironmentState, attackerAbilityName: string | null) {
  if (!environment.criticalHit) {
    return 1;
  }

  return attackerAbilityName === 'Sniper' ? 2.25 : 1.5;
}

function stageValue(build: PokemonBuild, stat: keyof typeof attackStageFields) {
  return build[attackStageFields[stat]];
}

function effectiveStageMultiplier(
  side: 'attacker' | 'defender',
  stat: keyof typeof attackStageFields,
  build: PokemonBuild,
  environment: EnvironmentState,
  ignoreStages: boolean,
) {
  if (ignoreStages) {
    return 1;
  }

  let stage = stageValue(build, stat);
  if (environment.criticalHit) {
    if (side === 'attacker' && stage < 0) {
      stage = 0;
    }
    if (side === 'defender' && stage > 0) {
      stage = 0;
    }
  }

  return stageMultiplier(stage);
}

function hitDistribution(perHitRolls: number[], hits: number) {
  let distribution: DamageDistribution = new Map([[0, 1]]);

  for (let hit = 0; hit < hits; hit += 1) {
    const next: DamageDistribution = new Map();
    for (const [runningDamage, runningProbability] of distribution.entries()) {
      for (const roll of perHitRolls) {
        const total = runningDamage + roll;
        next.set(total, (next.get(total) ?? 0) + runningProbability * (1 / perHitRolls.length));
      }
    }
    distribution = next;
  }

  return distribution;
}

function mergeDistributions(distributions: Array<{ distribution: DamageDistribution; weight: number }>) {
  const merged: DamageDistribution = new Map();

  for (const entry of distributions) {
    for (const [damage, probability] of entry.distribution.entries()) {
      merged.set(damage, (merged.get(damage) ?? 0) + probability * entry.weight);
    }
  }

  return merged;
}

function convolveDistributions(left: DamageDistribution, right: DamageDistribution) {
  const next: DamageDistribution = new Map();

  for (const [leftDamage, leftProbability] of left.entries()) {
    for (const [rightDamage, rightProbability] of right.entries()) {
      const total = leftDamage + rightDamage;
      next.set(total, (next.get(total) ?? 0) + leftProbability * rightProbability);
    }
  }

  return next;
}

function koChance(distribution: DamageDistribution, defenderHp: number, turns: number) {
  let combined: DamageDistribution = new Map(distribution);
  for (let turn = 1; turn < turns; turn += 1) {
    combined = convolveDistributions(combined, distribution);
  }

  let chance = 0;
  for (const [damage, probability] of combined.entries()) {
    if (damage >= defenderHp) {
      chance += probability;
    }
  }

  return Math.max(0, Math.min(1, chance));
}

function chanceText(chance: number) {
  return `${(chance * 100).toFixed(chance > 0 && chance < 0.01 ? 2 : chance < 0.1 ? 1 : 0)}%`;
}

function koSummary(distribution: DamageDistribution, defenderHp: number) {
  const oneHit = koChance(distribution, defenderHp, 1);
  const twoHit = koChance(distribution, defenderHp, 2);
  const threeHit = koChance(distribution, defenderHp, 3);

  if (oneHit >= 0.9999) return { label: 'Guaranteed 1HKO', oneHit, twoHit, threeHit };
  if (oneHit > 0) return { label: `${chanceText(oneHit)} to 1HKO`, oneHit, twoHit, threeHit };
  if (twoHit >= 0.9999) return { label: 'Guaranteed 2HKO', oneHit, twoHit, threeHit };
  if (twoHit > 0) return { label: `${chanceText(twoHit)} to 2HKO`, oneHit, twoHit, threeHit };
  if (threeHit >= 0.9999) return { label: 'Guaranteed 3HKO', oneHit, twoHit, threeHit };
  if (threeHit > 0) return { label: `${chanceText(threeHit)} to 3HKO`, oneHit, twoHit, threeHit };

  const highestRoll = Math.max(...distribution.keys(), 1);
  return { label: `Needs ${Math.ceil(defenderHp / Math.max(highestRoll, 1))}+ turns`, oneHit, twoHit, threeHit };
}

function distributionStats(distribution: DamageDistribution) {
  const rolls = [...distribution.keys()].sort((left, right) => left - right);
  const average = [...distribution.entries()].reduce((sum, [damage, probability]) => sum + damage * probability, 0);

  return {
    rolls,
    min: rolls[0] ?? 0,
    max: rolls[rolls.length - 1] ?? 0,
    average,
  };
}

export function calculateDamage(
  attackerBuild: PokemonBuild,
  defenderBuild: PokemonBuild,
  move: PokemonMove,
  environment: EnvironmentState,
  overrides?: DamageRuntimeOverrides,
) {
  const attacker = overrides?.attackerPokemon ?? resolvePokemonForm(attackerBuild);
  const defender = overrides?.defenderPokemon ?? resolvePokemonForm(defenderBuild);

  if (!attacker || !defender || move.category === 'Status' || !move.power) {
    return null;
  }

  const attackerAbility =
    overrides && 'attackerAbility' in overrides
      ? overrides.attackerAbility ?? null
      : resolveAbility(attackerBuild, attacker)?.name ?? null;
  const rawDefenderAbility =
    overrides && 'defenderAbility' in overrides
      ? overrides.defenderAbility ?? null
      : resolveAbility(defenderBuild, defender)?.name ?? null;
  const defenderAbility = moldBreakerAbilities.has(attackerAbility ?? '') ? null : rawDefenderAbility;
  const isStruggle = move.name === 'Struggle';
  const moveEnvironment =
    attackerAbility === 'Mega Sol'
      ? { ...environment, weather: 'sun' as const }
      : environment;
  const stagedAttackerBuild =
    move.name === 'Meteor Beam'
      ? { ...attackerBuild, specialAttackStage: Math.min(6, attackerBuild.specialAttackStage + 1) }
      : attackerBuild;
  const attackerStats = overrides?.attackerStats ?? currentStats(attackerBuild, attacker);
  const defenderStats = overrides?.defenderStats ?? currentStats(defenderBuild, defender);
  const attackerGrounded = overrides?.attackerGrounded ?? (environment.gravity || grounded(attacker, attackerBuild));
  const defenderGrounded = overrides?.defenderGrounded ?? (environment.gravity || grounded(defender, defenderBuild));
  const notes: string[] = [];
  const attackerItemName =
    overrides && 'attackerItemName' in overrides
      ? overrides.attackerItemName ?? null
      : resolveHeldItem(attackerBuild)?.name ?? null;
  const defenderItemName =
    overrides && 'defenderItemName' in overrides
      ? overrides.defenderItemName ?? null
      : resolveHeldItem(defenderBuild)?.name ?? null;
  const moveType = isStruggle ? 'Normal' : adjustedMoveType(move, attackerAbility, moveEnvironment, attackerGrounded, notes);
  const attackerTypes = overrides?.attackerTypes ?? effectiveTypes(attacker, attackerBuild, environment.weather);
  const defenderTypes = overrides?.defenderTypes ?? effectiveTypes(defender, defenderBuild, environment.weather);
  const attackerSpeed = overrides?.attackerSpeed ?? speedStat(attackerBuild, attacker, environment, attackerAbility);
  const defenderSpeed = overrides?.defenderSpeed ?? speedStat(defenderBuild, defender, environment, defenderAbility);
  const effectiveness = isStruggle ? 1 : typeEffectiveness(moveType, defenderTypes);

  if (!isStruggle && immunityFromAbility(defenderAbility, move, moveType, effectiveness)) {
    return {
      move,
      appliedType: moveType,
      minDamage: 0,
      maxDamage: 0,
      averageDamage: 0,
      minPercent: 0,
      maxPercent: 0,
      averagePercent: 0,
      attackStat: 0,
      defenseStat: 0,
      stab: 0,
      effectiveness: 0,
      hitSummary: 'No damage',
      koSummary: 'Immune',
      rollRange: [0],
      modifierSummary: [`${defender.displayName}'s ${rawDefenderAbility ?? 'ability'} blanks this line.`],
      koChances: {
        oneHit: 0,
        twoHit: 0,
        threeHit: 0,
      },
      notes: [`${defender.displayName}'s ${rawDefenderAbility ?? 'ability'} blanks ${moveType}-type damage.`],
    } satisfies DamageResult;
  }

  if (move.name === 'Final Gambit') {
    const defenderCurrentHp = currentHp(defenderStats, defenderBuild);
    const fixedDamage = Math.max(0, Math.min(defenderCurrentHp, currentHp(attackerStats, attackerBuild)));
    const fixedPercent = defenderStats.hp > 0 ? (fixedDamage / defenderStats.hp) * 100 : 0;
    return {
      move,
      appliedType: moveType,
      minDamage: fixedDamage,
      maxDamage: fixedDamage,
      averageDamage: fixedDamage,
      minPercent: fixedPercent,
      maxPercent: fixedPercent,
      averagePercent: fixedPercent,
      attackStat: 0,
      defenseStat: 0,
      stab: 1,
      effectiveness,
      hitSummary: `${fixedDamage} fixed damage`,
      koSummary: fixedDamage >= defenderStats.hp ? 'Guaranteed OHKO' : 'No clean KO',
      rollRange: [fixedDamage],
      modifierSummary: ['Final Gambit deals damage equal to the attacker\'s current HP.'],
      koChances: {
        oneHit: fixedDamage >= defenderStats.hp ? 100 : 0,
        twoHit: fixedDamage * 2 >= defenderStats.hp ? 100 : 0,
        threeHit: fixedDamage * 3 >= defenderStats.hp ? 100 : 0,
      },
      notes: ['Final Gambit ignores the normal damage formula and uses the attacker\'s current HP as fixed damage.'],
    } satisfies DamageResult;
  }

  const stab = isStruggle ? 1 : (attackerTypes.includes(moveType) ? (attackerAbility === 'Adaptability' ? 2 : 1.5) : 1);
  const profile = moveProfile(move, attackerStats);
  const power = resolvedMovePower(move, {
    attacker,
    defender,
    attackerBuild,
    defenderBuild,
    attackerAbility,
    defenderAbility,
    attackerStats,
    defenderStats,
    attackerGrounded,
    defenderGrounded,
    environment: moveEnvironment,
    moveWeather: moveEnvironment.weather,
    moveType,
    attackerSpeed,
    defenderSpeed,
    attackerItemName,
    defenderItemName,
    notes,
  });
  const ignoreAttackStages = defenderAbility === 'Unaware';
  const ignoreDefenseStages = attackerAbility === 'Unaware';

  const attackStatBase =
    profile.useTargetAttack
      ? defenderStats.attack
      : attackerStats[profile.attackStat];

  let attackStat = attackStatBase * effectiveStageMultiplier(
    'attacker',
    profile.attackStat === 'defense' ? 'defense' : profile.attackStat,
    profile.useTargetAttack ? defenderBuild : stagedAttackerBuild,
    environment,
    profile.useTargetAttack ? false : ignoreAttackStages,
  );

  let attackerDefenseStat = attackerStats.defense * effectiveStageMultiplier(
    'attacker',
    'defense',
    attackerBuild,
    environment,
    ignoreAttackStages,
  );
  let attackerSpecialDefenseStat = attackerStats.specialDefense * effectiveStageMultiplier(
    'attacker',
    'specialDefense',
    attackerBuild,
    environment,
    ignoreAttackStages,
  );
  let defenderDefenseStat = defenderStats.defense * effectiveStageMultiplier(
    'defender',
    'defense',
    defenderBuild,
    environment,
    ignoreDefenseStages,
  );
  let defenderSpecialDefenseStat = defenderStats.specialDefense * effectiveStageMultiplier(
    'defender',
    'specialDefense',
    defenderBuild,
    environment,
    ignoreDefenseStages,
  );

  attackStat *= abilityStatMultiplier(attackerAbility, profile.attackStat, moveType, move.category, environment, attackerBuild);
  attackerDefenseStat *= abilityStatMultiplier(attackerAbility, 'defense', moveType, move.category, environment, attackerBuild);
  attackerSpecialDefenseStat *= abilityStatMultiplier(attackerAbility, 'specialDefense', moveType, move.category, environment, attackerBuild);
  defenderDefenseStat *= abilityStatMultiplier(defenderAbility, 'defense', moveType, move.category, environment, defenderBuild);
  defenderSpecialDefenseStat *= abilityStatMultiplier(defenderAbility, 'specialDefense', moveType, move.category, environment, defenderBuild);
  attackerDefenseStat *= defensiveStatItemMultiplier(attackerItemName, 'defense', environment);
  attackerSpecialDefenseStat *= defensiveStatItemMultiplier(attackerItemName, 'specialDefense', environment);
  defenderDefenseStat *= defensiveStatItemMultiplier(defenderItemName, 'defense', environment);
  defenderSpecialDefenseStat *= defensiveStatItemMultiplier(defenderItemName, 'specialDefense', environment);

  if (move.category === 'Special' && environment.weather === 'sand') {
    if (attackerTypes.includes('Rock')) {
      attackerSpecialDefenseStat *= 1.5;
    }
    if (defenderTypes.includes('Rock')) {
      defenderSpecialDefenseStat *= 1.5;
      notes.push('Rock-types gain a sand-boosted special bulk bonus.');
    }
  }

  if (move.category === 'Physical' && environment.weather === 'snow') {
    if (attackerTypes.includes('Ice')) {
      attackerDefenseStat *= 1.5;
    }
    if (defenderTypes.includes('Ice')) {
      defenderDefenseStat *= 1.5;
      notes.push('Ice-types gain a snow-boosted physical bulk bonus.');
    }
  }

  if (environment.wonderRoom) {
    [attackerDefenseStat, attackerSpecialDefenseStat] = [attackerSpecialDefenseStat, attackerDefenseStat];
    [defenderDefenseStat, defenderSpecialDefenseStat] = [defenderSpecialDefenseStat, defenderDefenseStat];
    notes.push('Wonder Room swaps Defense and Sp. Def for this damage line.');
  }

  if (!profile.useTargetAttack && profile.attackStat === 'defense') {
    attackStat = attackerDefenseStat;
  }

  const defenseStat = profile.defenseStat === 'defense' ? defenderDefenseStat : defenderSpecialDefenseStat;

  if (attackerBuild.status === 'burn' && move.category === 'Physical' && attackerAbility !== 'Guts' && !burnImmuneFacade.has(move.name)) {
    attackStat *= 0.5;
    notes.push('Burn cuts physical damage on this line.');
  }

  const itemModifier = isStruggle ? 1 : offensiveItemModifier(attackerItemName, move, moveType, attacker, attackerBuild, effectiveness, environment);
  const abilityAttackBoost = abilityAttackModifier(attackerAbility, move, moveType, environment, attackerBuild, effectiveness);
  const abilityDefenseBoost = defensiveAbilityModifier(defenderAbility, move, moveType, effectiveness, defenderBuild);
  const berryModifier = isStruggle ? 1 : defensiveItemModifier(defenderItemName, moveType, effectiveness, environment);
  const terrainBoost = isStruggle ? 1 : terrainModifier(move, moveType, environment, attackerGrounded, defenderGrounded);
  const weatherBoost = isStruggle ? 1 : weatherModifier(moveType, moveEnvironment);
  const helpingHandBoost = helpingHandModifier(environment);
  const spreadBoost = spreadModifier(move, environment);
  const screenBoost = screenModifier(move, environment, attackerAbility);
  const critBoost = critModifier(environment, attackerAbility);
  const hitProfile = hitCountSummary(move, environment.magicRoom ? null : attackerItemName);

  const baseDamage = Math.floor(
    Math.floor((Math.floor((2 * 50) / 5 + 2) * power * Math.max(attackStat, 1)) / Math.max(defenseStat, 1)) / 50 + 2,
  );

  const modifier = stab * effectiveness * itemModifier * abilityAttackBoost * abilityDefenseBoost * berryModifier * terrainBoost * weatherBoost * helpingHandBoost * spreadBoost * screenBoost * critBoost;
  const perHitRolls = randomRollFactors.map((factor) => Math.max(1, Math.floor(baseDamage * modifier * factor / 100)));
  const distribution = mergeDistributions(hitProfile.weights.map((entry) => ({
    distribution: hitDistribution(perHitRolls, entry.hits),
    weight: entry.weight,
  })));
  const stats = distributionStats(distribution);
  const defenderHp = defenderStats.hp;
  const ko = koSummary(distribution, defenderHp);
  const modifierSummary = [
    `Resolved power ${power}`,
    `STAB ${stab.toFixed(2)}x`,
    `Effectiveness ${effectiveness.toFixed(2)}x`,
    `Item ${itemModifier.toFixed(2)}x`,
    `Ability ${abilityAttackBoost.toFixed(2)}x / ${abilityDefenseBoost.toFixed(2)}x`,
    `Terrain ${terrainBoost.toFixed(2)}x`,
    `Weather ${weatherBoost.toFixed(2)}x`,
    `Helping Hand ${helpingHandBoost.toFixed(2)}x`,
    `Spread ${spreadBoost.toFixed(2)}x`,
    `Screens ${screenBoost.toFixed(2)}x`,
    `Crit ${critBoost.toFixed(2)}x`,
  ];

  if (environment.magicRoom && (attackerItemName || defenderItemName)) {
    notes.push('Magic Room suppresses held-item effects on this line.');
  }

  if (!environment.magicRoom && defenderItemName === 'Focus Sash' && defenderBuild.currentHpPercent >= 100 && hitProfile.maxHits === 1) {
    notes.push('Focus Sash can let the defender survive from full HP.');
  }

  if (!environment.magicRoom && defenderItemName === 'Focus Band') {
    notes.push('Focus Band survival rolls are not folded into KO odds.');
  }

  if (!environment.magicRoom && attackerItemName === 'Choice Scarf') {
    notes.push('Choice Scarf affects speed order, not raw move damage.');
  }

  if (attackerAbility === 'Mega Sol' && environment.weather !== 'sun') {
    notes.push('Mega Sol lets the attacker resolve weather-sensitive move rules as though sun were active.');
  }

  if (attackerAbility === 'Stance Change' && attacker.baseSpecies === 'Aegislash') {
    notes.push('Aegislash attack calcs assume Blade Forme offenses for attacking moves.');
  }

  if (moldBreakerAbilities.has(attackerAbility ?? '') && rawDefenderAbility) {
    notes.push(`${attackerAbility} suppresses ${rawDefenderAbility} for this damage line.`);
  }

  return {
    move,
    appliedType: moveType,
    minDamage: stats.min,
    maxDamage: stats.max,
    averageDamage: Number(stats.average.toFixed(1)),
    minPercent: (stats.min / defenderHp) * 100,
    maxPercent: (stats.max / defenderHp) * 100,
    averagePercent: (stats.average / defenderHp) * 100,
    attackStat: Math.round(attackStat),
    defenseStat: Math.round(defenseStat),
    stab,
    effectiveness,
    hitSummary: hitProfile.label,
    koSummary: ko.label,
    rollRange: stats.rolls,
    modifierSummary,
    koChances: {
      oneHit: ko.oneHit,
      twoHit: ko.twoHit,
      threeHit: ko.threeHit,
    },
    notes,
  } satisfies DamageResult;
}

export function calculateDamageWithOverrides(
  attackerBuild: PokemonBuild,
  defenderBuild: PokemonBuild,
  move: PokemonMove,
  environment: EnvironmentState,
  overrides: DamageRuntimeOverrides,
) {
  return calculateDamage(attackerBuild, defenderBuild, move, environment, overrides);
}

export function summaryForResult(result: DamageResult | null) {
  if (!result) {
    return 'Select an attacking move to generate a damage line.';
  }

  return `${result.minDamage}-${result.maxDamage} (${formatPercent(result.minPercent)}-${formatPercent(result.maxPercent)})`;
}
