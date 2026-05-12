import {
  bestAttackingStat,
  buildLabel,
  buildStats,
  createTeam,
  dataset,
  effectiveTypes,
  fillEffortSpreadRemainder,
  findMegaForm,
  findMegaStoneItem,
  findPokemonByName,
  maxEffortValue,
  makeEmptyBuild,
  makeId,
  normalizeEffortSpread,
  resolvePokemonForm,
  sanitizeTeamForChampions,
  typeEffectiveness,
} from './champions';
import {
  getPokemonUsageInsight,
  getPopularPresetPatch,
  getPresetPreviewNote,
  getPresetSupportNote,
  getTeamUsageInsight,
  getTopMetaSpecies,
} from './usage';
import type {
  BattleFormat,
  GeneratedTeamPlan,
  PokemonBuild,
  PokemonEntry,
  PokemonMove,
  Team,
  TeamAnalysis,
  ThreatReport,
  UsageLabel,
} from '../types';

const setupMoves = ['Swords Dance', 'Dragon Dance', 'Calm Mind', 'Nasty Plot', 'Bulk Up', 'Coil'];
const speedControlMoves = ['Tailwind', 'Thunder Wave', 'Icy Wind', 'Trick Room', 'Rain Dance', 'Sunny Day'];
const hazardMoves = ['Stealth Rock', 'Spikes', 'Toxic Spikes', 'Sticky Web'];
const hazardControlMoves = ['Rapid Spin', 'Defog', 'Mortal Spin'];
const recoveryMoves = ['Recover', 'Roost', 'Slack Off', 'Moonlight', 'Synthesis', 'Wish', 'Shore Up', 'Soft-Boiled', 'Life Dew'];
const screenMoves = ['Reflect', 'Light Screen', 'Aurora Veil'];
const fakeOutMoves = ['Fake Out'];
const redirectionMoves = ['Rage Powder', 'Follow Me'];
const pivotMoves = ['Parting Shot', 'Flip Turn', 'Volt Switch', 'U-turn'];
const supportMoves = ['Helping Hand', 'Encore', 'Taunt', 'Will-O-Wisp', 'Haze'];
const spreadMoveNames = ['Earthquake', 'Rock Slide', 'Heat Wave', 'Sludge Wave', 'Muddy Water', 'Eruption', 'Sparkling Aria'];
const priorityMoves = ['Fake Out', 'Bullet Punch', 'Sucker Punch', 'Extreme Speed', 'Aqua Jet', 'Ice Shard'];
const offMetaMascots = new Set(['Castform', 'Chimecho', 'Dedenne', 'Emolga', 'Diggersby', 'Bellibolt', 'Aromatisse', 'Sableye', 'Jolteon']);

type VariantConfig = {
  id: string;
  tag: string;
  summary: string;
  metaWeight: number;
  bulkWeight: number;
  speedWeight: number;
  supportWeight: number;
  offMetaWeight: number;
};

const archetypeLibrary = [
  {
    id: 'stadium-balance',
    name: 'Stadium Balance',
    summary: 'A sturdy tournament shell with a flexible Mega slot, speed control, and clean defensive pivots.',
    species: ['Dragonite', 'Milotic', 'Lucario', 'Espeon', 'Glimmora', 'Scizor', 'Pelipper', 'Gengar'],
  },
  {
    id: 'rain-circuit',
    name: 'Rain Circuit',
    summary: 'Fast water pressure backed by Pelipper tempo, anti-Fire positioning, and utility pivots.',
    species: ['Pelipper', 'Azumarill', 'Starmie', 'Clawitzer', 'Gyarados', 'Kingdra', 'Vaporeon', 'Castform'],
  },
  {
    id: 'sun-circuit',
    name: 'Sun Circuit',
    summary: 'A harsh-sun offense that leans on Charizard, chlorophyll pressure, and anti-bulk breakpoints.',
    species: ['Charizard', 'Venusaur', 'Victreebel', 'Houndoom', 'Arcanine', 'Castform', 'Torkoal', 'Ninetales'],
  },
  {
    id: 'sand-bunker',
    name: 'Sand Bunker',
    summary: 'A bulky sand shell with rock-steel pressure, chip damage, and slow bruisers that punish overextension.',
    species: ['Tyranitar', 'Hippowdon', 'Rhyperior', 'Steelix', 'Gliscor', 'Aerodactyl', 'Lucario', 'Bastiodon'],
  },
  {
    id: 'snow-glacier',
    name: 'Snow Glacier',
    summary: 'Snow defense scaling plus Ice pressure, Aurora Veil support, and a clean Mega breaker finish.',
    species: ['Abomasnow', 'Glaceon', 'Weavile', 'Aurorus', 'Froslass', 'Castform', 'Milotic', 'Dragonite'],
  },
  {
    id: 'deep-cut',
    name: 'Deep Cut',
    summary: 'A controlled anti-meta pocket that leans on RU and NU surprises without giving up its structural win path.',
    species: ['Castform', 'Bellibolt', 'Sableye', 'Jolteon', 'Chimecho', 'Milotic', 'Dragonite', 'Pelipper'],
  },
];

const variantLibrary: VariantConfig[] = [
  {
    id: 'tournament-core',
    tag: 'Tournament Core',
    summary: 'The cleanest meta-facing version with the fewest dead previews.',
    metaWeight: 28,
    bulkWeight: 10,
    speedWeight: 12,
    supportWeight: 14,
    offMetaWeight: 0.15,
  },
  {
    id: 'tempo-pressure',
    tag: 'Tempo Pressure',
    summary: 'A faster shell that leans harder into speed control and immediate trades.',
    metaWeight: 20,
    bulkWeight: 6,
    speedWeight: 24,
    supportWeight: 12,
    offMetaWeight: 0.2,
  },
  {
    id: 'bulky-balance',
    tag: 'Bulky Balance',
    summary: 'A safer ladder shell that prioritizes stable pivots and longer endgames.',
    metaWeight: 18,
    bulkWeight: 24,
    speedWeight: 8,
    supportWeight: 12,
    offMetaWeight: 0.15,
  },
  {
    id: 'anti-meta-pocket',
    tag: 'Anti-Meta Pocket',
    summary: 'A tuned version that steals percentage points by targeting the standard public cores.',
    metaWeight: 16,
    bulkWeight: 12,
    speedWeight: 12,
    supportWeight: 18,
    offMetaWeight: 0.5,
  },
  {
    id: 'deep-cut-surprise',
    tag: 'Deep-Cut Surprise',
    summary: 'The highest-off-meta version that still preserves enough role compression to hang above 60% by calculation.',
    metaWeight: 8,
    bulkWeight: 10,
    speedWeight: 10,
    supportWeight: 14,
    offMetaWeight: 1,
  },
];

function lookupPokemonByName(name: string) {
  if (!name.trim()) {
    return null;
  }

  return (
    findPokemonByName(name.trim()) ??
    dataset.pokemon.find((entry) => entry.displayName.toLowerCase() === name.trim().toLowerCase()) ??
    dataset.pokemon.find((entry) => entry.baseSpecies.toLowerCase() === name.trim().toLowerCase()) ??
    null
  );
}

function usageRank(label: UsageLabel) {
  return { OU: 4, UU: 3, RU: 2, NU: 1 }[label];
}

function scoreFromPokemon(pokemon: PokemonEntry) {
  const stats = pokemon.baseStats;
  return stats.attack + stats.specialAttack + stats.speed + Math.round((stats.hp + stats.defense + stats.specialDefense) * 0.35);
}

function utilityScore(pokemon: PokemonEntry, format: BattleFormat) {
  let total = 0;
  const moveNames = new Set(pokemon.movePool.map((move) => move.name));

  if (setupMoves.some((move) => moveNames.has(move))) total += format === 'Singles' ? 12 : 4;
  if (speedControlMoves.some((move) => moveNames.has(move))) total += format === 'Doubles' ? 16 : 8;
  if (hazardMoves.some((move) => moveNames.has(move))) total += format === 'Singles' ? 12 : 4;
  if (hazardControlMoves.some((move) => moveNames.has(move))) total += format === 'Singles' ? 10 : 3;
  if (recoveryMoves.some((move) => moveNames.has(move))) total += 8;
  if (screenMoves.some((move) => moveNames.has(move))) total += format === 'Doubles' ? 6 : 4;
  if (fakeOutMoves.some((move) => moveNames.has(move))) total += format === 'Doubles' ? 18 : 0;
  if (redirectionMoves.some((move) => moveNames.has(move))) total += format === 'Doubles' ? 18 : 0;
  if (pivotMoves.some((move) => moveNames.has(move))) total += 8;
  if (supportMoves.some((move) => moveNames.has(move))) total += 6;
  if (priorityMoves.some((move) => moveNames.has(move))) total += 5;

  return total;
}

function strongestMove(pokemon: PokemonEntry, predicate?: (move: PokemonEntry['movePool'][number]) => boolean) {
  const preferredStat = bestAttackingStat(pokemon.baseStats);

  return [...pokemon.movePool]
    .filter((move) => move.category !== 'Status' && move.power)
    .filter((move) => !predicate || predicate(move))
    .sort((left, right) => {
      const leftBias = left.category === 'Physical' && preferredStat === 'attack' ? 20 : 0;
      const rightBias = right.category === 'Physical' && preferredStat === 'attack' ? 20 : 0;
      return (right.power ?? 0) + rightBias - ((left.power ?? 0) + leftBias);
    })[0] ?? null;
}

function bestStabMove(pokemon: PokemonEntry) {
  return strongestMove(pokemon, (move) => pokemon.types.includes(move.type));
}

function bestCoverageMove(pokemon: PokemonEntry) {
  return strongestMove(pokemon, (move) => !pokemon.types.includes(move.type));
}

function itemIdByName(name: string) {
  return dataset.items.find((item) => item.name === name)?.id ?? null;
}

function typeBoostItemId(type: string) {
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

  const itemName = map[type];
  return itemName ? itemIdByName(itemName) : null;
}

function assignedMoves(build: PokemonBuild, pokemon: PokemonEntry) {
  return build.moveIds
    .map((moveId) => pokemon.movePool.find((move) => move.id === moveId) ?? null)
    .filter((move): move is PokemonMove => Boolean(move));
}

function candidateGeneratedItemIds(pokemon: PokemonEntry, build: PokemonBuild, format: BattleFormat) {
  const candidates: (string | null)[] = [];
  const addCandidate = (itemId: string | null) => {
    if (itemId && !candidates.includes(itemId)) {
      candidates.push(itemId);
    }
  };

  if (build.useMega) {
    addCandidate(build.itemId ?? findMegaStoneItem(pokemon, findMegaForm(pokemon))?.id ?? null);
    return candidates.filter((itemId): itemId is string => Boolean(itemId));
  }

  if (pokemon.baseSpecies === 'Pikachu') {
    addCandidate(itemIdByName('Light Ball'));
    return candidates.filter((itemId): itemId is string => Boolean(itemId));
  }

  const moves = assignedMoves(build, pokemon);
  const roles = detectRoles(pokemon, format);
  const strongest = [...moves]
    .filter((move) => move.category !== 'Status')
    .sort((left, right) => (right.power ?? 0) - (left.power ?? 0))[0] ?? null;

  if (roles.has('fake-out') || roles.has('redirection') || roles.has('support')) {
    addCandidate(itemIdByName(format === 'Doubles' ? 'Sitrus Berry' : 'Leftovers'));
    addCandidate(itemIdByName('Focus Sash'));
  }

  if (roles.has('hazards') || roles.has('screens')) {
    addCandidate(itemIdByName('Focus Sash'));
    addCandidate(itemIdByName('Leftovers'));
  }

  if (roles.has('recovery') || pokemon.baseStats.hp + pokemon.baseStats.defense + pokemon.baseStats.specialDefense >= 280) {
    addCandidate(itemIdByName(format === 'Doubles' ? 'Sitrus Berry' : 'Leftovers'));
    addCandidate(itemIdByName('Leftovers'));
  }

  if (strongest) {
    addCandidate(typeBoostItemId(strongest.type));
    addCandidate(itemIdByName(pokemon.baseStats.speed >= 95 ? 'Focus Sash' : 'Sitrus Berry'));
  }

  addCandidate(itemIdByName(format === 'Doubles' ? 'Sitrus Berry' : 'Focus Sash'));
  addCandidate(itemIdByName('Leftovers'));
  addCandidate(itemIdByName('Clear Amulet'));
  addCandidate(itemIdByName('Assault Vest'));

  return candidates.filter((itemId): itemId is string => Boolean(itemId));
}

function fallbackGeneratedItemId(pokemon: PokemonEntry, build: PokemonBuild, format: BattleFormat, blockedItemIds = new Set<string>()) {
  return candidateGeneratedItemIds(pokemon, build, format).find((itemId) => !blockedItemIds.has(itemId)) ?? null;
}

function enforceUniqueGeneratedItems(team: Team) {
  const usedItemIds = new Set<string>();
  const nextTeam = sanitizeTeamForChampions(team);

  nextTeam.slots = nextTeam.slots.map((slot) => {
    const pokemon = resolvePokemonForm(slot);
    if (!pokemon) {
      return slot;
    }

    const preferredItemId = slot.itemId && !usedItemIds.has(slot.itemId) ? slot.itemId : null;
    const uniqueItemId = preferredItemId ?? fallbackGeneratedItemId(pokemon, slot, nextTeam.format, usedItemIds);
    if (uniqueItemId) {
      usedItemIds.add(uniqueItemId);
    }

    return {
      ...slot,
      itemId: uniqueItemId,
      evs: normalizeEffortSpread(slot.evs),
    };
  });

  return nextTeam;
}

export function recommendMoveIds(pokemon: PokemonEntry, format: BattleFormat) {
  const picks: string[] = [];
  const addMove = (moveId: string | null | undefined) => {
    if (moveId && !picks.includes(moveId)) {
      picks.push(moveId);
    }
  };

  addMove(bestStabMove(pokemon)?.id);
  addMove(bestCoverageMove(pokemon)?.id);

  const utilityNames =
    format === 'Doubles'
      ? ['Protect', 'Fake Out', 'Tailwind', 'Thunder Wave', 'Icy Wind', 'Helping Hand', 'Wide Guard', 'Rain Dance', 'Sunny Day']
      : ['Protect', 'Thunder Wave', 'Will-O-Wisp', 'Recover', 'Stealth Rock', 'Defog', 'Swords Dance', 'Calm Mind'];

  for (const moveName of utilityNames) {
    const move = pokemon.movePool.find((entry) => entry.name === moveName);
    addMove(move?.id);
    if (picks.length >= 4) {
      break;
    }
  }

  for (const move of pokemon.movePool) {
    if (move.category !== 'Status') {
      addMove(move.id);
    }
    if (picks.length >= 4) {
      break;
    }
  }

  return picks.slice(0, 4);
}

function detectRoles(pokemon: PokemonEntry, format: BattleFormat) {
  const names = new Set(pokemon.movePool.map((move) => move.name));
  const roles = new Set<string>();

  if (hazardMoves.some((move) => names.has(move))) roles.add('hazards');
  if (hazardControlMoves.some((move) => names.has(move))) roles.add('hazard-control');
  if (speedControlMoves.some((move) => names.has(move))) roles.add('speed-control');
  if (setupMoves.some((move) => names.has(move))) roles.add('setup');
  if (recoveryMoves.some((move) => names.has(move))) roles.add('recovery');
  if (pivotMoves.some((move) => names.has(move))) roles.add('pivot');
  if (fakeOutMoves.some((move) => names.has(move))) roles.add('fake-out');
  if (redirectionMoves.some((move) => names.has(move))) roles.add('redirection');
  if (screenMoves.some((move) => names.has(move))) roles.add('screens');
  if (supportMoves.some((move) => names.has(move))) roles.add('support');
  if (spreadMoveNames.some((move) => names.has(move))) roles.add('spread');
  if (priorityMoves.some((move) => names.has(move))) roles.add('priority');
  if (names.has('Protect')) roles.add('protect');
  if (format === 'Singles' && bestAttackingStat(pokemon.baseStats) === 'attack') roles.add('breaker');
  if (format === 'Doubles' && names.has('Helping Hand')) roles.add('support');

  return roles;
}

export function describeBuildRole(build: PokemonBuild, format: BattleFormat) {
  const pokemon = resolvePokemonForm(build);
  if (!pokemon) {
    return 'Open Slot';
  }

  const roles = detectRoles(pokemon, format);
  const physicalBias = buildStats(pokemon.baseStats, build.evs, build.natureId).attack >= buildStats(pokemon.baseStats, build.evs, build.natureId).specialAttack;

  if (format === 'Doubles') {
    if (roles.has('redirection')) return 'Support Redirector';
    if (roles.has('fake-out') && roles.has('pivot')) return 'Tempo Pivot';
    if (roles.has('speed-control')) return 'Speed Control';
    if (roles.has('spread')) return 'Spread Sweeper';
    if (roles.has('support')) return 'Board Support';
  }

  if (roles.has('hazards') && roles.has('hazard-control')) return 'Utility Lead';
  if (roles.has('hazards')) return 'Hazard Setter';
  if (roles.has('hazard-control')) return 'Hazard Control';
  if (roles.has('setup') && physicalBias) return 'Physical Sweeper';
  if (roles.has('setup') && !physicalBias) return 'Special Sweeper';
  if (roles.has('pivot')) return 'Bulky Pivot';
  if (roles.has('recovery')) return 'Sustain Wall';
  if (roles.has('priority')) return 'Cleaner';
  if (roles.has('speed-control')) return 'Speed Control';

  return physicalBias ? 'Offensive Breaker' : 'Special Breaker';
}

function buildForPokemon(pokemon: PokemonEntry, format: BattleFormat, preferMega = false) {
  const build = makeEmptyBuild(makeId('generated'));
  build.pokemonId = pokemon.id;
  build.abilityName = pokemon.abilities[0]?.name ?? null;
  build.natureId = bestAttackingStat(pokemon.baseStats) === 'attack' ? 'jolly' : 'timid';
  const offensivePriority =
    bestAttackingStat(pokemon.baseStats) === 'attack'
      ? ['attack', 'speed', 'hp', 'defense', 'specialDefense', 'specialAttack'] as const
      : ['specialAttack', 'speed', 'hp', 'defense', 'specialDefense', 'attack'] as const;

  const communityPatch = getPopularPresetPatch(pokemon, format);
  if (communityPatch) {
    build.abilityName = communityPatch.abilityName ?? build.abilityName;
    build.natureId = communityPatch.natureId ?? build.natureId;
    build.moveIds = [...(communityPatch.moveIds ?? [])];
    build.evs = communityPatch.evs ? fillEffortSpreadRemainder(normalizeEffortSpread({ ...communityPatch.evs }), [...offensivePriority]) : build.evs;
    build.itemId = communityPatch.itemId ?? build.itemId;
    build.useMega = Boolean(preferMega && communityPatch.useMega);

    if (!preferMega && communityPatch.useMega && communityPatch.itemId) {
      build.itemId = null;
      build.useMega = false;
    }
  } else {
    build.moveIds = recommendMoveIds(pokemon, format);
    if (pokemon.baseStats.hp + pokemon.baseStats.defense + pokemon.baseStats.specialDefense >= 300) {
      build.evs = fillEffortSpreadRemainder(normalizeEffortSpread({ hp: maxEffortValue, defense: 16, specialDefense: 18 }), ['hp', 'defense', 'specialDefense', 'speed', 'attack', 'specialAttack']);
    } else if (bestAttackingStat(pokemon.baseStats) === 'attack') {
      build.evs = fillEffortSpreadRemainder(normalizeEffortSpread({ attack: maxEffortValue, speed: maxEffortValue, hp: 2 }), [...offensivePriority]);
    } else {
      build.evs = fillEffortSpreadRemainder(normalizeEffortSpread({ specialAttack: maxEffortValue, speed: maxEffortValue, hp: 2 }), [...offensivePriority]);
    }
  }

  if (preferMega && !build.useMega) {
    const megaForm = findMegaForm(pokemon);
    const megaStone = findMegaStoneItem(pokemon, megaForm);
    if (megaForm) {
      build.useMega = true;
      build.itemId = megaStone?.id ?? build.itemId;
    }
  }

  if (!build.moveIds.length) {
    build.moveIds = recommendMoveIds(pokemon, format);
  }

  if (!build.itemId) {
    build.itemId = fallbackGeneratedItemId(pokemon, build, format);
  }

  return build;
}

function coverageTypes(team: Team) {
  const types = new Set<string>();
  for (const slot of team.slots) {
    const pokemon = resolvePokemonForm(slot);
    if (!pokemon) {
      continue;
    }

    for (const moveId of slot.moveIds) {
      const move = pokemon.movePool.find((entry) => entry.id === moveId);
      if (move && move.category !== 'Status') {
        types.add(move.type);
      }
    }
  }
  return types;
}

function typeWeaknessCount(team: Team) {
  const counts = new Map<string, number>();
  for (const slot of team.slots) {
    const pokemon = resolvePokemonForm(slot);
    if (!pokemon) {
      continue;
    }

    for (const attackType of Object.keys(pokemon.damageTaken)) {
      if ((pokemon.damageTaken[attackType] ?? 1) > 1) {
        counts.set(attackType, (counts.get(attackType) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function teamMoveCount(team: Team, moveNames: string[]) {
  let total = 0;
  for (const slot of team.slots) {
    const pokemon = resolvePokemonForm(slot);
    if (!pokemon) {
      continue;
    }

    for (const moveId of slot.moveIds) {
      const move = pokemon.movePool.find((entry) => entry.id === moveId);
      if (move && moveNames.includes(move.name)) {
        total += 1;
      }
    }
  }
  return total;
}

function teamAverageSpeed(team: Team) {
  const values = team.slots
    .map((slot) => {
      const pokemon = resolvePokemonForm(slot);
      return pokemon ? buildStats(pokemon.baseStats, slot.evs, slot.natureId).speed : null;
    })
    .filter((value): value is number => value !== null);

  if (!values.length) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function estimateSurvivability(team: Team) {
  const values = team.slots
    .map((slot) => {
      const pokemon = resolvePokemonForm(slot);
      if (!pokemon) {
        return null;
      }

      const stats = buildStats(pokemon.baseStats, slot.evs, slot.natureId);
      const role = describeBuildRole(slot, team.format);
      let score = (stats.hp + stats.defense + stats.specialDefense) / 3;
      if (role.includes('Wall') || role.includes('Pivot')) score += 15;
      if (slot.moveIds.some((moveId) => recoveryMoves.includes(pokemon.movePool.find((move) => move.id === moveId)?.name ?? ''))) score += 12;
      if (slot.moveIds.some((moveId) => pokemon.movePool.find((move) => move.id === moveId)?.name === 'Protect')) score += team.format === 'Doubles' ? 8 : 4;
      return score;
    })
    .filter((value): value is number => value !== null);

  if (!values.length) {
    return { score: 0, grade: 'D', turns: 0 };
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const normalized = Math.max(18, Math.min(98, Math.round((average - 80) * 0.55)));
  const grade = normalized >= 88 ? 'S' : normalized >= 76 ? 'A' : normalized >= 64 ? 'B' : normalized >= 50 ? 'C' : 'D';
  const turns = Number((average / 28).toFixed(1));

  return { score: normalized, grade, turns };
}

function bestThreatMove(threat: PokemonEntry, format: BattleFormat) {
  if (format === 'Doubles') {
    return (
      strongestMove(threat, (move) => spreadMoveNames.includes(move.name)) ??
      strongestMove(threat, (move) => threat.types.includes(move.type)) ??
      strongestMove(threat)
    );
  }

  return strongestMove(threat);
}

function threatScoreAgainstTeam(team: Team, threat: PokemonEntry) {
  const threatSpeed = threat.baseStats.speed;
  const bestMove = bestThreatMove(threat, team.format);
  const threatOffense = Math.max(threat.baseStats.attack, threat.baseStats.specialAttack);
  const threatUsage = usageRank(getPokemonUsageInsight(threat, team.format).label);
  let score = threatSpeed + threatOffense + threatUsage * 18;
  let pressureCount = 0;

  for (const slot of team.slots) {
    const defender = resolvePokemonForm(slot);
    if (!defender || !bestMove) {
      continue;
    }

    const effectiveness = typeEffectiveness(bestMove.type, effectiveTypes(defender, slot, 'clear'));
    if (effectiveness > 1) {
      pressureCount += 1;
      score += effectiveness * (bestMove.power ?? 0) * 0.35;
    }
  }

  if (team.format === 'Doubles' && spreadMoveNames.includes(bestMove?.name ?? '')) {
    score += 18;
  }

  if (pressureCount === 0) {
    score *= 0.5;
  }

  return { score, pressureCount, move: bestMove };
}

function counterScore(slot: PokemonBuild, threat: PokemonEntry, threatMoveType: string | null) {
  const pokemon = resolvePokemonForm(slot);
  if (!pokemon) {
    return -999;
  }

  let score = 0;
  const defenses = effectiveTypes(pokemon, slot, 'clear');

  if (threatMoveType) {
    const resistance = typeEffectiveness(threatMoveType, defenses);
    if (resistance < 1) score += 28;
    if (resistance === 0) score += 18;
    if (resistance > 1) score -= 18;
  }

  for (const moveId of slot.moveIds) {
    const move = pokemon.movePool.find((entry) => entry.id === moveId);
    if (!move || move.category === 'Status') {
      continue;
    }

    const effectiveness = typeEffectiveness(move.type, threat.types);
    score += effectiveness * 12 + (move.power ?? 0) * 0.05;
  }

  score += buildStats(pokemon.baseStats, slot.evs, slot.natureId).speed * 0.04;
  return score;
}

function bestCounterSlots(team: Team, threat: PokemonEntry, limit = 4) {
  const threatMove = bestThreatMove(threat, team.format);

  return team.slots
    .map((slot) => ({
      slot,
      pokemon: resolvePokemonForm(slot),
      score: counterScore(slot, threat, threatMove?.type ?? null),
    }))
    .filter((entry) => entry.pokemon)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function teammateNames(entries: { slot: PokemonBuild; pokemon: PokemonEntry | null; score: number }[]) {
  return entries
    .map((entry) => (entry.pokemon ? buildLabel(entry.slot, entry.pokemon) : null))
    .filter((name): name is string => Boolean(name));
}

function commonThreatPool(format: BattleFormat) {
  return [...new Set(getTopMetaSpecies(format))]
    .map((name) => lookupPokemonByName(name))
    .filter((pokemon): pokemon is PokemonEntry => Boolean(pokemon && !pokemon.isMega));
}

function easyTargetPool(team: Team) {
  return commonThreatPool(team.format)
    .filter((threat) => !team.slots.some((slot) => resolvePokemonForm(slot)?.baseSpecies === threat.baseSpecies))
    .map((threat) => {
      const counters = bestCounterSlots(team, threat, 4);
      const averageCounter = counters.reduce((sum, counter) => sum + counter.score, 0) / Math.max(1, counters.length);
      return { threat, averageCounter };
    })
    .sort((left, right) => right.averageCounter - left.averageCounter)
    .slice(0, 4)
    .map(({ threat }) => `${threat.displayName} looks like a favorable target if you keep your answers healthy.`);
}

export function suggestArchetypesForCore(corePokemonNames: string[], format: BattleFormat) {
  const lowerNames = corePokemonNames.map((name) => name.toLowerCase());
  const suggestions = new Set<string>();

  for (const archetype of archetypeLibrary) {
    if (archetype.species.some((species) => lowerNames.includes(species.toLowerCase()))) {
      suggestions.add(archetype.name);
    }
  }

  if (lowerNames.some((name) => ['pelipper', 'kingdra', 'castform'].includes(name))) suggestions.add('Rain Circuit');
  if (lowerNames.some((name) => ['charizard', 'venusaur', 'torkoal'].includes(name))) suggestions.add('Sun Circuit');
  if (lowerNames.some((name) => ['hippowdon', 'tyranitar', 'garchomp'].includes(name))) suggestions.add('Sand Bunker');
  if (lowerNames.some((name) => ['castform', 'bellibolt', 'sableye', 'jolteon', 'chimecho'].includes(name))) suggestions.add('Deep Cut');
  if (format === 'Doubles' && lowerNames.some((name) => ['incineroar', 'sinistcha', 'whimsicott'].includes(name))) suggestions.add('Stadium Balance');

  return [...suggestions].slice(0, 4);
}

export function analyzeTeam(team: Team): TeamAnalysis {
  const filledSlots = team.slots.filter((slot) => resolvePokemonForm(slot));

  if (!filledSlots.length) {
    return {
      format: team.format,
      synergyScore: 0,
      estimatedWinRate: 0,
      estimatedWinRateLow: 0,
      estimatedWinRateHigh: 0,
      survivabilityScore: 0,
      survivabilityGrade: 'D',
      survivabilityTurns: 0,
      winRateSummary: 'Add a few Pokemon before the app can project a useful win-rate band.',
      survivabilitySummary: 'Add a few Pokemon before the app can estimate how many stable turns the shell can absorb.',
      metricNotes: [],
      overview: 'Add a few Pokemon to start the analyzer.',
      strengths: [],
      weaknesses: [],
      threats: [],
      recommendations: ['Start with at least three Pokemon so the analyzer can score overlap, usage, and coverage.'],
      balanceHints: [],
      coverageHighlights: [],
      formatNotes: [`${team.format} plans change what matters most, so the guidance wakes up once you add actual members.`],
      previewPlans: [],
      archetypeSuggestions: [],
      easyTargets: [],
      teamUsage: getTeamUsageInsight(team),
    };
  }

  const coverage = coverageTypes(team);
  const weaknessMap = typeWeaknessCount(team);
  const averageSpeed = teamAverageSpeed(team);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recommendations: string[] = [];
  const balanceHints: string[] = [];
  const coverageHighlights: string[] = [];
  const formatNotes: string[] = [];

  const speedControlCount = teamMoveCount(team, speedControlMoves);
  const protectCount = teamMoveCount(team, ['Protect']);
  const fakeOutCount = teamMoveCount(team, fakeOutMoves);
  const redirectionCount = teamMoveCount(team, redirectionMoves);
  const hazardCount = teamMoveCount(team, hazardMoves);
  const hazardControlCount = teamMoveCount(team, hazardControlMoves);
  const pivotCount = teamMoveCount(team, pivotMoves);
  const recoveryCount = teamMoveCount(team, recoveryMoves);
  const spreadCount = teamMoveCount(team, spreadMoveNames);
  const teamUsage = getTeamUsageInsight(team);
  const survivability = estimateSurvivability(team);

  if (team.format === 'Singles') {
    if (hazardCount) strengths.push('The team can pressure long Singles games with hazard chip.');
    if (hazardControlCount) strengths.push('You have hazard control, which keeps boots-less lines playable.');
    if (speedControlCount) strengths.push('There is at least one speed-control line for faster Singles mirrors.');
    if (pivotCount >= 2) strengths.push('Your pivoting tools should help you keep good breakers healthy.');
    if (recoveryCount >= 2) strengths.push('There is enough sustain to play multiple positioning turns.');

    if (!hazardCount) recommendations.push('Singles teams want at least one proactive chip plan such as Stealth Rock or another pressure tool.');
    if (!hazardControlCount) recommendations.push('Add Defog, Rapid Spin, or Mortal Spin so spikes and rocks do not decide preview alone.');
    if (!filledSlots.some((slot) => describeBuildRole(slot, team.format).includes('Sweeper')) && averageSpeed < 120) {
      recommendations.push('This Singles shell could use a clearer closer so it can actually cash in the chip it creates.');
    }

    formatNotes.push('Singles rewards chip management, one reliable closer, and a stable answer to opposing hazards.');
  } else {
    if (speedControlCount >= 2) strengths.push('Your doubles shell has multiple speed-control layers for board resets.');
    if (protectCount >= 3) strengths.push('The Protect count is healthy, so you can pivot around target pressure and scout item lines.');
    if (fakeOutCount) strengths.push('Fake Out support gives you a clean way to steal tempo on turn one.');
    if (redirectionCount) strengths.push('Redirection support helps fragile sweepers or Megas reach the turns they need.');
    if (spreadCount >= 2) strengths.push('There are enough spread attackers to punish passive board states.');

    if (protectCount < 2) recommendations.push('Doubles teams usually want at least two Protect users so you can keep sequencing flexible.');
    if (!speedControlCount) recommendations.push('Add Tailwind, Icy Wind, Trick Room, or paralysis support before faster doubles boards run you over.');
    if (!fakeOutCount && !redirectionCount) recommendations.push('A doubles shell with no Fake Out or redirection has to play every lead honestly; add one of those cushions.');
    if (!spreadCount) recommendations.push('You are short on spread damage, so wide opposing boards may position too freely around your lines.');

    formatNotes.push('Doubles rewards Protect density, speed control, and one or two support pieces that let your Mega or cleaner attack safely.');
  }

  const repeatedWeaknesses = [...weaknessMap.entries()].filter(([, count]) => count >= 3);
  for (const [type, count] of repeatedWeaknesses) {
    weaknesses.push(`${count} members are weak to ${type}.`);
  }

  if (coverage.size >= (team.format === 'Doubles' ? 6 : 7)) {
    coverageHighlights.push(`Your selected moves currently pressure ${coverage.size} attacking types, which is healthy for ${team.format}.`);
  } else {
    recommendations.push('Broaden offensive coverage so opponents cannot stabilize around one or two safe resist patterns.');
  }

  for (const slot of filledSlots) {
    const pokemon = resolvePokemonForm(slot)!;
    const stats = buildStats(pokemon.baseStats, slot.evs, slot.natureId);
    const defenseTotal = stats.defense + stats.specialDefense;
    const difference = stats.hp - defenseTotal;

    if (difference < -20) {
      balanceHints.push(`${pokemon.displayName}: HP trails the combined defenses, so your custom heuristic would shift more EVs into HP.`);
    } else if (difference > 30) {
      balanceHints.push(`${pokemon.displayName}: HP is outpacing the defense sum, so your custom heuristic would feed the weaker defense instead.`);
    }
  }

  const threatPool = commonThreatPool(team.format)
    .filter((entry) => !filledSlots.some((slot) => resolvePokemonForm(slot)?.baseSpecies === entry.baseSpecies))
    .map((entry) => {
      const report = threatScoreAgainstTeam(team, entry);
      const counters = bestCounterSlots(team, entry);
      const counterNames = teammateNames(counters);
      return {
        pokemonId: entry.id,
        name: entry.displayName,
        score: report.score,
        reason: report.move
          ? `${entry.displayName} pressures ${report.pressureCount} of your current slots with ${report.move.name}.`
          : `${entry.displayName} has a stat profile that stresses your current shell.`,
        previewCue: report.move
          ? `Watch for ${entry.displayName} preview lines built around ${report.move.name}.`
          : `Watch for an aggressive ${entry.displayName} lead or endgame line in preview.`,
        counterplay: [
          counterNames.length
            ? `Your best answers are ${counterNames.slice(0, Math.min(3, counterNames.length)).join(', ')} because they either resist the pressure or hit back cleanly.`
            : 'This threat does not have a clean answer yet, so the best fix is better role compression or a replacement slot.',
          team.format === 'Doubles'
            ? 'In doubles, protect the answer slot for one turn if that preserves your speed control or board position.'
            : 'In singles, trade chip early so your revenge or setup line actually closes the game later.',
          `If this matchup keeps showing up, try a move or EV change before tearing apart the full team.`,
        ],
        bringPlan: counterNames.length
          ? `If preview shows ${entry.displayName}, the safest four are ${counterNames.slice(0, Math.min(4, counterNames.length)).join(', ')}.`
          : `If preview shows ${entry.displayName}, lean on your bulkiest lines and preserve priority or speed control.`,
      } satisfies ThreatReport;
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 6);

  const previewPlans = threatPool.slice(0, 3).map((threat) => threat.bringPlan);
  const easyTargets = easyTargetPool(team);
  const archetypeSuggestions = suggestArchetypesForCore(
    filledSlots.map((slot) => resolvePokemonForm(slot)?.baseSpecies ?? '').filter(Boolean),
    team.format,
  );

  const usageBonus = usageRank(teamUsage.label) * 3;
  const synergyScore = Math.max(
    24,
    Math.min(
      99,
      Math.round(
        38 +
          coverage.size * 4 +
          strengths.length * 4 -
          repeatedWeaknesses.length * 7 +
          Math.min(averageSpeed, 140) * 0.12 +
          usageBonus +
          survivability.score * 0.12 +
          (team.format === 'Doubles' ? protectCount * 2 + speedControlCount * 2 + fakeOutCount * 4 : hazardCount * 3 + hazardControlCount * 3),
      ),
    ),
  );

  const averageThreatScore = threatPool.length
    ? threatPool.reduce((sum, threat) => sum + threat.score, 0) / threatPool.length
    : 0;
  const threatPenalty = Math.max(0, Math.round((averageThreatScore - 165) / 18));
  const structureBonus = team.format === 'Doubles'
    ? Math.min(12, protectCount * 1.5 + speedControlCount * 2 + fakeOutCount * 2 + redirectionCount * 2)
    : Math.min(12, hazardCount * 1.5 + hazardControlCount * 1.5 + pivotCount * 1.25 + recoveryCount);
  const easyTargetBonus = Math.min(6, easyTargets.length * 1.5);
  let estimatedWinRate = Math.max(
    28,
    Math.min(
      82,
      Math.round(26 + synergyScore * 0.4 + survivability.score * 0.2 + structureBonus + easyTargetBonus - threatPenalty),
    ),
  );
  if (team.format === 'Doubles' && protectCount >= 3 && speedControlCount >= 2) {
    estimatedWinRate += 2;
  }
  if (teamUsage.label === 'NU' && team.format === 'Singles' && synergyScore >= 72) {
    estimatedWinRate = Math.max(estimatedWinRate, 60);
  }
  estimatedWinRate = Math.max(30, Math.min(84, estimatedWinRate));

  const volatility = Math.max(
    4,
    Math.min(
      12,
      11 -
        Math.round(synergyScore / 18) -
        Math.round(survivability.score / 24) +
        repeatedWeaknesses.length * 2 +
        Math.max(0, 2 - Math.min(2, speedControlCount)),
    ),
  );
  const estimatedWinRateLow = Math.max(18, estimatedWinRate - volatility);
  const estimatedWinRateHigh = Math.min(92, estimatedWinRate + volatility);

  const survivabilitySummary = `Survivability projects about ${survivability.turns} stable turns before the shell starts forcing sacks, based on HP, defenses, sustain, and protective utility.`;
  const winRateSummary = `Win Rate is an estimate, not a promise: this team currently projects around ${estimatedWinRateLow}-${estimatedWinRateHigh}% in a normal ${team.format.toLowerCase()} ranked pocket.`;
  const metricNotes = [
    `Win Rate blends synergy, threat pressure, role compression, speed control, sustain, and format-specific structure into one estimate.`,
    `Survivability uses team bulk, recovery access, Protect density, and defensive role support to grade how long the shell can keep trading cleanly.`,
    `${survivability.grade} / ${survivability.score} is the survivability grade, and ${survivability.turns} turns is the projected stable battle window before repeated pressure should start collapsing the board.`,
  ];

  const overview = repeatedWeaknesses.length
    ? `The ${team.format} shell has a real game plan, but a few matchup clusters can still overload it in preview.`
    : `The ${team.format} shell is coherent, flexible, and should give you real room to outplay instead of forcing coin-flip previews.`;

  if (!recommendations.length) {
    recommendations.push('The structure is healthy already; the next edge is tuning specific EVs and move slots for your expected ranked pocket.');
  }

  return {
    format: team.format,
    synergyScore,
    estimatedWinRate,
    estimatedWinRateLow,
    estimatedWinRateHigh,
    survivabilityScore: survivability.score,
    survivabilityGrade: survivability.grade,
    survivabilityTurns: survivability.turns,
    winRateSummary,
    survivabilitySummary,
    metricNotes,
    overview,
    strengths,
    weaknesses,
    threats: threatPool,
    recommendations,
    balanceHints,
    coverageHighlights,
    formatNotes,
    previewPlans,
    archetypeSuggestions,
    easyTargets,
    teamUsage,
  };
}

function missingRoleBonus(selected: PokemonEntry[], pokemon: PokemonEntry, format: BattleFormat) {
  const selectedRoles = new Set(selected.flatMap((entry) => [...detectRoles(entry, format)]));
  const candidateRoles = detectRoles(pokemon, format);
  let bonus = 0;

  for (const role of candidateRoles) {
    if (!selectedRoles.has(role)) {
      bonus += role === 'fake-out' || role === 'redirection' ? 28 : 14;
    }
  }

  return bonus;
}

function variantScore(pokemon: PokemonEntry, format: BattleFormat, variant: VariantConfig, offMetaBias: number, selected: PokemonEntry[]) {
  const usage = usageRank(getPokemonUsageInsight(pokemon, format).label);
  const speed = pokemon.baseStats.speed;
  const bulk = pokemon.baseStats.hp + pokemon.baseStats.defense + pokemon.baseStats.specialDefense;
  const utility = utilityScore(pokemon, format);
  const offMetaBonus = offMetaMascots.has(pokemon.baseSpecies) ? offMetaBias * variant.offMetaWeight : 0;

  return (
    scoreFromPokemon(pokemon) +
    usage * variant.metaWeight +
    speed * (variant.speedWeight / 100) +
    bulk * (variant.bulkWeight / 100) +
    utility * (variant.supportWeight / 2) +
    missingRoleBonus(selected, pokemon, format) +
    offMetaBonus
  );
}

function weightedRandom<T>(entries: T[], weightFor: (value: T) => number) {
  const weights = entries.map((entry) => Math.max(1, weightFor(entry)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  let cursor = Math.random() * total;

  for (let index = 0; index < entries.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return entries[index];
    }
  }

  return entries[entries.length - 1];
}

function shuffle<T>(entries: T[]) {
  const next = [...entries];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function formatSupportTargets(format: BattleFormat) {
  return format === 'Doubles'
    ? ['Incineroar', 'Sinistcha', 'Whimsicott', 'Pelipper', 'Torkoal', 'Gengar', 'Milotic', 'Dragonite']
    : ['Corviknight', 'Primarina', 'Milotic', 'Kingambit', 'Scizor', 'Glimmora', 'Hippowdon', 'Dragonite'];
}

function chooseMegaCandidates(selected: PokemonEntry[], format: BattleFormat, lockedNames: string[]) {
  const locked = new Set(lockedNames.map((name) => name.toLowerCase()));

  return [...selected]
    .filter((pokemon) => Boolean(findMegaForm(pokemon)))
    .sort((left, right) => {
      const leftMega = findMegaForm(left);
      const rightMega = findMegaForm(right);
      const leftUsage = usageRank(getPokemonUsageInsight(leftMega ?? left, format).label) + (locked.has(left.baseSpecies.toLowerCase()) ? 2 : 0);
      const rightUsage = usageRank(getPokemonUsageInsight(rightMega ?? right, format).label) + (locked.has(right.baseSpecies.toLowerCase()) ? 2 : 0);
      return rightUsage - leftUsage;
    })
    .slice(0, 3);
}

function buildTeamFromSelection(selection: PokemonEntry[], format: BattleFormat, lockedNames: string[]) {
  const megaCandidates = chooseMegaCandidates(selection, format, lockedNames);
  const primaryMega = megaCandidates[0] ?? null;
  const team = createTeam('Generated Team', format);

  team.slots = team.slots.map((slot, index) => {
    const pokemon = selection[index];
    if (!pokemon) {
      return slot;
    }

    return buildForPokemon(pokemon, format, primaryMega?.baseSpecies === pokemon.baseSpecies);
  });

  return { team: enforceUniqueGeneratedItems(team), megaCandidates };
}

function teamSignature(selection: PokemonEntry[]) {
  return [...selection].map((pokemon) => pokemon.baseSpecies).sort().join('|');
}

function reasonFromMember(pokemon: PokemonEntry | null, format: BattleFormat) {
  if (!pokemon) {
    return null;
  }

  return getPresetSupportNote(pokemon, format) ?? `${pokemon.displayName} keeps the plan structurally sound through role compression and matchup flexibility.`;
}

function generateSelection(
  candidatePool: PokemonEntry[],
  format: BattleFormat,
  variant: VariantConfig,
  offMetaBias: number,
  lockedPokemon: PokemonEntry[],
  randomize: boolean,
) {
  const selected: PokemonEntry[] = [];
  const tryAdd = (pokemon: PokemonEntry | null) => {
    if (!pokemon || selected.some((entry) => entry.baseSpecies === pokemon.baseSpecies)) {
      return;
    }
    selected.push(pokemon);
  };

  for (const locked of lockedPokemon) {
    tryAdd(locked);
  }

  const pool = randomize ? shuffle(candidatePool) : [...candidatePool];
  while (selected.length < 6 && pool.length) {
    const ordered = [...pool].sort(
      (left, right) => variantScore(right, format, variant, offMetaBias, selected) - variantScore(left, format, variant, offMetaBias, selected),
    );

    const candidate = randomize
      ? weightedRandom(
        shuffle(ordered.slice(0, Math.min(18, ordered.length))),
        (entry) => variantScore(entry, format, variant, offMetaBias, selected),
      )
      : ordered[0];

    tryAdd(candidate);
    const index = pool.findIndex((entry) => entry.baseSpecies === candidate.baseSpecies);
    if (index >= 0) {
      pool.splice(index, 1);
    }
  }

  if (selected.length < 6) {
    const fallback = [...dataset.pokemon]
      .filter((pokemon) => !pokemon.isMega)
      .filter((pokemon) => !selected.some((entry) => entry.baseSpecies === pokemon.baseSpecies))
      .sort((left, right) => scoreFromPokemon(right) + utilityScore(right, format) - (scoreFromPokemon(left) + utilityScore(left, format)));

    for (const pokemon of fallback) {
      if (selected.length >= 6) {
        break;
      }
      tryAdd(pokemon);
    }
  }

  return selected;
}

export function generateTeamPlans(
  archetypeId: string,
  format: BattleFormat,
  offMetaBias: number,
  lockedPokemonNames: string[],
  requestedCount = 8,
  randomize = false,
) {
  const archetype = archetypeLibrary.find((entry) => entry.id === archetypeId) ?? archetypeLibrary[0];
  const lockedPokemon = lockedPokemonNames.map((name) => lookupPokemonByName(name)).filter((pokemon): pokemon is PokemonEntry => Boolean(pokemon && !pokemon.isMega));
  const poolNames = new Set<string>([
    ...archetype.species,
    ...getTopMetaSpecies(format),
    ...formatSupportTargets(format),
    ...lockedPokemon.map((pokemon) => pokemon.baseSpecies),
  ]);

  if (offMetaBias >= 50 || archetype.id === 'deep-cut') {
    for (const name of ['Castform', 'Bellibolt', 'Sableye', 'Jolteon', 'Chimecho']) {
      poolNames.add(name);
    }
  }

  const candidatePool = [...poolNames]
    .map((name) => lookupPokemonByName(name))
    .filter((pokemon): pokemon is PokemonEntry => Boolean(pokemon && !pokemon.isMega));

  const desiredCount = Math.max(3, Math.min(20, requestedCount));
  const variants = Array.from({ length: desiredCount }, (_, index) => variantLibrary[index % variantLibrary.length]);
  const uniqueTeams = new Set<string>();
  const plans: GeneratedTeamPlan[] = [];

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    let attempts = 0;

    while (attempts < 20) {
      const selection = generateSelection(candidatePool, format, variant, offMetaBias + (index % 3) * 6, lockedPokemon, randomize || index >= variantLibrary.length);
      const signature = teamSignature(selection);
      attempts += 1;

      if (uniqueTeams.has(signature)) {
        continue;
      }

      uniqueTeams.add(signature);
      const { team, megaCandidates } = buildTeamFromSelection(selection, format, lockedPokemonNames);
      const analysis = analyzeTeam(team);
      const primaryMega = megaCandidates[0] ? findMegaForm(megaCandidates[0]) ?? megaCandidates[0] : null;
      const secondaryMegas = megaCandidates.slice(1).map((pokemon) => findMegaForm(pokemon)?.displayName ?? pokemon.displayName);
      const topThreat = analysis.threats[0];
      const lockedBaseNames = lockedPokemon.map((pokemon) => pokemon.baseSpecies);

      const reasons = [
        archetype.summary,
        variant.summary,
        lockedBaseNames.length
          ? `${lockedBaseNames.join(', ')} stay locked in, so the remaining slots were chosen to patch speed, bulk, coverage, and role gaps.`
          : `This version starts from the ${archetype.name} shell and then tunes the last few slots for ${format}.`,
        reasonFromMember(primaryMega ? megaCandidates[0] : null, format) ?? 'A dedicated Mega angle was kept so the team still has a premium closer.',
        analysis.strengths[0] ?? analysis.coverageHighlights[0] ?? `The current move coverage already supports flexible ${format} preview decisions.`,
      ].filter(Boolean) as string[];

      const expertNotes = [
        primaryMega
          ? `${primaryMega.displayName} is the primary Mega because ${getPokemonUsageInsight(primaryMega, format).reason.toLowerCase()}`
          : 'This version stays non-Mega on purpose so every item slot can stay flexible.',
        secondaryMegas.length
          ? `Secondary Mega candidates: ${secondaryMegas.join(', ')}. They stay on the roster as alternate ladder branches if you want to pivot builds later.`
          : 'This team focuses on one Mega plan instead of splitting its item economy.',
        primaryMega ? getPresetPreviewNote(megaCandidates[0], format) ?? `${primaryMega.displayName} is the main closer, so keep it healthy until the board opens.` : 'No Mega candidate was forced into this draft.',
        analysis.previewPlans[0] ?? `Use preview to identify the opposing speed-control plan first, then pick the four that keep your own cleaner protected.`,
        topThreat ? `The first threat check is ${topThreat.name}, so the draft keeps explicit counterplay for that matchup.` : `This draft is tuned to avoid one-dimensional previews.`,
      ];

      plans.push({
        id: makeId(`plan-${variant.id}-${index + 1}`),
        name: lockedBaseNames.length ? `${lockedBaseNames[0]} ${variant.tag}` : `${archetype.name} ${variant.tag}`,
        format,
        archetype: archetype.name,
        planTag: index < variantLibrary.length ? variant.tag : randomize ? `Random ${index + 1}` : `${variant.tag} ${index + 1}`,
        summary: `${variant.summary} ${format} plan built from the live Champions roster and current community usage reads.`,
        reasons: reasons.slice(0, 6),
        expertNotes,
        favoritePokemon: lockedBaseNames[0] ?? null,
        megaPokemonId: primaryMega?.id ?? null,
        megaReason: primaryMega
          ? `${primaryMega.displayName} is the Mega anchor here because it gives the team its cleanest high-leverage win button without breaking the support spine.`
          : 'This draft does not force a Mega; it leans on item flexibility instead.',
        slots: team.slots,
        analysis,
      } satisfies GeneratedTeamPlan);
      break;
    }
  }

  return plans;
}

export { archetypeLibrary };
