import rawData from '../data/champions-data.json';
import type {
  AbilityEntry,
  AppState,
  BattleFormat,
  ChampionsDataset,
  EnvironmentState,
  ItemEntry,
  NatureEntry,
  PokemonBuild,
  PokemonEntry,
  PokemonMove,
  StatBlock,
  StatKey,
  StatusCondition,
  Team,
  Terrain,
  Weather,
} from '../types';

function megaSpriteSuffix(pokemon: PokemonEntry) {
  if (!pokemon.isMega) {
    return '';
  }

  if (pokemon.baseSpecies === 'Charizard') {
    if (pokemon.types.includes('Dragon') || pokemon.abilities.some((ability) => ability.name === 'Tough Claws')) {
      return '-mx';
    }

    if (pokemon.abilities.some((ability) => ability.name === 'Drought')) {
      return '-my';
    }
  }

  return '-m';
}

function fallbackSpriteForPokemon(pokemon: PokemonEntry, shiny = false) {
  const dexNumber = String(pokemon.dexNumber).padStart(3, '0');
  const suffix = megaSpriteSuffix(pokemon);
  const basePath = shiny ? 'https://www.serebii.net/Shiny/home/' : 'https://www.serebii.net/pokemonhome/pokemon/';
  return `${basePath}${dexNumber}${suffix}.png`;
}

function normalizeMegaIdentity(pokemon: PokemonEntry) {
  if (!pokemon.isMega || pokemon.baseSpecies !== 'Charizard') {
    return pokemon;
  }

  if (pokemon.types.includes('Dragon') || pokemon.abilities.some((ability) => ability.name === 'Tough Claws')) {
    return {
      ...pokemon,
      displayName: 'Mega Charizard X',
      megaStone: 'Charizardite X',
    };
  }

  if (pokemon.abilities.some((ability) => ability.name === 'Drought')) {
    return {
      ...pokemon,
      displayName: 'Mega Charizard Y',
      megaStone: 'Charizardite Y',
    };
  }

  return pokemon;
}

function normalizeDataset(source: ChampionsDataset): ChampionsDataset {
  return {
    ...source,
    pokemon: source.pokemon.map((entry) => {
      const normalized = normalizeMegaIdentity({
        ...entry,
        types: [...entry.types],
        abilities: entry.abilities.map((ability) => ({ ...ability })),
        baseStats: { ...entry.baseStats },
        neutralRanges: { ...entry.neutralRanges },
        movePool: entry.movePool.map((move) => ({ ...move })),
        damageTaken: { ...entry.damageTaken },
      });

      return {
        ...normalized,
        sprite: normalized.sprite || fallbackSpriteForPokemon(normalized),
        shinySprite: normalized.shinySprite || fallbackSpriteForPokemon(normalized, true),
      };
    }),
  };
}

export const dataset = normalizeDataset(rawData as ChampionsDataset);

export function makeId(prefix: string) {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
}

export const statOrder: StatKey[] = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
export const offensiveStats: StatKey[] = ['attack', 'specialAttack'];
export const weatherOptions: Weather[] = ['clear', 'sun', 'rain', 'sand', 'snow'];
export const terrainOptions: Terrain[] = ['none', 'electric', 'grassy', 'misty', 'psychic'];
export const statusOptions: StatusCondition[] = ['healthy', 'burn', 'poison', 'toxic', 'paralysis', 'sleep', 'freeze'];
export const battleFormats: BattleFormat[] = ['Singles', 'Doubles'];

export const statLabels: Record<StatKey, string> = {
  hp: 'HP',
  attack: 'Atk',
  defense: 'Def',
  specialAttack: 'SpA',
  specialDefense: 'SpD',
  speed: 'Spe',
};

export const defaultEnvironment: EnvironmentState = {
  battleFormat: 'Singles',
  weather: 'clear',
  terrain: 'none',
  gravity: false,
  magicRoom: false,
  wonderRoom: false,
  helpingHand: false,
  criticalHit: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  spreadTargetsHit: 1,
  defenderProtectedByBerry: true,
};

export const natures: NatureEntry[] = [
  { id: 'hardy', name: 'Hardy', plus: null, minus: null },
  { id: 'lonely', name: 'Lonely', plus: 'attack', minus: 'defense' },
  { id: 'brave', name: 'Brave', plus: 'attack', minus: 'speed' },
  { id: 'adamant', name: 'Adamant', plus: 'attack', minus: 'specialAttack' },
  { id: 'naughty', name: 'Naughty', plus: 'attack', minus: 'specialDefense' },
  { id: 'bold', name: 'Bold', plus: 'defense', minus: 'attack' },
  { id: 'docile', name: 'Docile', plus: null, minus: null },
  { id: 'relaxed', name: 'Relaxed', plus: 'defense', minus: 'speed' },
  { id: 'impish', name: 'Impish', plus: 'defense', minus: 'specialAttack' },
  { id: 'lax', name: 'Lax', plus: 'defense', minus: 'specialDefense' },
  { id: 'timid', name: 'Timid', plus: 'speed', minus: 'attack' },
  { id: 'hasty', name: 'Hasty', plus: 'speed', minus: 'defense' },
  { id: 'serious', name: 'Serious', plus: null, minus: null },
  { id: 'jolly', name: 'Jolly', plus: 'speed', minus: 'specialAttack' },
  { id: 'naive', name: 'Naive', plus: 'speed', minus: 'specialDefense' },
  { id: 'modest', name: 'Modest', plus: 'specialAttack', minus: 'attack' },
  { id: 'mild', name: 'Mild', plus: 'specialAttack', minus: 'defense' },
  { id: 'quiet', name: 'Quiet', plus: 'specialAttack', minus: 'speed' },
  { id: 'bashful', name: 'Bashful', plus: null, minus: null },
  { id: 'rash', name: 'Rash', plus: 'specialAttack', minus: 'specialDefense' },
  { id: 'calm', name: 'Calm', plus: 'specialDefense', minus: 'attack' },
  { id: 'gentle', name: 'Gentle', plus: 'specialDefense', minus: 'defense' },
  { id: 'sassy', name: 'Sassy', plus: 'specialDefense', minus: 'speed' },
  { id: 'careful', name: 'Careful', plus: 'specialDefense', minus: 'specialAttack' },
  { id: 'quirky', name: 'Quirky', plus: null, minus: null },
];

export const blankStats = (): StatBlock => ({
  hp: 0,
  attack: 0,
  defense: 0,
  specialAttack: 0,
  specialDefense: 0,
  speed: 0,
});

const legacyEffortCap = 252;
const legacyEffortStep = 4;
export const fixedIvValue = 31;
export const maxEffortValue = 32;
export const totalEffortBudget = 66;
export const level = dataset.mechanics.battleLevel;

export const typeChart: Record<string, Record<string, number>> = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: { Fire: 0.5, Water: 2, Grass: 0.5, Poison: 0.5, Ground: 2, Flying: 0.5, Bug: 0.5, Rock: 2, Dragon: 0.5, Steel: 0.5 },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5, Ice: 0.5 },
  Fighting: { Normal: 2, Ice: 2, Poison: 0.5, Flying: 0.5, Psychic: 0.5, Bug: 0.5, Rock: 2, Ghost: 0, Dark: 2, Steel: 2, Fairy: 0.5 },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: { Fire: 0.5, Grass: 2, Fighting: 0.5, Poison: 0.5, Flying: 0.5, Psychic: 2, Ghost: 0.5, Dark: 2, Steel: 0.5, Fairy: 0.5 },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

const pokemonIndex = new Map(dataset.pokemon.map((entry) => [entry.id, entry]));
const moveIndex = new Map(dataset.moves.map((move) => [move.id, move]));
const itemIndex = new Map(dataset.items.map((item) => [item.id, item]));

export function getPokemonById(id: string | null) {
  return id ? pokemonIndex.get(id) ?? null : null;
}

export function getMoveById(id: string | null) {
  return id ? moveIndex.get(id) ?? null : null;
}

export function getItemById(id: string | null) {
  return id ? itemIndex.get(id) ?? null : null;
}

export function getNinetalesBiasLabel(value: number) {
  if (value < 35) {
    return 'Meta-aligned';
  }

  if (value < 70) {
    return 'Balanced';
  }

  return 'Deep cut';
}

export function getNatureById(id: string) {
  return natures.find((nature) => nature.id === id) ?? natures[0];
}

export function natureMultiplier(natureId: string, stat: StatKey) {
  const nature = getNatureById(natureId);
  if (nature.plus === stat) {
    return 1.1;
  }

  if (nature.minus === stat) {
    return 0.9;
  }

  return 1;
}

export function normalizeEffortValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(maxEffortValue, Math.round(value)));
}

export function legacyEvToEffortPoint(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const clamped = Math.max(0, Math.min(legacyEffortCap, value));
  return normalizeEffortValue(Math.round((clamped / legacyEffortCap) * maxEffortValue));
}

export function effortPointToLegacyEv(value: number) {
  const normalized = normalizeEffortValue(value);
  return Math.min(
    legacyEffortCap,
    Math.round(((normalized / maxEffortValue) * legacyEffortCap) / legacyEffortStep) * legacyEffortStep,
  );
}

export function totalEffortPoints(stats: StatBlock) {
  return statOrder.reduce((total, stat) => total + normalizeEffortValue(stats[stat]), 0);
}

function trimEffortSpread(spread: StatBlock, protectedStat?: StatKey) {
  const next = { ...spread };
  let overflow = Math.max(0, totalEffortPoints(next) - totalEffortBudget);

  if (!overflow) {
    return next;
  }

  const reductionOrder = [...statOrder]
    .filter((stat) => stat !== protectedStat)
    .sort((left, right) => next[right] - next[left]);

  for (const stat of reductionOrder) {
    if (!overflow) {
      break;
    }

    const reducible = Math.min(next[stat], overflow);
    next[stat] -= reducible;
    overflow -= reducible;
  }

  if (overflow && protectedStat) {
    next[protectedStat] = Math.max(0, next[protectedStat] - overflow);
  }

  return next;
}

export function normalizeEffortSpread(partial: Partial<StatBlock>, protectedStat?: StatKey): StatBlock {
  const containsLegacyValues = statOrder.some((stat) => Number(partial[stat] ?? 0) > maxEffortValue);
  const next = statOrder.reduce((result, stat) => {
    const value = Number(partial[stat] ?? 0);
    result[stat] = containsLegacyValues ? legacyEvToEffortPoint(value) : normalizeEffortValue(value);
    return result;
  }, blankStats());

  return trimEffortSpread(next, protectedStat);
}

export function remainingEffortPoints(spread: StatBlock, stat?: StatKey) {
  const normalized = normalizeEffortSpread(spread);
  if (!stat) {
    return Math.max(0, totalEffortBudget - totalEffortPoints(normalized));
  }

  const available = totalEffortBudget - (totalEffortPoints(normalized) - normalized[stat]);
  return Math.max(0, Math.min(maxEffortValue, available));
}

export function applyEffortValue(spread: StatBlock, stat: StatKey, value: number) {
  const normalized = normalizeEffortSpread(spread);
  const nextValue = Math.min(normalizeEffortValue(value), remainingEffortPoints(normalized, stat));
  return normalizeEffortSpread(
    {
      ...normalized,
      [stat]: nextValue,
    },
    stat,
  );
}

export function fillEffortSpreadRemainder(spread: StatBlock, priority: StatKey[] = ['hp', 'speed', 'attack', 'specialAttack', 'defense', 'specialDefense']) {
  const next = normalizeEffortSpread(spread);
  let remaining = totalEffortBudget - totalEffortPoints(next);
  if (remaining <= 0) {
    return next;
  }

  const orderedPriority = [...new Set(priority.filter((stat) => statOrder.includes(stat)).concat(statOrder))];
  while (remaining > 0) {
    const targetStat = orderedPriority.find((stat) => next[stat] < maxEffortValue);
    if (!targetStat) {
      break;
    }
    next[targetStat] += 1;
    remaining -= 1;
  }

  return next;
}

export function normalizeBuildForChampions(build: PokemonBuild) {
  return {
    ...build,
    moveIds: [...new Set(build.moveIds)].slice(0, 4),
    evs: normalizeEffortSpread(build.evs),
    currentHpPercent: Math.max(1, Math.min(100, Math.round(build.currentHpPercent || 100))),
    attackStage: Math.max(-6, Math.min(6, Math.round(build.attackStage || 0))),
    defenseStage: Math.max(-6, Math.min(6, Math.round(build.defenseStage || 0))),
    specialAttackStage: Math.max(-6, Math.min(6, Math.round(build.specialAttackStage || 0))),
    specialDefenseStage: Math.max(-6, Math.min(6, Math.round(build.specialDefenseStage || 0))),
    speedStage: Math.max(-6, Math.min(6, Math.round(build.speedStage || 0))),
    accuracyStage: Math.max(-6, Math.min(6, Math.round(build.accuracyStage || 0))),
    evasionStage: Math.max(-6, Math.min(6, Math.round(build.evasionStage || 0))),
  };
}

export function sanitizeTeamForChampions(team: Team) {
  const nextTeam = {
    ...team,
    slots: team.slots.map((slot) => normalizeBuildForChampions(slot)),
  };
  const usedItems = new Set<string>();

  nextTeam.slots = nextTeam.slots.map((slot) => {
    if (!slot.itemId) {
      return slot;
    }

    if (usedItems.has(slot.itemId)) {
      return {
        ...slot,
        itemId: null,
      };
    }

    usedItems.add(slot.itemId);
    return slot;
  });

  return nextTeam;
}

export function sanitizeAppState(state: AppState) {
  const defaults = createDefaultState();
  const teams = (state.teams?.length ? state.teams : defaults.teams).map((team) => sanitizeTeamForChampions(team));
  const activeTeamId = teams.some((team) => team.id === state.activeTeamId) ? state.activeTeamId : teams[0].id;

  return {
    ...defaults,
    ...state,
    profile: {
      ...defaults.profile,
      ...state.profile,
      matchHistory: (state.profile?.matchHistory ?? defaults.profile.matchHistory).map((record) => ({
        ...record,
        mode: record.mode ?? 'AI Simulator',
        opponentName: record.opponentName ?? null,
        roomCode: record.roomCode ?? null,
        musicTrackId: record.musicTrackId ?? null,
        resultReason: record.resultReason ?? 'normal',
      })),
    },
    teams,
    activeTeamId,
  } satisfies AppState;
}

export function buildStats(baseStats: StatBlock, evs: StatBlock, natureId: string) {
  const hpEffort = effortPointToLegacyEv(evs.hp);
  const hp = Math.floor(((2 * baseStats.hp + fixedIvValue + Math.floor(hpEffort / 4)) * level) / 100) + level + 10;
  const nonHp = (stat: Exclude<StatKey, 'hp'>) =>
    Math.floor(
      (Math.floor(((2 * baseStats[stat] + fixedIvValue + Math.floor(effortPointToLegacyEv(evs[stat]) / 4)) * level) / 100) + 5) *
        natureMultiplier(natureId, stat),
    );

  return {
    hp,
    attack: nonHp('attack'),
    defense: nonHp('defense'),
    specialAttack: nonHp('specialAttack'),
    specialDefense: nonHp('specialDefense'),
    speed: nonHp('speed'),
  };
}

export function stageMultiplier(stage: number) {
  if (stage >= 0) {
    return (2 + stage) / 2;
  }

  return 2 / (2 - stage);
}

export function makeEmptyBuild(seed: string): PokemonBuild {
  return {
    id: seed,
    pokemonId: null,
    nickname: '',
    natureId: 'hardy',
    itemId: null,
    abilityName: null,
    moveIds: [],
    evs: normalizeEffortSpread(blankStats()),
    useMega: false,
    currentHpPercent: 100,
    status: 'healthy',
    attackStage: 0,
    defenseStage: 0,
    specialAttackStage: 0,
    specialDefenseStage: 0,
    speedStage: 0,
    accuracyStage: 0,
    evasionStage: 0,
    notes: '',
  };
}

export function createTeam(name: string, format: BattleFormat = 'Singles'): Team {
  const now = new Date().toISOString();
  return {
    id: makeId('team'),
    name,
    format,
    notes: '',
    slots: Array.from({ length: 6 }, (_, index) => makeEmptyBuild(makeId(`slot-${index + 1}`))),
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultState(): AppState {
  const team = createTeam('Prototype Squad');
  return {
    profile: {
      trainerName: '',
      profileCreatedAt: null,
      favoriteFormat: 'Singles',
      playerNote: '',
      offMetaBias: 50,
      layoutMode: 'Auto',
      resizablePanels: true,
      battleMusicEnabled: true,
      battleMusicVolume: 18,
      battleMusicMode: 'single',
      preferredBattleTrackId: 'gen5-final',
      battleMusicPlaylistIds: ['gen5-final'],
      announcerDefaultEnabled: true,
      lysanderCutscenesEnabled: true,
      onlineAccount: null,
      matchHistory: [],
    },
    teams: [team],
    activeTeamId: team.id,
  };
}

export function resolveAbility(build: PokemonBuild, pokemon: PokemonEntry | null): AbilityEntry | null {
  if (!pokemon) {
    return null;
  }

  if (build.abilityName) {
    return pokemon.abilities.find((ability) => ability.name === build.abilityName) ?? pokemon.abilities[0] ?? null;
  }

  return pokemon.abilities[0] ?? null;
}

export function resolveHeldItem(build: PokemonBuild): ItemEntry | null {
  return getItemById(build.itemId);
}

export function findMegaForm(basePokemon: PokemonEntry | null) {
  if (!basePokemon) {
    return null;
  }

  return dataset.pokemon.find(
    (entry) => entry.baseSpecies === basePokemon.baseSpecies && entry.isMega && entry.megaStone === basePokemon.megaStone,
  ) ?? dataset.pokemon.find((entry) => entry.baseSpecies === basePokemon.baseSpecies && entry.isMega) ?? null;
}

export function findMegaStoneItem(basePokemon: PokemonEntry | null, megaPokemon: PokemonEntry | null = findMegaForm(basePokemon)) {
  if (!basePokemon) {
    return null;
  }

  const candidates = dataset.items.filter((item) => {
    if (item.category !== 'mega-stone') {
      return false;
    }

    return item.effect.includes(` ${basePokemon.baseSpecies} `) || item.effect.includes(`${basePokemon.baseSpecies}.`) || item.effect.includes(`${basePokemon.baseSpecies} holding`);
  });

  if (!candidates.length) {
    return null;
  }

  const suffix = megaPokemon?.displayName.replace(`Mega ${basePokemon.baseSpecies}`, '').trim().toLowerCase() ?? '';
  if (suffix) {
    const exact = candidates.find((item) => item.name.toLowerCase().includes(suffix));
    if (exact) {
      return exact;
    }
  }

  return candidates[0] ?? null;
}

export function selectedPokemon(build: PokemonBuild) {
  return getPokemonById(build.pokemonId);
}

export function resolvePokemonForm(build: PokemonBuild): PokemonEntry | null {
  const selected = selectedPokemon(build);
  if (!selected) {
    return null;
  }

  if (build.useMega) {
    const megaForms = dataset.pokemon.filter((entry) => entry.baseSpecies === selected.baseSpecies && entry.isMega);
    const heldItemName = resolveHeldItem(build)?.name ?? null;
    const megaForm =
      megaForms.find((entry) => {
        if (!heldItemName) {
          return true;
        }

        return findMegaStoneItem(selected, entry)?.name === heldItemName;
      }) ?? megaForms[0];

    if (megaForm) {
      return megaForm;
    }
  }

  return selected;
}

export function displaySpriteForPokemon(pokemon: PokemonEntry | null) {
  if (!pokemon) {
    return '';
  }

  return pokemon.sprite || fallbackSpriteForPokemon(pokemon);
}

export function usesMegaSpriteFallback(pokemon: PokemonEntry | null) {
  return Boolean(pokemon?.isMega && displaySpriteForPokemon(pokemon));
}

export function effectiveTypes(pokemon: PokemonEntry | null, build: PokemonBuild, weather: Weather) {
  if (!pokemon) {
    return [];
  }

  const ability = resolveAbility(build, pokemon)?.name ?? '';
  if (pokemon.baseSpecies === 'Castform' && ability === 'Forecast') {
    if (weather === 'sun') {
      return ['Fire'];
    }
    if (weather === 'rain') {
      return ['Water'];
    }
    if (weather === 'snow') {
      return ['Ice'];
    }
  }

  return pokemon.types;
}

export function typeEffectiveness(moveType: string, defenderTypes: string[]) {
  return defenderTypes.reduce((multiplier, defenderType) => multiplier * (typeChart[moveType]?.[defenderType] ?? 1), 1);
}

export function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

export function normalizeMoveSelection(build: PokemonBuild, pokemon: PokemonEntry | null) {
  if (!pokemon) {
    return [];
  }

  const availableIds = new Set(pokemon.movePool.map((move) => move.id));
  const nextIds = build.moveIds.filter((id) => availableIds.has(id));

  if (nextIds.length >= 4) {
    return nextIds.slice(0, 4);
  }

  for (const move of pokemon.movePool) {
    if (!nextIds.includes(move.id)) {
      nextIds.push(move.id);
    }
    if (nextIds.length === 4) {
      break;
    }
  }

  return nextIds;
}

export function buildLabel(build: PokemonBuild, pokemon: PokemonEntry | null) {
  if (!pokemon) {
    return 'Empty slot';
  }

  return build.nickname.trim() ? `${build.nickname.trim()} (${pokemon.displayName})` : pokemon.displayName;
}

export function grounded(pokemon: PokemonEntry | null, build: PokemonBuild) {
  if (!pokemon) {
    return true;
  }

  const ability = resolveAbility(build, pokemon)?.name;
  const types = effectiveTypes(pokemon, build, 'clear');
  return !types.includes('Flying') && ability !== 'Levitate';
}

export function sumStats(stats: StatBlock) {
  return statOrder.reduce((total, key) => total + stats[key], 0);
}

export function findPokemonByName(name: string) {
  return dataset.pokemon.find((entry) => entry.displayName === name) ?? null;
}

export function typeBoostItemMap(itemName: string) {
  const map: Record<string, string> = {
    'Black Belt': 'Fighting',
    'Black Glasses': 'Dark',
    Charcoal: 'Fire',
    'Dragon Fang': 'Dragon',
    'Fairy Feather': 'Fairy',
    'Hard Stone': 'Rock',
    Magnet: 'Electric',
    'Metal Coat': 'Steel',
    'Miracle Seed': 'Grass',
    'Mystic Water': 'Water',
    'Never-Melt Ice': 'Ice',
    'Poison Barb': 'Poison',
    'Sharp Beak': 'Flying',
    'Silk Scarf': 'Normal',
    'Silver Powder': 'Bug',
    'Soft Sand': 'Ground',
    'Spell Tag': 'Ghost',
    'Twisted Spoon': 'Psychic',
  };

  return map[itemName] ?? null;
}

export function resistBerryType(itemName: string) {
  const map: Record<string, string> = {
    'Babiri Berry': 'Steel',
    'Charti Berry': 'Rock',
    'Chilan Berry': 'Normal',
    'Chople Berry': 'Fighting',
    'Coba Berry': 'Flying',
    'Colbur Berry': 'Dark',
    'Haban Berry': 'Dragon',
    'Kasib Berry': 'Ghost',
    'Kebia Berry': 'Poison',
    'Occa Berry': 'Fire',
    'Passho Berry': 'Water',
    'Payapa Berry': 'Psychic',
    'Rindo Berry': 'Grass',
    'Roseli Berry': 'Fairy',
    'Shuca Berry': 'Ground',
    'Tanga Berry': 'Bug',
    'Wacan Berry': 'Electric',
    'Yache Berry': 'Ice',
  };

  return map[itemName] ?? null;
}

export function bestAttackingStat(stats: StatBlock) {
  return stats.attack >= stats.specialAttack ? 'attack' : 'specialAttack';
}
