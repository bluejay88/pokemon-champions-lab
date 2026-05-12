import type { PokemonEntry } from '../types';

export type AbilityParityTier = 'Explicit' | 'Damage Core' | 'Review Needed';

export interface AbilityParityEntry {
  abilityName: string;
  tier: AbilityParityTier;
  summary: string;
}

export interface AbilityParitySummary {
  total: number;
  explicit: number;
  damageCore: number;
  reviewNeeded: number;
  coveredPercent: number;
  topReviewAbilities: AbilityParityEntry[];
}

const explicitAbilities = new Set([
  'Clear Body',
  'Competitive',
  'Contrary',
  'Dauntless Shield',
  'Defiant',
  'Drizzle',
  'Drought',
  'Electric Surge',
  'Full Metal Body',
  'Good as Gold',
  'Grassy Surge',
  'Inner Focus',
  'Intimidate',
  'Intrepid Sword',
  'Mega Sol',
  'Mirror Armor',
  'Misty Surge',
  'Oblivious',
  'Prankster',
  'Psychic Surge',
  'Regenerator',
  'Sand Stream',
  'Simple',
  'Snow Warning',
  'Unseen Fist',
  'White Smoke',
]);

const damageCoreAbilities = new Set([
  'Aerilate',
  'Blaze',
  'Bulletproof',
  'Chlorophyll',
  'Dry Skin',
  'Earth Eater',
  'Filter',
  'Flash Fire',
  'Fluffy',
  'Fur Coat',
  'Galvanize',
  'Guts',
  'Heatproof',
  'Huge Power',
  'Hustle',
  'Ice Scales',
  'Immunity',
  'Iron Fist',
  'Levitate',
  'Lightning Rod',
  'Magic Guard',
  'Marvel Scale',
  'Mega Launcher',
  'Mold Breaker',
  'Motor Drive',
  'Multiscale',
  'Neuroforce',
  'No Guard',
  'Overgrow',
  'Pixilate',
  'Poison Heal',
  'Prism Armor',
  'Punk Rock',
  'Pure Power',
  'Purifying Salt',
  'Reckless',
  'Refrigerate',
  'Rocky Payload',
  'Sand Force',
  'Sand Rush',
  'Sap Sipper',
  'Shadow Shield',
  'Sharpness',
  'Sheer Force',
  'Slush Rush',
  'Sniper',
  'Solar Power',
  'Solid Rock',
  'Soundproof',
  'Steelworker',
  'Steely Spirit',
  'Storm Drain',
  'Strong Jaw',
  'Swarm',
  'Swift Swim',
  'Technician',
  'Thick Fat',
  'Tinted Lens',
  'Torrent',
  'Tough Claws',
  'Transistor',
  'Volt Absorb',
  'Water Absorb',
  'Water Bubble',
  'Well-Baked Body',
  'Wonder Guard',
]);

export function abilityParityForName(abilityName: string): AbilityParityEntry {
  if (explicitAbilities.has(abilityName)) {
    return {
      abilityName,
      tier: 'Explicit',
      summary: 'This ability has explicit simulator or live battle hooks beyond the shared formula layer.',
    };
  }

  if (damageCoreAbilities.has(abilityName)) {
    return {
      abilityName,
      tier: 'Damage Core',
      summary: 'This ability is covered in the shared damage, immunity, or stat-modifier engine.',
    };
  }

  return {
    abilityName,
    tier: 'Review Needed',
    summary: 'This ability still needs deeper bespoke parity work or a dedicated simulator hook.',
  };
}

export function buildAbilityParitySummary(pokemonEntries: PokemonEntry[]): AbilityParitySummary {
  const names = [...new Set(pokemonEntries.flatMap((pokemon) => pokemon.abilities.map((ability) => ability.name)).filter(Boolean))].sort();
  const entries = names.map((name) => abilityParityForName(name));
  const explicit = entries.filter((entry) => entry.tier === 'Explicit').length;
  const damageCore = entries.filter((entry) => entry.tier === 'Damage Core').length;
  const reviewNeeded = entries.filter((entry) => entry.tier === 'Review Needed').length;
  const covered = explicit + damageCore;

  return {
    total: entries.length,
    explicit,
    damageCore,
    reviewNeeded,
    coveredPercent: names.length ? Math.round((covered / names.length) * 100) : 0,
    topReviewAbilities: entries.filter((entry) => entry.tier === 'Review Needed').slice(0, 18),
  };
}
