import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const workspaceRoot = resolve('.');
const auditDir = resolve(workspaceRoot, '.tmp-audit');
const skipCompile = process.env.AUDIT_SKIP_COMPILE === '1';
const run = (command, args) => execFileSync(command, args, { cwd: workspaceRoot, stdio: 'pipe' });

function parseRange(text) {
  const [low, high] = text.split('-').map((value) => Number.parseInt(value.trim(), 10));
  return [low, high];
}

function statSummary(spread) {
  return Object.values(spread).reduce((sum, value) => sum + Number(value || 0), 0);
}

if (!skipCompile) {
  rmSync(auditDir, { recursive: true, force: true });
  mkdirSync(auditDir, { recursive: true });
}

if (!skipCompile) {
  const tscEntrypoint = resolve(workspaceRoot, 'node_modules/typescript/bin/tsc');
  run(process.execPath, [
    tscEntrypoint,
    'src/lib/champions.ts',
    'src/lib/damage.ts',
    'src/lib/usage.ts',
    'src/lib/ai.ts',
    'src/lib/simulator.ts',
    'src/types.ts',
    '--outDir',
    auditDir,
    '--rootDir',
    'src',
    '--module',
    'CommonJS',
    '--moduleResolution',
    'Node',
    '--target',
    'ES2022',
    '--lib',
    'ES2022,DOM,DOM.Iterable',
    '--resolveJsonModule',
    '--esModuleInterop',
    '--allowSyntheticDefaultImports',
    '--strict',
    'true',
    '--skipLibCheck',
    '--ignoreDeprecations',
    '6.0',
    '--noEmit',
    'false',
    '--ignoreConfig',
  ]);
}

writeFileSync(resolve(auditDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
mkdirSync(resolve(auditDir, 'data'), { recursive: true });
copyFileSync(resolve(workspaceRoot, 'src/data/champions-data.json'), resolve(auditDir, 'data/champions-data.json'));

const auditRequire = createRequire(import.meta.url);
const champions = auditRequire(resolve(auditDir, 'lib/champions.js'));
const damage = auditRequire(resolve(auditDir, 'lib/damage.js'));
const ai = auditRequire(resolve(auditDir, 'lib/ai.js'));
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
  sanitizeTeamForChampions,
  getPokemonById,
} = champions;

const { calculateDamage } = damage;
const { generateTeamPlans } = ai;

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

const garchomp = getPokemonById('garchomp');
const steelix = getPokemonById('steelix');
assert(garchomp && steelix, 'Expected Garchomp and Steelix to exist.');
const attacker = {
  ...makeEmptyBuild('audit-attacker'),
  pokemonId: garchomp.id,
  natureId: 'jolly',
  moveIds: ['earthquake'],
  evs: { ...blankStats(), attack: 32, speed: 32, hp: 2 },
  itemId: 'life-orb',
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

if (failures.length) {
  throw new Error(`Stat range audit failed for ${failures.length} entries.\n${failures.slice(0, 24).join('\n')}`);
}

const summary = [
  `Verified ${rangedPokemonCount} Pokemon stat ranges against Serebii neutral ranges.`,
  `Verified Froslass Timid speed benchmark: 143 base, 178 with 32 Speed EV points.`,
  `Verified global EV limits: 66 total points, 32 max per stat.`,
  `Verified item clause sanitization for manual teams and AI-generated teams.`,
  `Verified damage engine produces live damage output under the Champions EV model.`,
  warnings.length ? `Source-data warnings: ${warnings.length} HP floor rows on the scraped form pages disagree with fixed 31 IV policy, so the app keeps the fixed-IV result intentionally.` : 'Source-data warnings: none.',
];

process.stdout.write(`${summary.join('\n')}\n`);
