import { blankStats, dataset, normalizeEffortSpread } from './champions';
import type { BattleFormat, PokemonBuild, PokemonEntry, StatBlock, Team, UsageInsight, UsageLabel } from '../types';

type FormatPreset = {
  label: UsageLabel;
  source: string;
  reason: string;
  itemName?: string;
  abilityName?: string;
  natureId?: string;
  moveNames: string[];
  evs?: Partial<StatBlock>;
  useMega?: boolean;
  previewNote?: string;
  supportNote?: string;
};

type PresetProfile = {
  singles?: FormatPreset;
  doubles?: FormatPreset;
  mega?: FormatPreset;
};

type FormatKey = 'singles' | 'doubles';

function formatKey(format: BattleFormat): FormatKey {
  return format === 'Doubles' ? 'doubles' : 'singles';
}

function makeSpread(partial: Partial<StatBlock>): StatBlock {
  return normalizeEffortSpread({
    ...blankStats(),
    ...partial,
  });
}

function normalizeSpeciesName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function itemIdByName(name: string | undefined) {
  if (!name) {
    return null;
  }

  return dataset.items.find((item) => item.name === name)?.id ?? null;
}

function typeBoostItemName(type: string) {
  const map: Record<string, string> = {
    Bug: 'Silver Powder',
    Dark: 'Black Glasses',
    Dragon: 'Dragon Fang',
    Electric: 'Magnet',
    Fairy: 'Fairy Feather',
    Fighting: 'Black Belt',
    Fire: 'Charcoal',
    Flying: 'Sharp Beak',
    Ghost: 'Spell Tag',
    Grass: 'Miracle Seed',
    Ground: 'Soft Sand',
    Ice: 'Never-Melt Ice',
    Normal: 'Silk Scarf',
    Poison: 'Poison Barb',
    Psychic: 'Twisted Spoon',
    Rock: 'Hard Stone',
    Steel: 'Metal Coat',
    Water: 'Mystic Water',
  };

  return map[type] ?? null;
}

function resolvePresetItemId(pokemon: PokemonEntry, preset: FormatPreset) {
  const direct = itemIdByName(preset.itemName);
  if (direct) {
    return direct;
  }

  if (preset.itemName === 'Choice Specs') {
    const specialMove = preset.moveNames
      .map((moveName) => pokemon.movePool.find((move) => move.name === moveName))
      .find((move) => move?.category === 'Special');
    return itemIdByName(typeBoostItemName(specialMove?.type ?? pokemon.types[0] ?? '')) ?? itemIdByName('Focus Sash');
  }

  if (preset.itemName === 'Life Orb') {
    return itemIdByName(pokemon.baseStats.speed >= 95 ? 'Focus Sash' : 'Leftovers') ?? itemIdByName('Sitrus Berry');
  }

  return null;
}

function moveIdsByNames(pokemon: PokemonEntry, moveNames: string[]) {
  return moveNames
    .map((moveName) => pokemon.movePool.find((move) => move.name === moveName)?.id ?? null)
    .filter((moveId): moveId is string => Boolean(moveId))
    .slice(0, 4);
}

const sourceUsage = 'Game8 usage snapshot - Season M-1 (updated April 22, 2026)';
const sourceTier = 'Game8 tier lists (updated April 9-April 24, 2026)';
const sourceMoves = 'Game8 utility move guide (updated May 7, 2026)';

const presetProfiles: Record<string, PresetProfile> = {
  [normalizeSpeciesName('Garchomp')]: {
    singles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Ranked at the top of the current Singles snapshot, with Focus Sash and Rough Skin lines showing up constantly.',
      itemName: 'Focus Sash',
      abilityName: 'Rough Skin',
      natureId: 'jolly',
      moveNames: ['Earthquake', 'Outrage', 'Stealth Rock', 'Rock Tomb'],
      evs: { hp: 4, attack: 252, speed: 252 },
      previewNote: 'In Singles preview, respect Ice coverage first and preserve Sash if this is your lead.',
      supportNote: 'It gives you immediate speed pressure, hazard access, and a strong emergency trade pattern.',
    },
    doubles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Garchomp remains one of the best doubles spread attackers, with Earthquake, Rock Slide, and Protect as its default shell.',
      itemName: 'Choice Scarf',
      abilityName: 'Rough Skin',
      natureId: 'adamant',
      moveNames: ['Earthquake', 'Rock Slide', 'Dragon Claw', 'Protect'],
      evs: { hp: 4, attack: 252, speed: 252 },
      previewNote: 'Bring it when the opposing four are light on Ice and you can force spread damage.',
      supportNote: 'It pressures both slots at once and rewards speed control or Wide Guard support.',
    },
    mega: {
      label: 'UU',
      source: sourceTier,
      reason: 'Mega Garchomp is still dangerous, but current community coverage leans harder into standard Garchomp tempo lines.',
      itemName: 'Garchompite',
      abilityName: 'Rough Skin',
      natureId: 'adamant',
      moveNames: ['Earthquake', 'Dragon Claw', 'Protect', 'Rock Slide'],
      evs: { hp: 4, attack: 252, speed: 252 },
      useMega: true,
    },
  },
  [normalizeSpeciesName('Primarina')]: {
    singles: {
      label: 'OU',
      source: sourceTier,
      reason: 'Primarina is one of the headline Singles picks in the current community tiering and remains hard to pivot into cleanly.',
      itemName: 'Choice Specs',
      abilityName: 'Torrent',
      natureId: 'modest',
      moveNames: ['Sparkling Aria', 'Moonblast', 'Ice Beam', 'Flip Turn'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Bring Primarina when the opposing preview lacks reliable Fairy resists or immediate Electric pressure.',
      supportNote: 'Its raw special damage compresses breaker and emergency revenge roles.',
    },
    doubles: {
      label: 'UU',
      source: sourceTier,
      reason: 'Primarina is still a respected doubles pick, but it now sits a step below the premier board-control pieces.',
      itemName: 'Sitrus Berry',
      abilityName: 'Torrent',
      natureId: 'modest',
      moveNames: ['Sparkling Aria', 'Moonblast', 'Icy Wind', 'Protect'],
      evs: { hp: 252, defense: 116, specialAttack: 116, specialDefense: 20, speed: 4 },
    },
  },
  [normalizeSpeciesName('Scizor')]: {
    singles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Current Singles builds are overwhelmingly centered on Bullet Punch, Swords Dance, and Mega Scizor pressure.',
      itemName: 'Scizorite',
      abilityName: 'Technician',
      natureId: 'adamant',
      moveNames: ['Bullet Punch', 'Swords Dance', 'Close Combat', 'Knock Off'],
      evs: { hp: 4, attack: 252, speed: 252 },
      useMega: true,
      previewNote: 'Save the Mega trigger for slower matchups where boosted Bullet Punch closes games.',
      supportNote: 'It gives the team a clean Mega closer and punishes frailer offensive ladders.',
    },
  },
  [normalizeSpeciesName('Dragonite')]: {
    singles: {
      label: 'UU',
      source: sourceUsage,
      reason: 'The current Singles snapshot leans into Mega Dragonite special sets with emergency Extreme Speed coverage.',
      itemName: 'Dragoninite',
      abilityName: 'Multiscale',
      natureId: 'modest',
      moveNames: ['Extreme Speed', 'Draco Meteor', 'Thunderbolt', 'Flamethrower'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      useMega: true,
      previewNote: 'Bring it when your opponent is slow to pressure weather-boosted special coverage.',
      supportNote: 'Mega Dragonite flips normal Dragonite expectations and strains preview calls.',
    },
    doubles: {
      label: 'OU',
      source: sourceTier,
      reason: 'Dragonite is a well-established doubles attacker and one of the more flexible Mega options in the current meta.',
      itemName: 'Dragoninite',
      abilityName: 'Multiscale',
      natureId: 'modest',
      moveNames: ['Draco Meteor', 'Hurricane', 'Thunderbolt', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      useMega: true,
      previewNote: 'Bring it into teams that do not handle weather-assisted special Dragonite well.',
      supportNote: 'Weather-backed Mega Dragonite is one of the better doubles late-game buttons.',
    },
  },
  [normalizeSpeciesName('Kingambit')]: {
    singles: {
      label: 'OU',
      source: sourceTier,
      reason: 'Kingambit remains a top-end Singles win condition because Sucker Punch and Swords Dance still compress offense and endgame pressure.',
      itemName: 'Black Glasses',
      abilityName: 'Supreme Overlord',
      natureId: 'adamant',
      moveNames: ['Sucker Punch', 'Kowtow Cleave', 'Swords Dance', 'Iron Head'],
      evs: { hp: 4, attack: 252, speed: 252 },
      previewNote: 'Do not expose it early into obvious Fighting coverage; save it for trade compression.',
      supportNote: 'It gives the team a premium closer that benefits from every chip line you create.',
    },
    doubles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Defiant Kingambit is one of the best answers to Intimidate-heavy doubles boards right now.',
      itemName: 'Black Glasses',
      abilityName: 'Defiant',
      natureId: 'adamant',
      moveNames: ['Sucker Punch', 'Kowtow Cleave', 'Protect', 'Iron Head'],
      evs: { hp: 252, attack: 252, specialDefense: 4 },
      previewNote: 'Bring it into Intimidate or Parting Shot previews and threaten Defiant swings.',
      supportNote: 'It punishes support-heavy opposing leads and stabilizes slower shells.',
    },
  },
  [normalizeSpeciesName('Glimmora')]: {
    singles: {
      label: 'UU',
      source: sourceUsage,
      reason: 'Singles Glimmora is still a reliable hazard lead and Mortal Spin utility piece in the live snapshot.',
      itemName: 'Focus Sash',
      abilityName: 'Toxic Debris',
      natureId: 'timid',
      moveNames: ['Stealth Rock', 'Mortal Spin', 'Power Gem', 'Sludge Wave'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Lead it when hazards matter and the opposing side is not stuffed with Taunt.',
      supportNote: 'It compresses hazards, status control, and solid special damage into one slot.',
    },
    doubles: {
      label: 'UU',
      source: sourceTier,
      reason: 'Doubles Glimmora still carries real value through Toxic Debris, Meteor Beam lines, and Mega Adaptability pressure.',
      itemName: 'White Herb',
      abilityName: 'Toxic Debris',
      natureId: 'timid',
      moveNames: ['Meteor Beam', 'Sludge Wave', 'Power Gem', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Bring it when the opponent lacks easy Ground punishment and hates immediate spread poison pressure.',
      supportNote: 'It gives you a threatening special tempo slot that also punishes contact.',
    },
  },
  [normalizeSpeciesName('Incineroar')]: {
    doubles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Incineroar is still the default doubles field-control piece because Fake Out, Parting Shot, and Intimidate are everywhere.',
      itemName: 'Sitrus Berry',
      abilityName: 'Intimidate',
      natureId: 'careful',
      moveNames: ['Fake Out', 'Parting Shot', 'Flare Blitz', 'Darkest Lariat'],
      evs: { hp: 252, defense: 56, specialDefense: 200 },
      previewNote: 'Lead it into physical or setup-heavy previews and use Parting Shot to create your first pivot.',
      supportNote: 'It keeps doubles boards stable and buys turns for your Mega or speed control piece.',
    },
  },
  [normalizeSpeciesName('Sneasler')]: {
    doubles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Sneasler is one of the fastest and most consistent doubles openers in the live usage snapshot.',
      itemName: 'White Herb',
      abilityName: 'Unburden',
      natureId: 'jolly',
      moveNames: ['Close Combat', 'Dire Claw', 'Fake Out', 'Protect'],
      evs: { hp: 4, attack: 252, speed: 252 },
      previewNote: 'Bring it into slower boards that struggle to handle Fake Out plus poison pressure.',
      supportNote: 'It accelerates games immediately and rewards proactive doubles sequencing.',
    },
  },
  [normalizeSpeciesName('Sinistcha')]: {
    doubles: {
      label: 'OU',
      source: sourceUsage,
      reason: 'Sinistcha has become one of the better doubles support pieces because Rage Powder and Hospitality buy setup turns cleanly.',
      itemName: 'Sitrus Berry',
      abilityName: 'Hospitality',
      natureId: 'bold',
      moveNames: ['Matcha Gotcha', 'Rage Powder', 'Trick Room', 'Life Dew'],
      evs: { hp: 252, defense: 148, specialDefense: 108 },
      previewNote: 'Bring it when your attacker needs redirection or recovery to survive the first exchange.',
      supportNote: 'It glues together slower or bulkier doubles plans better than most support slots do.',
    },
  },
  [normalizeSpeciesName('Whimsicott')]: {
    doubles: {
      label: 'UU',
      source: sourceTier,
      reason: 'Whimsicott keeps showing up as one of the cleaner doubles speed-control enablers.',
      itemName: 'Focus Sash',
      abilityName: 'Prankster',
      natureId: 'timid',
      moveNames: ['Tailwind', 'Moonblast', 'Encore', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Bring it when faster mirrors or setup-heavy teams are likely to decide the match.',
      supportNote: 'Prankster Tailwind makes bulky breakers and Megas far more reliable.',
    },
  },
  [normalizeSpeciesName('Pelipper')]: {
    doubles: {
      label: 'UU',
      source: sourceTier,
      reason: 'Pelipper remains one of the better doubles weather pivots because it turns on rain attackers immediately.',
      itemName: 'Focus Sash',
      abilityName: 'Drizzle',
      natureId: 'modest',
      moveNames: ['Hurricane', 'Weather Ball', 'Tailwind', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Bring it when the opposing board leans on Fire pressure or struggles to stop Tailwind.',
      supportNote: 'It turns rain shells on instantly and gives special Megas cleaner board states.',
    },
  },
  [normalizeSpeciesName('Torkoal')]: {
    doubles: {
      label: 'UU',
      source: sourceTier,
      reason: 'Torkoal is still one of the safest doubles sun setters and simplifies your first few turns.',
      itemName: 'Choice Specs',
      abilityName: 'Drought',
      natureId: 'quiet',
      moveNames: ['Eruption', 'Heat Wave', 'Earth Power', 'Protect'],
      evs: { hp: 252, specialAttack: 252, defense: 4 },
      previewNote: 'Bring it when you expect the game to revolve around immediate weather pressure or Trick Room.',
      supportNote: 'Sun pressure gives your team a clean anti-bulk button and forces respect in preview.',
    },
  },
  [normalizeSpeciesName('Gengar')]: {
    doubles: {
      label: 'OU',
      source: sourceTier,
      reason: 'Gengar still shows up as a strong doubles special attacker and Mega Gengar remains one of the scariest trap pieces.',
      itemName: 'Gengarite',
      abilityName: 'Cursed Body',
      natureId: 'timid',
      moveNames: ['Shadow Ball', 'Sludge Bomb', 'Protect', 'Will-O-Wisp'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      useMega: true,
      previewNote: 'Bring Mega Gengar into previews that hate being trapped or worn down by status.',
      supportNote: 'Shadow Tag style pressure forces awkward doubles positioning and punishes passive boards.',
    },
    mega: {
      label: 'OU',
      source: sourceTier,
      reason: 'Mega Gengar is one of the headline Mega threats in the current community tier lists.',
      itemName: 'Gengarite',
      abilityName: 'Cursed Body',
      natureId: 'timid',
      moveNames: ['Shadow Ball', 'Sludge Bomb', 'Protect', 'Will-O-Wisp'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      useMega: true,
    },
  },
  [normalizeSpeciesName('Clefable')]: {
    singles: {
      label: 'RU',
      source: sourceTier,
      reason: 'Clefable is more of a pocket pick than a ladder staple right now, but Magic Guard and support lines still win games.',
      itemName: 'Leftovers',
      abilityName: 'Magic Guard',
      natureId: 'bold',
      moveNames: ['Moonblast', 'Thunder Wave', 'Soft-Boiled', 'Flamethrower'],
      evs: { hp: 252, defense: 252, specialDefense: 4 },
      previewNote: 'Bring it when you want a stable glue pick against slower offense or chip-heavy teams.',
      supportNote: 'It gives balance teams a resilient status spreader that can also absorb chip.',
    },
    mega: {
      label: 'UU',
      source: sourceTier,
      reason: 'Mega Clefable is less common than the S-tier Megas, but its Magic Bounce utility keeps it relevant as a support Mega.',
      itemName: 'Clefablite',
      abilityName: 'Magic Guard',
      natureId: 'modest',
      moveNames: ['Moonblast', 'Air Slash', 'Calm Mind', 'Protect'],
      evs: { hp: 252, defense: 116, specialAttack: 140 },
      useMega: true,
    },
  },
  [normalizeSpeciesName('Alakazam')]: {
    singles: {
      label: 'UU',
      source: sourceTier,
      reason: 'Base Alakazam is still dangerous, but most community discussion now centers on its Mega ceiling.',
      itemName: 'Focus Sash',
      abilityName: 'Magic Guard',
      natureId: 'timid',
      moveNames: ['Psychic', 'Shadow Ball', 'Encore', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
    },
    mega: {
      label: 'UU',
      source: sourceTier,
      reason: 'Mega Alakazam stays relevant as a fast special cleaner even if it is not one of the current S-tier Mega centerpieces.',
      itemName: 'Alakazite',
      abilityName: 'Magic Guard',
      natureId: 'timid',
      moveNames: ['Psychic', 'Shadow Ball', 'Dazzling Gleam', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      useMega: true,
    },
  },
  [normalizeSpeciesName('Bellibolt')]: {
    doubles: {
      label: 'RU',
      source: 'Game8 Bellibolt and community build coverage (April 2026)',
      reason: 'Bellibolt is still a niche doubles pick, but Electromorphosis can punish careless spread damage and give you an anti-meta angle.',
      itemName: 'Sitrus Berry',
      abilityName: 'Electromorphosis',
      natureId: 'modest',
      moveNames: ['Thunderbolt', 'Volt Switch', 'Muddy Water', 'Protect'],
      evs: { hp: 252, defense: 108, specialAttack: 116, specialDefense: 32 },
      previewNote: 'Bring it when the other side leans on contact pivots or rain-enabled Water pressure.',
      supportNote: 'It gives anti-meta doubles teams a surprisingly sticky Electric pivot.',
    },
  },
  [normalizeSpeciesName('Jolteon')]: {
    singles: {
      label: 'RU',
      source: 'Game8 Jolteon build guide (updated April 29, 2026)',
      reason: 'Jolteon is more of a targeted speed pick than a format staple, but it still threatens slower water-heavy teams.',
      itemName: 'Choice Specs',
      abilityName: 'Volt Absorb',
      natureId: 'timid',
      moveNames: ['Thunderbolt', 'Volt Switch', 'Shadow Ball', 'Thunder Wave'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Bring it when the other preview gives you free Volt Switch lanes or punishes slow Water cores poorly.',
      supportNote: 'Its raw speed lets you force tempo when your team is otherwise bulky.',
    },
  },
  [normalizeSpeciesName('Sableye')]: {
    doubles: {
      label: 'RU',
      source: 'Game8 Sableye build guide (updated April 23, 2026)',
      reason: 'Sableye sits outside the default top end, but Prankster disruption and Mega Bounce give it real off-meta value.',
      itemName: 'Leftovers',
      abilityName: 'Prankster',
      natureId: 'careful',
      moveNames: ['Will-O-Wisp', 'Knock Off', 'Recover', 'Taunt'],
      evs: { hp: 252, defense: 116, specialDefense: 140 },
      previewNote: 'Bring it into setup or status-heavy previews where Prankster and Magic Bounce distort turn one.',
      supportNote: 'It gives anti-meta teams a disruption slot that is awkward to scout cleanly.',
    },
    mega: {
      label: 'RU',
      source: sourceTier,
      reason: 'Mega Sableye is still niche, but Magic Bounce alone creates valuable preview pressure.',
      itemName: 'Sablenite',
      abilityName: 'Prankster',
      natureId: 'careful',
      moveNames: ['Knock Off', 'Recover', 'Will-O-Wisp', 'Taunt'],
      evs: { hp: 252, defense: 116, specialDefense: 140 },
      useMega: true,
    },
  },
  [normalizeSpeciesName('Castform')]: {
    singles: {
      label: 'NU',
      source: 'Game8 Castform build guide (updated May 5, 2026)',
      reason: 'Castform is still a deep-cut pick, but weather abuse and scouting value make it a legitimate off-meta project.',
      itemName: 'Life Orb',
      abilityName: 'Forecast',
      natureId: 'timid',
      moveNames: ['Weather Ball', 'Thunderbolt', 'Ice Beam', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Bring it only when your weather support is real and the opposing preview is light on priority.',
      supportNote: 'It is the kind of surprise pick that wins preview mind games when the rest of the team is disciplined.',
    },
    doubles: {
      label: 'NU',
      source: 'Game8 Castform build guide (updated May 5, 2026)',
      reason: 'Castform is still far from mainstream doubles play, but it becomes a real surprise attacker when weather is locked in.',
      itemName: 'Life Orb',
      abilityName: 'Forecast',
      natureId: 'timid',
      moveNames: ['Weather Ball', 'Thunderbolt', 'Ice Beam', 'Protect'],
      evs: { hp: 4, specialAttack: 252, speed: 252 },
      previewNote: 'Only bring it when your weather setter is likely to stay on the field long enough to matter.',
      supportNote: 'It adds a real off-meta fork that can steal games from rigid ladder shells.',
    },
  },
  [normalizeSpeciesName('Milotic')]: {
    singles: {
      label: 'UU',
      source: 'Game8 Milotic build coverage (April 2026)',
      reason: 'Milotic is still a sturdy anti-offense glue pick because Marvel Scale and consistent recovery let it weather long games.',
      itemName: 'Leftovers',
      abilityName: 'Marvel Scale',
      natureId: 'bold',
      moveNames: ['Scald', 'Recover', 'Ice Beam', 'Haze'],
      evs: { hp: 252, defense: 252, specialDefense: 4 },
    },
    doubles: {
      label: 'UU',
      source: 'Game8 Milotic build coverage (April 2026)',
      reason: 'Milotic is still a healthy doubles counter-meta pick because it resists common Fire pressure and punishes stat drops.',
      itemName: 'Sitrus Berry',
      abilityName: 'Competitive',
      natureId: 'modest',
      moveNames: ['Scald', 'Ice Beam', 'Recover', 'Protect'],
      evs: { hp: 252, specialAttack: 140, defense: 60, specialDefense: 52, speed: 4 },
    },
  },
};

const explicitPokemonTiers: Record<FormatKey, Record<UsageLabel, string[]>> = {
  singles: {
    OU: ['Garchomp', 'Primarina', 'Kingambit', 'Corviknight', 'Archaludon', 'Hippowdon', 'Mimikyu'],
    UU: ['Dragonite', 'Glimmora', 'Milotic', 'Scizor', 'Hydreigon', 'Delphox', 'Meowscarada'],
    RU: ['Clefable', 'Jolteon', 'Sableye', 'Bellibolt', 'Pelipper'],
    NU: ['Castform', 'Chimecho'],
  },
  doubles: {
    OU: ['Incineroar', 'Kingambit', 'Sneasler', 'Garchomp', 'Sinistcha'],
    UU: ['Dragonite', 'Glimmora', 'Whimsicott', 'Torkoal', 'Pelipper', 'Primarina', 'Milotic', 'Gengar', 'Charizard'],
    RU: ['Bellibolt', 'Sableye', 'Jolteon', 'Farigiraf', 'Sylveon'],
    NU: ['Castform', 'Chimecho'],
  },
};

const explicitMegaTiers: Record<UsageLabel, string[]> = {
  OU: ['Mega Gengar', 'Mega Delphox', 'Mega Greninja', 'Mega Floette'],
  UU: ['Mega Charizard X', 'Mega Charizard Y', 'Mega Dragonite', 'Mega Glimmora', 'Mega Alakazam', 'Mega Clefable', 'Mega Garchomp'],
  RU: ['Mega Sableye', 'Mega Scizor', 'Mega Houndoom'],
  NU: [],
};

const moveTierAnchors: Record<FormatKey, Record<UsageLabel, string[]>> = {
  singles: {
    OU: ['Earthquake', 'Stealth Rock', 'Swords Dance', 'Outrage', 'Bullet Punch', 'Draco Meteor', 'Extreme Speed', 'Sucker Punch', 'Protect'],
    UU: ['Knock Off', 'Rock Tomb', 'Rock Slide', 'Flip Turn', 'Moonblast', 'Ice Beam', 'Mortal Spin', 'Thunder Wave', 'Scald'],
    RU: ['Encore', 'Haze', 'Will-O-Wisp', 'Taunt', 'Air Slash', 'Flamethrower'],
    NU: [],
  },
  doubles: {
    OU: ['Protect', 'Fake Out', 'Parting Shot', 'Earthquake', 'Rock Slide', 'Close Combat', 'Dire Claw', 'Rage Powder', 'Trick Room', 'Tailwind'],
    UU: ['Matcha Gotcha', 'Life Dew', 'Icy Wind', 'Helping Hand', 'Darkest Lariat', 'Dragon Claw', 'Hurricane', 'Eruption', 'Flare Blitz'],
    RU: ['Will-O-Wisp', 'Taunt', 'Recover', 'Volt Switch', 'Muddy Water', 'Encore'],
    NU: [],
  },
};

const moveFrequencyByFormat = {
  singles: new Map<string, number>(),
  doubles: new Map<string, number>(),
};

for (const profile of Object.values(presetProfiles)) {
  for (const key of ['singles', 'doubles'] as const) {
    const preset = profile[key];
    if (!preset) {
      continue;
    }

    for (const moveName of preset.moveNames) {
      const next = (moveFrequencyByFormat[key].get(moveName) ?? 0) + 1;
      moveFrequencyByFormat[key].set(moveName, next);
    }
  }
}

function presetForPokemon(pokemon: PokemonEntry, format: BattleFormat) {
  const profile = presetProfiles[normalizeSpeciesName(pokemon.baseSpecies)];
  if (!profile) {
    return null;
  }

  if (pokemon.isMega) {
    return profile.mega ?? profile[formatKey(format)] ?? null;
  }

  return profile[formatKey(format)] ?? null;
}

function labelRank(label: UsageLabel) {
  return { OU: 4, UU: 3, RU: 2, NU: 1 }[label];
}

function fallbackPokemonLabel(pokemon: PokemonEntry, format: BattleFormat): UsageInsight {
  if (pokemon.isMega) {
    for (const label of ['OU', 'UU', 'RU'] as UsageLabel[]) {
      if (explicitMegaTiers[label].includes(pokemon.displayName)) {
        return {
          label,
          reason: `${pokemon.displayName} is tracked in the current community Mega tier discussions.`,
          source: sourceTier,
        };
      }
    }
  }

  for (const label of ['OU', 'UU', 'RU'] as UsageLabel[]) {
    if (explicitPokemonTiers[formatKey(format)][label].includes(pokemon.baseSpecies)) {
      return {
        label,
        reason: `${pokemon.baseSpecies} is part of the current ${format} community tier conversation.`,
        source: sourceTier,
      };
    }
  }

  const total = Object.values(pokemon.baseStats).reduce((sum, value) => sum + value, 0);
  const label: UsageLabel = total >= 575 ? 'UU' : total >= 510 ? 'RU' : 'NU';

  return {
    label,
    reason: `No direct community snapshot was pinned for this form, so this label falls back to roster power and utility context.`,
    source: 'Local fallback model',
  };
}

export function getPokemonUsageInsight(pokemon: PokemonEntry | null, format: BattleFormat): UsageInsight {
  if (!pokemon) {
    return {
      label: 'NU',
      reason: 'No Pokemon is selected yet.',
      source: 'Local state',
    };
  }

  const preset = presetForPokemon(pokemon, format);
  if (preset) {
    return {
      label: preset.label,
      reason: preset.reason,
      source: preset.source,
    };
  }

  return fallbackPokemonLabel(pokemon, format);
}

export function getMoveUsageInsight(moveName: string | null, format: BattleFormat): UsageInsight {
  if (!moveName) {
    return {
      label: 'NU',
      reason: 'No move is selected yet.',
      source: 'Local state',
    };
  }

  const key = formatKey(format);

  for (const label of ['OU', 'UU', 'RU'] as UsageLabel[]) {
    if (moveTierAnchors[key][label].includes(moveName)) {
      return {
        label,
        reason: `${moveName} keeps showing up in current ${format} usage sets or utility coverage.`,
        source: sourceMoves,
      };
    }
  }

  const observedFrequency = moveFrequencyByFormat[key].get(moveName) ?? 0;
  if (observedFrequency >= 3) {
    return {
      label: 'OU',
      reason: `${moveName} appears repeatedly in the current community presets for ${format}.`,
      source: sourceUsage,
    };
  }

  if (observedFrequency >= 2) {
    return {
      label: 'UU',
      reason: `${moveName} is a common support or coverage move in multiple tracked ${format} sets.`,
      source: sourceUsage,
    };
  }

  if (observedFrequency >= 1) {
    return {
      label: 'RU',
      reason: `${moveName} appears in at least one current community preset, but not at high saturation.`,
      source: sourceUsage,
    };
  }

  return {
    label: 'NU',
    reason: `${moveName} is either niche, species-specific, or not currently highlighted in the public community snapshots.`,
    source: 'Local fallback model',
  };
}

export function getPopularPresetSummary(pokemon: PokemonEntry | null, format: BattleFormat) {
  if (!pokemon) {
    return null;
  }

  return presetForPokemon(pokemon, format);
}

export function getPopularPresetPatch(pokemon: PokemonEntry, format: BattleFormat): Partial<PokemonBuild> | null {
  const preset = presetForPokemon(pokemon, format);
  if (!preset) {
    return null;
  }

  const moveIds = moveIdsByNames(pokemon, preset.moveNames);
  if (!moveIds.length) {
    return null;
  }

  return {
    abilityName: preset.abilityName ?? pokemon.abilities[0]?.name ?? null,
    natureId: preset.natureId ?? 'hardy',
    moveIds,
    evs: makeSpread(preset.evs ?? {}),
    itemId: resolvePresetItemId(pokemon, preset),
    useMega: Boolean(preset.useMega),
  };
}

export function getTopMetaSpecies(format: BattleFormat) {
  const order = [
    ...explicitPokemonTiers[formatKey(format)].OU,
    ...explicitPokemonTiers[formatKey(format)].UU,
    ...explicitPokemonTiers[formatKey(format)].RU,
  ];

  return [...new Set(order)];
}

export function getTopMegaSpecies() {
  const order = [
    ...explicitMegaTiers.OU,
    ...explicitMegaTiers.UU,
    ...explicitMegaTiers.RU,
  ];

  return [...new Set(order)];
}

export function getPresetPreviewNote(pokemon: PokemonEntry | null, format: BattleFormat) {
  return getPopularPresetSummary(pokemon, format)?.previewNote ?? null;
}

export function getPresetSupportNote(pokemon: PokemonEntry | null, format: BattleFormat) {
  return getPopularPresetSummary(pokemon, format)?.supportNote ?? null;
}

export function getTeamUsageInsight(team: Team): UsageInsight {
  const members = team.slots
    .map((slot) => dataset.pokemon.find((entry) => entry.id === slot.pokemonId) ?? null)
    .filter((pokemon): pokemon is PokemonEntry => Boolean(pokemon));

  if (!members.length) {
    return {
      label: 'NU',
      reason: 'Add a few Pokemon before the team-level usage label can stabilize.',
      source: 'Local state',
    };
  }

  const scores = members.map((pokemon) => labelRank(getPokemonUsageInsight(pokemon, team.format).label));
  const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const label: UsageLabel = average >= 3.5 ? 'OU' : average >= 2.6 ? 'UU' : average >= 1.7 ? 'RU' : 'NU';

  return {
    label,
    reason: `This team-level label blends the current ${team.format} community labels for your selected members.`,
    source: `${sourceUsage}; ${sourceTier}`,
  };
}
