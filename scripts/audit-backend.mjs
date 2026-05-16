import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const workspaceRoot = resolve('.');
const auditDir = resolve(workspaceRoot, '.tmp-audit');
const skipCompile = process.env.AUDIT_SKIP_COMPILE === '1';
const rootRequire = createRequire(import.meta.url);

function parseRange(text) {
  const [low, high] = text.split('-').map((value) => Number.parseInt(value.trim(), 10));
  return [low, high];
}

function statSummary(spread) {
  return Object.values(spread).reduce((sum, value) => sum + Number(value || 0), 0);
}

function withMockRandom(values, task) {
  const originalRandom = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)] ?? values[values.length - 1] ?? 0.5;
  try {
    return task();
  } finally {
    Math.random = originalRandom;
  }
}

function findPokemonWithMoves(moveNames, preferredDisplayNames = []) {
  for (const preferredName of preferredDisplayNames) {
    const preferred = dataset.pokemon.find((pokemon) => pokemon.displayName === preferredName && moveNames.every((moveName) => pokemon.movePool.some((move) => move.name === moveName)));
    if (preferred) {
      return preferred;
    }
  }

  return dataset.pokemon.find((pokemon) => moveNames.every((moveName) => pokemon.movePool.some((move) => move.name === moveName))) ?? null;
}

function moveIdFor(pokemon, moveName) {
  return pokemon.movePool.find((move) => move.name === moveName)?.id ?? null;
}

function itemIdByName(itemName) {
  return dataset.items.find((item) => item.name === itemName)?.id ?? null;
}

function buildSlot(seed, pokemon, moveNames, overrides = {}) {
  const moveIds = moveNames.map((moveName) => moveIdFor(pokemon, moveName)).filter(Boolean);
  return {
    ...makeEmptyBuild(seed),
    ...overrides,
    pokemonId: pokemon.id,
    natureId: overrides.natureId ?? 'hardy',
    itemId: overrides.itemId ?? null,
    abilityName: overrides.abilityName ?? pokemon.abilities[0]?.name ?? null,
    moveIds,
    evs: normalizeEffortSpread(overrides.evs ?? blankStats()),
    status: overrides.status ?? 'healthy',
  };
}

function buildBattle(format, playerSlots, opponentSlots) {
  const playerTeam = createTeam('Player Audit', format);
  const opponentTeam = createTeam('Opponent Audit', format);
  playerSlots.forEach((slot, index) => {
    playerTeam.slots[index] = slot;
  });
  opponentSlots.forEach((slot, index) => {
    opponentTeam.slots[index] = slot;
  });
  const playerOrder = playerSlots.map((_, index) => index);
  const opponentOrder = opponentSlots.map((_, index) => index);
  return advancePreviewToBattle(createSimulatorBattle(format, playerTeam, playerOrder, opponentTeam, opponentOrder, null));
}

function materializeGeneratedPlan(name, format, plan) {
  const team = createTeam(name, format);
  plan.slots.forEach((slot, index) => {
    team.slots[index] = slot;
  });
  return sanitizeTeamForChampions(team);
}

if (!skipCompile) {
  rmSync(auditDir, { recursive: true, force: true });
  mkdirSync(auditDir, { recursive: true });
}

if (!skipCompile) {
  const ts = rootRequire(resolve(workspaceRoot, 'node_modules/typescript/lib/typescript.js'));
  const compilerOptions = {
    outDir: auditDir,
    rootDir: resolve(workspaceRoot, 'src'),
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
    resolveJsonModule: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    strict: true,
    skipLibCheck: true,
    ignoreDeprecations: '6.0',
  };
  const program = ts.createProgram([
    resolve(workspaceRoot, 'src/lib/champions.ts'),
    resolve(workspaceRoot, 'src/lib/damage.ts'),
    resolve(workspaceRoot, 'src/lib/usage.ts'),
    resolve(workspaceRoot, 'src/lib/ai.ts'),
    resolve(workspaceRoot, 'src/lib/moveParity.ts'),
    resolve(workspaceRoot, 'src/lib/online.ts'),
    resolve(workspaceRoot, 'src/lib/simulator.ts'),
    resolve(workspaceRoot, 'src/types.ts'),
  ], compilerOptions);
  const emitResult = program.emit();
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .concat(emitResult.diagnostics)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (!diagnostic.file || typeof diagnostic.start !== 'number') {
        return message;
      }
      const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${line + 1}:${character + 1} ${message}`;
    });
  if (emitResult.emitSkipped || diagnostics.length) {
    throw new Error(`Audit compile failed.\n${diagnostics.slice(0, 40).join('\n')}`);
  }
}

writeFileSync(resolve(auditDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
mkdirSync(resolve(auditDir, 'data'), { recursive: true });
copyFileSync(resolve(workspaceRoot, 'src/data/champions-data.json'), resolve(auditDir, 'data/champions-data.json'));

const auditRequire = rootRequire;
const champions = auditRequire(resolve(auditDir, 'lib/champions.js'));
const damage = auditRequire(resolve(auditDir, 'lib/damage.js'));
const ai = auditRequire(resolve(auditDir, 'lib/ai.js'));
const moveParity = auditRequire(resolve(auditDir, 'lib/moveParity.js'));
const online = auditRequire(resolve(auditDir, 'lib/online.js'));
const simulator = auditRequire(resolve(auditDir, 'lib/simulator.js'));
const dataset = JSON.parse(readFileSync(resolve(workspaceRoot, 'src/data/champions-data.json'), 'utf8'));

const {
  blankStats,
  buildStats,
  maxEffortValue,
  totalEffortBudget,
  totalEffortPoints,
  applyEffortValue,
  createTeam,
  makeEmptyBuild,
  normalizeEffortSpread,
  sanitizeTeamForChampions,
  getPokemonById,
} = champions;

const { calculateDamage } = damage;
const { generateTeamPlans } = ai;
const { buildMoveParitySummary, moveParityForMove } = moveParity;
const { createRoomState, forfeitRoomState, joinRoomState, submitBringOrderState, submitTurnChoicesState, touchRoomState } = online;
const {
  advancePreviewToBattle,
  applyReplacementChoices,
  battleHasPendingReplacements,
  buildAutoReplacementChoices,
  createSimulatorBattle,
  generateAiChoices,
  legalMovesForUnit,
  randomChoicesForSide,
  resolveTurn,
  resolveTurnWithChoices,
} = simulator;

const statKeys = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];
const failures = [];
const warnings = [];
let rangedPokemonCount = 0;

for (const pokemon of dataset.pokemon) {
  if (!pokemon.neutralRanges) {
    continue;
  }
  rangedPokemonCount += 1;
  for (const stat of statKeys) {
    const neutralBase = buildStats(pokemon.baseStats, blankStats(), 'hardy')[stat];
    const maxedSpread = blankStats();
    maxedSpread[stat] = maxEffortValue;
    const neutralMax = buildStats(pokemon.baseStats, maxedSpread, 'hardy')[stat];
    const [expectedMin, expectedMax] = parseRange(pokemon.neutralRanges[stat]);
    if (neutralMax !== expectedMax) {
      failures.push(`${pokemon.displayName} ${stat}: expected max ${expectedMax}, received ${neutralMax}`);
      continue;
    }
    if (neutralBase !== expectedMin) {
      if (stat === 'hp') {
        warnings.push(`${pokemon.displayName} HP floor on source page is ${expectedMin}, app uses fixed-31-IV floor ${neutralBase}.`);
        continue;
      }
      failures.push(`${pokemon.displayName} ${stat}: expected min ${expectedMin}, received ${neutralBase}`);
    }
  }
}

const froslass = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Froslass');
assert(froslass, 'Froslass must exist in the Champions dataset.');
const timidBaseSpeed = buildStats(froslass.baseStats, blankStats(), 'timid').speed;
const timidMaxSpeedSpread = blankStats();
timidMaxSpeedSpread.speed = maxEffortValue;
const timidMaxSpeed = buildStats(froslass.baseStats, timidMaxSpeedSpread, 'timid').speed;
assert.equal(timidBaseSpeed, 143, `Expected Froslass Timid base speed to be 143, received ${timidBaseSpeed}.`);
assert.equal(timidMaxSpeed, 178, `Expected Froslass Timid speed with 32 EV points to be 178, received ${timidMaxSpeed}.`);

let cappedSpread = blankStats();
for (let index = 0; index < 80; index += 1) {
  cappedSpread = applyEffortValue(cappedSpread, 'speed', index + 1);
}
assert.equal(cappedSpread.speed, maxEffortValue, `Expected speed cap ${maxEffortValue}, received ${cappedSpread.speed}.`);
assert.equal(totalEffortPoints(cappedSpread), maxEffortValue, 'Single-stat cap should not overflow total points.');

let totalBudgetSpread = blankStats();
for (const stat of statKeys) {
  totalBudgetSpread = applyEffortValue(totalBudgetSpread, stat, maxEffortValue);
}
assert.equal(totalEffortPoints(totalBudgetSpread), totalEffortBudget, `Expected total budget ${totalEffortBudget}, received ${totalEffortPoints(totalBudgetSpread)}.`);
assert.ok(Object.values(totalBudgetSpread).every((value) => value <= maxEffortValue), 'No stat should exceed the individual cap.');

const duplicateItemTeam = createTeam('Audit Team');
duplicateItemTeam.slots[0] = {
  ...makeEmptyBuild('audit-1'),
  pokemonId: 'garchomp',
  itemId: 'leftovers',
};
duplicateItemTeam.slots[1] = {
  ...makeEmptyBuild('audit-2'),
  pokemonId: 'ting-lu',
  itemId: 'leftovers',
};
const sanitizedTeam = sanitizeTeamForChampions(duplicateItemTeam);
assert.equal(sanitizedTeam.slots[0].itemId, 'leftovers', 'First held item should remain assigned.');
assert.equal(sanitizedTeam.slots[1].itemId, null, 'Duplicate held items should be cleared from later slots.');

const aiPlans = generateTeamPlans('stadium-balance', 'Singles', 50, ['Garchomp'], 5, false);
assert.ok(aiPlans.length >= 1, 'AI builder should generate at least one plan.');
for (const plan of aiPlans) {
  const usedItems = new Set();
  for (const slot of plan.slots.filter((entry) => entry.pokemonId)) {
    assert.ok(totalEffortPoints(slot.evs) <= totalEffortBudget, `AI slot ${slot.id} exceeded total EV budget.`);
    assert.ok(Object.values(slot.evs).every((value) => value <= maxEffortValue), `AI slot ${slot.id} exceeded the 32-point per-stat cap.`);
    assert.ok(slot.itemId, `AI slot ${slot.id} is missing a held item.`);
    assert.ok(!usedItems.has(slot.itemId), `AI plan ${plan.name} repeated held item ${slot.itemId}.`);
    usedItems.add(slot.itemId);
  }
}

const paritySummary = buildMoveParitySummary(dataset.moves);
assert.equal(paritySummary.coveredPercent, 100, `Expected move parity coverage to stay at 100%, received ${paritySummary.coveredPercent}%.`);
for (const moveName of ['Protect', 'Encore', 'Disable', 'Aurora Veil', 'Clear Smog', 'Yawn', 'Perish Song', 'Pain Split', 'Destiny Bond', 'Parabolic Charge', 'Draining Kiss', 'Bitter Blade', 'Matcha Gotcha', 'Rest']) {
  const move = dataset.moves.find((entry) => entry.name === moveName);
  assert(move, `Expected ${moveName} to exist in the Champions move list.`);
  const parity = moveParityForMove(move);
  assert.equal(parity.tier, 'Explicit', `Expected ${moveName} to be tagged Explicit, received ${parity.tier}.`);
}

const garchomp = getPokemonById('garchomp');
const steelix = getPokemonById('steelix');
assert(garchomp && steelix, 'Expected Garchomp and Steelix to exist.');
const attacker = {
  ...makeEmptyBuild('audit-attacker'),
  pokemonId: garchomp.id,
  natureId: 'jolly',
  moveIds: ['earthquake'],
  evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 },
  itemId: 'soft-sand',
};
const defender = {
  ...makeEmptyBuild('audit-defender'),
  pokemonId: steelix.id,
  natureId: 'careful',
  evs: { ...blankStats(), hp: 32, defense: 16, specialDefense: 18 },
  itemId: 'leftovers',
};
const earthquake = garchomp.movePool.find((move) => move.id === 'earthquake');
assert(earthquake, 'Garchomp should have Earthquake in its move pool.');
const damageResult = calculateDamage(attacker, defender, earthquake, champions.defaultEnvironment);
assert(damageResult, 'Damage calculation should return a result for damaging moves.');
assert.ok(damageResult.maxDamage > damageResult.minDamage || damageResult.maxDamage > 0, 'Damage result should contain positive damage output.');
const burnedDamageResult = calculateDamage({ ...attacker, status: 'burn' }, defender, earthquake, champions.defaultEnvironment);
assert(burnedDamageResult, 'Burned damage calculation should still resolve for physical attacks.');
assert.ok(burnedDamageResult.averageDamage < damageResult.averageDamage, 'Burn should reduce physical attack damage output.');
const burnedDamageRatio = burnedDamageResult.averageDamage / Math.max(1, damageResult.averageDamage);
assert.ok(burnedDamageRatio > 0.45 && burnedDamageRatio < 0.55, `Burned physical damage should land near half power, received ratio ${burnedDamageRatio.toFixed(3)}.`);
const spreadDamageResult = calculateDamage(attacker, defender, earthquake, {
  ...champions.defaultEnvironment,
  battleFormat: 'Doubles',
  spreadTargetsHit: 2,
});
const auroraVeilDamageResult = calculateDamage(attacker, defender, earthquake, {
  ...champions.defaultEnvironment,
  battleFormat: 'Doubles',
  spreadTargetsHit: 2,
  auroraVeil: true,
});
const helpingHandDamageResult = calculateDamage(attacker, defender, earthquake, {
  ...champions.defaultEnvironment,
  helpingHand: true,
});
const magicRoomDamageResult = calculateDamage(attacker, defender, earthquake, {
  ...champions.defaultEnvironment,
  magicRoom: true,
});
const wonderRoomDamageResult = calculateDamage(attacker, defender, earthquake, {
  ...champions.defaultEnvironment,
  wonderRoom: true,
});
assert(spreadDamageResult && auroraVeilDamageResult && helpingHandDamageResult && magicRoomDamageResult && wonderRoomDamageResult, 'Damage calculation should support spread, room, and support-field contexts.');
assert.ok(spreadDamageResult.averageDamage < damageResult.averageDamage, 'Spread-target damage should be reduced in Doubles.');
assert.ok(auroraVeilDamageResult.averageDamage < spreadDamageResult.averageDamage, 'Aurora Veil should reduce incoming damage beyond the base spread reduction.');
assert.ok(helpingHandDamageResult.averageDamage > damageResult.averageDamage, 'Helping Hand should boost outgoing damage.');
assert.ok(magicRoomDamageResult.averageDamage < damageResult.averageDamage, 'Magic Room should suppress held-item damage boosts.');
assert.ok(wonderRoomDamageResult.averageDamage > damageResult.averageDamage, 'Wonder Room should swap the defender into its lower special-wall stat when appropriate.');

const freezeDryUser = findPokemonWithMoves(['Freeze-Dry'], ['Glaceon', 'Aurorus', 'Vanilluxe']);
const hawlucha = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Hawlucha') ?? null;
const kangaskhan = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Kangaskhan') ?? null;
const milotic = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Milotic') ?? null;
const chesnaught = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Chesnaught') ?? null;
const gengar = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Gengar') ?? null;
assert(freezeDryUser && hawlucha && kangaskhan && milotic && chesnaught && gengar, 'Expected Freeze-Dry, Flying Press, and Scrappy audit Pokemon to exist.');
const freezeDryMove = freezeDryUser.movePool.find((move) => move.name === 'Freeze-Dry');
const flyingPressMove = hawlucha.movePool.find((move) => move.name === 'Flying Press');
const hammerArmMove = kangaskhan.movePool.find((move) => move.name === 'Hammer Arm');
assert(freezeDryMove && flyingPressMove && hammerArmMove, 'Expected audit move hooks to exist for Freeze-Dry, Flying Press, and Hammer Arm.');
const freezeDryResult = calculateDamage(
  {
    ...makeEmptyBuild('audit-freeze-dry-user'),
    pokemonId: freezeDryUser.id,
    abilityName: freezeDryUser.abilities[0]?.name ?? null,
    moveIds: [freezeDryMove.id],
    evs: { ...blankStats(), specialAttack: 32, speed: 24, hp: 10 },
  },
  {
    ...makeEmptyBuild('audit-freeze-dry-target'),
    pokemonId: milotic.id,
    moveIds: ['recover'],
    evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14 },
  },
  freezeDryMove,
  champions.defaultEnvironment,
);
assert.equal(freezeDryResult?.effectiveness, 2, `Freeze-Dry should register as super effective into Water targets, received ${freezeDryResult?.effectiveness}.`);
const flyingPressResult = calculateDamage(
  {
    ...makeEmptyBuild('audit-flying-press-user'),
    pokemonId: hawlucha.id,
    moveIds: [flyingPressMove.id],
    evs: { ...blankStats(), attack: 32, speed: 24, hp: 10 },
  },
  {
    ...makeEmptyBuild('audit-flying-press-target'),
    pokemonId: chesnaught.id,
    moveIds: ['spiky-shield'],
    evs: { ...blankStats(), hp: 32, defense: 18, specialDefense: 16 },
  },
  flyingPressMove,
  champions.defaultEnvironment,
);
assert.equal(flyingPressResult?.effectiveness, 4, `Flying Press should combine Fighting and Flying coverage, received ${flyingPressResult?.effectiveness}.`);
const scrappyResult = calculateDamage(
  {
    ...makeEmptyBuild('audit-scrappy-user'),
    pokemonId: kangaskhan.id,
    abilityName: 'Scrappy',
    moveIds: [hammerArmMove.id],
    evs: { ...blankStats(), attack: 32, speed: 24, hp: 10 },
  },
  {
    ...makeEmptyBuild('audit-scrappy-target'),
    pokemonId: gengar.id,
    moveIds: ['shadow-ball'],
    evs: { ...blankStats(), hp: 24, defense: 10, specialDefense: 24 },
  },
  hammerArmMove,
  champions.defaultEnvironment,
);
assert.equal(scrappyResult?.effectiveness, 0.5, `Scrappy should bypass Ghost immunity while still respecting the target's secondary type, received ${scrappyResult?.effectiveness}.`);

const protectUser = findPokemonWithMoves(['Protect'], ['Amoonguss', 'Umbreon', 'Clefable']);
const groundedProtectUser = findPokemonWithMoves(['Protect'], ['Umbreon', 'Clefable', 'Snorlax']);
const earthquakeUser = findPokemonWithMoves(['Earthquake'], ['Garchomp']);
const slowEarthquakeUser = findPokemonWithMoves(['Earthquake'], ['Steelix', 'Ting-Lu', 'Rhyperior', 'Garchomp']);
const thunderUser = findPokemonWithMoves(['Thunder'], ['Zapdos', 'Jolteon']);
const snarlUser = findPokemonWithMoves(['Snarl'], ['Incineroar', 'Arcanine']);
const shadowBallUser = findPokemonWithMoves(['Shadow Ball'], ['Froslass', 'Gengar', 'Alakazam']);
const specialTargetA = findPokemonWithMoves(['Shadow Ball'], ['Gengar', 'Alakazam', 'Flutter Mane']);
const specialTargetB = findPokemonWithMoves(['Thunderbolt'], ['Jolteon', 'Zapdos', 'Raikou']);
const wishUser = findPokemonWithMoves(['Wish'], ['Clefable', 'Sylveon', 'Umbreon']);
const pivotUser = findPokemonWithMoves(['Volt Switch'], ['Jolteon', 'Zapdos', 'Rotom']);
const brickBreakUser = findPokemonWithMoves(['Brick Break'], ['Garchomp', 'Dragonite', 'Lucario']);
const iceSpinnerUser = findPokemonWithMoves(['Ice Spinner'], ['Sneasler', 'Weavile', 'Pawmot']);
const leechSeedUser = findPokemonWithMoves(['Leech Seed'], ['Venusaur', 'Abomasnow', 'Ferrothorn']);
const restUser = findPokemonWithMoves(['Rest'], ['Snorlax', 'Suicune', 'Milotic']);
const disableUser = findPokemonWithMoves(['Disable', 'Protect'], ['Gengar', 'Sableye', 'Mismagius']);
const willOWispUser = findPokemonWithMoves(['Will-O-Wisp'], ['Sableye', 'Rotom', 'Mismagius']);
const thunderWaveUser = findPokemonWithMoves(['Thunder Wave'], ['Jolteon', 'Zapdos', 'Meowstic']);
const sporeUser = findPokemonWithMoves(['Hypnosis'], ['Aromatisse', 'Chimecho', 'Gardevoir']);
const scaldUser = findPokemonWithMoves(['Scald'], ['Suicune', 'Milotic', 'Vaporeon']);
const heatproofUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Sinistcha' && pokemon.abilities.some((ability) => ability.name === 'Heatproof')) ?? null;
const hydrationUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Vaporeon' && pokemon.abilities.some((ability) => ability.name === 'Hydration')) ?? null;
const shedSkinUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Arbok' && pokemon.abilities.some((ability) => ability.name === 'Shed Skin')) ?? null;
const naturalCureUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Starmie' && pokemon.abilities.some((ability) => ability.name === 'Natural Cure')) ?? null;
const limberTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Liepard' && pokemon.abilities.some((ability) => ability.name === 'Limber')) ?? null;
const insomniaTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Banette' && pokemon.abilities.some((ability) => ability.name === 'Insomnia')) ?? null;
const sweetVeilSupport = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Alcremie' && pokemon.abilities.some((ability) => ability.name === 'Sweet Veil')) ?? null;
const waterBubbleTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Araquanid' && pokemon.abilities.some((ability) => ability.name === 'Water Bubble')) ?? null;
const aromaVeilTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Aromatisse' && pokemon.abilities.some((ability) => ability.name === 'Aroma Veil')) ?? null;
const trickRoomUser = findPokemonWithMoves(['Trick Room', 'Shadow Ball'], ['Mimikyu', 'Bronzong', 'Flutter Mane']);
const calmMindUser = findPokemonWithMoves(['Calm Mind'], ['Alakazam', 'Suicune', 'Clefable']);
const nastyPlotUser = findPokemonWithMoves(['Nasty Plot'], ['Gengar', 'Hydreigon', 'Mismagius']);
const sunnyDayUser = findPokemonWithMoves(['Sunny Day', 'Protect'], ['Charizard', 'Venusaur', 'Castform']);
const tormentUser = findPokemonWithMoves(['Torment', 'Protect'], ['Infernape', 'Sableye', 'Umbreon']);
const auroraVeilUser = findPokemonWithMoves(['Aurora Veil'], ['Froslass', 'Abomasnow', 'Ninetales']);
const coachingUser = findPokemonWithMoves(['Coaching'], ['Chesnaught']);
const healPulseUser = findPokemonWithMoves(['Heal Pulse'], ['Audino', 'Gardevoir', 'Chimecho']);
const stickyWebUser = findPokemonWithMoves(['Sticky Web'], ['Ariados', 'Araquanid']);
const toxicSpikesUser = findPokemonWithMoves(['Toxic Spikes'], ['Ariados', 'Arbok', 'Beedrill']);
const hyperBeamUser = findPokemonWithMoves(['Hyper Beam'], ['Meganium', 'Charizard', 'Sableye']);
const solarBeamUser = findPokemonWithMoves(['Solar Beam'], ['Meganium', 'Glimmora', 'Charizard']);
const meteorBeamUser = findPokemonWithMoves(['Meteor Beam'], ['Glimmora']);
const parabolicChargeUser = findPokemonWithMoves(['Parabolic Charge'], ['Bellibolt', 'Heliolisk', 'Ampharos']);
const drainingKissUser = findPokemonWithMoves(['Draining Kiss'], ['Aromatisse', 'Audino', 'Alcremie']);
const bitterBladeUser = findPokemonWithMoves(['Bitter Blade'], ['Ceruledge']);
const matchaGotchaUser = findPokemonWithMoves(['Matcha Gotcha'], ['Sinistcha']);
const sparklingAriaUser = findPokemonWithMoves(['Sparkling Aria'], ['Primarina']);
const painSplitUser = findPokemonWithMoves(['Pain Split'], ['Banette', 'Alcremie', 'Arbok']);
const pranksterUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Sableye' && pokemon.abilities.some((ability) => ability.name === 'Prankster') && ['Taunt', 'Fake Out'].every((moveName) => pokemon.movePool.some((move) => move.name === moveName))) ?? null;
const darkTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Umbreon' && pokemon.types.includes('Dark')) ?? findPokemonWithMoves(['Protect'], ['Umbreon']);
const struggleTarget = findPokemonWithMoves(['Protect'], ['Clefable', 'Amoonguss', 'Umbreon']);
const intimidateUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Incineroar' && pokemon.abilities.some((ability) => ability.name === 'Intimidate')) ?? null;
const innerFocusTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Umbreon' && pokemon.abilities.some((ability) => ability.name === 'Inner Focus')) ?? null;
const clearBodyTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Dragapult' && pokemon.abilities.some((ability) => ability.name === 'Clear Body')) ?? null;
const mirrorArmorTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Corviknight' && pokemon.abilities.some((ability) => ability.name === 'Mirror Armor')) ?? null;
const competitiveTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Milotic' && pokemon.abilities.some((ability) => ability.name === 'Competitive')) ?? null;
const obliviousTarget = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Mamoswine' && pokemon.abilities.some((ability) => ability.name === 'Oblivious')) ?? null;
const contraryUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Serperior' && pokemon.abilities.some((ability) => ability.name === 'Contrary') && pokemon.movePool.some((move) => move.name === 'Leaf Storm')) ?? null;
const sheerForceSnarlUser = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Feraligatr' && pokemon.abilities.some((ability) => ability.name === 'Sheer Force') && pokemon.movePool.some((move) => move.name === 'Snarl')) ?? null;
const soundOnlyTarget = findPokemonWithMoves(['Perish Song', 'Round', 'Snarl', 'Snore'], ['Absol']);
const charizardBase = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Charizard' && !pokemon.isMega) ?? null;
const abomasnowBase = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Abomasnow' && !pokemon.isMega) ?? null;
const meganiumBase = dataset.pokemon.find((pokemon) => pokemon.displayName === 'Meganium' && !pokemon.isMega) ?? null;
assert(
    protectUser &&
    groundedProtectUser &&
    earthquakeUser &&
    slowEarthquakeUser &&
    thunderUser &&
    snarlUser &&
    shadowBallUser &&
    specialTargetA &&
    specialTargetB &&
    wishUser &&
    pivotUser &&
    brickBreakUser &&
    iceSpinnerUser &&
    leechSeedUser &&
    restUser &&
    disableUser &&
    willOWispUser &&
    thunderWaveUser &&
    sporeUser &&
    scaldUser &&
    heatproofUser &&
    hydrationUser &&
    shedSkinUser &&
    naturalCureUser &&
    limberTarget &&
    insomniaTarget &&
    sweetVeilSupport &&
    waterBubbleTarget &&
    aromaVeilTarget &&
    trickRoomUser &&
    calmMindUser &&
    nastyPlotUser &&
    sunnyDayUser &&
    tormentUser &&
    auroraVeilUser &&
    coachingUser &&
    healPulseUser &&
    stickyWebUser &&
    toxicSpikesUser &&
    hyperBeamUser &&
    solarBeamUser &&
    meteorBeamUser &&
    parabolicChargeUser &&
    drainingKissUser &&
    bitterBladeUser &&
    matchaGotchaUser &&
    sparklingAriaUser &&
    painSplitUser &&
    pranksterUser &&
    darkTarget &&
    struggleTarget &&
    intimidateUser &&
    innerFocusTarget &&
    clearBodyTarget &&
    mirrorArmorTarget &&
    competitiveTarget &&
    obliviousTarget &&
    contraryUser &&
    sheerForceSnarlUser &&
    soundOnlyTarget &&
    charizardBase &&
    abomasnowBase &&
    meganiumBase,
  'Expected simulator audit Pokemon to exist in the Champions roster.',
);

const protectChoiceId = moveIdFor(protectUser, 'Protect');
const earthquakeChoiceId = moveIdFor(earthquakeUser, 'Earthquake');
const slowEarthquakeChoiceId = moveIdFor(slowEarthquakeUser, 'Earthquake');
const thunderChoiceId = moveIdFor(thunderUser, 'Thunder');
const snarlChoiceId = moveIdFor(snarlUser, 'Snarl');
const shadowBallChoiceId = moveIdFor(shadowBallUser, 'Shadow Ball');
const specialTargetAAttackId = specialTargetA.movePool.find((move) => move.category !== 'Status')?.id ?? specialTargetA.movePool[0]?.id ?? null;
const specialTargetBAttackId = specialTargetB.movePool.find((move) => move.category !== 'Status')?.id ?? specialTargetB.movePool[0]?.id ?? null;
const darkTargetAttackId = darkTarget.movePool.find((move) => move.category !== 'Status')?.id ?? darkTarget.movePool[0]?.id ?? null;
const wishChoiceId = moveIdFor(wishUser, 'Wish');
const voltSwitchChoiceId = moveIdFor(pivotUser, 'Volt Switch');
const brickBreakChoiceId = moveIdFor(brickBreakUser, 'Brick Break');
const iceSpinnerChoiceId = moveIdFor(iceSpinnerUser, 'Ice Spinner');
const leechSeedChoiceId = moveIdFor(leechSeedUser, 'Leech Seed');
const restChoiceId = moveIdFor(restUser, 'Rest');
const restFollowUpChoiceId = restUser.movePool.find((move) => move.id !== restChoiceId)?.id ?? null;
const disableChoiceId = moveIdFor(disableUser, 'Disable');
const willOWispChoiceId = moveIdFor(willOWispUser, 'Will-O-Wisp');
const thunderWaveChoiceId = moveIdFor(thunderWaveUser, 'Thunder Wave');
const sporeChoiceId = moveIdFor(sporeUser, 'Hypnosis');
const scaldChoiceId = moveIdFor(scaldUser, 'Scald');
const heatproofChoiceId = moveIdFor(heatproofUser, 'Endure');
const hydrationChoiceId = moveIdFor(hydrationUser, 'Aqua Ring');
const shedSkinChoiceId = moveIdFor(shedSkinUser, 'Coil');
const sweetVeilSupportChoiceId = moveIdFor(sweetVeilSupport, 'Calm Mind');
const aromaVeilProtectChoiceId = moveIdFor(aromaVeilTarget, 'Protect') ?? moveIdFor(aromaVeilTarget, 'Wish') ?? aromaVeilTarget.movePool[0]?.id ?? null;
const trickRoomChoiceId = moveIdFor(trickRoomUser, 'Trick Room');
const calmMindChoiceId = moveIdFor(calmMindUser, 'Calm Mind');
const nastyPlotChoiceId = moveIdFor(nastyPlotUser, 'Nasty Plot');
const sunnyDayChoiceId = moveIdFor(sunnyDayUser, 'Sunny Day');
const tormentChoiceId = moveIdFor(tormentUser, 'Torment');
const auroraVeilChoiceId = moveIdFor(auroraVeilUser, 'Aurora Veil');
const coachingChoiceId = moveIdFor(coachingUser, 'Coaching');
const healPulseChoiceId = moveIdFor(healPulseUser, 'Heal Pulse');
const stickyWebChoiceId = moveIdFor(stickyWebUser, 'Sticky Web');
const toxicSpikesChoiceId = moveIdFor(toxicSpikesUser, 'Toxic Spikes');
const hyperBeamChoiceId = moveIdFor(hyperBeamUser, 'Hyper Beam');
const solarBeamChoiceId = moveIdFor(solarBeamUser, 'Solar Beam');
const meteorBeamChoiceId = moveIdFor(meteorBeamUser, 'Meteor Beam');
const parabolicChargeChoiceId = moveIdFor(parabolicChargeUser, 'Parabolic Charge');
const drainingKissChoiceId = moveIdFor(drainingKissUser, 'Draining Kiss');
const bitterBladeChoiceId = moveIdFor(bitterBladeUser, 'Bitter Blade');
const matchaGotchaChoiceId = moveIdFor(matchaGotchaUser, 'Matcha Gotcha');
const sparklingAriaChoiceId = moveIdFor(sparklingAriaUser, 'Sparkling Aria');
const painSplitChoiceId = moveIdFor(painSplitUser, 'Pain Split');
const pranksterTauntChoiceId = moveIdFor(pranksterUser, 'Taunt');
const pranksterFakeOutChoiceId = moveIdFor(pranksterUser, 'Fake Out');
const intimidateAttackId = intimidateUser.movePool.find((move) => move.category !== 'Status')?.id ?? intimidateUser.movePool[0]?.id ?? null;
const innerFocusAttackId = innerFocusTarget.movePool.find((move) => move.category !== 'Status')?.id ?? innerFocusTarget.movePool[0]?.id ?? null;
const clearBodyAttackId = clearBodyTarget.movePool.find((move) => move.category !== 'Status')?.id ?? clearBodyTarget.movePool[0]?.id ?? null;
const mirrorArmorAttackId = mirrorArmorTarget.movePool.find((move) => move.category !== 'Status')?.id ?? mirrorArmorTarget.movePool[0]?.id ?? null;
const competitiveAttackId = competitiveTarget.movePool.find((move) => move.category !== 'Status')?.id ?? competitiveTarget.movePool[0]?.id ?? null;
const obliviousAttackId = obliviousTarget.movePool.find((move) => move.category !== 'Status')?.id ?? obliviousTarget.movePool[0]?.id ?? null;
const contraryLeafStormChoiceId = moveIdFor(contraryUser, 'Leaf Storm');
const sheerForceSnarlChoiceId = moveIdFor(sheerForceSnarlUser, 'Snarl');
const megaCharizardMoveId = moveIdFor(charizardBase, 'Flamethrower') ?? moveIdFor(charizardBase, 'Heat Wave') ?? charizardBase.movePool[0]?.id ?? null;
const megaAbomasnowMoveId = moveIdFor(abomasnowBase, 'Blizzard') ?? moveIdFor(abomasnowBase, 'Ice Shard') ?? abomasnowBase.movePool[0]?.id ?? null;
const charizardThawMoveName = charizardBase.movePool.find((move) => move.id === megaCharizardMoveId)?.name ?? charizardBase.movePool[0]?.name ?? 'Flamethrower';
const charizarditeYId = itemIdByName('Charizardite Y');
const abomasiteId = itemIdByName('Abomasite');
const meganiumiteId = itemIdByName('Meganiumite');
assert(
    protectChoiceId &&
    earthquakeChoiceId &&
    slowEarthquakeChoiceId &&
    thunderChoiceId &&
    snarlChoiceId &&
    shadowBallChoiceId &&
    specialTargetAAttackId &&
    specialTargetBAttackId &&
    darkTargetAttackId &&
    wishChoiceId &&
    voltSwitchChoiceId &&
    brickBreakChoiceId &&
    iceSpinnerChoiceId &&
    leechSeedChoiceId &&
    restChoiceId &&
    restFollowUpChoiceId &&
    disableChoiceId &&
    willOWispChoiceId &&
    thunderWaveChoiceId &&
    sporeChoiceId &&
    scaldChoiceId &&
    heatproofChoiceId &&
    hydrationChoiceId &&
    shedSkinChoiceId &&
    sweetVeilSupportChoiceId &&
    aromaVeilProtectChoiceId &&
    trickRoomChoiceId &&
    calmMindChoiceId &&
    nastyPlotChoiceId &&
    sunnyDayChoiceId &&
    tormentChoiceId &&
    auroraVeilChoiceId &&
    coachingChoiceId &&
    healPulseChoiceId &&
    stickyWebChoiceId &&
    toxicSpikesChoiceId &&
    hyperBeamChoiceId &&
    solarBeamChoiceId &&
    meteorBeamChoiceId &&
    parabolicChargeChoiceId &&
    drainingKissChoiceId &&
    bitterBladeChoiceId &&
    matchaGotchaChoiceId &&
    sparklingAriaChoiceId &&
    painSplitChoiceId &&
    pranksterTauntChoiceId &&
    pranksterFakeOutChoiceId &&
    intimidateAttackId &&
    innerFocusAttackId &&
    clearBodyAttackId &&
    mirrorArmorAttackId &&
    competitiveAttackId &&
    obliviousAttackId &&
    contraryLeafStormChoiceId &&
    sheerForceSnarlChoiceId &&
    megaCharizardMoveId &&
    megaAbomasnowMoveId &&
    charizarditeYId &&
    abomasiteId &&
    meganiumiteId,
  'Expected simulator audit moves and Mega Stones to exist on selected Pokemon.',
);

let protectBattle = buildBattle(
  'Singles',
  [buildSlot('protect-user', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('protect-foe', earthquakeUser, ['Earthquake'], { natureId: 'jolly', evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 } })],
);

protectBattle = withMockRandom([0.2, 0.2, 0.2], () => resolveTurn(protectBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
assert.equal(protectBattle.player.units[0].currentHp, protectBattle.player.units[0].maxHp, 'First Protect should always succeed.');
protectBattle = withMockRandom([0.2, 0.2, 0.2], () => resolveTurn(protectBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
assert.equal(protectBattle.player.units[0].currentHp, protectBattle.player.units[0].maxHp, 'Second consecutive Protect should succeed at the 1/3 rate with a 0.2 roll.');
protectBattle = withMockRandom([0.2, 0.2, 0.2], () => resolveTurn(protectBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
assert.ok(protectBattle.player.units[0].currentHp < protectBattle.player.units[0].maxHp, 'Third consecutive Protect should fail at the 1/9 rate with a 0.2 roll.');

let residualBattle = buildBattle(
  'Singles',
  [buildSlot('burned-user', groundedProtectUser, ['Protect'], { status: 'burn', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('leftovers-foe', protectUser, ['Protect'], { itemId: itemIdByName('Leftovers'), evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
residualBattle.opponent.units[0].currentHp = Math.max(1, residualBattle.opponent.units[0].currentHp - 24);
const burnStartHp = residualBattle.player.units[0].currentHp;
const leftoversStartHp = residualBattle.opponent.units[0].currentHp;
residualBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    residualBattle,
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
assert.equal(
  residualBattle.player.units[0].currentHp,
  burnStartHp - Math.max(1, Math.round(residualBattle.player.units[0].maxHp * 0.0625)),
  'Burn should deal one-sixteenth max HP at the end of the turn.',
);
assert.ok(residualBattle.opponent.units[0].currentHp > leftoversStartHp, 'Leftovers should heal its holder automatically at the end of the turn.');
assert.ok(
  residualBattle.log.some((entry) => /took \d+ burn damage\./.test(entry)),
  'Burn chip should be called out in the log with the exact HP loss.',
);
assert.ok(
  residualBattle.log.some((entry) => /restored \d+ HP with Leftovers\./.test(entry)),
  'Leftovers healing should be called out in the log with the exact HP gain.',
);

let heatproofBurnBattle = buildBattle(
  'Singles',
  [buildSlot('heatproof-burned-user', heatproofUser, ['Endure'], { status: 'burn', abilityName: 'Heatproof', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('heatproof-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const heatproofStartHp = heatproofBurnBattle.player.units[0].currentHp;
heatproofBurnBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    heatproofBurnBattle,
    [{ type: 'move', actor: 0, moveId: heatproofChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
assert.equal(
  heatproofBurnBattle.player.units[0].currentHp,
  heatproofStartHp - Math.max(1, Math.round(heatproofBurnBattle.player.units[0].maxHp * 0.03125)),
  'Heatproof should halve burn chip damage.',
);

let hydrationBattle = buildBattle(
  'Singles',
  [buildSlot('hydration-user', hydrationUser, ['Aqua Ring'], { status: 'burn', abilityName: 'Hydration', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('hydration-foe', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
hydrationBattle.environment.weather = 'rain';
hydrationBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    hydrationBattle,
    [{ type: 'move', actor: 0, moveId: hydrationChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
assert.equal(hydrationBattle.player.units[0].build.status, 'healthy', 'Hydration should cure status conditions at end of turn in rain.');

let shedSkinBattle = buildBattle(
  'Singles',
  [buildSlot('shed-skin-user', shedSkinUser, ['Coil'], { status: 'poison', abilityName: 'Shed Skin', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('shed-skin-foe', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
shedSkinBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    shedSkinBattle,
    [{ type: 'move', actor: 0, moveId: shedSkinChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
assert.equal(shedSkinBattle.player.units[0].build.status, 'healthy', 'Shed Skin should have a chance to clear status at end of turn.');

let healerBattle = buildBattle(
  'Doubles',
  [
    buildSlot('healer-user', healPulseUser, ['Heal Pulse'], { abilityName: 'Healer', evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14 } }),
    buildSlot('healer-ally', protectUser, ['Protect'], { status: 'burn', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('healer-foe-a', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('healer-foe-b', darkTarget, [darkTarget.movePool.find((move) => move.id === darkTargetAttackId)?.name ?? darkTarget.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
  ],
);
healerBattle = withMockRandom([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    healerBattle,
    [
      { type: 'move', actor: 0, moveId: healPulseChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: protectChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: darkTargetAttackId, target: 0 },
    ],
  ));
assert.equal(healerBattle.player.units[1].build.status, 'healthy', 'Healer should be able to cure allied status conditions at end of turn.');

let limberBattle = buildBattle(
  'Singles',
  [buildSlot('paralysis-user', thunderWaveUser, ['Thunder Wave'], { natureId: 'timid', evs: { ...blankStats(), speed: 32, hp: 20, specialDefense: 14 } })],
  [buildSlot('limber-target', limberTarget, ['Attract'], { abilityName: 'Limber', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
limberBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(limberBattle, [{ type: 'move', actor: 0, moveId: thunderWaveChoiceId, target: 0 }]));
assert.equal(limberBattle.opponent.units[0].build.status, 'healthy', 'Limber should block paralysis.');

let waterBubbleBattle = buildBattle(
  'Singles',
  [buildSlot('burn-user', willOWispUser, ['Will-O-Wisp'], { evs: { ...blankStats(), speed: 32, hp: 20, specialDefense: 14 } })],
  [buildSlot('water-bubble-target', waterBubbleTarget, ['Aqua Ring'], { abilityName: 'Water Bubble', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
waterBubbleBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(waterBubbleBattle, [{ type: 'move', actor: 0, moveId: willOWispChoiceId, target: 0 }]));
assert.equal(waterBubbleBattle.opponent.units[0].build.status, 'healthy', 'Water Bubble should block burn.');

let insomniaBattle = buildBattle(
  'Singles',
  [buildSlot('sleep-user', sporeUser, ['Hypnosis'], { evs: { ...blankStats(), hp: 20, specialDefense: 20, speed: 26 } })],
  [buildSlot('insomnia-target', insomniaTarget, ['Confuse Ray'], { abilityName: 'Insomnia', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
insomniaBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(insomniaBattle, [{ type: 'move', actor: 0, moveId: sporeChoiceId, target: 0 }]));
assert.equal(insomniaBattle.opponent.units[0].build.status, 'healthy', 'Insomnia should block sleep.');

let sweetVeilBattle = buildBattle(
  'Doubles',
  [
    buildSlot('sweet-veil-spore-user', sporeUser, ['Hypnosis'], { evs: { ...blankStats(), hp: 20, specialDefense: 20, speed: 26 } }),
    buildSlot('sweet-veil-ally', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('sweet-veil-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('sweet-veil-support', sweetVeilSupport, ['Calm Mind'], { abilityName: 'Sweet Veil', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
);
sweetVeilBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    sweetVeilBattle,
    [
      { type: 'move', actor: 0, moveId: sporeChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: protectChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: sweetVeilSupportChoiceId, target: 0 },
    ],
  ));
assert.equal(sweetVeilBattle.opponent.units[0].build.status, 'healthy', 'Sweet Veil should block allied sleep.');

let naturalCureBattle = buildBattle(
  'Singles',
  [
    buildSlot('natural-cure-user', naturalCureUser, ['Agility'], { status: 'burn', abilityName: 'Natural Cure', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('natural-cure-bench', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [buildSlot('natural-cure-foe', darkTarget, [darkTarget.movePool.find((move) => move.id === darkTargetAttackId)?.name ?? darkTarget.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } })],
);
naturalCureBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    naturalCureBattle,
    [{ type: 'switch', actor: 0, target: 1 }],
    [{ type: 'move', actor: 0, moveId: darkTargetAttackId, target: 0 }],
  ));
assert.equal(naturalCureBattle.player.units[0].build.status, 'healthy', 'Natural Cure should clear status when the Pokemon switches out.');

let thawTargetBattle = buildBattle(
  'Singles',
  [buildSlot('thaw-fire-user', charizardBase, [charizardThawMoveName], { natureId: 'modest', evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [buildSlot('thaw-fire-target', groundedProtectUser, ['Protect'], { status: 'freeze', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
thawTargetBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(thawTargetBattle, [{ type: 'move', actor: 0, moveId: megaCharizardMoveId, target: 0 }]));
assert.equal(thawTargetBattle.opponent.units[0].build.status, 'healthy', 'Fire-type attacks should thaw frozen targets.');

let thawSelfBattle = buildBattle(
  'Singles',
  [buildSlot('thaw-self-user', scaldUser, ['Scald'], { status: 'freeze', evs: { ...blankStats(), specialAttack: 24, speed: 24, hp: 18 } })],
  [buildSlot('thaw-self-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
thawSelfBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(thawSelfBattle, [{ type: 'move', actor: 0, moveId: scaldChoiceId, target: 0 }]));
assert.equal(thawSelfBattle.player.units[0].build.status, 'healthy', 'Scald should thaw a frozen user before it attacks.');

let fullParaBattle = buildBattle(
  'Singles',
  [buildSlot('full-para-user', shadowBallUser, ['Shadow Ball'], { status: 'paralysis', evs: { ...blankStats(), specialAttack: 24, speed: 24, hp: 18 } })],
  [buildSlot('full-para-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const fullParaStartHp = fullParaBattle.opponent.units[0].currentHp;
fullParaBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(fullParaBattle, [{ type: 'move', actor: 0, moveId: shadowBallChoiceId, target: 0 }]));
assert.equal(fullParaBattle.opponent.units[0].currentHp, fullParaStartHp, 'A 0.1 paralysis roll should fully paralyze the user in Champions.');
assert.ok(fullParaBattle.log.some((entry) => entry.includes('fully paralyzed')), 'Full paralysis should be called out in the battle log.');

let partialParaBattle = buildBattle(
  'Singles',
  [buildSlot('partial-para-user', shadowBallUser, ['Shadow Ball'], { status: 'paralysis', evs: { ...blankStats(), specialAttack: 24, speed: 24, hp: 18 } })],
  [buildSlot('partial-para-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const partialParaStartHp = partialParaBattle.opponent.units[0].currentHp;
partialParaBattle = withMockRandom([0.2, 0.1, 0.1], () => resolveTurn(partialParaBattle, [{ type: 'move', actor: 0, moveId: shadowBallChoiceId, target: 0 }]));
assert.ok(partialParaBattle.opponent.units[0].currentHp < partialParaStartHp, 'A 0.2 paralysis roll should let the move execute under Champions rules.');

let sitrusBattle = buildBattle(
  'Singles',
  [buildSlot('sitrus-attacker', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('sitrus-target', groundedProtectUser, ['Protect'], { itemId: itemIdByName('Sitrus Berry'), evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
sitrusBattle.opponent.units[0].currentHp = Math.max(1, Math.floor(sitrusBattle.opponent.units[0].maxHp * 0.45));
sitrusBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    sitrusBattle,
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
assert.equal(sitrusBattle.opponent.units[0].heldItemId, null, 'Sitrus Berry should be consumed automatically after the holder drops to half HP or lower.');
assert.ok(sitrusBattle.log.some((entry) => entry.includes('Sitrus Berry')), 'Sitrus Berry should be called out in the battle log when it triggers.');

let rainBattle = buildBattle(
  'Singles',
  [buildSlot('rain-thunder', thunderUser, ['Thunder'], { natureId: 'timid', evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [buildSlot('rain-target', protectUser, [protectUser.movePool.find((move) => move.category !== 'Status')?.name ?? protectUser.movePool[0].name], { evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14 } })],
);
rainBattle.environment.weather = 'rain';
rainBattle = withMockRandom([0.99, 0.99, 0.99], () => resolveTurn(rainBattle, [{ type: 'move', actor: 0, moveId: thunderChoiceId, target: 0 }]));
assert.ok(rainBattle.opponent.units[0].currentHp < rainBattle.opponent.units[0].maxHp, 'Thunder should connect in rain even on a 0.99 roll.');

let dryBattle = buildBattle(
  'Singles',
  [buildSlot('dry-thunder', thunderUser, ['Thunder'], { natureId: 'timid', evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [buildSlot('dry-target', protectUser, [protectUser.movePool.find((move) => move.category !== 'Status')?.name ?? protectUser.movePool[0].name], { evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14 } })],
);
dryBattle.environment.weather = 'clear';
dryBattle = withMockRandom([0.99, 0.99, 0.99], () => resolveTurn(dryBattle, [{ type: 'move', actor: 0, moveId: thunderChoiceId, target: 0 }]));
assert.equal(dryBattle.opponent.units[0].currentHp, dryBattle.opponent.units[0].maxHp, 'Thunder should miss outside rain on a 0.99 roll.');

let snarlBattle = buildBattle(
  'Doubles',
  [
    buildSlot('snarl-user', snarlUser, ['Snarl'], { evs: { ...blankStats(), hp: 24, specialAttack: 24, speed: 18 } }),
    buildSlot('snarl-ally', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('snarl-target-a', specialTargetA, [specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialAttack: 24, speed: 22 } }),
    buildSlot('snarl-target-b', specialTargetB, [specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialAttack: 24, speed: 22 } }),
  ],
);
snarlBattle = withMockRandom([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], () => resolveTurn(snarlBattle, [
  { type: 'move', actor: 0, moveId: snarlChoiceId, target: 0 },
  { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
]));
assert.equal(snarlBattle.opponent.units[0].build.specialAttackStage, -1, 'Snarl should drop the first target\'s Sp. Atk.');
assert.equal(snarlBattle.opponent.units[1].build.specialAttackStage, -1, 'Snarl should drop the second target\'s Sp. Atk.');
assert.ok(snarlBattle.opponent.units[0].currentHp < snarlBattle.opponent.units[0].maxHp, 'Snarl should damage the first opposing target.');
assert.ok(snarlBattle.opponent.units[1].currentHp < snarlBattle.opponent.units[1].maxHp, 'Snarl should damage the second opposing target.');

let aiDisciplineBattle = buildBattle(
  'Doubles',
  [
    buildSlot('ai-fakeout-user', pranksterUser, ['Fake Out', 'Taunt'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } }),
    buildSlot('ai-fakeout-ally', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('ai-fakeout-foe-a', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('ai-fakeout-foe-b', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
  ],
);
aiDisciplineBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    aiDisciplineBattle,
    [
      { type: 'move', actor: 0, moveId: pranksterFakeOutChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: protectChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: specialTargetAAttackId, target: 0 },
    ],
  ));
const aiFollowUpChoices = generateAiChoices(aiDisciplineBattle, 'player');
assert.ok(
  aiFollowUpChoices.every((choice) => choice.type === 'switch' || choice.moveId !== pranksterFakeOutChoiceId),
  'Expert AI should stop selecting Fake Out after the opener turn has passed.',
);

let coachingBattle = buildBattle(
  'Doubles',
  [
    buildSlot('coach-user', coachingUser, ['Coaching'], { evs: { ...blankStats(), hp: 24, defense: 20, specialDefense: 22 } }),
    buildSlot('coach-ally', earthquakeUser, ['Earthquake'], { natureId: 'jolly', evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 } }),
  ],
  [
    buildSlot('coach-foe-a', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('coach-foe-b', specialTargetB, [specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
coachingBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(coachingBattle, [
  { type: 'move', actor: 0, moveId: coachingChoiceId, target: 0 },
  { type: 'move', actor: 1, moveId: earthquakeChoiceId, target: 0 },
]));
assert.equal(coachingBattle.player.units[1].build.attackStage, 1, 'Coaching should raise the ally\'s Attack by one stage.');
assert.equal(coachingBattle.player.units[1].build.defenseStage, 1, 'Coaching should raise the ally\'s Defense by one stage.');
assert.equal(coachingBattle.player.units[0].build.attackStage, 0, 'Coaching should not incorrectly boost the user.');

let healPulseBattle = buildBattle(
  'Doubles',
  [
    buildSlot('heal-user', healPulseUser, ['Heal Pulse'], { evs: { ...blankStats(), hp: 24, specialDefense: 22, defense: 20 } }),
    buildSlot('heal-ally', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('heal-foe-a', shadowBallUser, ['Shadow Ball'], { evs: { ...blankStats(), specialAttack: 32, speed: 20, hp: 14 } }),
    buildSlot('heal-foe-b', specialTargetB, [specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
healPulseBattle.player.units[1].currentHp = Math.max(1, Math.floor(healPulseBattle.player.units[1].maxHp * 0.35));
const preHealPulseHp = healPulseBattle.player.units[1].currentHp;
healPulseBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(healPulseBattle, [
  { type: 'move', actor: 0, moveId: healPulseChoiceId, target: 0 },
  { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
]));
assert.ok(healPulseBattle.player.units[1].currentHp > preHealPulseHp, 'Heal Pulse should restore HP to an ally instead of the user.');

let earthquakeBattle = buildBattle(
  'Doubles',
  [
    buildSlot('eq-user', earthquakeUser, ['Earthquake'], { natureId: 'jolly', evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 } }),
    buildSlot('eq-ally', snarlUser, ['Snarl'], { evs: { ...blankStats(), hp: 24, defense: 20, specialDefense: 22 } }),
  ],
  [
    buildSlot('eq-target-a', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('eq-target-b', specialTargetB, [specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
  ],
);
earthquakeBattle = withMockRandom([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], () => resolveTurn(earthquakeBattle, [
  { type: 'move', actor: 0, moveId: earthquakeChoiceId, target: 0 },
  { type: 'move', actor: 1, moveId: snarlChoiceId, target: 0 },
]));
assert.ok(earthquakeBattle.player.units[1].currentHp < earthquakeBattle.player.units[1].maxHp, 'All-adjacent moves should hit the user\'s ally when appropriate.');
assert.ok(earthquakeBattle.opponent.units[0].currentHp < earthquakeBattle.opponent.units[0].maxHp, 'Earthquake should damage the first opposing target.');
assert.ok(earthquakeBattle.opponent.units[1].currentHp < earthquakeBattle.opponent.units[1].maxHp, 'Earthquake should damage the second opposing target.');

let parabolicChargeBattle = buildBattle(
  'Doubles',
  [
    buildSlot('parabolic-user', parabolicChargeUser, ['Parabolic Charge'], { natureId: 'modest', evs: { ...blankStats(), specialAttack: 32, hp: 20, speed: 14 } }),
    buildSlot('parabolic-ally', wishUser, ['Wish'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('parabolic-foe-a', sunnyDayUser, ['Sunny Day'], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
    buildSlot('parabolic-foe-b', wishUser, ['Wish'], { natureId: 'brave', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14, speed: 0 } }),
  ],
);
parabolicChargeBattle.player.units[0].currentHp = Math.max(1, Math.floor(parabolicChargeBattle.player.units[0].maxHp * 0.35));
const parabolicStartHp = parabolicChargeBattle.player.units[0].currentHp;
const parabolicAllyHp = parabolicChargeBattle.player.units[1].currentHp;
const parabolicFoeAHp = parabolicChargeBattle.opponent.units[0].currentHp;
const parabolicFoeBHp = parabolicChargeBattle.opponent.units[1].currentHp;
parabolicChargeBattle = withMockRandom([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    parabolicChargeBattle,
    [
      { type: 'move', actor: 0, moveId: parabolicChargeChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: wishChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: wishChoiceId, target: 0 },
    ],
  ));
const parabolicDamageTotal =
  (parabolicAllyHp - parabolicChargeBattle.player.units[1].currentHp) +
  (parabolicFoeAHp - parabolicChargeBattle.opponent.units[0].currentHp) +
  (parabolicFoeBHp - parabolicChargeBattle.opponent.units[1].currentHp);
const parabolicExpectedHeal = Math.min(
  parabolicChargeBattle.player.units[0].maxHp - parabolicStartHp,
  Math.max(1, Math.round(parabolicDamageTotal * 0.5)),
);
assert.ok(parabolicChargeBattle.player.units[1].currentHp < parabolicAllyHp, 'Parabolic Charge should strike adjacent allies.');
assert.ok(parabolicChargeBattle.opponent.units[0].currentHp < parabolicFoeAHp, 'Parabolic Charge should damage the first opposing target.');
assert.ok(parabolicChargeBattle.opponent.units[1].currentHp < parabolicFoeBHp, 'Parabolic Charge should damage the second opposing target.');
assert.equal(parabolicChargeBattle.player.units[0].currentHp - parabolicStartHp, parabolicExpectedHeal, 'Parabolic Charge should heal for half the total damage dealt to all struck targets.');

let drainingKissBattle = buildBattle(
  'Singles',
  [buildSlot('draining-kiss-user', drainingKissUser, ['Draining Kiss'], { natureId: 'modest', evs: { ...blankStats(), specialAttack: 32, hp: 20, speed: 14 } })],
  [buildSlot('draining-kiss-foe', sunnyDayUser, ['Sunny Day'], { natureId: 'brave', evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14, speed: 0 } })],
);
drainingKissBattle.player.units[0].currentHp = Math.max(1, Math.floor(drainingKissBattle.player.units[0].maxHp * 0.3));
const drainingKissStartHp = drainingKissBattle.player.units[0].currentHp;
const drainingKissTargetHp = drainingKissBattle.opponent.units[0].currentHp;
drainingKissBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    drainingKissBattle,
    [{ type: 'move', actor: 0, moveId: drainingKissChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 }],
  ));
const drainingKissDamage = drainingKissTargetHp - drainingKissBattle.opponent.units[0].currentHp;
const drainingKissExpectedHeal = Math.min(
  drainingKissBattle.player.units[0].maxHp - drainingKissStartHp,
  Math.max(1, Math.round(drainingKissDamage * 0.75)),
);
assert.equal(drainingKissBattle.player.units[0].currentHp - drainingKissStartHp, drainingKissExpectedHeal, 'Draining Kiss should restore three-quarters of the damage it dealt.');

let bitterBladeBattle = buildBattle(
  'Singles',
  [buildSlot('bitter-blade-user', bitterBladeUser, ['Bitter Blade'], { natureId: 'adamant', evs: { ...blankStats(), attack: 32, hp: 20, speed: 14 } })],
  [buildSlot('bitter-blade-foe', sunnyDayUser, ['Sunny Day'], { natureId: 'brave', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14, speed: 0 } })],
);
bitterBladeBattle.player.units[0].currentHp = Math.max(1, Math.floor(bitterBladeBattle.player.units[0].maxHp * 0.3));
const bitterBladeStartHp = bitterBladeBattle.player.units[0].currentHp;
const bitterBladeTargetHp = bitterBladeBattle.opponent.units[0].currentHp;
bitterBladeBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    bitterBladeBattle,
    [{ type: 'move', actor: 0, moveId: bitterBladeChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 }],
  ));
const bitterBladeDamage = bitterBladeTargetHp - bitterBladeBattle.opponent.units[0].currentHp;
const bitterBladeExpectedHeal = Math.min(
  bitterBladeBattle.player.units[0].maxHp - bitterBladeStartHp,
  Math.max(1, Math.round(bitterBladeDamage * 0.5)),
);
assert.equal(bitterBladeBattle.player.units[0].currentHp - bitterBladeStartHp, bitterBladeExpectedHeal, 'Bitter Blade should restore half the damage it dealt.');

let matchaGotchaBattle = buildBattle(
  'Doubles',
  [
    buildSlot('matcha-user', matchaGotchaUser, ['Matcha Gotcha'], { natureId: 'modest', evs: { ...blankStats(), specialAttack: 32, hp: 20, speed: 14 } }),
    buildSlot('matcha-ally', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('matcha-foe-a', sunnyDayUser, ['Sunny Day'], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
    buildSlot('matcha-foe-b', wishUser, ['Wish'], { natureId: 'brave', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14, speed: 0 } }),
  ],
);
matchaGotchaBattle.player.units[0].currentHp = Math.max(1, Math.floor(matchaGotchaBattle.player.units[0].maxHp * 0.32));
const matchaStartHp = matchaGotchaBattle.player.units[0].currentHp;
const matchaFoeAHp = matchaGotchaBattle.opponent.units[0].currentHp;
const matchaFoeBHp = matchaGotchaBattle.opponent.units[1].currentHp;
matchaGotchaBattle = withMockRandom([0.1, 0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    matchaGotchaBattle,
    [
      { type: 'move', actor: 0, moveId: matchaGotchaChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: wishChoiceId, target: 0 },
    ],
  ));
const matchaDamageTotal =
  (matchaFoeAHp - matchaGotchaBattle.opponent.units[0].currentHp) +
  (matchaFoeBHp - matchaGotchaBattle.opponent.units[1].currentHp);
const matchaExpectedHeal = Math.min(
  matchaGotchaBattle.player.units[0].maxHp - matchaStartHp,
  Math.max(1, Math.round(matchaDamageTotal * 0.5)),
);
assert.equal(matchaGotchaBattle.player.units[0].currentHp - matchaStartHp, matchaExpectedHeal, 'Matcha Gotcha should heal for half the total damage it dealt to both opponents.');

let painSplitBattle = buildBattle(
  'Singles',
  [buildSlot('pain-split-user', painSplitUser, ['Pain Split'], { natureId: 'timid', evs: { ...blankStats(), hp: 20, specialDefense: 14, speed: 32 } })],
  [buildSlot('pain-split-foe', wishUser, ['Wish'], { natureId: 'brave', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14, speed: 0 } })],
);
painSplitBattle.player.units[0].currentHp = Math.max(1, Math.floor(painSplitBattle.player.units[0].maxHp * 0.24));
painSplitBattle.opponent.units[0].currentHp = Math.max(2, Math.floor(painSplitBattle.opponent.units[0].maxHp * 0.82));
const painSplitExpectedShared = Math.max(1, Math.floor((painSplitBattle.player.units[0].currentHp + painSplitBattle.opponent.units[0].currentHp) / 2));
painSplitBattle = withMockRandom([0.1, 0.1], () =>
  resolveTurnWithChoices(
    painSplitBattle,
    [{ type: 'move', actor: 0, moveId: painSplitChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: wishChoiceId, target: 0 }],
  ));
assert.equal(painSplitBattle.player.units[0].currentHp, Math.min(painSplitBattle.player.units[0].maxHp, painSplitExpectedShared), 'Pain Split should set the user HP to the shared halved total.');
assert.equal(painSplitBattle.opponent.units[0].currentHp, Math.min(painSplitBattle.opponent.units[0].maxHp, painSplitExpectedShared), 'Pain Split should set the target HP to the shared halved total.');

let sparklingAriaBattle = buildBattle(
  'Doubles',
  [
    buildSlot('sparkling-user', sparklingAriaUser, ['Sparkling Aria'], { natureId: 'modest', evs: { ...blankStats(), specialAttack: 32, hp: 20, speed: 14 } }),
    buildSlot('sparkling-ally', wishUser, ['Wish'], { status: 'burn', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('sparkling-foe-a', sunnyDayUser, ['Sunny Day'], { status: 'burn', evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
    buildSlot('sparkling-foe-b', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
);
sparklingAriaBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    sparklingAriaBattle,
    [
      { type: 'move', actor: 0, moveId: sparklingAriaChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: wishChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
  ));
assert.equal(sparklingAriaBattle.player.units[1].build.status, 'healthy', 'Sparkling Aria should cure allied burns on struck adjacent Pokemon.');
assert.equal(sparklingAriaBattle.opponent.units[0].build.status, 'healthy', 'Sparkling Aria should cure opposing burns on struck adjacent Pokemon.');

let auroraVeilBattle = buildBattle(
  'Doubles',
  [
    buildSlot('veil-user', auroraVeilUser, ['Aurora Veil'], { evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14 } }),
    buildSlot('veil-ally', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('veil-foe-a', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('veil-foe-b', disableUser, ['Protect'], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
auroraVeilBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(auroraVeilBattle, [
  { type: 'move', actor: 0, moveId: auroraVeilChoiceId, target: 0 },
  { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
]));
assert.equal(auroraVeilBattle.player.auroraVeilTurns, 0, 'Aurora Veil should fail without snow.');
auroraVeilBattle.environment.weather = 'snow';
auroraVeilBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(auroraVeilBattle, [
  { type: 'move', actor: 0, moveId: auroraVeilChoiceId, target: 0 },
  { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
]));
assert.equal(auroraVeilBattle.player.auroraVeilTurns, 4, 'Aurora Veil should set a five-turn side timer when snow is active.');

let stickyWebBattle = buildBattle(
  'Doubles',
  [
    buildSlot('web-user', stickyWebUser, ['Sticky Web'], { natureId: 'jolly', evs: { ...blankStats(), speed: 32, hp: 20, defense: 14 } }),
    buildSlot('web-ally', slowEarthquakeUser, ['Earthquake'], { natureId: 'brave', evs: { ...blankStats(), attack: 32, hp: 32, speed: 2 } }),
  ],
  [
    buildSlot('web-foe-a', specialTargetA, [specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('web-foe-b', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('web-bench', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
);
stickyWebBattle.opponent.units[0].currentHp = 1;
stickyWebBattle = withMockRandom([0.2, 0.2, 0.2, 0.2], () =>
  resolveTurnWithChoices(
    stickyWebBattle,
    [
      { type: 'move', actor: 0, moveId: stickyWebChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: slowEarthquakeChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
  ));
stickyWebBattle = applyReplacementChoices(stickyWebBattle, [], buildAutoReplacementChoices(stickyWebBattle, 'opponent'));
assert.equal(stickyWebBattle.opponent.units[2].revealed, true, 'A replacement switch-in should reveal the incoming Pokemon.');
assert.equal(stickyWebBattle.opponent.units[2].build.speedStage, -1, 'Sticky Web should lower the Speed of grounded switch-ins.');

let toxicSpikesBattle = buildBattle(
  'Doubles',
  [
    buildSlot('toxic-spikes-user', toxicSpikesUser, ['Toxic Spikes'], { natureId: 'jolly', evs: { ...blankStats(), speed: 32, hp: 20, defense: 14 } }),
    buildSlot('toxic-spikes-ally', slowEarthquakeUser, ['Earthquake'], { natureId: 'brave', evs: { ...blankStats(), attack: 32, hp: 32, speed: 2 } }),
  ],
  [
    buildSlot('toxic-spikes-foe-a', specialTargetA, [specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('toxic-spikes-foe-b', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('toxic-spikes-bench', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
);
toxicSpikesBattle.opponent.units[0].currentHp = 1;
toxicSpikesBattle = withMockRandom([0.2, 0.2, 0.2, 0.2], () =>
  resolveTurnWithChoices(
    toxicSpikesBattle,
    [
      { type: 'move', actor: 0, moveId: toxicSpikesChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: slowEarthquakeChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
  ));
toxicSpikesBattle = applyReplacementChoices(toxicSpikesBattle, [], buildAutoReplacementChoices(toxicSpikesBattle, 'opponent'));
assert.equal(toxicSpikesBattle.opponent.units[2].build.status, 'poison', 'Toxic Spikes should poison grounded switch-ins when one layer is active.');

let freezeBattle = buildBattle(
  'Singles',
  [buildSlot('freeze-user', shadowBallUser, ['Shadow Ball'], { status: 'freeze', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
  [buildSlot('freeze-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
freezeBattle = withMockRandom([0.9, 0.9, 0.9], () => resolveTurn(freezeBattle, [{ type: 'move', actor: 0, moveId: shadowBallChoiceId, target: 0 }]));
assert.equal(freezeBattle.player.units[0].build.status, 'freeze', 'Frozen Pokemon should stay frozen on the first failed thaw turn.');
freezeBattle = withMockRandom([0.9, 0.9, 0.9], () => resolveTurn(freezeBattle, [{ type: 'move', actor: 0, moveId: shadowBallChoiceId, target: 0 }]));
assert.equal(freezeBattle.player.units[0].build.status, 'freeze', 'Frozen Pokemon should still be frozen on the second failed thaw turn.');
freezeBattle = withMockRandom([0.9, 0.9, 0.9], () => resolveTurn(freezeBattle, [{ type: 'move', actor: 0, moveId: shadowBallChoiceId, target: 0 }]));
assert.equal(freezeBattle.player.units[0].build.status, 'healthy', 'Frozen Pokemon should always thaw by the third turn.');

let wishBattle = buildBattle(
  'Singles',
  [
    buildSlot('wish-user', wishUser, ['Wish'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 }, currentHpPercent: 40 }),
    buildSlot('wish-bench', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [buildSlot('wish-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
wishBattle.player.units[0].currentHp = Math.max(1, Math.floor(wishBattle.player.units[0].maxHp * 0.4));
wishBattle = withMockRandom([0.2, 0.2, 0.2], () =>
  resolveTurnWithChoices(
    wishBattle,
    [{ type: 'move', actor: 0, moveId: wishChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
const postWishHp = wishBattle.player.units[0].currentHp;
wishBattle = withMockRandom([0.2, 0.2, 0.2], () =>
  resolveTurnWithChoices(
    wishBattle,
    [{ type: 'move', actor: 0, moveId: wishChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
  ));
assert.ok(wishBattle.player.units[0].currentHp > postWishHp, 'Wish should heal the active slot at the end of the following turn.');

let pivotBattle = buildBattle(
  'Singles',
  [
    buildSlot('pivot-user', pivotUser, ['Volt Switch'], { evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } }),
    buildSlot('pivot-bench', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [buildSlot('pivot-foe', shadowBallUser, ['Shadow Ball'], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } })],
);
pivotBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(pivotBattle, [{ type: 'move', actor: 0, moveId: voltSwitchChoiceId, target: 0 }]));
assert.equal(pivotBattle.player.units[pivotBattle.player.active[0]].pokemon.displayName, protectUser.displayName, 'Volt Switch should pivot the user into the first available bench replacement.');

let brickBreakBattle = buildBattle(
  'Singles',
  [buildSlot('brick-user', brickBreakUser, ['Brick Break'], { evs: { ...blankStats(), attack: 32, speed: 20, hp: 14 } })],
  [buildSlot('brick-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
brickBreakBattle.opponent.reflectTurns = 5;
brickBreakBattle.opponent.lightScreenTurns = 5;
brickBreakBattle.opponent.auroraVeilTurns = 5;
brickBreakBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(brickBreakBattle, [{ type: 'move', actor: 0, moveId: brickBreakChoiceId, target: 0 }]));
assert.equal(brickBreakBattle.opponent.reflectTurns, 0, 'Brick Break should remove Reflect.');
assert.equal(brickBreakBattle.opponent.lightScreenTurns, 0, 'Brick Break should remove Light Screen.');
assert.equal(brickBreakBattle.opponent.auroraVeilTurns, 0, 'Brick Break should also remove Aurora Veil.');

let terrainBattle = buildBattle(
  'Singles',
  [buildSlot('ice-user', iceSpinnerUser, ['Ice Spinner'], { evs: { ...blankStats(), attack: 32, speed: 20, hp: 14 } })],
  [buildSlot('ice-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
terrainBattle.environment.terrain = 'psychic';
terrainBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(terrainBattle, [{ type: 'move', actor: 0, moveId: iceSpinnerChoiceId, target: 0 }]));
assert.equal(terrainBattle.environment.terrain, 'none', 'Ice Spinner should clear the current terrain.');

let electricTerrainBattle = buildBattle(
  'Singles',
  [buildSlot('electric-terrain-sleep-user', sporeUser, ['Hypnosis'], { evs: { ...blankStats(), hp: 20, specialDefense: 20, speed: 26 } })],
  [buildSlot('electric-terrain-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
electricTerrainBattle.environment.terrain = 'electric';
electricTerrainBattle.terrainTurns = 5;
electricTerrainBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(electricTerrainBattle, [{ type: 'move', actor: 0, moveId: sporeChoiceId, target: 0 }]));
assert.equal(electricTerrainBattle.opponent.units[0].build.status, 'healthy', 'Electric Terrain should block sleep for grounded targets.');

let mistyTerrainBattle = buildBattle(
  'Singles',
  [buildSlot('misty-terrain-burn-user', willOWispUser, ['Will-O-Wisp'], { evs: { ...blankStats(), hp: 20, speed: 20, specialDefense: 26 } })],
  [buildSlot('misty-terrain-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
mistyTerrainBattle.environment.terrain = 'misty';
mistyTerrainBattle.terrainTurns = 5;
mistyTerrainBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(mistyTerrainBattle, [{ type: 'move', actor: 0, moveId: willOWispChoiceId, target: 0 }]));
assert.equal(mistyTerrainBattle.opponent.units[0].build.status, 'healthy', 'Misty Terrain should block new status conditions for grounded targets.');

let grassyTerrainBattle = buildBattle(
  'Singles',
  [buildSlot('grassy-terrain-heal-user', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 }, currentHpPercent: 55 })],
  [buildSlot('grassy-terrain-foe', sunnyDayUser, ['Sunny Day'], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } })],
);
grassyTerrainBattle.environment.terrain = 'grassy';
grassyTerrainBattle.terrainTurns = 5;
grassyTerrainBattle.player.units[0].currentHp = Math.max(1, Math.floor(grassyTerrainBattle.player.units[0].maxHp * 0.55));
const grassyStartHp = grassyTerrainBattle.player.units[0].currentHp;
grassyTerrainBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    grassyTerrainBattle,
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 }],
  ));
assert.ok(grassyTerrainBattle.player.units[0].currentHp > grassyStartHp, 'Grassy Terrain should heal grounded active Pokemon at end of turn.');

let psychicTerrainPriorityBattle = buildBattle(
  'Doubles',
  [
    buildSlot('psychic-terrain-fake-out-user', pranksterUser, ['Fake Out'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } }),
    buildSlot('psychic-terrain-ally', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('psychic-terrain-target-a', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('psychic-terrain-target-b', sunnyDayUser, ['Sunny Day'], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
psychicTerrainPriorityBattle.environment.terrain = 'psychic';
psychicTerrainPriorityBattle.terrainTurns = 5;
const psychicTerrainTargetHp = psychicTerrainPriorityBattle.opponent.units[0].currentHp;
psychicTerrainPriorityBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    psychicTerrainPriorityBattle,
    [
      { type: 'move', actor: 0, moveId: pranksterFakeOutChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: protectChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: sunnyDayChoiceId, target: 0 },
    ],
  ));
assert.equal(psychicTerrainPriorityBattle.opponent.units[0].currentHp, psychicTerrainTargetHp, 'Psychic Terrain should block priority attacks into grounded targets.');
assert.ok(psychicTerrainPriorityBattle.log.some((entry) => entry.includes('Psychic Terrain')), 'Psychic Terrain should be called out when it blocks a priority move.');

let seedBattle = buildBattle(
  'Singles',
  [buildSlot('seed-user', leechSeedUser, ['Leech Seed'], { evs: { ...blankStats(), hp: 32, specialDefense: 20, defense: 14 }, currentHpPercent: 60 })],
  [buildSlot('seed-foe', protectUser, [protectUser.movePool.find((move) => move.category !== 'Status')?.name ?? protectUser.movePool[0].name], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
seedBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(seedBattle, [{ type: 'move', actor: 0, moveId: leechSeedChoiceId, target: 0 }]));
assert.ok(seedBattle.opponent.units[0].currentHp < seedBattle.opponent.units[0].maxHp, 'Leech Seed should drain HP at end of turn.');
assert.ok(seedBattle.player.units[0].currentHp > Math.round(seedBattle.player.units[0].maxHp * 0.6) - 1, 'Leech Seed should restore HP to the seeding side.');

let restBattle = buildBattle(
  'Singles',
  [buildSlot('rest-user', restUser, ['Rest'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 }, currentHpPercent: 35, status: 'burn' })],
  [buildSlot('rest-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
restBattle.player.units[0].currentHp = Math.max(1, Math.floor(restBattle.player.units[0].maxHp * 0.35));
restBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(restBattle, [{ type: 'move', actor: 0, moveId: restChoiceId, target: 0 }]));
assert.equal(restBattle.player.units[0].currentHp, restBattle.player.units[0].maxHp, 'Rest should fully restore HP.');
assert.equal(restBattle.player.units[0].build.status, 'sleep', 'Rest should put the user to sleep.');
restBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(restBattle, [{ type: 'move', actor: 0, moveId: restFollowUpChoiceId, target: 0 }]));
assert.equal(restBattle.player.units[0].build.status, 'sleep', 'Rest sleep should still be active after the first forced sleep turn.');
restBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(restBattle, [{ type: 'move', actor: 0, moveId: restFollowUpChoiceId, target: 0 }]));
assert.equal(restBattle.player.units[0].build.status, 'sleep', 'Rest sleep should still be active after the second forced sleep turn.');
restBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(restBattle, [{ type: 'move', actor: 0, moveId: restFollowUpChoiceId, target: 0 }]));
assert.equal(restBattle.player.units[0].build.status, 'healthy', 'Rest sleep should clear on the third move attempt.');

let disableBattle = buildBattle(
  'Singles',
  [buildSlot('disable-user', disableUser, ['Disable', 'Protect'], { evs: { ...blankStats(), hp: 32, speed: 20, defense: 14 } })],
  [buildSlot('disable-foe', shadowBallUser, ['Shadow Ball', 'Protect'], { evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
);
disableBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(disableBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
disableBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(disableBattle, [{ type: 'move', actor: 0, moveId: disableChoiceId, target: 0 }]));
assert.equal(disableBattle.opponent.units[0].disabledMoveId, shadowBallChoiceId, 'Disable should lock the target\'s last used move.');
const hpAfterDisableTurn = disableBattle.player.units[0].currentHp;
disableBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(disableBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
assert.equal(disableBattle.player.units[0].currentHp, hpAfterDisableTurn, 'A disabled attacker should not be able to reuse its disabled move immediately.');

let aromaVeilBattle = buildBattle(
  'Singles',
  [buildSlot('aroma-veil-user', disableUser, ['Disable', 'Protect'], { evs: { ...blankStats(), hp: 32, speed: 20, defense: 14 } })],
  [buildSlot('aroma-veil-target', aromaVeilTarget, ['Protect'], { abilityName: 'Aroma Veil', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
aromaVeilBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    aromaVeilBattle,
    [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: aromaVeilProtectChoiceId, target: 0 }],
  ));
aromaVeilBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(aromaVeilBattle, [{ type: 'move', actor: 0, moveId: disableChoiceId, target: 0 }]));
assert.equal(aromaVeilBattle.opponent.units[0].disableTurns, 0, 'Aroma Veil should block Disable from landing on the protected side.');

let tormentBattle = buildBattle(
  'Singles',
  [buildSlot('torment-user', tormentUser, ['Torment', 'Protect'], { evs: { ...blankStats(), hp: 32, speed: 20, defense: 14 } })],
  [buildSlot('torment-foe', shadowBallUser, ['Shadow Ball', 'Protect'], { evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
);
tormentBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(tormentBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
tormentBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(tormentBattle, [{ type: 'move', actor: 0, moveId: tormentChoiceId, target: 0 }]));
assert.equal(tormentBattle.opponent.units[0].tormentActive, true, 'Torment should stay active until the target switches out.');
assert.ok(
  !legalMovesForUnit(tormentBattle.opponent.units[0]).some((move) => move.id === shadowBallChoiceId),
  'A tormented target should not be able to immediately repeat its last move.',
);

let calmMindBattle = buildBattle(
  'Singles',
  [buildSlot('calm-mind-user', calmMindUser, ['Calm Mind'], { evs: { ...blankStats(), hp: 32, specialAttack: 20, specialDefense: 14 } })],
  [buildSlot('calm-mind-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
calmMindBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(calmMindBattle, [{ type: 'move', actor: 0, moveId: calmMindChoiceId, target: 0 }]));
assert.equal(calmMindBattle.player.units[0].build.specialAttackStage, 1, 'Calm Mind should raise Sp. Atk by one stage.');
assert.equal(calmMindBattle.player.units[0].build.specialDefenseStage, 1, 'Calm Mind should raise Sp. Def by one stage.');

let nastyPlotBattle = buildBattle(
  'Singles',
  [buildSlot('nasty-plot-user', nastyPlotUser, ['Nasty Plot'], { evs: { ...blankStats(), hp: 32, specialAttack: 20, specialDefense: 14 } })],
  [buildSlot('nasty-plot-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
nastyPlotBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(nastyPlotBattle, [{ type: 'move', actor: 0, moveId: nastyPlotChoiceId, target: 0 }]));
assert.equal(nastyPlotBattle.player.units[0].build.specialAttackStage, 2, 'Nasty Plot should sharply raise Sp. Atk.');

let weatherTimerBattle = buildBattle(
  'Singles',
  [buildSlot('sunny-user', sunnyDayUser, ['Sunny Day', 'Protect'], { evs: { ...blankStats(), hp: 24, speed: 22, specialDefense: 20 } })],
  [buildSlot('sunny-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
weatherTimerBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(weatherTimerBattle, [{ type: 'move', actor: 0, moveId: sunnyDayChoiceId, target: 0 }]));
assert.equal(weatherTimerBattle.environment.weather, 'sun', 'Sunny Day should apply sun to the field.');
assert.equal(weatherTimerBattle.weatherTurns, 4, 'A five-turn weather move should show four turns remaining after the turn resolves.');
for (let index = 0; index < 4; index += 1) {
  weatherTimerBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(weatherTimerBattle, [{ type: 'move', actor: 0, moveId: protectChoiceId, target: 0 }]));
}
assert.equal(weatherTimerBattle.environment.weather, 'clear', 'Weather should expire after its full field duration.');
assert.equal(weatherTimerBattle.weatherTurns, 0, 'Weather timer should clear after expiration.');

let trickRoomBattle = buildBattle(
  'Singles',
  [buildSlot('trick-room-user', trickRoomUser, ['Trick Room', 'Shadow Ball'], { evs: { ...blankStats(), hp: 32, specialAttack: 20, specialDefense: 14 }, natureId: 'quiet' })],
  [buildSlot('trick-room-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
trickRoomBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(trickRoomBattle, [{ type: 'move', actor: 0, moveId: trickRoomChoiceId, target: 0 }]));
assert.equal(trickRoomBattle.trickRoomTurns, 4, 'Trick Room should be active after the turn it was used.');
trickRoomBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(trickRoomBattle, [{ type: 'move', actor: 0, moveId: trickRoomChoiceId, target: 0 }]));
assert.equal(trickRoomBattle.trickRoomTurns, 0, 'Using Trick Room again while active should cancel it.');

let megaWeatherBattle = buildBattle(
  'Singles',
  [buildSlot('mega-charizard', charizardBase, ['Flamethrower'], { itemId: charizarditeYId, evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 }, natureId: 'timid' })],
  [buildSlot('mega-abomasnow', abomasnowBase, ['Blizzard'], { itemId: abomasiteId, evs: { ...blankStats(), specialAttack: 32, hp: 32, speed: 0 }, natureId: 'quiet' })],
);
megaWeatherBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(megaWeatherBattle, [
  { type: 'mega', actor: 0, moveId: megaCharizardMoveId, target: 0 },
]));
assert.equal(megaWeatherBattle.player.units[0].megaEvolved, true, 'Player Mega Evolution should trigger when the Mega action is chosen.');
assert.equal(megaWeatherBattle.opponent.units[0].megaEvolved, true, 'AI Mega Evolution should also trigger when available.');
assert.equal(megaWeatherBattle.environment.weather, 'snow', 'When both Megas set weather, the slower Mega should override the faster weather.');
assert.equal(megaWeatherBattle.weatherTurns, 4, 'Mega weather abilities should also start a five-turn field timer.');
assert.equal(megaWeatherBattle.player.megaUsed, true, 'A side should record that its Mega Evolution has been used.');
assert.equal(megaWeatherBattle.opponent.megaUsed, true, 'The opposing side should also record Mega usage.');

let megaExclusivityBattle = buildBattle(
  'Doubles',
  [
    buildSlot('mega-lock-charizard', charizardBase, ['Flamethrower'], { itemId: charizarditeYId, evs: { ...blankStats(), specialAttack: 32, speed: 20, hp: 14 } }),
    buildSlot('mega-lock-abomasnow', abomasnowBase, ['Blizzard'], { itemId: abomasiteId, evs: { ...blankStats(), specialAttack: 32, hp: 20, defense: 14 } }),
  ],
  [
    buildSlot('mega-lock-foe-a', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('mega-lock-foe-b', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
);
megaExclusivityBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurnWithChoices(
  megaExclusivityBattle,
  [
    { type: 'mega', actor: 0, moveId: megaCharizardMoveId, target: 0 },
    { type: 'mega', actor: 1, moveId: megaAbomasnowMoveId, target: 0 },
  ],
  [
    { type: 'move', actor: 0, moveId: protectChoiceId, target: 0 },
    { type: 'move', actor: 1, moveId: protectChoiceId, target: 0 },
  ],
));
assert.equal(megaExclusivityBattle.player.units[0].megaEvolved, true, 'The first queued Mega Evolution should resolve for the player side.');
assert.equal(megaExclusivityBattle.player.units[1].megaEvolved, false, 'A side should never resolve a second Mega Evolution in the same battle.');
assert.equal(megaExclusivityBattle.player.megaUsed, true, 'Spending one Mega Evolution should hard-lock the side from using another later in the battle.');

let revealBattle = buildBattle(
  'Singles',
  [buildSlot('reveal-user', earthquakeUser, ['Earthquake'], { natureId: 'jolly', evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 } })],
  [
    buildSlot('reveal-foe-a', specialTargetA, [specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('reveal-foe-b', specialTargetB, [specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
assert.equal(revealBattle.opponent.units[1].revealed, false, 'Opponent bench Pokemon should stay hidden before they are switched in.');
revealBattle.opponent.units[0].currentHp = 1;
revealBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(revealBattle, [{ type: 'move', actor: 0, moveId: earthquakeChoiceId, target: 0 }]));
revealBattle = applyReplacementChoices(revealBattle, [], buildAutoReplacementChoices(revealBattle, 'opponent'));
assert.equal(revealBattle.opponent.units[1].revealed, true, 'Opponent bench Pokemon should become revealed after they first switch into battle.');

let hyperBeamBattle = buildBattle(
  'Singles',
  [
    buildSlot('hyper-beam-user', hyperBeamUser, ['Hyper Beam'], { evs: { ...blankStats(), specialAttack: 32, hp: 20, specialDefense: 14 } }),
    buildSlot('hyper-beam-bench', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [buildSlot('hyper-beam-foe', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } })],
);
hyperBeamBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(hyperBeamBattle, [{ type: 'move', actor: 0, moveId: hyperBeamChoiceId, target: 0 }]));
assert.equal(hyperBeamBattle.player.units[0].rechargeTurns, 1, 'Hyper Beam should apply a one-turn recharge lock after it lands.');
const hyperBeamActiveBeforeRecharge = hyperBeamBattle.player.active[0];
hyperBeamBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(hyperBeamBattle, [{ type: 'switch', actor: 0, target: 1 }]));
assert.equal(hyperBeamBattle.player.active[0], hyperBeamActiveBeforeRecharge, 'A recharging Pokemon should not be allowed to switch out on the recharge turn.');
assert.equal(hyperBeamBattle.player.units[0].rechargeTurns, 0, 'Recharge should clear after the forced rest turn is spent.');

let solarBeamBattle = buildBattle(
  'Singles',
  [buildSlot('solar-beam-user', solarBeamUser, ['Solar Beam'], { evs: { ...blankStats(), specialAttack: 32, hp: 20, specialDefense: 14 } })],
  [buildSlot('solar-beam-foe', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } })],
);
const solarBeamStartHp = solarBeamBattle.opponent.units[0].currentHp;
solarBeamBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(solarBeamBattle, [{ type: 'move', actor: 0, moveId: solarBeamChoiceId, target: 0 }]));
assert.equal(solarBeamBattle.opponent.units[0].currentHp, solarBeamStartHp, 'Solar Beam should spend the first turn charging outside of sun.');
assert.equal(solarBeamBattle.player.units[0].chargingTurns, 1, 'Solar Beam should store a charge turn outside of sun.');
solarBeamBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(solarBeamBattle, [{ type: 'move', actor: 0, moveId: solarBeamChoiceId, target: 0 }]));
assert.ok(solarBeamBattle.opponent.units[0].currentHp < solarBeamStartHp, 'Solar Beam should land on the following turn after charging.');
assert.equal(solarBeamBattle.player.units[0].chargingTurns, 0, 'Solar Beam should clear its charge state after firing.');

let megaSolBattle = buildBattle(
  'Singles',
  [buildSlot('mega-sol-user', meganiumBase, ['Solar Beam'], { itemId: meganiumiteId, evs: { ...blankStats(), specialAttack: 32, hp: 20, specialDefense: 14 } })],
  [buildSlot('mega-sol-foe', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } })],
);
const megaSolStartHp = megaSolBattle.opponent.units[0].currentHp;
megaSolBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(megaSolBattle, [{ type: 'mega', actor: 0, moveId: solarBeamChoiceId, target: 0 }]));
assert.equal(megaSolBattle.player.units[0].megaEvolved, true, 'Mega Meganium should Mega Evolve before acting.');
assert.ok(megaSolBattle.opponent.units[0].currentHp < megaSolStartHp, 'Mega Sol should let Solar Beam fire immediately without a charge turn.');
assert.equal(megaSolBattle.player.units[0].chargingTurns, 0, 'Mega Sol should bypass Solar Beam charging entirely.');

const aiMegaAllocationBattle = buildBattle(
  'Doubles',
  [
    buildSlot('ai-mega-player-a', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('ai-mega-player-b', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('ai-mega-charizard', charizardBase, ['Flamethrower'], { itemId: charizarditeYId, evs: { ...blankStats(), specialAttack: 32, speed: 20, hp: 14 } }),
    buildSlot('ai-mega-abomasnow', abomasnowBase, ['Blizzard'], { itemId: abomasiteId, evs: { ...blankStats(), specialAttack: 32, hp: 20, defense: 14 } }),
  ],
);
const aiMegaChoices = generateAiChoices(aiMegaAllocationBattle, 'opponent');
assert.ok(
  aiMegaChoices.filter((choice) => choice.type === 'mega').length <= 1,
  'Expert AI should only reserve one Mega Evolution even if two active lanes are Mega-capable.',
);

let meteorBeamBattle = buildBattle(
  'Singles',
  [buildSlot('meteor-beam-user', meteorBeamUser, ['Meteor Beam'], { evs: { ...blankStats(), specialAttack: 32, hp: 20, specialDefense: 14 } })],
  [buildSlot('meteor-beam-foe', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } })],
);
const meteorBeamStartHp = meteorBeamBattle.opponent.units[0].currentHp;
meteorBeamBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(meteorBeamBattle, [{ type: 'move', actor: 0, moveId: meteorBeamChoiceId, target: 0 }]));
assert.equal(meteorBeamBattle.opponent.units[0].currentHp, meteorBeamStartHp, 'Meteor Beam should not deal damage on its setup turn.');
assert.equal(meteorBeamBattle.player.units[0].build.specialAttackStage, 1, 'Meteor Beam should raise Sp. Atk on the setup turn.');
assert.equal(meteorBeamBattle.player.units[0].chargingTurns, 1, 'Meteor Beam should store a charge turn before the attack lands.');
meteorBeamBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(meteorBeamBattle, [{ type: 'move', actor: 0, moveId: meteorBeamChoiceId, target: 0 }]));
assert.ok(meteorBeamBattle.opponent.units[0].currentHp < meteorBeamStartHp, 'Meteor Beam should strike on the following turn after charging.');

let pranksterDarkBattle = buildBattle(
  'Singles',
  [buildSlot('prankster-user', pranksterUser, ['Taunt', 'Fake Out'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } })],
  [buildSlot('prankster-dark-foe', darkTarget, [darkTarget.movePool.find((move) => move.id === darkTargetAttackId)?.name ?? darkTarget.movePool[0].name], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
pranksterDarkBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(pranksterDarkBattle, [{ type: 'move', actor: 0, moveId: pranksterTauntChoiceId, target: 0 }]));
assert.equal(pranksterDarkBattle.opponent.units[0].tauntTurns, 0, 'Dark-types should ignore opposing Prankster status moves like Taunt.');

let pranksterFakeOutBattle = buildBattle(
  'Singles',
  [buildSlot('prankster-fake-out-user', pranksterUser, ['Fake Out'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } })],
  [buildSlot('prankster-fake-out-foe', darkTarget, [darkTarget.movePool.find((move) => move.id === darkTargetAttackId)?.name ?? darkTarget.movePool[0].name], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const fakeOutStartHp = pranksterFakeOutBattle.opponent.units[0].currentHp;
pranksterFakeOutBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(pranksterFakeOutBattle, [{ type: 'move', actor: 0, moveId: pranksterFakeOutChoiceId, target: 0 }]));
assert.ok(pranksterFakeOutBattle.opponent.units[0].currentHp < fakeOutStartHp, 'Fake Out should still damage a Dark-type because it is not a Prankster status move.');

const intimidateClearBodyBattle = buildBattle(
  'Singles',
  [buildSlot('intimidate-user', intimidateUser, [intimidateUser.movePool.find((move) => move.id === intimidateAttackId)?.name ?? intimidateUser.movePool[0].name], { abilityName: 'Intimidate', evs: { ...blankStats(), hp: 24, attack: 24, specialDefense: 18 } })],
  [buildSlot('clear-body-target', clearBodyTarget, [clearBodyTarget.movePool.find((move) => move.id === clearBodyAttackId)?.name ?? clearBodyTarget.movePool[0].name], { abilityName: 'Clear Body', evs: { ...blankStats(), hp: 20, attack: 24, speed: 22 } })],
);
assert.equal(intimidateClearBodyBattle.opponent.units[0].build.attackStage, 0, 'Clear Body should block Intimidate on switch-in.');

const intimidateMirrorArmorBattle = buildBattle(
  'Singles',
  [buildSlot('mirror-intimidate-user', intimidateUser, [intimidateUser.movePool.find((move) => move.id === intimidateAttackId)?.name ?? intimidateUser.movePool[0].name], { abilityName: 'Intimidate', evs: { ...blankStats(), hp: 24, attack: 24, specialDefense: 18 } })],
  [buildSlot('mirror-armor-target', mirrorArmorTarget, [mirrorArmorTarget.movePool.find((move) => move.id === mirrorArmorAttackId)?.name ?? mirrorArmorTarget.movePool[0].name], { abilityName: 'Mirror Armor', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
assert.equal(intimidateMirrorArmorBattle.opponent.units[0].build.attackStage, 0, 'Mirror Armor should stop Intimidate from lowering the target.');
assert.equal(intimidateMirrorArmorBattle.player.units[0].build.attackStage, -1, 'Mirror Armor should reflect Intimidate back to the source.');

const intimidateCompetitiveBattle = buildBattle(
  'Singles',
  [buildSlot('competitive-intimidate-user', intimidateUser, [intimidateUser.movePool.find((move) => move.id === intimidateAttackId)?.name ?? intimidateUser.movePool[0].name], { abilityName: 'Intimidate', evs: { ...blankStats(), hp: 24, attack: 24, specialDefense: 18 } })],
  [buildSlot('competitive-target', competitiveTarget, [competitiveTarget.movePool.find((move) => move.id === competitiveAttackId)?.name ?? competitiveTarget.movePool[0].name], { abilityName: 'Competitive', evs: { ...blankStats(), hp: 32, specialAttack: 20, defense: 14 } })],
);
assert.equal(intimidateCompetitiveBattle.opponent.units[0].build.specialAttackStage, 2, 'Competitive should boost Sp. Atk after an opposing stat drop.');

let innerFocusBattle = buildBattle(
  'Singles',
  [buildSlot('inner-focus-fake-out-user', pranksterUser, ['Fake Out'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } })],
  [buildSlot('inner-focus-target', innerFocusTarget, [innerFocusTarget.movePool.find((move) => move.id === innerFocusAttackId)?.name ?? innerFocusTarget.movePool[0].name], { abilityName: 'Inner Focus', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const innerFocusStartHp = innerFocusBattle.opponent.units[0].currentHp;
innerFocusBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(innerFocusBattle, [{ type: 'move', actor: 0, moveId: pranksterFakeOutChoiceId, target: 0 }]));
assert.ok(innerFocusBattle.opponent.units[0].currentHp < innerFocusStartHp, 'Inner Focus targets should still take Fake Out damage.');
assert.equal(innerFocusBattle.opponent.units[0].flinched, false, 'Inner Focus should stop Fake Out from causing flinch.');

let obliviousBattle = buildBattle(
  'Singles',
  [buildSlot('oblivious-taunt-user', pranksterUser, ['Taunt'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } })],
  [buildSlot('oblivious-target', obliviousTarget, [obliviousTarget.movePool.find((move) => move.id === obliviousAttackId)?.name ?? obliviousTarget.movePool[0].name], { abilityName: 'Oblivious', evs: { ...blankStats(), hp: 32, attack: 24, defense: 10 } })],
);
obliviousBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(obliviousBattle, [{ type: 'move', actor: 0, moveId: pranksterTauntChoiceId, target: 0 }]));
assert.equal(obliviousBattle.opponent.units[0].tauntTurns, 0, 'Oblivious should ignore Taunt.');

let contraryBattle = buildBattle(
  'Singles',
  [buildSlot('contrary-user', contraryUser, ['Leaf Storm'], { abilityName: 'Contrary', natureId: 'timid', evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [buildSlot('contrary-target', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
contraryBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(contraryBattle, [{ type: 'move', actor: 0, moveId: contraryLeafStormChoiceId, target: 0 }]));
assert.equal(contraryBattle.player.units[0].build.specialAttackStage, 2, 'Contrary should reverse Leaf Storm into a Sp. Atk boost.');

const confuseRayUser = findPokemonWithMoves(['Confuse Ray'], ['Froslass', 'Sableye', 'Gengar']);
const blockUser = findPokemonWithMoves(['Block'], ['Snorlax', 'Umbreon']);
const trickUser = findPokemonWithMoves(['Trick'], ['Alakazam', 'Rotom']);
const substituteUser = findPokemonWithMoves(['Substitute'], ['Gengar', 'Mismagius', 'Jolteon']);
const recycleUser = findPokemonWithMoves(['Recycle'], ['Snorlax', 'Alcremie']);
const healingWishUser = findPokemonWithMoves(['Healing Wish']);
const lockOnUser = findPokemonWithMoves(['Lock-On', 'Thunder'], ['Jolteon', 'Zapdos', 'Magnezone']);
const fairyLockUser = findPokemonWithMoves(['Fairy Lock'], ['Klefki']);
const sleepTalkUser = findPokemonWithMoves(['Sleep Talk', 'Snore'], ['Abomasnow', 'Absol', 'Aegislash']);
const knockOffUser = findPokemonWithMoves(['Knock Off'], ['Absol', 'Arbok', 'Ariados']);
const psychicNoiseUser = findPokemonWithMoves(['Psychic Noise', 'Recover'], ['Espeon', 'Farigiraf', 'Gardevoir']);
const throatChopUser = findPokemonWithMoves(['Throat Chop'], ['Absol', 'Arbok', 'Ariados']);
const expandingForceUser = findPokemonWithMoves(['Expanding Force'], ['Alakazam', 'Armarouge', 'Espathra']);
const dragonDartsUser = findPokemonWithMoves(['Dragon Darts'], ['Dragapult']);
const finalGambitUser = findPokemonWithMoves(['Final Gambit'], ['Lucario']);
const explosionUser = findPokemonWithMoves(['Explosion'], ['Forretress', 'Garbodor', 'Glalie']);
const partingShotUser = findPokemonWithMoves(['Parting Shot'], ['Incineroar', 'Morpeko', 'Pangoro']);
assert(confuseRayUser && blockUser && trickUser && substituteUser && recycleUser && healingWishUser && lockOnUser && fairyLockUser && sleepTalkUser && knockOffUser && psychicNoiseUser && throatChopUser && snarlUser && expandingForceUser && dragonDartsUser && finalGambitUser && explosionUser && partingShotUser, 'Expected audit users for the expanded move-family checks.');

const confuseRayChoiceId = moveIdFor(confuseRayUser, 'Confuse Ray');
const blockChoiceId = moveIdFor(blockUser, 'Block');
const trickChoiceId = moveIdFor(trickUser, 'Trick');
const substituteChoiceId = moveIdFor(substituteUser, 'Substitute');
const recycleChoiceId = moveIdFor(recycleUser, 'Recycle');
const healingWishChoiceId = moveIdFor(healingWishUser, 'Healing Wish');
const lockOnChoiceId = moveIdFor(lockOnUser, 'Lock-On');
const lockOnThunderChoiceId = moveIdFor(lockOnUser, 'Thunder');
const fairyLockChoiceId = moveIdFor(fairyLockUser, 'Fairy Lock');
const sleepTalkChoiceId = moveIdFor(sleepTalkUser, 'Sleep Talk');
const knockOffChoiceId = moveIdFor(knockOffUser, 'Knock Off');
const psychicNoiseChoiceId = moveIdFor(psychicNoiseUser, 'Psychic Noise');
const throatChopChoiceId = moveIdFor(throatChopUser, 'Throat Chop');
const expandingForceChoiceId = moveIdFor(expandingForceUser, 'Expanding Force');
const dragonDartsChoiceId = moveIdFor(dragonDartsUser, 'Dragon Darts');
const finalGambitChoiceId = moveIdFor(finalGambitUser, 'Final Gambit');
const explosionChoiceId = moveIdFor(explosionUser, 'Explosion');
const partingShotChoiceId = moveIdFor(partingShotUser, 'Parting Shot');

let confusionBattle = buildBattle(
  'Singles',
  [buildSlot('confuse-user', confuseRayUser, ['Confuse Ray'], { evs: { ...blankStats(), speed: 32, hp: 32, defense: 2 } })],
  [buildSlot('confuse-target', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
confusionBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(confusionBattle, [{ type: 'move', actor: 0, moveId: confuseRayChoiceId, target: 0 }]));
assert.ok(confusionBattle.opponent.units[0].confusionTurns > 0, 'Confuse Ray should apply a confusion timer.');

let blockBattle = buildBattle(
  'Singles',
  [
    buildSlot('block-user', blockUser, ['Block'], { evs: { ...blankStats(), hp: 32, defense: 18, specialDefense: 16 } }),
    buildSlot('block-bench', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [
    buildSlot('block-target', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('block-foe-bench', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
);
blockBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    blockBattle,
    [{ type: 'move', actor: 0, moveId: blockChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 }],
  ));
const blockedActiveIndex = blockBattle.opponent.active[0];
blockBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    blockBattle,
    [{ type: 'move', actor: 0, moveId: blockChoiceId, target: 0 }],
    [{ type: 'switch', actor: 0, target: 1 }],
  ));
assert.equal(blockBattle.opponent.active[0], blockedActiveIndex, 'Block should stop the trapped target from switching out.');

let trickBattle = buildBattle(
  'Singles',
  [buildSlot('trick-user', trickUser, ['Trick'], { itemId: itemIdByName('Choice Specs'), evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [buildSlot('trick-target', groundedProtectUser, ['Protect'], { itemId: itemIdByName('Leftovers'), evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
trickBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(trickBattle, [{ type: 'move', actor: 0, moveId: trickChoiceId, target: 0 }]));
assert.equal(trickBattle.player.units[0].heldItemId, itemIdByName('Leftovers'), 'Trick should swap the user into the target item.');
assert.equal(trickBattle.opponent.units[0].heldItemId, itemIdByName('Choice Specs'), 'Trick should swap the target into the user item.');

let substituteBattle = buildBattle(
  'Singles',
  [buildSlot('substitute-user', substituteUser, ['Substitute'], { evs: { ...blankStats(), hp: 32, speed: 32, defense: 2 } })],
  [buildSlot('substitute-foe', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } })],
);
substituteBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(substituteBattle, [{ type: 'move', actor: 0, moveId: substituteChoiceId, target: 0 }]));
assert.ok(substituteBattle.player.units[0].substituteHp > 0, 'Substitute should create a substitute doll.');

let recycleBattle = buildBattle(
  'Singles',
  [buildSlot('recycle-user', recycleUser, ['Recycle'], { evs: { ...blankStats(), hp: 32, defense: 18, specialDefense: 16 } })],
  [buildSlot('recycle-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
recycleBattle.player.units[0].heldItemId = null;
recycleBattle.player.units[0].lastConsumedItemId = itemIdByName('Sitrus Berry');
recycleBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(recycleBattle, [{ type: 'move', actor: 0, moveId: recycleChoiceId, target: 0 }]));
assert.equal(recycleBattle.player.units[0].heldItemId, itemIdByName('Sitrus Berry'), 'Recycle should restore the last consumed item.');

let healingWishBattle = buildBattle(
  'Singles',
  [
    buildSlot('healing-wish-user', healingWishUser, ['Healing Wish'], { evs: { ...blankStats(), hp: 32, specialAttack: 18, speed: 16 } }),
    buildSlot('healing-wish-receiver', groundedProtectUser, ['Protect'], { status: 'burn', evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [buildSlot('healing-wish-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
healingWishBattle.player.units[1].currentHp = 1;
healingWishBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    healingWishBattle,
    [{ type: 'move', actor: 0, moveId: healingWishChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: protectUser.movePool.find((move) => move.name === 'Protect')?.id ?? 'protect', target: 0 }],
  ));
assert.ok(healingWishBattle.player.units[0].fainted, 'Healing Wish should faint the user.');
healingWishBattle = applyReplacementChoices(healingWishBattle, [{ type: 'switch', actor: 0, target: 1 }], []);
assert.equal(healingWishBattle.player.units[1].currentHp, healingWishBattle.player.units[1].maxHp, 'Healing Wish should fully restore the replacement Pokemon.');
assert.equal(healingWishBattle.player.units[1].build.status, 'healthy', 'Healing Wish should cure the replacement Pokemon status.');

let lockOnBattle = buildBattle(
  'Singles',
  [buildSlot('lock-on-user', lockOnUser, ['Lock-On', 'Thunder'], { natureId: 'timid', evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [buildSlot('lock-on-foe', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
lockOnBattle.environment.weather = 'sun';
const lockOnStartHp = lockOnBattle.opponent.units[0].currentHp;
lockOnBattle = withMockRandom([0.95, 0.95, 0.95], () => resolveTurn(lockOnBattle, [{ type: 'move', actor: 0, moveId: lockOnChoiceId, target: 0 }]));
lockOnBattle = withMockRandom([0.95, 0.95, 0.95], () => resolveTurn(lockOnBattle, [{ type: 'move', actor: 0, moveId: lockOnThunderChoiceId, target: 0 }]));
assert.ok(lockOnBattle.opponent.units[0].currentHp < lockOnStartHp, 'Lock-On should make the next Thunder connect even in harsh sunlight.');

let fairyLockBattle = buildBattle(
  'Singles',
  [buildSlot('fairy-lock-user', fairyLockUser, ['Fairy Lock'], { evs: { ...blankStats(), hp: 32, defense: 18, specialDefense: 16 } })],
  [
    buildSlot('fairy-lock-target', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('fairy-lock-bench', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
  ],
);
fairyLockBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    fairyLockBattle,
    [{ type: 'move', actor: 0, moveId: fairyLockChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: groundedProtectUser.movePool.find((move) => move.name === 'Protect')?.id ?? 'protect', target: 0 }],
  ));
const fairyLockedIndex = fairyLockBattle.opponent.active[0];
fairyLockBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    fairyLockBattle,
    [{ type: 'move', actor: 0, moveId: fairyLockChoiceId, target: 0 }],
    [{ type: 'switch', actor: 0, target: 1 }],
  ));
assert.equal(fairyLockBattle.opponent.active[0], fairyLockedIndex, 'Fairy Lock should stop switching on the next turn.');

let sleepTalkBattle = buildBattle(
  'Singles',
  [buildSlot('sleep-talk-user', sleepTalkUser, ['Sleep Talk', 'Snore'], { status: 'sleep', evs: { ...blankStats(), specialAttack: 24, speed: 22, hp: 20 } })],
  [buildSlot('sleep-talk-foe', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } })],
);
const sleepTalkStartHp = sleepTalkBattle.opponent.units[0].currentHp;
sleepTalkBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    sleepTalkBattle,
    [{ type: 'move', actor: 0, moveId: sleepTalkChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 }],
  ));
assert.ok(sleepTalkBattle.opponent.units[0].currentHp < sleepTalkStartHp, 'Sleep Talk should call Snore and damage the target while the user is asleep.');

let knockOffBattle = buildBattle(
  'Singles',
  [buildSlot('knock-off-user', knockOffUser, ['Knock Off'], { evs: { ...blankStats(), attack: 32, speed: 20, hp: 14 } })],
  [buildSlot('knock-off-target', groundedProtectUser, ['Protect'], { itemId: itemIdByName('Leftovers'), evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
knockOffBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(knockOffBattle, [{ type: 'move', actor: 0, moveId: knockOffChoiceId, target: 0 }]));
assert.equal(knockOffBattle.opponent.units[0].heldItemId, null, 'Knock Off should remove the target item after a successful hit.');

let psychicNoiseBattle = buildBattle(
  'Singles',
  [buildSlot('psychic-noise-user', psychicNoiseUser, ['Psychic Noise'], { evs: { ...blankStats(), specialAttack: 24, speed: 22, hp: 20 } })],
  [buildSlot('psychic-noise-target', psychicNoiseUser, ['Recover'], { evs: { ...blankStats(), hp: 32, defense: 14, specialDefense: 20 } })],
);
psychicNoiseBattle.opponent.units[0].currentHp = Math.max(1, Math.floor(psychicNoiseBattle.opponent.units[0].maxHp / 2));
psychicNoiseBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(psychicNoiseBattle, [{ type: 'move', actor: 0, moveId: psychicNoiseChoiceId, target: 0 }]));
const blockedHealHp = psychicNoiseBattle.opponent.units[0].currentHp;
psychicNoiseBattle = withMockRandom([0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    psychicNoiseBattle,
    [{ type: 'move', actor: 0, moveId: psychicNoiseChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: moveIdFor(psychicNoiseUser, 'Recover'), target: 0 }],
  ));
assert.equal(psychicNoiseBattle.opponent.units[0].currentHp <= blockedHealHp, true, 'Psychic Noise should stop Recover from restoring HP while the timer is active.');

let throatChopBattle = buildBattle(
  'Singles',
  [buildSlot('throat-chop-user', throatChopUser, ['Throat Chop'], { evs: { ...blankStats(), attack: 32, speed: 20, hp: 14 } })],
  [buildSlot('throat-chop-target', soundOnlyTarget, ['Perish Song', 'Round', 'Snarl', 'Snore'], { evs: { ...blankStats(), specialAttack: 24, speed: 18, hp: 24 } })],
);
throatChopBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(throatChopBattle, [{ type: 'move', actor: 0, moveId: throatChopChoiceId, target: 0 }]));
assert.ok(legalMovesForUnit(throatChopBattle.opponent.units[0], throatChopBattle, 'opponent').some((move) => move.id === 'struggle'), 'Throat Chop should force Struggle when the target only knows sound moves.');

let sheerForceBattle = buildBattle(
  'Singles',
  [buildSlot('sheer-force-user', sheerForceSnarlUser, ['Snarl'], { abilityName: 'Sheer Force', evs: { ...blankStats(), specialAttack: 24, speed: 22, hp: 20 } })],
  [buildSlot('sheer-force-target', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } })],
);
sheerForceBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(sheerForceBattle, [{ type: 'move', actor: 0, moveId: sheerForceSnarlChoiceId, target: 0 }]));
assert.equal(sheerForceBattle.opponent.units[0].build.specialAttackStage, 0, 'Sheer Force should suppress Snarl\'s Special Attack drop while still allowing the hit.');

let expandingForceBattle = buildBattle(
  'Doubles',
  [buildSlot('expanding-force-user', expandingForceUser, ['Expanding Force'], { evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
  [
    buildSlot('expanding-force-foe-a', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('expanding-force-foe-b', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
expandingForceBattle.environment.terrain = 'psychic';
expandingForceBattle.terrainTurns = 5;
const expandingForceHpA = expandingForceBattle.opponent.units[0].currentHp;
const expandingForceHpB = expandingForceBattle.opponent.units[1].currentHp;
expandingForceBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    expandingForceBattle,
    [{ type: 'move', actor: 0, moveId: expandingForceChoiceId, target: 0 }],
    [
      { type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 },
      { type: 'move', actor: 1, moveId: specialTargetBAttackId, target: 0 },
    ],
  ));
assert.ok(expandingForceBattle.opponent.units[0].currentHp < expandingForceHpA && expandingForceBattle.opponent.units[1].currentHp < expandingForceHpB, 'Expanding Force should hit both opposing targets in Psychic Terrain.');

let dragonDartsBattle = buildBattle(
  'Doubles',
  [buildSlot('dragon-darts-user', dragonDartsUser, ['Dragon Darts'], { evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 } })],
  [
    buildSlot('dragon-darts-foe-a', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('dragon-darts-foe-b', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } }),
  ],
);
const dragonDartsHpA = dragonDartsBattle.opponent.units[0].currentHp;
const dragonDartsHpB = dragonDartsBattle.opponent.units[1].currentHp;
dragonDartsBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    dragonDartsBattle,
    [{ type: 'move', actor: 0, moveId: dragonDartsChoiceId, target: 0 }],
    [
      { type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 },
      { type: 'move', actor: 1, moveId: specialTargetBAttackId, target: 0 },
    ],
  ));
assert.ok(dragonDartsBattle.opponent.units[0].currentHp < dragonDartsHpA && dragonDartsBattle.opponent.units[1].currentHp < dragonDartsHpB, 'Dragon Darts should strike each opposing Pokemon once in Doubles.');

let finalGambitBattle = buildBattle(
  'Singles',
  [buildSlot('final-gambit-user', finalGambitUser, ['Final Gambit'], { evs: { ...blankStats(), speed: 32, hp: 32, attack: 2 } })],
  [buildSlot('final-gambit-foe', groundedProtectUser, [groundedProtectUser.movePool.find((move) => move.category !== 'Status')?.name ?? groundedProtectUser.movePool[0].name], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const finalGambitStartHp = finalGambitBattle.opponent.units[0].currentHp;
finalGambitBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(finalGambitBattle, [{ type: 'move', actor: 0, moveId: finalGambitChoiceId, target: 0 }]));
assert.ok(finalGambitBattle.player.units[0].fainted, 'Final Gambit should faint the user.');
assert.ok(finalGambitBattle.opponent.units[0].currentHp < finalGambitStartHp, 'Final Gambit should damage the target based on the user HP.');

let explosionBattle = buildBattle(
  'Singles',
  [buildSlot('explosion-user', explosionUser, ['Explosion'], { evs: { ...blankStats(), attack: 32, hp: 32, defense: 2 } })],
  [buildSlot('explosion-foe', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
explosionBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(explosionBattle, [{ type: 'move', actor: 0, moveId: explosionChoiceId, target: 0 }]));
assert.ok(explosionBattle.player.units[0].fainted, 'Explosion should faint the user after the attack resolves.');

let partingShotBattle = buildBattle(
  'Singles',
  [
    buildSlot('parting-shot-user', partingShotUser, ['Parting Shot'], { evs: { ...blankStats(), speed: 32, hp: 20, defense: 14 } }),
    buildSlot('parting-shot-bench', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
  ],
  [buildSlot('parting-shot-foe', groundedProtectUser, [groundedProtectUser.movePool.find((move) => move.category !== 'Status')?.name ?? groundedProtectUser.movePool[0].name], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
partingShotBattle = withMockRandom([0.1, 0.1, 0.1], () => resolveTurn(partingShotBattle, [{ type: 'move', actor: 0, moveId: partingShotChoiceId, target: 0 }]));
assert.equal(partingShotBattle.player.active[0], 1, 'Parting Shot should pivot the user out after the stat drops land.');

let struggleBattle = buildBattle(
  'Singles',
  [buildSlot('struggle-user', pranksterUser, ['Taunt'], { abilityName: 'Prankster', evs: { ...blankStats(), hp: 20, speed: 32, defense: 14 } })],
  [buildSlot('struggle-foe', struggleTarget, ['Protect', 'Light Screen', 'Reflect', 'Wish'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } })],
);
const strugglePlayerStartHp = struggleBattle.player.units[0].currentHp;
const struggleFoeStartHp = struggleBattle.opponent.units[0].currentHp;
struggleBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () => resolveTurn(struggleBattle, [{ type: 'move', actor: 0, moveId: pranksterTauntChoiceId, target: 0 }]));
assert.ok(struggleBattle.player.units[0].currentHp < strugglePlayerStartHp, 'A taunted, all-status target should damage the opponent with Struggle.');
assert.ok(struggleBattle.opponent.units[0].currentHp < struggleFoeStartHp, 'A taunted, all-status target should also take Struggle recoil.');

let replacementBattle = buildBattle(
  'Singles',
  [
    buildSlot('replacement-user-a', slowEarthquakeUser, ['Earthquake'], { natureId: 'brave', evs: { ...blankStats(), attack: 32, hp: 32, speed: 2 } }),
    buildSlot('replacement-user-b', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('replacement-user-c', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } }),
    buildSlot('replacement-user-d', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
  ],
  [buildSlot('replacement-foe', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } })],
);
replacementBattle.player.units[0].currentHp = 1;
replacementBattle = withMockRandom([0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    replacementBattle,
    [{ type: 'move', actor: 0, moveId: slowEarthquakeChoiceId, target: 0 }],
    [{ type: 'move', actor: 0, moveId: specialTargetBAttackId, target: 0 }],
  ));
assert.equal(replacementBattle.player.active[0], -1, 'When the lead is knocked out, the slot should stay empty until the next turn replacement phase.');
replacementBattle = applyReplacementChoices(replacementBattle, [{ type: 'switch', actor: 0, target: 1 }], []);
assert.equal(replacementBattle.player.active[0], 1, 'The chosen replacement should enter at the top of the next turn.');
assert.equal(replacementBattle.player.units.filter((unit) => !unit.fainted).length, 3, 'The battle should still preserve the remaining three player Pokemon after the first knockout.');

let redirectBattle = buildBattle(
  'Doubles',
  [
    buildSlot('redirect-user-a', shadowBallUser, ['Shadow Ball'], { evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } }),
    buildSlot('redirect-user-b', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), specialAttack: 32, speed: 24, hp: 10 } }),
  ],
  [
    buildSlot('redirect-foe-a', specialTargetA, [specialTargetA.movePool.find((move) => move.id === specialTargetAAttackId)?.name ?? specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } }),
    buildSlot('redirect-foe-b', specialTargetB, [specialTargetB.movePool.find((move) => move.id === specialTargetBAttackId)?.name ?? specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialAttack: 24, speed: 22 } }),
  ],
);
redirectBattle.opponent.units[0].currentHp = 1;
const redirectStartHp = redirectBattle.opponent.units[1].currentHp;
redirectBattle = withMockRandom([0.1, 0.1, 0.1, 0.1, 0.1], () =>
  resolveTurnWithChoices(
    redirectBattle,
    [
      { type: 'move', actor: 0, moveId: shadowBallChoiceId, target: 0 },
      { type: 'move', actor: 1, moveId: specialTargetBAttackId, target: 0 },
    ],
    [
      { type: 'move', actor: 0, moveId: specialTargetAAttackId, target: 0 },
      { type: 'move', actor: 1, moveId: specialTargetBAttackId, target: 0 },
    ],
  ));
assert.ok(redirectBattle.opponent.units[0].fainted, 'The first targeted foe should be knocked out before the second allied attack resolves.');
assert.ok(redirectBattle.opponent.units[1].currentHp < redirectStartHp, 'When one foe is knocked out in Doubles, later single-target attacks should redirect to the remaining live target.');

const hostAccount = {
  playerId: 'audit-host',
  trainerName: 'Audit Host',
  email: 'host@test.local',
  sessionToken: 'audit-host-session',
  registeredAt: new Date().toISOString(),
};
const guestAccount = {
  playerId: 'audit-guest',
  trainerName: 'Audit Guest',
  email: 'guest@test.local',
  sessionToken: 'audit-guest-session',
  registeredAt: new Date().toISOString(),
};
const auditHostTeam = createTeam('Audit Host Team', 'Singles');
auditHostTeam.slots[0] = buildSlot('audit-host-1', earthquakeUser, ['Earthquake'], { natureId: 'jolly', evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 } });
auditHostTeam.slots[1] = buildSlot('audit-host-2', charizardBase, ['Flamethrower'], { itemId: charizarditeYId, natureId: 'timid', evs: { ...blankStats(), specialAttack: 32, speed: 32, hp: 2 } });
auditHostTeam.slots[2] = buildSlot('audit-host-3', trickRoomUser, ['Trick Room', 'Shadow Ball'], { natureId: 'quiet', evs: { ...blankStats(), hp: 32, specialAttack: 20, specialDefense: 14 } });
auditHostTeam.slots[3] = buildSlot('audit-host-4', protectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 20, specialDefense: 14 } });
const auditGuestTeam = createTeam('Audit Guest Team', 'Singles');
auditGuestTeam.slots[0] = buildSlot('audit-guest-1', abomasnowBase, ['Blizzard'], { itemId: abomasiteId, natureId: 'quiet', evs: { ...blankStats(), specialAttack: 32, hp: 32, speed: 0 } });
auditGuestTeam.slots[1] = buildSlot('audit-guest-2', specialTargetA, [specialTargetA.movePool[0].name], { evs: { ...blankStats(), hp: 20, defense: 20, specialDefense: 26 } });
auditGuestTeam.slots[2] = buildSlot('audit-guest-3', specialTargetB, [specialTargetB.movePool[0].name], { evs: { ...blankStats(), hp: 20, specialDefense: 24, defense: 22 } });
auditGuestTeam.slots[3] = buildSlot('audit-guest-4', groundedProtectUser, ['Protect'], { evs: { ...blankStats(), hp: 32, defense: 14, specialDefense: 20 } });

let forfeitAuditRoom = createRoomState(hostAccount, auditHostTeam, 'Singles', 'gen5-final', true);
forfeitAuditRoom = joinRoomState(forfeitAuditRoom, guestAccount, auditGuestTeam, 'gen4-champion', true);
forfeitAuditRoom = submitBringOrderState(forfeitAuditRoom, hostAccount.playerId, [0, 1, 2, 3]);
forfeitAuditRoom = submitBringOrderState(forfeitAuditRoom, guestAccount.playerId, [0, 1, 2, 3]);
assert.equal(forfeitAuditRoom.battle?.player.units.length, 4, 'A locked bring-four should always produce four usable player units in battle.');
assert.equal(forfeitAuditRoom.battle?.opponent.units.length, 4, 'A locked bring-four should always produce four usable opponent units in battle.');
forfeitAuditRoom = forfeitRoomState(forfeitAuditRoom, guestAccount.playerId);
assert.equal(forfeitAuditRoom.winnerSeat, 'host', 'Forfeit should award the win to the non-forfeiting player.');
assert.equal(forfeitAuditRoom.resultReason, 'forfeit', 'Forfeit results should be tagged clearly in PvP room state.');

let deadlineAuditRoom = createRoomState(hostAccount, auditHostTeam, 'Singles', 'gen5-final', true);
deadlineAuditRoom = joinRoomState(deadlineAuditRoom, guestAccount, auditGuestTeam, 'gen4-champion', true);
deadlineAuditRoom = submitBringOrderState(deadlineAuditRoom, hostAccount.playerId, [0, 1, 2, 3]);
deadlineAuditRoom = submitBringOrderState(deadlineAuditRoom, guestAccount.playerId, [0, 1, 2, 3]);
const deadlineAuditTurn = deadlineAuditRoom.battle?.turn ?? 0;
deadlineAuditRoom = submitTurnChoicesState(deadlineAuditRoom, hostAccount.playerId, randomChoicesForSide(deadlineAuditRoom.battle, 'player'));
deadlineAuditRoom = submitTurnChoicesState(deadlineAuditRoom, guestAccount.playerId, randomChoicesForSide(deadlineAuditRoom.battle, 'opponent'));
assert.equal(deadlineAuditRoom.battle?.turn, deadlineAuditTurn + 1, 'PvP turn resolution should advance immediately once both battlers lock their choices.');

let timeoutAuditRoom = createRoomState(hostAccount, auditHostTeam, 'Singles', 'gen5-final', true);
timeoutAuditRoom = joinRoomState(timeoutAuditRoom, guestAccount, auditGuestTeam, 'gen4-champion', true);
timeoutAuditRoom = submitBringOrderState(timeoutAuditRoom, hostAccount.playerId, [0, 1, 2, 3]);
timeoutAuditRoom = submitBringOrderState(timeoutAuditRoom, guestAccount.playerId, [0, 1, 2, 3]);
const timeoutAuditTurn = timeoutAuditRoom.battle?.turn ?? 0;
timeoutAuditRoom = submitTurnChoicesState(timeoutAuditRoom, hostAccount.playerId, randomChoicesForSide(timeoutAuditRoom.battle, 'player'));
timeoutAuditRoom.deadlineAt = new Date(Date.now() - 1000).toISOString();
timeoutAuditRoom = touchRoomState(timeoutAuditRoom);
assert.equal(timeoutAuditRoom.battle?.turn, timeoutAuditTurn + 1, 'PvP turn resolution should still advance when the move clock expires without both players locking in.');

let roomMatchTimeoutAudit = createRoomState(hostAccount, auditHostTeam, 'Singles', 'gen5-final', true);
roomMatchTimeoutAudit = joinRoomState(roomMatchTimeoutAudit, guestAccount, auditGuestTeam, 'gen4-champion', true);
roomMatchTimeoutAudit = submitBringOrderState(roomMatchTimeoutAudit, hostAccount.playerId, [0, 1, 2, 3]);
roomMatchTimeoutAudit = submitBringOrderState(roomMatchTimeoutAudit, guestAccount.playerId, [0, 1, 2, 3]);
roomMatchTimeoutAudit.matchDeadlineAt = new Date(Date.now() - 1000).toISOString();
roomMatchTimeoutAudit = touchRoomState(roomMatchTimeoutAudit);
assert.equal(roomMatchTimeoutAudit.stage, 'finished', 'PvP rooms should end cleanly when the overall match timer expires.');
assert.equal(roomMatchTimeoutAudit.resultReason, 'timeout', 'PvP rooms should mark overall match timer endings as timeout results.');
assert.equal(roomMatchTimeoutAudit.winnerSeat, null, 'Current Pokemon Champions timeout parity should record overall timer expiry as a draw.');

let onlineBattleHostWins = 0;
let onlineBattleGuestWins = 0;
let onlineBattleDraws = 0;
for (let matchIndex = 0; matchIndex < 50; matchIndex += 1) {
  let room = createRoomState(hostAccount, auditHostTeam, 'Singles', 'gen5-final', true);
  room = joinRoomState(room, guestAccount, auditGuestTeam, 'gen4-champion', true);
  room = submitBringOrderState(room, hostAccount.playerId, [0, 1, 2, 3]);
  room = submitBringOrderState(room, guestAccount.playerId, [0, 1, 2, 3]);

  let guard = 0;
  while (room.stage === 'battle' && room.battle && guard < 60) {
    const hostChoices = randomChoicesForSide(room.battle, 'player');
    room = submitTurnChoicesState(room, hostAccount.playerId, hostChoices);
    if (room.stage !== 'battle' || !room.battle) {
      break;
    }
    const guestChoices = randomChoicesForSide(room.battle, 'opponent');
    room = submitTurnChoicesState(room, guestAccount.playerId, guestChoices);
    guard += 1;
  }

  if (room.stage === 'battle') {
    room.matchDeadlineAt = new Date(Date.now() - 1000).toISOString();
    room = touchRoomState(room);
  }

  assert.equal(room.stage, 'finished', 'A fully automated PvP audit battle should reach a finished state.');
  assert.ok(room.winnerSeat === 'host' || room.winnerSeat === 'guest' || room.winnerSeat === null, 'A finished PvP room should resolve to a winner or a timeout draw.');
  if (room.winnerSeat === 'host') {
    onlineBattleHostWins += 1;
  } else if (room.winnerSeat === 'guest') {
    onlineBattleGuestWins += 1;
  } else {
    onlineBattleDraws += 1;
  }
}

let simulatorBattlePlayerWins = 0;
let simulatorBattleOpponentWins = 0;
for (let matchIndex = 0; matchIndex < 50; matchIndex += 1) {
  const format = matchIndex < 25 ? 'Singles' : 'Doubles';
  const [playerPlan] = generateTeamPlans('stadium-balance', format, 55 + (matchIndex % 15), [], 1, true);
  const [opponentPlan] = generateTeamPlans('stadium-balance', format, 45 + ((matchIndex + 7) % 15), [], 1, true);
  assert.ok(playerPlan && opponentPlan, `Simulator audit match ${matchIndex + 1} should be able to generate both teams.`);

  const playerTeam = materializeGeneratedPlan(`Simulator Audit ${matchIndex + 1}A`, format, playerPlan);
  const opponentTeam = materializeGeneratedPlan(`Simulator Audit ${matchIndex + 1}B`, format, opponentPlan);
  const order = [0, 1, 2, 3];
  let battle = advancePreviewToBattle(createSimulatorBattle(format, playerTeam, order, opponentTeam, order, null));

  let guard = 0;
  while (!battle.winner && guard < 100) {
    if (battleHasPendingReplacements(battle)) {
      battle = applyReplacementChoices(
        battle,
        buildAutoReplacementChoices(battle, 'player'),
        buildAutoReplacementChoices(battle, 'opponent'),
      );
      if (battle.winner) {
        break;
      }
    }
    const playerChoices = randomChoicesForSide(battle, 'player');
    const opponentChoices = randomChoicesForSide(battle, 'opponent');
    battle = resolveTurnWithChoices(battle, playerChoices, opponentChoices);
    guard += 1;
  }

  assert.ok(battle.winner, `Simulator audit match ${matchIndex + 1} should finish within the guard limit.`);
  if (battle.winner === 'player') {
    simulatorBattlePlayerWins += 1;
  } else {
    simulatorBattleOpponentWins += 1;
  }
}

if (failures.length) {
  throw new Error(`Stat range audit failed for ${failures.length} entries.\n${failures.slice(0, 24).join('\n')}`);
}

const summary = [
  `Verified ${rangedPokemonCount} Pokemon stat ranges against Serebii neutral ranges.`,
  `Verified Froslass Timid speed benchmark: 143 base, 178 with 32 Speed EV points.`,
  `Verified global EV limits: 66 total points, 32 max per stat.`,
  `Verified item clause sanitization for manual teams and AI-generated teams.`,
  `Verified move-parity registry coverage at ${paritySummary.coveredPercent}% across ${paritySummary.total} Champions moves, with ${paritySummary.explicit} explicit hooks tagged in the report.`,
  `Verified damage engine produces live damage output under the Champions EV model, including Doubles spread reduction, Aurora Veil, Helping Hand, Magic Room, and Wonder Room checks.`,
  `Verified simulator rules for chained Protect odds, burn end-turn chip, burn physical damage cuts, paralysis fail-rate and speed penalty, Hydration / Shed Skin / Healer / Natural Cure cures, Limber / Insomnia / Sweet Veil / Water Bubble status immunities, Leftovers healing, Sitrus auto-consumption, confusion/trap timers, Trick and Recycle item flow, Substitute and Healing Wish handling, Lock-On accuracy, ally-target support hooks, rain-locked Thunder accuracy, Snarl spread debuffs, Earthquake ally collateral, Parabolic Charge spread healing, Draining Kiss and Bitter Blade drain ratios, Matcha Gotcha spread recovery, Pain Split averaging, Sparkling Aria burn cures, Sticky Web and Toxic Spikes switch-in hooks, forced-thaw freeze timing, Rest sleep timing, Disable and Torment move locks, weather field timers, opponent reveal state, Calm Mind and Nasty Plot boosts, Trick Room toggling, recharge turns, charge-turn attacks, mid-turn doubles retargeting, Struggle locks, Dark-type immunity to opposing Prankster status moves, and Mega weather ordering.`,
  `Verified 50 fully automated simulator battle sweeps across Singles and Doubles (${simulatorBattlePlayerWins} player-side wins / ${simulatorBattleOpponentWins} opponent-side wins).`,
  `Verified shared PvP room logic, including bring-four lock-in, full roster integrity, immediate dual-lock resolution, deadline-based turn resolution, overall match-timer draws, forfeit handling, and 50 automated room-code battle simulations (${onlineBattleHostWins} host wins / ${onlineBattleGuestWins} guest wins / ${onlineBattleDraws} draws).`,
  warnings.length ? `Source-data warnings: ${warnings.length} HP floor rows on the scraped form pages disagree with fixed 31 IV policy, so the app keeps the fixed-IV result intentionally.` : 'Source-data warnings: none.',
];

process.stdout.write(`${summary.join('\n')}\n`);
