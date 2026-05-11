import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { analyzeTeam, archetypeLibrary, describeBuildRole, generateTeamPlans, recommendMoveIds, suggestArchetypesForCore } from './lib/ai';
import {
  battleFormats,
  buildLabel,
  buildStats,
  createDefaultState,
  createTeam,
  dataset,
  defaultEnvironment,
  displaySpriteForPokemon,
  findMegaForm,
  findMegaStoneItem,
  getItemById,
  getNinetalesBiasLabel,
  getPokemonById,
  makeId,
  natures,
  normalizeMoveSelection,
  resolvePokemonForm,
  selectedPokemon,
  statLabels,
  statOrder,
  statusOptions,
  terrainOptions,
  usesMegaSpriteFallback,
  weatherOptions,
} from './lib/champions';
import { calculateDamage, summaryForResult } from './lib/damage';
import { clearState, loadState, saveState } from './lib/storage';
import { advancePreviewToBattle, createSimulatorBattle, resolveTurn } from './lib/simulator';
import { getMoveUsageInsight, getPokemonUsageInsight, getPopularPresetPatch, getPopularPresetSummary } from './lib/usage';
import type {
  BattleFormat,
  BattleTab,
  EnvironmentState,
  GeneratedTeamPlan,
  LayoutMode,
  PokemonBuild,
  PokemonEntry,
  Team,
} from './types';
import type { SimulatorBattleState, SimulatorChoice } from './lib/simulator';

type SimulatorPreviewState = {
  format: BattleFormat;
  opponentTeam: Team;
  opponentOrder: number[];
  previewEndsAt: number;
};

type ChoiceDraft = {
  type: 'move' | 'switch';
  moveId: string;
  target: number;
  switchTarget: number;
};

const appTabs: { id: BattleTab; label: string; short: string; description: string }[] = [
  { id: 'team-builder', label: 'Team Builder', short: 'Build', description: 'Craft, label, and save up to ten squads.' },
  { id: 'damage-lab', label: 'Damage Lab', short: 'Calc', description: 'Run both-way damage lines with items and Mega toggles.' },
  { id: 'pokedex', label: 'Champions Dex', short: 'Dex', description: 'Browse move pools, abilities, items, and Mega data.' },
  { id: 'ai-builder', label: 'AI Builder', short: 'AI', description: 'Generate meta, anti-meta, and random team plans around your core.' },
  { id: 'analyzer', label: 'Analyzer', short: 'Scan', description: 'Surface survivability, threats, roles, and bring-four ideas.' },
  { id: 'simulator', label: 'Simulator', short: 'Sim', description: 'Preview matchups, pick four, and play a live battle sandbox.' },
  { id: 'profile', label: 'Profile', short: 'Save', description: 'Manage your trainer profile and local save data.' },
];

const brandPokemonIcons = ['Bellibolt', 'Jolteon', 'Sableye', 'Gengar', 'Mega Alakazam', 'Mega Clefable', 'Garchomp'];
const layoutModes: LayoutMode[] = ['Auto', 'Stretch', 'Focus'];

function copyBuild(build: PokemonBuild): PokemonBuild {
  return {
    ...build,
    evs: { ...build.evs },
    moveIds: [...build.moveIds],
  };
}

function cloneTeam(team: Team): Team {
  return {
    ...team,
    slots: team.slots.map(copyBuild),
  };
}

function activeTeamFromState(state: ReturnType<typeof createDefaultState>) {
  return state.teams.find((team) => team.id === state.activeTeamId) ?? state.teams[0];
}

function pickerLabel(pokemon: PokemonEntry) {
  return `#${String(pokemon.dexNumber).padStart(4, '0')} ${pokemon.displayName}`;
}

function defaultAbilityName(pokemon: PokemonEntry | null) {
  return pokemon?.abilities[0]?.name ?? null;
}

function availableItemsForPokemon(pokemon: PokemonEntry | null) {
  return dataset.items.filter((item) => {
    if (item.category === 'held' || item.category === 'berry') {
      return true;
    }

    if (item.category === 'mega-stone' && pokemon) {
      return item.effect.includes(` ${pokemon.baseSpecies} `) || item.effect.includes(`${pokemon.baseSpecies}.`) || item.effect.includes(`${pokemon.baseSpecies} holding`);
    }

    return false;
  });
}

function describeMegaState(build: PokemonBuild, pokemon: PokemonEntry | null) {
  const megaStone = findMegaStoneItem(pokemon);
  if (!megaStone) {
    return 'No Mega option';
  }

  return build.useMega ? `Mega live via ${megaStone.name}` : `Mega ready via ${megaStone.name}`;
}

function prepareBuildForPokemon(build: PokemonBuild, pokemonId: string | null, format: BattleFormat) {
  const pickedPokemon = getPokemonById(pokemonId);
  const chosenPokemon =
    pickedPokemon?.isMega
      ? dataset.pokemon.find((entry) => entry.baseSpecies === pickedPokemon.baseSpecies && !entry.isMega) ?? pickedPokemon
      : pickedPokemon;
  const nextBuild = copyBuild(build);
  nextBuild.pokemonId = chosenPokemon?.id ?? null;
  nextBuild.useMega = false;
  nextBuild.abilityName = defaultAbilityName(chosenPokemon);

  if (nextBuild.itemId && getItemById(nextBuild.itemId)?.category === 'mega-stone') {
    nextBuild.itemId = null;
  }

  const presetPatch = chosenPokemon ? getPopularPresetPatch(pickedPokemon ?? chosenPokemon, format) ?? getPopularPresetPatch(chosenPokemon, format) : null;
  if (presetPatch) {
    nextBuild.abilityName = presetPatch.abilityName ?? nextBuild.abilityName;
    nextBuild.natureId = presetPatch.natureId ?? nextBuild.natureId;
    nextBuild.moveIds = [...(presetPatch.moveIds ?? [])];
    nextBuild.evs = presetPatch.evs ? { ...presetPatch.evs } : nextBuild.evs;
    nextBuild.itemId = presetPatch.itemId ?? nextBuild.itemId;
    nextBuild.useMega = Boolean(presetPatch.useMega && chosenPokemon?.megaStone);
  } else {
    nextBuild.moveIds = chosenPokemon ? recommendMoveIds(chosenPokemon, format) : [];
  }

  if (pickedPokemon?.isMega && chosenPokemon) {
    const megaForm = findMegaForm(chosenPokemon) ?? pickedPokemon;
    const megaStone = findMegaStoneItem(chosenPokemon, megaForm);
    nextBuild.useMega = Boolean(megaForm);
    nextBuild.itemId = megaStone?.id ?? nextBuild.itemId;
  }

  return nextBuild;
}

function profileSummary(teamCount: number) {
  return `${teamCount}/10 saved teams`;
}

function buildTeamFromPlan(plan: GeneratedTeamPlan) {
  const team = createTeam(plan.name, plan.format);
  team.name = plan.name;
  team.notes = `${plan.summary}\n\n${plan.reasons.join('\n')}\n\n${plan.expertNotes.join('\n')}`;
  team.slots = plan.slots.map(copyBuild);
  return team;
}

function planSignature(plan: GeneratedTeamPlan | null) {
  if (!plan) {
    return '';
  }

  return plan.slots
    .map((slot) => slot.pokemonId ?? '')
    .filter(Boolean)
    .sort()
    .join('|');
}

function randomOpponentTeam(format: BattleFormat, offMetaBias: number) {
  const archetype = archetypeLibrary[Math.floor(Math.random() * archetypeLibrary.length)] ?? archetypeLibrary[0];
  const plans = generateTeamPlans(archetype.id, format, offMetaBias, [], 6, true);
  return buildTeamFromPlan(plans[Math.floor(Math.random() * plans.length)] ?? plans[0]);
}

function filledSlotIndices(team: Team) {
  return team.slots.map((slot, index) => (slot.pokemonId ? index : -1)).filter((index) => index >= 0);
}

function roleSummary(team: Team) {
  return team.slots
    .map((slot) => {
      const pokemon = resolvePokemonForm(slot);
      if (!pokemon) {
        return null;
      }
      return `${pokemon.displayName}: ${describeBuildRole(slot, team.format)}`;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function App() {
  const [state, setState] = useState(() => loadState());
  const [activeTab, setActiveTab] = useState<BattleTab>('team-builder');
  const [selectedSlotIndex, setSelectedSlotIndex] = useState(0);
  const [calcAttacker, setCalcAttacker] = useState<PokemonBuild>(() => copyBuild(loadState().teams[0]?.slots[0] ?? createDefaultState().teams[0].slots[0]));
  const [calcDefender, setCalcDefender] = useState<PokemonBuild>(() => copyBuild(loadState().teams[0]?.slots[1] ?? createDefaultState().teams[0].slots[1]));
  const [environment, setEnvironment] = useState<EnvironmentState>(defaultEnvironment);
  const [selectedDamageMoveId, setSelectedDamageMoveId] = useState<string | null>(null);
  const [pokedexSearch, setPokedexSearch] = useState('');
  const [selectedPokedexId, setSelectedPokedexId] = useState<string>(dataset.pokemon[0]?.id ?? '');
  const [selectedArchetype, setSelectedArchetype] = useState(archetypeLibrary[0].id);
  const [aiFormat, setAiFormat] = useState<BattleFormat>(() => activeTeamFromState(loadState()).format);
  const [aiLockedNames, setAiLockedNames] = useState<string[]>(['', '', '', '', '']);
  const [aiVariantCount, setAiVariantCount] = useState(8);
  const [aiRandomMode, setAiRandomMode] = useState(false);
  const [generatedPlans, setGeneratedPlans] = useState<GeneratedTeamPlan[]>([]);
  const [selectedGeneratedPlanId, setSelectedGeneratedPlanId] = useState<string | null>(null);
  const [simFormat, setSimFormat] = useState<BattleFormat>(() => activeTeamFromState(loadState()).format);
  const [simPreview, setSimPreview] = useState<SimulatorPreviewState | null>(null);
  const [simBringOrder, setSimBringOrder] = useState<number[]>([]);
  const [simBattle, setSimBattle] = useState<SimulatorBattleState | null>(null);
  const [simChoiceDrafts, setSimChoiceDrafts] = useState<Record<number, ChoiceDraft>>({});
  const [simCountdown, setSimCountdown] = useState(0);

  const team = activeTeamFromState(state);
  const analysis = analyzeTeam(team);
  const selectedTeamSlot = team.slots[selectedSlotIndex] ?? team.slots[0];
  const deferredDexSearch = useDeferredValue(pokedexSearch);
  const pokedexMatches = useMemo(
    () => dataset.pokemon.filter((pokemon) => pickerLabel(pokemon).toLowerCase().includes(deferredDexSearch.toLowerCase())),
    [deferredDexSearch],
  );
  const selectedPokedexPokemon = dataset.pokemon.find((pokemon) => pokemon.id === selectedPokedexId) ?? pokedexMatches[0] ?? dataset.pokemon[0];
  const attackerPokemon = resolvePokemonForm(calcAttacker);
  const defenderPokemon = resolvePokemonForm(calcDefender);
  const attackerBuild = attackerPokemon ? { ...calcAttacker, moveIds: normalizeMoveSelection(calcAttacker, attackerPokemon) } : calcAttacker;
  const defenderBuild = defenderPokemon ? { ...calcDefender, moveIds: normalizeMoveSelection(calcDefender, defenderPokemon) } : calcDefender;
  const attackerMoves = attackerPokemon ? attackerBuild.moveIds.map((id) => attackerPokemon.movePool.find((move) => move.id === id)).filter(Boolean) : [];
  const defenderMoves = defenderPokemon ? defenderBuild.moveIds.map((id) => defenderPokemon.movePool.find((move) => move.id === id)).filter(Boolean) : [];
  const attackerMoveResults = useMemo(
    () => attackerMoves.map((move) => ({ move, result: calculateDamage(attackerBuild, defenderBuild, move, environment) })),
    [attackerBuild, attackerMoves, defenderBuild, environment],
  );
  const defenderMoveResults = useMemo(
    () => defenderMoves.map((move) => ({ move, result: calculateDamage(defenderBuild, attackerBuild, move, environment) })),
    [attackerBuild, defenderBuild, defenderMoves, environment],
  );
  const selectedGeneratedPlan = generatedPlans.find((plan) => plan.id === selectedGeneratedPlanId) ?? generatedPlans[0] ?? null;
  const coreArchetypeSuggestions = suggestArchetypesForCore(aiLockedNames.filter(Boolean), aiFormat);

  const selectedResult = attackerMoveResults.find(({ move }) => move.id === selectedDamageMoveId)?.result ?? null;

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!selectedDamageMoveId && attackerMoves[0]) {
      setSelectedDamageMoveId(attackerMoves[0].id);
    }
  }, [attackerMoves, selectedDamageMoveId]);

  useEffect(() => {
    if (!simPreview) {
      setSimCountdown(0);
      return;
    }

    const tick = () => setSimCountdown(Math.max(0, Math.ceil((simPreview.previewEndsAt - Date.now()) / 1000)));
    tick();
    const handle = window.setInterval(tick, 1000);
    return () => window.clearInterval(handle);
  }, [simPreview]);

  function updateState(mutator: (draft: ReturnType<typeof createDefaultState>) => ReturnType<typeof createDefaultState>) {
    setState((current) => mutator(current));
  }

  function updateTeam(mutator: (nextTeam: Team) => Team) {
    updateState((current) => ({
      ...current,
      teams: current.teams.map((entry) => (entry.id === team.id ? mutator(cloneTeam(entry)) : entry)),
    }));
  }

  function updateSlot(index: number, nextBuild: PokemonBuild) {
    updateTeam((currentTeam) => {
      const nextTeam = cloneTeam(currentTeam);
      nextTeam.slots[index] = nextBuild;
      nextTeam.updatedAt = new Date().toISOString();
      return nextTeam;
    });
  }

  function createNewTeam() {
    if (state.teams.length >= 10) {
      return;
    }

    const nextTeam = createTeam(`New Team ${state.teams.length + 1}`, state.profile.favoriteFormat);
    setState((current) => ({
      ...current,
      teams: [...current.teams, nextTeam],
      activeTeamId: nextTeam.id,
    }));
    setSelectedSlotIndex(0);
  }

  function duplicateCurrentTeam() {
    if (state.teams.length >= 10) {
      return;
    }

    const duplicate = cloneTeam(team);
    duplicate.id = makeId('team');
    duplicate.name = `${team.name} Copy`;
    duplicate.createdAt = new Date().toISOString();
    duplicate.updatedAt = duplicate.createdAt;
    setState((current) => ({
      ...current,
      teams: [...current.teams, duplicate],
      activeTeamId: duplicate.id,
    }));
  }

  function deleteCurrentTeam() {
    if (state.teams.length === 1) {
      return;
    }

    const remaining = state.teams.filter((entry) => entry.id !== team.id);
    setState((current) => ({
      ...current,
      teams: remaining,
      activeTeamId: remaining[0].id,
    }));
    setSelectedSlotIndex(0);
  }

  function importSlotIntoCalc(sourceIndex: number, side: 'attacker' | 'defender') {
    const source = team.slots[sourceIndex];
    if (!source) {
      return;
    }

    const next = copyBuild(source);
    next.id = makeId(side);
    if (side === 'attacker') {
      setCalcAttacker(next);
    } else {
      setCalcDefender(next);
    }
  }

  function runAiBuilder() {
    startTransition(() => {
      const plans = generateTeamPlans(
        selectedArchetype,
        aiFormat,
        state.profile.offMetaBias,
        aiLockedNames.filter((name) => name.trim()),
        aiVariantCount,
        aiRandomMode,
      );
      const previousSignature = planSignature(selectedGeneratedPlan);
      const preferredPlan = aiRandomMode
        ? plans.find((plan) => planSignature(plan) !== previousSignature) ?? plans[0] ?? null
        : plans[0] ?? null;
      setGeneratedPlans(plans);
      setSelectedGeneratedPlanId(preferredPlan?.id ?? null);
      if (aiRandomMode && preferredPlan) {
        applyGeneratedPlan(preferredPlan);
      }
    });
  }

  function applyGeneratedPlan(plan = selectedGeneratedPlan) {
    if (!plan) {
      return;
    }

    updateTeam((currentTeam) => {
      const nextTeam = cloneTeam(currentTeam);
      nextTeam.name = plan.name;
      nextTeam.format = plan.format;
      nextTeam.notes = `${plan.summary}\n\n${plan.reasons.join('\n')}\n\n${plan.expertNotes.join('\n')}`;
      nextTeam.slots = plan.slots.map(copyBuild);
      nextTeam.updatedAt = new Date().toISOString();
      return nextTeam;
    });
    setActiveTab('team-builder');
  }

  function resetEverything() {
    clearState();
    const next = createDefaultState();
    setState(next);
    setCalcAttacker(copyBuild(next.teams[0].slots[0]));
    setCalcDefender(copyBuild(next.teams[0].slots[1]));
    setEnvironment(defaultEnvironment);
    setGeneratedPlans([]);
    setSelectedGeneratedPlanId(null);
    setSimPreview(null);
    setSimBattle(null);
    setSimBringOrder([]);
    setSimChoiceDrafts({});
    setSelectedSlotIndex(0);
  }

  function startSimulatorPreview() {
    const selectable = filledSlotIndices(team);
    if (selectable.length < 4) {
      return;
    }

    const opponentTeam = randomOpponentTeam(simFormat, state.profile.offMetaBias);
    const opponentOrder = filledSlotIndices(opponentTeam).slice(0, 4);
    setSimPreview({
      format: simFormat,
      opponentTeam,
      opponentOrder,
      previewEndsAt: Date.now() + 60_000,
    });
    setSimBringOrder([]);
    setSimBattle(null);
    setSimChoiceDrafts({});
  }

  function toggleBringIndex(slotIndex: number) {
    setSimBringOrder((current) => {
      if (current.includes(slotIndex)) {
        return current.filter((entry) => entry !== slotIndex);
      }
      if (current.length >= 4) {
        return current;
      }
      return [...current, slotIndex];
    });
  }

  function beginSimBattle() {
    if (!simPreview || simBringOrder.length !== 4) {
      return;
    }

    const playerTeam = cloneTeam(team);
    playerTeam.format = simPreview.format;
    const battle = advancePreviewToBattle(createSimulatorBattle(simPreview.format, playerTeam, simBringOrder, simPreview.opponentTeam, simPreview.opponentOrder, simPreview.previewEndsAt));
    setSimBattle(battle);
    setSimPreview(null);
    setSimChoiceDrafts({});
  }

  function updateChoiceDraft(actor: number, partial: Partial<ChoiceDraft>) {
    setSimChoiceDrafts((current) => ({
      ...current,
      [actor]: {
        type: 'move',
        moveId: simBattle?.player.units[simBattle.player.active[actor]]?.build.moveIds[0] ?? '',
        target: 0,
        switchTarget: simBattle?.player.bench[0] ?? 0,
        ...(current[actor] ?? {}),
        ...partial,
      },
    }));
  }

  function submitSimTurn() {
    if (!simBattle || simBattle.stage !== 'battle') {
      return;
    }

    const requiredActors = simBattle.player.active
      .map((unitIndex, actor) => ({ unitIndex, actor }))
      .filter(({ unitIndex }) => {
        const unit = simBattle.player.units[unitIndex];
        return unit && !unit.fainted;
      })
      .map(({ actor }) => actor);

    const choices: SimulatorChoice[] = requiredActors.map((actor) => {
      const draft = simChoiceDrafts[actor];
      if (!draft) {
        const unit = simBattle.player.units[simBattle.player.active[actor]];
        return {
          type: 'move',
          actor,
          moveId: unit?.build.moveIds[0] ?? '',
          target: 0,
        } satisfies SimulatorChoice;
      }

      if (draft.type === 'switch') {
        return {
          type: 'switch',
          actor,
          target: draft.switchTarget,
        } satisfies SimulatorChoice;
      }

      return {
        type: 'move',
        actor,
        moveId: draft.moveId,
        target: draft.target,
      } satisfies SimulatorChoice;
    });

    setSimBattle((current) => (current ? resolveTurn(current, choices) : current));
    setSimChoiceDrafts({});
  }

  return (
    <div className={`app-shell layout-${state.profile.layoutMode.toLowerCase()}${state.profile.resizablePanels ? ' panels-resizable' : ''}`}>
      <aside className="sidebar">
        <div className="brand-panel">
          <div className="brand-kicker">Pokemon Champions Lab</div>
          <h1>Damage Calculator + Team Builder</h1>
          <p>Source-backed against Serebii's Champions pages and layered with current community usage reads for spreads, synergy, preview planning, and battle sandbox work.</p>
          <div className="brand-sprite-row">
            {brandPokemonIcons.map((name) => {
              const pokemon = dataset.pokemon.find((entry) => entry.displayName === name) ?? null;
              return <PokemonSpriteFrame key={name} pokemon={pokemon} size="mini" label={name} />;
            })}
          </div>
        </div>

        <div className="profile-chip">
          <div>
            <strong>{state.profile.trainerName || 'Unregistered Trainer'}</strong>
            <span>{profileSummary(state.teams.length)}</span>
          </div>
          <div className="pill">{state.profile.favoriteFormat}</div>
        </div>

        <nav className="side-nav">
          {appTabs.map((tab) => (
            <button key={tab.id} className={tab.id === activeTab ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab(tab.id)}>
              <span>{tab.short}</span>
              <div>
                <strong>{tab.label}</strong>
                <small>{tab.description}</small>
              </div>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="info-card compact">
            <span>Champions Data</span>
            <strong>{dataset.pokemon.length} forms / {dataset.moves.length} moves / {dataset.items.length} items</strong>
            <small>Release date confirmed from Serebii: {dataset.mechanics.releaseDate}</small>
          </div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="topbar-intro">
            <p className="eyebrow">Current squad</p>
            <h2>{team.name}</h2>
            <span>{analysis.overview}</span>
          </div>
          <div className="topbar-side">
            <div className="topbar-actions">
              <InfoStat label="Format" value={team.format} />
              <InfoStat label="Synergy" value={`${analysis.synergyScore}`} />
              <InfoStat label="Survivability" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityScore}`} />
              <InfoStat label="Win Rate" value={`${analysis.estimatedWinRate}%`} />
              <InfoStat label="Meta Label" value={analysis.teamUsage.label} />
              <InfoStat label="Off-Meta Bias" value={getNinetalesBiasLabel(state.profile.offMetaBias)} />
            </div>
            <div className="layout-toolbar">
              <label className="field toolbar-field">
                <span>Layout Width</span>
                <select
                  value={state.profile.layoutMode}
                  onChange={(event) =>
                    setState((current) => ({
                      ...current,
                      profile: {
                        ...current.profile,
                        layoutMode: event.target.value as LayoutMode,
                      },
                    }))
                  }
                >
                  {layoutModes.map((mode) => (
                    <option key={mode} value={mode}>{mode}</option>
                  ))}
                </select>
              </label>
              <ToggleField
                label="Resizable Panels"
                checked={state.profile.resizablePanels}
                onChange={(checked) =>
                  setState((current) => ({
                    ...current,
                    profile: {
                      ...current.profile,
                      resizablePanels: checked,
                    },
                  }))
                }
              />
            </div>
          </div>
        </header>

        {activeTab === 'team-builder' && (
          <section className="page-grid page-grid-wide">
            <div className="panel tall">
              <SectionHeader title="Saved Teams" subtitle="Create, duplicate, rename, and rotate through up to ten squads." />
              <div className="team-actions">
                <button className="action-button primary" onClick={createNewTeam} disabled={state.teams.length >= 10}>New Team</button>
                <button className="action-button" onClick={duplicateCurrentTeam} disabled={state.teams.length >= 10}>Duplicate</button>
                <button className="action-button danger" onClick={deleteCurrentTeam}>Delete</button>
              </div>
              <div className="saved-team-list scroll-stack">
                {state.teams.map((savedTeam) => (
                  <button key={savedTeam.id} className={savedTeam.id === team.id ? 'saved-team-card active' : 'saved-team-card'} onClick={() => setState((current) => ({ ...current, activeTeamId: savedTeam.id }))}>
                    <div>
                      <strong>{savedTeam.name}</strong>
                      <small>{savedTeam.format} - {savedTeam.slots.filter((slot) => slot.pokemonId).length}/6 filled</small>
                    </div>
                    <span>{new Date(savedTeam.updatedAt).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel span-two">
              <SectionHeader title="Active Team" subtitle="Click a slot to edit species, moves, nature, EVs, item, Mega plan, and role identity." />
              <div className="team-meta-row">
                <label className="field">
                  <span>Team Name</span>
                  <input value={team.name} onChange={(event) => updateTeam((currentTeam) => ({ ...currentTeam, name: event.target.value, updatedAt: new Date().toISOString() }))} />
                </label>
                <label className="field">
                  <span>Format</span>
                  <select value={team.format} onChange={(event) => updateTeam((currentTeam) => ({ ...currentTeam, format: event.target.value as BattleFormat, updatedAt: new Date().toISOString() }))}>
                    {battleFormats.map((format) => (
                      <option key={format} value={format}>{format}</option>
                    ))}
                  </select>
                </label>
                <label className="field grow">
                  <span>Notes</span>
                  <input value={team.notes} onChange={(event) => updateTeam((currentTeam) => ({ ...currentTeam, notes: event.target.value, updatedAt: new Date().toISOString() }))} placeholder="Matchup notes, Mega plan, ladder pocket..." />
                </label>
              </div>

              <div className="slot-grid">
                {team.slots.map((slot, index) => {
                  const pokemon = resolvePokemonForm(slot);
                  const usage = getPokemonUsageInsight(pokemon, team.format);
                  return (
                    <button key={slot.id} className={index === selectedSlotIndex ? 'slot-card active' : 'slot-card'} onClick={() => setSelectedSlotIndex(index)}>
                      <div className="slot-card-top">
                        <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                        <div>
                          <strong>{pokemon ? buildLabel(slot, pokemon) : `Slot ${index + 1}`}</strong>
                          <small>{pokemon ? pokemon.types.join(' / ') : 'Select a Pokemon'}</small>
                          {pokemon ? <UsagePill insight={usage} /> : null}
                        </div>
                      </div>
                      <div className="slot-card-stats">
                        <span>{slot.itemId ? getItemById(slot.itemId)?.name : 'No item'}</span>
                        <span>{pokemon ? describeBuildRole(slot, team.format) : 'Open slot'}</span>
                        <span>{pokemon ? describeMegaState(slot, selectedPokemon(slot)) : 'No Mega'}</span>
                      </div>
                      <div className="move-chip-row">
                        {slot.moveIds.slice(0, 4).map((moveId) => {
                          const move = pokemon?.movePool.find((entry) => entry.id === moveId);
                          return <span key={moveId} className="move-chip">{move?.name ?? 'Move'}</span>;
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="panel tall inspector-summary-panel">
              <SectionHeader title="Inspector + Summary" subtitle="This editor updates the live team and the summary panel beneath it." />
              <BuildEditor build={selectedTeamSlot} onChange={(next) => updateSlot(selectedSlotIndex, next)} title={`Slot ${selectedSlotIndex + 1}`} format={team.format} />
              <div className="subpanel team-summary-subpanel">
                <SectionHeader title="Team Summary" subtitle="The same AI labels and survivability notes are reflected live inside Team Builder." compact />
                <div className="result-grid">
                  <InfoStat label="Meta" value={analysis.teamUsage.label} />
                  <InfoStat label="Survive" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityScore}`} />
                  <InfoStat label="Roles" value={`${roleSummary(team).length}`} />
                  <InfoStat label="Easy Wins" value={`${analysis.easyTargets.length}`} />
                </div>
                <div className="notes-list team-summary-list">
                  {roleSummary(team).map((note) => (
                    <div key={note} className="note-row">{note}</div>
                  ))}
                  {analysis.archetypeSuggestions.map((note) => (
                    <div key={note} className="note-row">Suggested archetype fit: {note}</div>
                  ))}
                  {analysis.previewPlans.map((note) => (
                    <div key={note} className="note-row">{note}</div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'damage-lab' && (
          <section className="page-grid page-grid-wide">
            <div className="panel tall">
              <SectionHeader title="Attacker" subtitle="Pull from your team or build a manual line for outbound damage." />
              <div className="calc-import-row">
                {team.slots.map((slot, index) => (
                  <button key={slot.id} className="mini-button" onClick={() => importSlotIntoCalc(index, 'attacker')}>Import Slot {index + 1}</button>
                ))}
              </div>
              <BuildEditor build={attackerBuild} onChange={setCalcAttacker} title="Attacking Build" format={team.format} condensed />
            </div>

            <div className="panel tall">
              <SectionHeader title="Environment" subtitle="Toggle battle state, then swap directions to see the reverse line." />
              <div className="control-grid two">
                <label className="field">
                  <span>Weather</span>
                  <select value={environment.weather} onChange={(event) => setEnvironment((current) => ({ ...current, weather: event.target.value as EnvironmentState['weather'] }))}>
                    {weatherOptions.map((weather) => (
                      <option key={weather} value={weather}>{weather}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Terrain</span>
                  <select value={environment.terrain} onChange={(event) => setEnvironment((current) => ({ ...current, terrain: event.target.value as EnvironmentState['terrain'] }))}>
                    {terrainOptions.map((terrain) => (
                      <option key={terrain} value={terrain}>{terrain}</option>
                    ))}
                  </select>
                </label>
                <ToggleField label="Critical hit" checked={environment.criticalHit} onChange={(checked) => setEnvironment((current) => ({ ...current, criticalHit: checked }))} />
                <ToggleField label="Reflect" checked={environment.reflect} onChange={(checked) => setEnvironment((current) => ({ ...current, reflect: checked }))} />
                <ToggleField label="Light Screen" checked={environment.lightScreen} onChange={(checked) => setEnvironment((current) => ({ ...current, lightScreen: checked }))} />
                <ToggleField label="Auto-resist berries" checked={environment.defenderProtectedByBerry} onChange={(checked) => setEnvironment((current) => ({ ...current, defenderProtectedByBerry: checked }))} />
              </div>
              <button className="action-button" onClick={() => { const nextAttacker = copyBuild(calcDefender); const nextDefender = copyBuild(calcAttacker); setCalcAttacker(nextAttacker); setCalcDefender(nextDefender); }}>
                Reverse Direction
              </button>

                <div className="result-stack">
                  <div className="move-result-grid">
                  {attackerMoveResults.map(({ move, result }) => {
                    return (
                      <button key={move.id} className={selectedDamageMoveId === move.id ? 'damage-chip active' : 'damage-chip'} onClick={() => setSelectedDamageMoveId(move.id)}>
                        <strong>{move.name}</strong>
                        <span>{summaryForResult(result)}</span>
                        <UsagePill insight={getMoveUsageInsight(move.name, team.format)} small />
                      </button>
                    );
                  })}
                </div>

                <div className="damage-hero">
                  <div>
                    <p className="eyebrow">Selected move</p>
                    <h3>{selectedResult?.move.name ?? 'Pick a move'}</h3>
                    <span>{selectedResult ? `${selectedResult.appliedType} - ${selectedResult.hitSummary}` : 'The calculator uses standard level-50 combat math plus Champions move, item, and Mega data.'}</span>
                  </div>
                  <strong>{selectedResult ? summaryForResult(selectedResult) : '--'}</strong>
                </div>

                <div className="result-grid">
                  <InfoStat label="KO line" value={selectedResult?.koSummary ?? '--'} />
                  <InfoStat label="Effect" value={selectedResult ? `${selectedResult.effectiveness}x` : '--'} />
                  <InfoStat label="STAB" value={selectedResult ? `${selectedResult.stab}x` : '--'} />
                  <InfoStat label="Move Meta" value={selectedResult ? getMoveUsageInsight(selectedResult.move.name, team.format).label : '--'} />
                </div>

                <div className="notes-list scroll-stack compact-scroll">
                  {(selectedResult?.notes ?? dataset.mechanics.notes).map((note) => (
                    <div key={note} className="note-row">{note}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Defender" subtitle="Mirror the same controls so you can scout damage coming back into your side." />
              <div className="calc-import-row">
                {team.slots.map((slot, index) => (
                  <button key={slot.id} className="mini-button" onClick={() => importSlotIntoCalc(index, 'defender')}>Import Slot {index + 1}</button>
                ))}
              </div>
              <BuildEditor build={defenderBuild} onChange={setCalcDefender} title="Defending Build" format={team.format} condensed />

              <div className="subpanel">
                <SectionHeader title="Incoming Pressure" subtitle="These are the defender's selected moves into your current attacker." compact />
                <div className="move-result-grid compact">
                  {defenderMoveResults.map(({ move, result }) => {
                    return (
                      <div key={move.id} className="damage-chip static">
                        <strong>{move.name}</strong>
                        <span>{summaryForResult(result)}</span>
                        <UsagePill insight={getMoveUsageInsight(move.name, team.format)} small />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'pokedex' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Champions Roster" subtitle="Search the current available Pokemon, forms, and Mega entries from the Serebii-backed dataset." />
              <label className="field">
                <span>Search Pokemon</span>
                <input value={pokedexSearch} onChange={(event) => setPokedexSearch(event.target.value)} placeholder="Mega Dragonite, Castform, Milotic..." />
              </label>
              <div className="dex-list scroll-stack">
                {pokedexMatches.slice(0, 120).map((pokemon) => (
                  <button key={pokemon.id} className={pokemon.id === selectedPokedexPokemon?.id ? 'dex-row active' : 'dex-row'} onClick={() => setSelectedPokedexId(pokemon.id)}>
                    <PokemonSpriteFrame pokemon={pokemon} size="tiny" />
                    <div>
                      <strong>{pokemon.displayName}</strong>
                      <small>{pokemon.types.join(' / ')}</small>
                    </div>
                    <UsagePill insight={getPokemonUsageInsight(pokemon, team.format)} small />
                  </button>
                ))}
              </div>
            </div>

            <div className="panel tall span-two">
              <SectionHeader title={selectedPokedexPokemon.displayName} subtitle={`${selectedPokedexPokemon.baseSpecies} - ${selectedPokedexPokemon.classification || 'Battle-ready form'}`} />
              <div className="pokedex-hero">
                <PokemonSpriteFrame pokemon={selectedPokedexPokemon} size="pokedex" />
                <div className="pokedex-metadata">
                  <div className="result-grid">
                    <InfoStat label="Singles" value={getPokemonUsageInsight(selectedPokedexPokemon, 'Singles').label} />
                    <InfoStat label="Doubles" value={getPokemonUsageInsight(selectedPokedexPokemon, 'Doubles').label} />
                    <InfoStat label="Role" value={describeBuildRole(prepareBuildForPokemon(selectedTeamSlot, selectedPokedexPokemon.id, team.format), team.format)} />
                    <InfoStat label="Mega Item" value={selectedPokedexPokemon.megaStone ?? 'None'} />
                  </div>
                  <div className="notes-list scroll-stack compact-scroll">
                    <div className="note-row">{getPokemonUsageInsight(selectedPokedexPokemon, team.format).reason}</div>
                    {selectedPokedexPokemon.abilities.map((ability) => (
                      <div key={ability.name} className="note-row"><strong>{ability.name}:</strong> {ability.description}</div>
                    ))}
                    {getPopularPresetSummary(selectedPokedexPokemon, team.format) ? (
                      <div className="note-row">
                        Popular {team.format} set: {getPopularPresetSummary(selectedPokedexPokemon, team.format)?.moveNames.join(', ')}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="stats-bar-grid">
                {statOrder.map((stat) => (
                  <div key={stat} className="stat-bar-card">
                    <span>{statLabels[stat]}</span>
                    <strong>{selectedPokedexPokemon.baseStats[stat]}</strong>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (selectedPokedexPokemon.baseStats[stat] / 180) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>

              <div className="move-table">
                <div className="move-table-head move-table-head-wide">
                  <span>Move</span>
                  <span>Type</span>
                  <span>Cat</span>
                  <span>Power</span>
                  <span>Acc</span>
                  <span>Meta</span>
                  <span>Effect</span>
                </div>
                {selectedPokedexPokemon.movePool.map((move) => (
                  <div key={move.id} className="move-table-row move-table-row-wide">
                    <strong>{move.name}</strong>
                    <span>{move.type}</span>
                    <span>{move.category}</span>
                    <span>{move.power ?? '--'}</span>
                    <span>{move.accuracy ?? '--'}</span>
                    <span>{getMoveUsageInsight(move.name, team.format).label}</span>
                    <small>{move.description || 'No extra rider text on the source page.'}</small>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'ai-builder' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="AI Team Builder" subtitle="Lock your favorite core, then generate fully built Singles or Doubles teams with up to twenty guided or random variants." />
              <label className="field">
                <span>Archetype</span>
                <select value={selectedArchetype} onChange={(event) => setSelectedArchetype(event.target.value)}>
                  {archetypeLibrary.map((archetype) => (
                    <option key={archetype.id} value={archetype.id}>{archetype.name}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Plan Format</span>
                <select value={aiFormat} onChange={(event) => setAiFormat(event.target.value as BattleFormat)}>
                  {battleFormats.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <div className="locked-team-stack">
                {aiLockedNames.map((name, index) => (
                  <label key={index} className="field">
                    <span>{index === 0 ? 'Favorite / Core Pokemon' : `Additional Pokemon ${index}`}</span>
                    <input value={name} onChange={(event) => setAiLockedNames((current) => current.map((entry, currentIndex) => (currentIndex === index ? event.target.value : entry)))} placeholder={index === 0 ? 'Mandatory core like Garchomp, Castform, or Mega Gengar' : 'Optional locked teammate'} />
                  </label>
                ))}
              </div>
              <label className="field">
                <span>Generated Team Count</span>
                <input type="number" min={3} max={20} value={aiVariantCount} onChange={(event) => setAiVariantCount(Math.max(3, Math.min(20, Number(event.target.value))))} />
              </label>
              <div className="team-actions compact-actions">
                {[3, 5, 10, 20].map((count) => (
                  <button key={count} className={aiVariantCount === count ? 'mini-button active' : 'mini-button'} onClick={() => setAiVariantCount(count)}>
                    {count} Teams
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Off-Meta Bias</span>
                <input type="range" min={0} max={100} value={state.profile.offMetaBias} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, offMetaBias: Number(event.target.value) } }))} />
                <small>{getNinetalesBiasLabel(state.profile.offMetaBias)} - higher values hunt unusual but coherent win paths.</small>
              </label>
              <ToggleField label="Random Team Generator" checked={aiRandomMode} onChange={setAiRandomMode} />
              <button className="action-button primary ai-build-button" onClick={runAiBuilder}>
                {aiRandomMode ? `Generate ${aiVariantCount} Random Teams` : `Generate ${aiVariantCount} Team Plans`}
              </button>

              <div className="notes-list scroll-stack compact-scroll">
                {coreArchetypeSuggestions.map((note) => (
                  <div key={note} className="note-row">Core fit suggestion: {note}</div>
                ))}
                <div className="note-row">Locked core Pokemon are always included, then the AI rounds the team out with items, abilities, spreads, and role coverage.</div>
                <div className="note-row">Random generator mode keeps your locked core intact while sampling different high-value support, Mega, and matchup branches, and it now refreshes the active team with the first new random result.</div>
                <div className="note-row">Every generated team comes back with synergy, survivability, meta label, estimated win rate, preview lines, and threat notes.</div>
              </div>
            </div>

            <div className="panel tall span-two">
              <SectionHeader title={selectedGeneratedPlan?.name ?? 'Draft Plans'} subtitle={selectedGeneratedPlan?.summary ?? 'Generate at least three complete plans to preview different archetype branches.'} />
              {generatedPlans.length ? (
                <>
                  <div className="plan-tab-row">
                    {generatedPlans.map((plan) => (
                      <button key={plan.id} className={plan.id === selectedGeneratedPlan?.id ? 'plan-tab active' : 'plan-tab'} onClick={() => setSelectedGeneratedPlanId(plan.id)}>
                        <strong>{plan.planTag}</strong>
                        <small>{plan.analysis.synergyScore} / {plan.analysis.survivabilityGrade} / {plan.analysis.teamUsage.label}</small>
                      </button>
                    ))}
                  </div>
                  {selectedGeneratedPlan ? (
                    <div className="plan-detail-grid">
                      <div className="generated-team-row">
                        {selectedGeneratedPlan.slots.map((slot) => {
                          const pokemon = resolvePokemonForm(slot);
                          return (
                            <div key={slot.id} className="generated-slot">
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? 'Open'}</strong>
                              <small>{describeBuildRole(slot, selectedGeneratedPlan.format)}</small>
                              <UsagePill insight={getPokemonUsageInsight(pokemon, selectedGeneratedPlan.format)} small />
                              <span>{slot.moveIds.map((moveId) => pokemon?.movePool.find((move) => move.id === moveId)?.name).filter(Boolean).join(' / ')}</span>
                              <span>{getItemById(slot.itemId)?.name ?? 'No item'} - {slot.abilityName ?? pokemon?.abilities[0]?.name ?? 'Ability'}</span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="result-grid">
                        <InfoStat label="Format" value={selectedGeneratedPlan.format} />
                        <InfoStat label="Core" value={selectedGeneratedPlan.favoritePokemon ?? 'Open'} />
                        <InfoStat label="Mega" value={getPokemonById(selectedGeneratedPlan.megaPokemonId)?.displayName ?? 'Flexible'} />
                        <InfoStat label="Archetype" value={selectedGeneratedPlan.archetype} />
                        <InfoStat label="Synergy" value={`${selectedGeneratedPlan.analysis.synergyScore}`} />
                        <InfoStat label="Survive" value={`${selectedGeneratedPlan.analysis.survivabilityGrade} / ${selectedGeneratedPlan.analysis.survivabilityScore}`} />
                        <InfoStat label="Win Rate" value={`${selectedGeneratedPlan.analysis.estimatedWinRate}%`} />
                        <InfoStat label="Meta" value={selectedGeneratedPlan.analysis.teamUsage.label} />
                      </div>

                      <div className="notes-list scroll-stack">
                        {selectedGeneratedPlan.reasons.map((reason) => (
                          <div key={reason} className="note-row">{reason}</div>
                        ))}
                        {selectedGeneratedPlan.expertNotes.map((reason) => (
                          <div key={reason} className="note-row">{reason}</div>
                        ))}
                        <div className="note-row">{selectedGeneratedPlan.megaReason}</div>
                        {selectedGeneratedPlan.analysis.easyTargets.map((reason) => (
                          <div key={reason} className="note-row">{reason}</div>
                        ))}
                      </div>

                      <div className="notes-list scroll-stack compact-scroll">
                        {selectedGeneratedPlan.analysis.previewPlans.map((note) => (
                          <div key={note} className="note-row">{note}</div>
                        ))}
                        {selectedGeneratedPlan.analysis.recommendations.map((note) => (
                          <div key={note} className="note-row">{note}</div>
                        ))}
                      </div>

                      <div className="team-actions">
                        <button className="action-button primary" onClick={() => applyGeneratedPlan(selectedGeneratedPlan)}>Apply to Active Team</button>
                        <button className="action-button" onClick={() => { applyGeneratedPlan(selectedGeneratedPlan); setActiveTab('analyzer'); }}>Apply + Analyze</button>
                        <button className="action-button" onClick={() => { applyGeneratedPlan(selectedGeneratedPlan); setActiveTab('simulator'); }}>Apply + Sim</button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">
                  <strong>No generated team yet.</strong>
                  <span>Lock a core, set a team count, and generate complete plans with items, abilities, spreads, threats, and Mega recommendations.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'analyzer' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Overview" subtitle="A quick read on synergy, survivability, easy wins, and overall team identity." />
              <div className="result-grid">
                <InfoStat label="Synergy" value={`${analysis.synergyScore}/100`} />
                <InfoStat label="Win Rate" value={`${analysis.estimatedWinRate}%`} />
                <InfoStat label="Survivability" value={`${analysis.survivabilityGrade} / ${analysis.survivabilityScore}`} />
                <InfoStat label="Meta Label" value={analysis.teamUsage.label} />
              </div>
              <div className="notes-list scroll-stack">
                {[...analysis.strengths, ...analysis.coverageHighlights, ...analysis.easyTargets].map((note) => (
                  <div key={note} className="note-row">{note}</div>
                ))}
                {analysis.formatNotes.map((note) => (
                  <div key={note} className="note-row">{note}</div>
                ))}
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Threat Radar" subtitle="The biggest pressure pieces against this exact shell plus the safest four to bring." />
              <div className="threat-list scroll-stack">
                {analysis.threats.map((threat) => {
                  const pokemon = getPokemonById(threat.pokemonId);
                  return (
                    <div key={threat.pokemonId} className="threat-card threat-card-block">
                      <div className="threat-top">
                        <PokemonSpriteFrame pokemon={pokemon} size="tiny" />
                        <div>
                          <strong>{threat.name}</strong>
                          <small>{threat.reason}</small>
                        </div>
                        <span>{Math.round(threat.score)}</span>
                      </div>
                      <div className="note-row compact-note">{threat.previewCue}</div>
                      <div className="note-row compact-note">{threat.bringPlan}</div>
                      {threat.counterplay.map((note) => (
                        <div key={note} className="note-row compact-note">{note}</div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel tall">
              <SectionHeader title="Tuning Notes" subtitle="Recommendations, archetype fits, and ways to push closer to 100% synergy." />
              <div className="notes-list scroll-stack">
                {analysis.archetypeSuggestions.map((note) => (
                  <div key={note} className="note-row">Archetype fit: {note}</div>
                ))}
                {[...analysis.weaknesses, ...analysis.recommendations, ...analysis.balanceHints, ...analysis.previewPlans].map((note) => (
                  <div key={note} className="note-row">{note}</div>
                ))}
              </div>
            </div>
          </section>
        )}

        {activeTab === 'simulator' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Battle Setup" subtitle="Pick the battle type, roll an AI opponent, study the one-minute preview, and lock your four." />
              <label className="field">
                <span>Battle Type</span>
                <select value={simFormat} onChange={(event) => setSimFormat(event.target.value as BattleFormat)}>
                  {battleFormats.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <button className="action-button primary" onClick={startSimulatorPreview}>Generate Viable Opponent</button>
              <div className="notes-list compact-scroll">
                <div className="note-row">The simulator uses the live roster, your saved spreads, the current damage engine, and a battle sandbox with targeting, switching, preview order, and AI decisions.</div>
                <div className="note-row">Preview stays visible for 60 seconds so you can plan your four before the battle opens.</div>
              </div>
            </div>

            <div className="panel tall span-two">
              {simPreview ? (
                <>
                  <SectionHeader title="Team Preview" subtitle={`Time left: ${simCountdown}s. Lock your four in order from lead to backline.`} />
                  <div className="sim-preview-grid">
                    <div className="subpanel">
                      <SectionHeader title="Your Team" subtitle={`Selected: ${simBringOrder.length}/4`} compact />
                      <div className="sim-team-preview">
                        {filledSlotIndices(team).map((slotIndex) => {
                          const build = team.slots[slotIndex];
                          const pokemon = resolvePokemonForm(build);
                          const selected = simBringOrder.includes(slotIndex);
                          return (
                            <button key={build.id} className={selected ? 'sim-team-card active' : 'sim-team-card'} onClick={() => toggleBringIndex(slotIndex)}>
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? `Slot ${slotIndex + 1}`}</strong>
                              <small>{describeBuildRole(build, simFormat)}</small>
                              {selected ? <span>Bring #{simBringOrder.indexOf(slotIndex) + 1}</span> : <span>Select</span>}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="subpanel">
                      <SectionHeader title="Opponent Preview" subtitle="AI-generated viable team" compact />
                      <div className="sim-team-preview">
                        {simPreview.opponentOrder.map((orderIndex, index) => {
                          const build = simPreview.opponentTeam.slots[orderIndex];
                          const pokemon = resolvePokemonForm(build);
                          return (
                            <div key={`${build.id}-${index}`} className="sim-team-card static">
                              <PokemonSpriteFrame pokemon={pokemon} size="standard" />
                              <strong>{pokemon?.displayName ?? `Slot ${index + 1}`}</strong>
                              <small>{describeBuildRole(build, simFormat)}</small>
                              <UsagePill insight={getPokemonUsageInsight(pokemon, simFormat)} small />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="team-actions">
                    <button className="action-button primary" onClick={beginSimBattle} disabled={simCountdown > 0 || simBringOrder.length !== 4}>Start Battle</button>
                    <button className="action-button" onClick={() => setSimPreview(null)}>Cancel Preview</button>
                  </div>
                </>
              ) : simBattle ? (
                <>
                  <SectionHeader title={simBattle.winner ? 'Battle Result' : `Battle Turn ${simBattle.turn}`} subtitle={simBattle.winner ? (simBattle.winner === 'player' ? 'You won the sandbox battle.' : 'The AI won the sandbox battle.') : 'Select moves or switches for each active Pokemon, then resolve the turn.'} />
                  <div className="sim-battle-grid">
                    <BattleSideView side={simBattle.opponent} format={simBattle.format} />
                    <div className="sim-center-column">
                      <div className="result-grid">
                        <InfoStat label="Trick Room" value={simBattle.trickRoomTurns ? `${simBattle.trickRoomTurns} turns` : 'Off'} />
                        <InfoStat label="Your Tailwind" value={simBattle.player.tailwindTurns ? `${simBattle.player.tailwindTurns}` : 'Off'} />
                        <InfoStat label="AI Tailwind" value={simBattle.opponent.tailwindTurns ? `${simBattle.opponent.tailwindTurns}` : 'Off'} />
                      </div>
                      <div className="notes-list scroll-stack sim-log">
                        {simBattle.log.slice(0, 16).map((entry, index) => (
                          <div key={`${entry}-${index}`} className="note-row">{entry}</div>
                        ))}
                      </div>
                    </div>
                    <BattleSideView side={simBattle.player} format={simBattle.format} friendly />
                  </div>

                  {!simBattle.winner ? (
                    <>
                      <div className="sim-action-grid">
                        {simBattle.player.active.map((unitIndex, actor) => {
                          const unit = simBattle.player.units[unitIndex];
                          if (!unit || unit.fainted) {
                            return null;
                          }

                          const draft = simChoiceDrafts[actor] ?? {
                            type: 'move' as const,
                            moveId: unit.build.moveIds[0] ?? '',
                            target: 0,
                            switchTarget: simBattle.player.bench[0] ?? 0,
                          };

                          return (
                            <div key={`${unit.pokemon.id}-${actor}`} className="subpanel sim-action-card">
                              <SectionHeader title={unit.pokemon.displayName} subtitle={describeBuildRole(unit.build, simBattle.format)} compact />
                              <label className="field">
                                <span>Action</span>
                                <select value={draft.type} onChange={(event) => updateChoiceDraft(actor, { type: event.target.value as ChoiceDraft['type'] })}>
                                  <option value="move">Move</option>
                                  <option value="switch">Switch</option>
                                </select>
                              </label>
                              {draft.type === 'move' ? (
                                <>
                                  <label className="field">
                                    <span>Move</span>
                                    <select value={draft.moveId} onChange={(event) => updateChoiceDraft(actor, { moveId: event.target.value })}>
                                      {unit.build.moveIds.map((moveId) => {
                                        const move = unit.pokemon.movePool.find((entry) => entry.id === moveId);
                                        return <option key={moveId} value={moveId}>{move?.name ?? 'Move'}</option>;
                                      })}
                                    </select>
                                  </label>
                                  <label className="field">
                                    <span>Target</span>
                                    <select value={draft.target} onChange={(event) => updateChoiceDraft(actor, { target: Number(event.target.value) })}>
                                      {simBattle.opponent.active.map((enemyIndex, targetIndex) => {
                                        const enemy = simBattle.opponent.units[enemyIndex];
                                        return <option key={`${enemy?.pokemon.id}-${targetIndex}`} value={targetIndex}>{enemy?.pokemon.displayName ?? `Target ${targetIndex + 1}`}</option>;
                                      })}
                                    </select>
                                  </label>
                                </>
                              ) : (
                                <label className="field">
                                  <span>Switch To</span>
                                  <select value={draft.switchTarget} onChange={(event) => updateChoiceDraft(actor, { switchTarget: Number(event.target.value) })}>
                                    {simBattle.player.bench.filter((benchIndex) => !simBattle.player.units[benchIndex]?.fainted).map((benchIndex) => (
                                      <option key={benchIndex} value={benchIndex}>{simBattle.player.units[benchIndex]?.pokemon.displayName}</option>
                                    ))}
                                  </select>
                                </label>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <div className="team-actions">
                        <button className="action-button primary" onClick={submitSimTurn}>Resolve Turn</button>
                        <button className="action-button" onClick={() => { setSimBattle(null); setSimChoiceDrafts({}); }}>End Simulation</button>
                      </div>
                    </>
                  ) : (
                    <div className="team-actions">
                      <button className="action-button primary" onClick={() => { setSimBattle(null); setSimChoiceDrafts({}); startSimulatorPreview(); }}>Run Another Match</button>
                      <button className="action-button" onClick={() => { setSimBattle(null); setSimChoiceDrafts({}); }}>Close Simulator</button>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-state">
                  <strong>No active simulation yet.</strong>
                  <span>Generate an opponent to open team preview, then lock your four and play a live battle sandbox.</span>
                </div>
              )}
            </div>
          </section>
        )}

        {activeTab === 'profile' && (
          <section className="page-grid">
            <div className="panel tall">
              <SectionHeader title="Trainer Profile" subtitle="Saved locally so your teams, preferences, and notes persist between sessions." />
              <label className="field">
                <span>Trainer Name</span>
                <input value={state.profile.trainerName} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, trainerName: event.target.value } }))} placeholder="Your ladder or tournament tag" />
              </label>
              <label className="field">
                <span>Favorite Format</span>
                <select value={state.profile.favoriteFormat} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, favoriteFormat: event.target.value as BattleFormat } }))}>
                  {battleFormats.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Player Notes</span>
                <textarea rows={6} value={state.profile.playerNote} onChange={(event) => setState((current) => ({ ...current, profile: { ...current.profile, playerNote: event.target.value } }))} placeholder="Personal metagame reads, comfort picks, anti-meta angles..." />
              </label>
            </div>

            <div className="panel tall">
              <SectionHeader title="Save Data" subtitle="Everything in this app is stored in local browser storage for the current machine." />
              <div className="notes-list scroll-stack">
                <div className="note-row">Profile saved: {state.profile.trainerName || 'Not yet named'}</div>
                <div className="note-row">Teams saved: {state.teams.length}</div>
                <div className="note-row">Current roster source pages: {dataset.sourcePages.length}</div>
                <div className="note-row">Layout mode: {state.profile.layoutMode}</div>
                <div className="note-row">Resizable panels: {state.profile.resizablePanels ? 'On' : 'Off'}</div>
                <div className="note-row">Community usage labels currently blend April-May 2026 Game8 usage and tier snapshots with local fallback scoring where public data is thin.</div>
              </div>
              <button className="action-button danger" onClick={resetEverything}>Clear Local Save</button>
            </div>

            <div className="panel tall">
              <SectionHeader title="What Still Needs Depth" subtitle="Current implementation opinion on the next layers worth adding." />
              <div className="notes-list scroll-stack">
                <div className="note-row">The battle sandbox already handles preview, bringing four, switching, targeting, setup, healing, Protect, Tailwind, Trick Room, and AI turn choice, but edge-case abilities still need deeper per-ability scripting.</div>
                <div className="note-row">Some simulator interactions still use matchup-weighted approximations rather than a full one-to-one cartridge rules engine.</div>
                <div className="note-row">The next best upgrade after this pass is a larger move-effect table and ability-specific simulator hooks for rare edge cases.</div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function SectionHeader({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className={compact ? 'section-header compact' : 'section-header'}>
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function InfoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function UsagePill({ insight, small = false }: { insight: ReturnType<typeof getMoveUsageInsight>; small?: boolean }) {
  return <span className={small ? `usage-pill ${insight.label.toLowerCase()} small` : `usage-pill ${insight.label.toLowerCase()}`}>{insight.label}</span>;
}

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <button type="button" className={checked ? 'toggle-switch active' : 'toggle-switch'} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </label>
  );
}

function PokemonSpriteFrame({ pokemon, size = 'standard', label }: { pokemon: PokemonEntry | null; size?: 'mini' | 'tiny' | 'standard' | 'pokedex'; label?: string }) {
  const sprite = displaySpriteForPokemon(pokemon);
  const syntheticMega = usesMegaSpriteFallback(pokemon);
  const className = `sprite-shell ${size}${syntheticMega ? ' mega-fallback' : ''}`;

  if (!sprite) {
    return <div className={`${className} sprite-fallback`}>{label?.[0] ?? '?'}</div>;
  }

  return (
    <div className={className}>
      <img src={sprite} alt={pokemon?.displayName ?? label ?? 'Pokemon'} className="sprite-image" />
      {syntheticMega ? <span className="mega-pill">Mega</span> : null}
    </div>
  );
}

function BattleSideView({ side, format, friendly = false }: { side: SimulatorBattleState['player']; format: BattleFormat; friendly?: boolean }) {
  return (
    <div className={friendly ? 'battle-side friendly' : 'battle-side'}>
      <h3>{side.name}</h3>
      <div className="battle-active-row">
        {side.active.map((unitIndex, index) => {
          const unit = side.units[unitIndex];
          if (!unit) {
            return null;
          }

          return (
            <div key={`${unit.pokemon.id}-${index}`} className="battle-card">
              <PokemonSpriteFrame pokemon={unit.pokemon} size="standard" />
              <strong>{unit.pokemon.displayName}</strong>
              <small>{describeBuildRole(unit.build, format)}</small>
              <div className="hp-bar">
                <div className="hp-fill" style={{ width: `${Math.max(0, (unit.currentHp / unit.maxHp) * 100)}%` }} />
              </div>
              <span>{unit.currentHp} / {unit.maxHp}</span>
            </div>
          );
        })}
      </div>
      <div className="battle-bench-row">
        {side.bench.map((unitIndex) => {
          const unit = side.units[unitIndex];
          return unit ? (
            <div key={unit.pokemon.id} className="battle-bench-card">
              <PokemonSpriteFrame pokemon={unit.pokemon} size="tiny" />
              <small>{unit.pokemon.displayName}</small>
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

function BuildEditor({
  build,
  onChange,
  title,
  format,
  condensed = false,
}: {
  build: PokemonBuild;
  onChange: (next: PokemonBuild) => void;
  title: string;
  format: BattleFormat;
  condensed?: boolean;
}) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const basePokemon = selectedPokemon(build);
  const activePokemon = resolvePokemonForm(build);
  const megaForm = basePokemon ? findMegaForm(basePokemon) : null;
  const filteredPokemon = dataset.pokemon.filter((entry) => pickerLabel(entry).toLowerCase().includes(deferredSearch.toLowerCase()));
  const effectiveBuild = activePokemon ? { ...build, moveIds: normalizeMoveSelection(build, activePokemon) } : build;
  const stats = activePokemon ? buildStats(activePokemon.baseStats, effectiveBuild.evs, effectiveBuild.natureId) : null;
  const availableItems = availableItemsForPokemon(basePokemon ?? activePokemon);
  const usage = getPokemonUsageInsight(activePokemon ?? basePokemon, format);
  const presetSummary = getPopularPresetSummary(activePokemon ?? basePokemon, format);

  function patch(partial: Partial<PokemonBuild>) {
    onChange({
      ...effectiveBuild,
      ...partial,
      evs: partial.evs ? { ...partial.evs } : { ...effectiveBuild.evs },
      moveIds: partial.moveIds ? [...partial.moveIds] : [...effectiveBuild.moveIds],
    });
  }

  function updateEv(stat: keyof PokemonBuild['evs'], value: number) {
    patch({
      evs: {
        ...effectiveBuild.evs,
        [stat]: Math.max(0, Math.min(252, Math.round(value / 4) * 4)),
      },
    });
  }

  return (
    <div className={condensed ? 'editor-stack condensed' : 'editor-stack'}>
      <div className="editor-title-row">
        <div>
          <strong>{title}</strong>
          <small>{activePokemon ? `${activePokemon.displayName} - ${activePokemon.types.join(' / ')}` : 'Pick a Pokemon form from the current Champions roster.'}</small>
        </div>
        <PokemonSpriteFrame pokemon={activePokemon} size="standard" />
      </div>

      <div className="result-grid">
        <InfoStat label="Role" value={activePokemon ? describeBuildRole(effectiveBuild, format) : 'Open'} />
        <InfoStat label="Meta" value={usage.label} />
      </div>

      <label className="field">
        <span>Find Pokemon</span>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the current Champions roster..." />
      </label>

      <div className="picker-list scroll-stack compact-scroll">
        {filteredPokemon.slice(0, condensed ? 10 : 14).map((entry) => (
          <button key={entry.id} className={entry.id === activePokemon?.id ? 'picker-row active' : 'picker-row'} onClick={() => onChange(prepareBuildForPokemon(effectiveBuild, entry.id, format))}>
            <PokemonSpriteFrame pokemon={entry} size="tiny" />
            <div>
              <strong>{entry.displayName}</strong>
              <small>{entry.types.join(' / ')}</small>
            </div>
            <UsagePill insight={getPokemonUsageInsight(entry, format)} small />
          </button>
        ))}
      </div>

      <div className="control-grid two">
        <label className="field">
          <span>Nickname</span>
          <input value={effectiveBuild.nickname} onChange={(event) => patch({ nickname: event.target.value })} placeholder="Optional nickname" />
        </label>
        <label className="field">
          <span>Nature</span>
          <select value={effectiveBuild.natureId} onChange={(event) => patch({ natureId: event.target.value })}>
            {natures.map((nature) => (
              <option key={nature.id} value={nature.id}>{nature.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Base Ability</span>
          <select value={effectiveBuild.abilityName ?? ''} onChange={(event) => patch({ abilityName: event.target.value })} disabled={!basePokemon}>
            {(basePokemon?.abilities ?? []).map((ability) => (
              <option key={ability.name} value={ability.name}>{ability.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Item</span>
          <select value={effectiveBuild.itemId ?? ''} onChange={(event) => patch({ itemId: event.target.value || null })}>
            <option value="">No item</option>
            {availableItems.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="control-grid three">
        <ToggleField
          label="Mega Evolve"
          checked={effectiveBuild.useMega}
          onChange={(checked) => {
            const megaStone = findMegaStoneItem(basePokemon, megaForm);
            patch({
              useMega: checked,
              itemId: checked && megaStone ? megaStone.id : effectiveBuild.itemId && getItemById(effectiveBuild.itemId)?.category === 'mega-stone' ? null : effectiveBuild.itemId,
            });
          }}
        />
        <label className="field">
          <span>Status</span>
          <select value={effectiveBuild.status} onChange={(event) => patch({ status: event.target.value as PokemonBuild['status'] })}>
            {statusOptions.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Current HP %</span>
          <input type="number" min={1} max={100} value={effectiveBuild.currentHpPercent} onChange={(event) => patch({ currentHpPercent: Number(event.target.value) })} />
        </label>
      </div>

      {effectiveBuild.useMega && megaForm ? (
        <div className="mega-ability-stack">
          <label className="field">
            <span>Original Ability</span>
            <input value={effectiveBuild.abilityName ?? basePokemon?.abilities[0]?.name ?? ''} readOnly />
          </label>
          <label className="field">
            <span>Mega Ability</span>
            <input value={megaForm.abilities[0]?.name ?? 'Unknown'} readOnly />
          </label>
        </div>
      ) : null}

      <div className="control-grid five">
        {(['attackStage', 'defenseStage', 'specialAttackStage', 'specialDefenseStage', 'speedStage'] as const).map((field) => (
          <label key={field} className="field small">
            <span>{field.replace('Stage', '').replace('special', 'Sp').replace('Attack', 'A').replace('Defense', 'D')}</span>
            <input type="number" min={-6} max={6} value={effectiveBuild[field]} onChange={(event) => patch({ [field]: Math.max(-6, Math.min(6, Number(event.target.value))) } as Partial<PokemonBuild>)} />
          </label>
        ))}
      </div>

      <div className="ev-grid">
        {statOrder.map((stat) => (
          <label key={stat} className="field small">
            <span>{statLabels[stat]} EV</span>
            <input type="number" min={0} max={252} step={4} value={effectiveBuild.evs[stat]} onChange={(event) => updateEv(stat, Number(event.target.value))} />
          </label>
        ))}
      </div>

      {stats ? (
        <div className="stats-bar-grid compact">
          {statOrder.map((stat) => (
            <div key={stat} className="stat-bar-card">
              <span>{statLabels[stat]}</span>
              <strong>{stats[stat]}</strong>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (stats[stat] / 220) * 100)}%` }} /></div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="move-selector-grid">
        {[0, 1, 2, 3].map((index) => {
          const move = activePokemon?.movePool.find((entry) => entry.id === effectiveBuild.moveIds[index]);
          return (
            <label key={index} className="field">
              <span>Move {index + 1}</span>
              <select
                value={effectiveBuild.moveIds[index] ?? ''}
                onChange={(event) => {
                  const nextMoveIds = [...effectiveBuild.moveIds];
                  nextMoveIds[index] = event.target.value;
                  patch({ moveIds: nextMoveIds.filter(Boolean) });
                }}
                disabled={!activePokemon}
              >
                {(activePokemon?.movePool ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>{entry.name}</option>
                ))}
              </select>
              {move ? <UsagePill insight={getMoveUsageInsight(move.name, format)} small /> : null}
            </label>
          );
        })}
      </div>

      {activePokemon ? (
        <div className="notes-list compact-scroll">
          <div className="note-row">{activePokemon.classification || 'Current battle form'} - {describeMegaState(effectiveBuild, basePokemon)}</div>
          {presetSummary ? <div className="note-row">Popular {format} set: {presetSummary.moveNames.join(', ')}</div> : null}
          <div className="note-row">{usage.reason}</div>
          {(basePokemon?.abilities ?? []).slice(0, 2).map((ability) => (
            <div key={ability.name} className="note-row"><strong>{ability.name}:</strong> {ability.description}</div>
          ))}
          {megaForm?.abilities[0] && effectiveBuild.useMega ? <div className="note-row"><strong>{megaForm.abilities[0].name}:</strong> {megaForm.abilities[0].description}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export default App;
