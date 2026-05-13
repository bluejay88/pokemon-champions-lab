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
  'After You',
  'Ally Switch',
  'Aqua Ring',
  'Aurora Veil',
  'Attract',
  'Baby-Doll Eyes',
  'Baneful Bunker',
  'Baton Pass',
  'Belly Drum',
  'Block',
  'Chilly Reception',
  'Charge',
  'Clear Smog',
  'Clangorous Soul',
  'Coaching',
  'Coil',
  'Confuse Ray',
  'Copycat',
  'Corrosive Gas',
  'Defog',
  'Destiny Bond',
  'Detect',
  'Disable',
  'Double Team',
  'Dragon Cheer',
  'Electrify',
  'Electric Terrain',
  'Entrainment',
  'Encore',
  'Endure',
  'Fairy Lock',
  'Fake Tears',
  'Follow Me',
  'Focus Energy',
  "Forest's Curse",
  'Gastro Acid',
  'Glare',
  'Guard Split',
  'Guard Swap',
  'Grassy Terrain',
  'Gravity',
  'Growth',
  'Hail',
  'Haze',
  'Heal Bell',
  'Healing Wish',
  'Heal Pulse',
  'Helping Hand',
  'Hypnosis',
  'Imprison',
  'Ingrain',
  'Instruct',
  'King\'s Shield',
  'Leech Seed',
  'Life Dew',
  'Light Screen',
  'Lock-On',
  'Magic Room',
  'Magic Powder',
  'Magnet Rise',
  'Magnetic Flux',
  'Metal Sound',
  'Mean Look',
  'Misty Terrain',
  'Morning Sun',
  'Moonlight',
  'Noble Roar',
  'Pain Split',
  'Parting Shot',
  'Perish Song',
  'Power Split',
  'Power Swap',
  'Power Trick',
  'Protect',
  'Psychic Terrain',
  'Psych Up',
  'Quash',
  'Quick Guard',
  'Rage Powder',
  'Rain Dance',
  'Recycle',
  'Recover',
  'Reflect',
  'Reflect Type',
  'Rest',
  'Role Play',
  'Roar',
  'Roost',
  'Safeguard',
  'Sandstorm',
  'Shed Tail',
  'Shore Up',
  'Skill Swap',
  'Simple Beam',
  'Slack Off',
  'Sleep Talk',
  'Snowscape',
  'Soft-Boiled',
  'Soak',
  'Speed Swap',
  'Spite',
  'Spikes',
  'Spiky Shield',
  'Spore',
  'Sticky Web',
  'Stealth Rock',
  'Strength Sap',
  'Substitute',
  'Sunny Day',
  'Swallow',
  'Sweet Kiss',
  'Sweet Scent',
  'Switcheroo',
  'Synthesis',
  'Tailwind',
  'Taunt',
  'Tearful Look',
  'Teatime',
  'Teeter Dance',
  'Thunder Wave',
  'Torment',
  'Toxic',
  'Toxic Spikes',
  'Toxic Thread',
  'Transform',
  'Trick',
  'Trick-or-Treat',
  'Trick Room',
  'Wide Guard',
  'Whirlwind',
  'Will-O-Wisp',
  'Wish',
  'Wonder Room',
  'Worry Seed',
  'Yawn',
  'Memento',
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
  'Covet',
  'Dire Claw',
  'Discharge',
  'Dragon Darts',
  'Draco Meteor',
  'Earth Power',
  'Eerie Spell',
  'Electroweb',
  'Energy Ball',
  'Expanding Force',
  'Fake Out',
  'Final Gambit',
  'Fling',
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
  'Misty Explosion',
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
  'Psychic Noise',
  'Psychic Fangs',
  'Rapid Spin',
  'Rock Tomb',
  'Salt Cure',
  'Self-Destruct',
  'Snarl',
  'Snore',
  'Sparkling Aria',
  'Explosion',
  'Spirit Shackle',
  'Struggle Bug',
  'Superpower',
  'Syrup Bomb',
  'Thief',
  'Thunder',
  'Throat Chop',
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
