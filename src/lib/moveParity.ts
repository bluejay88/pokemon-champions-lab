import type { PokemonMove } from '../types';

export type MoveParityTier = 'Explicit' | 'Rules-aware' | 'Damage Core' | 'Review Needed';

export interface MoveParityEntry {
  moveId: string;
  moveName: string;
  tier: MoveParityTier;
  summary: string;
  tags: string[];
}

export interface MoveParitySummary {
  total: number;
  explicit: number;
  rulesAware: number;
  damageCore: number;
  reviewNeeded: number;
  coveredPercent: number;
  topReviewMoves: MoveParityEntry[];
}

function buildMoveSet(names: string[]) {
  return new Set(names);
}

const explicitRulesMoves = buildMoveSet([
  'Acupressure',
  'Ally Switch',
  'Aqua Ring',
  'Aurora Veil',
  'Baby-Doll Eyes',
  'Baneful Bunker',
  'Baton Pass',
  'Belly Drum',
  'Chilly Reception',
  'Charge',
  'Clear Smog',
  'Coaching',
  'Coil',
  'Defog',
  'Destiny Bond',
  'Detect',
  'Disable',
  'Double Team',
  'Electric Terrain',
  'Encore',
  'Endure',
  'Fake Tears',
  'Follow Me',
  'Glare',
  'Grassy Terrain',
  'Gravity',
  'Growth',
  'Hail',
  'Haze',
  'Heal Bell',
  'Heal Pulse',
  'Helping Hand',
  'Hypnosis',
  'Ingrain',
  'King\'s Shield',
  'Leech Seed',
  'Life Dew',
  'Light Screen',
  'Magic Room',
  'Metal Sound',
  'Misty Terrain',
  'Morning Sun',
  'Moonlight',
  'Noble Roar',
  'Pain Split',
  'Parting Shot',
  'Perish Song',
  'Protect',
  'Psychic Terrain',
  'Quick Guard',
  'Rage Powder',
  'Rain Dance',
  'Recover',
  'Reflect',
  'Rest',
  'Roar',
  'Roost',
  'Safeguard',
  'Sandstorm',
  'Shore Up',
  'Slack Off',
  'Snowscape',
  'Soft-Boiled',
  'Spikes',
  'Spiky Shield',
  'Spore',
  'Stealth Rock',
  'Strength Sap',
  'Sunny Day',
  'Sweet Scent',
  'Tailwind',
  'Taunt',
  'Tearful Look',
  'Thunder Wave',
  'Torment',
  'Toxic',
  'Toxic Spikes',
  'Toxic Thread',
  'Trick Room',
  'Wide Guard',
  'Whirlwind',
  'Will-O-Wisp',
  'Wish',
  'Wonder Room',
  'Yawn',
]);

const explicitDamageMoves = buildMoveSet([
  'Acid Spray',
  'Apple Acid',
  'Aqua Step',
  'Beak Blast',
  'Bitter Malice',
  'Blaze Kick',
  'Blizzard',
  'Body Slam',
  'Breaking Swipe',
  'Brick Break',
  'Bug Buzz',
  'Bulldoze',
  'Burning Jealousy',
  'Chilling Water',
  'Clanging Scales',
  'Close Combat',
  'Crunch',
  'Dire Claw',
  'Discharge',
  'Draco Meteor',
  'Earth Power',
  'Eerie Spell',
  'Electroweb',
  'Energy Ball',
  'Fake Out',
  'Fire Blast',
  'Fire Fang',
  'Fire Lash',
  'Fire Punch',
  'First Impression',
  'Flame Charge',
  'Flamethrower',
  'Flare Blitz',
  'Flash Cannon',
  'Giga Drain',
  'Grav Apple',
  'Gunk Shot',
  'Hammer Arm',
  'Headlong Rush',
  'Heat Wave',
  'Horn Leech',
  'Ice Hammer',
  'Ice Spinner',
  'Icy Wind',
  'Infernal Parade',
  'Inferno',
  'Lava Plume',
  'Leaf Storm',
  'Low Sweep',
  'Lumina Crash',
  'Lunge',
  'Matcha Gotcha',
  'Metal Claw',
  'Mortal Spin',
  'Muddy Water',
  'Mud-Slap',
  'Mud Shot',
  'Mystical Fire',
  'Night Daze',
  'Nuzzle',
  'Overheat',
  'Parabolic Charge',
  'Psyshield Bash',
  'Psychic Fangs',
  'Rapid Spin',
  'Rock Tomb',
  'Salt Cure',
  'Snarl',
  'Sparkling Aria',
  'Spirit Shackle',
  'Struggle Bug',
  'Superpower',
  'Syrup Bomb',
  'Thunder',
  'U-turn',
  'Volt Switch',
]);

const genericBoostPattern = /raises|boosts|sharply boosts|harshly boosts/i;
const genericDropPattern = /lowers|harshly lowers|drops/i;
const genericStatusPattern = /burn|poison|badly poison|paraly|sleep|freeze/i;
const fieldPattern = /weather|terrain|screen|protect|switch|tailwind|room|safeguard|hazards?/i;
const multiTurnPattern = /for [a-z0-9 -]+ turns?|next turn|while|until it switches/i;

export function moveParityForMove(move: PokemonMove): MoveParityEntry {
  if (explicitRulesMoves.has(move.name)) {
    return {
      moveId: move.id,
      moveName: move.name,
      tier: 'Explicit',
      summary: 'This move has dedicated simulator hooks for its board-state or timing rules.',
      tags: ['status', 'timers', 'field-state'],
    };
  }

  if (explicitDamageMoves.has(move.name)) {
    return {
      moveId: move.id,
      moveName: move.name,
      tier: 'Explicit',
      summary: 'This damaging move has explicit hooks for its rider effect, follow-up effect, or field interaction.',
      tags: ['damage', 'secondary-effect'],
    };
  }

  if (move.category !== 'Status') {
    const description = move.description ?? '';
    const hasComplexRider =
      genericBoostPattern.test(description) ||
      genericDropPattern.test(description) ||
      genericStatusPattern.test(description) ||
      fieldPattern.test(description) ||
      multiTurnPattern.test(description);

    return {
      moveId: move.id,
      moveName: move.name,
      tier: hasComplexRider ? 'Rules-aware' : 'Damage Core',
      summary: hasComplexRider
        ? 'This move rides on the shared damage/accuracy engine and uses the generic simulator path, but a bespoke rider hook is not separately cataloged yet.'
        : 'This move is covered by the shared damage formula, accuracy checks, spread rules, screens, weather, terrain, and item/ability modifiers.',
      tags: hasComplexRider ? ['damage', 'generic-rider'] : ['damage', 'formula'],
    };
  }

  if (genericBoostPattern.test(move.description) || genericDropPattern.test(move.description) || genericStatusPattern.test(move.description)) {
    return {
      moveId: move.id,
      moveName: move.name,
      tier: 'Rules-aware',
      summary: 'This status move fits an existing generic stat/status pattern, but it is not yet listed in the explicit hook registry.',
      tags: ['status', 'pattern'],
    };
  }

  if (fieldPattern.test(move.description) || multiTurnPattern.test(move.description)) {
    return {
      moveId: move.id,
      moveName: move.name,
      tier: 'Review Needed',
      summary: 'This move likely needs a bespoke timing or field-state hook before it can be called cartridge-close.',
      tags: ['review', 'field-state'],
    };
  }

  return {
    moveId: move.id,
    moveName: move.name,
    tier: 'Review Needed',
    summary: 'This move is available in the roster, but it is not currently tagged as explicitly scripted or generic-pattern complete.',
    tags: ['review'],
  };
}

export function buildMoveParitySummary(moves: PokemonMove[], topReviewCount = 12): MoveParitySummary {
  const entries = moves.map(moveParityForMove);
  const explicit = entries.filter((entry) => entry.tier === 'Explicit').length;
  const rulesAware = entries.filter((entry) => entry.tier === 'Rules-aware').length;
  const damageCore = entries.filter((entry) => entry.tier === 'Damage Core').length;
  const reviewNeeded = entries.filter((entry) => entry.tier === 'Review Needed').length;
  const covered = explicit + rulesAware + damageCore;

  return {
    total: entries.length,
    explicit,
    rulesAware,
    damageCore,
    reviewNeeded,
    coveredPercent: entries.length ? Math.round((covered / entries.length) * 100) : 0,
    topReviewMoves: entries
      .filter((entry) => entry.tier === 'Review Needed')
      .sort((left, right) => left.moveName.localeCompare(right.moveName))
      .slice(0, topReviewCount),
  };
}
