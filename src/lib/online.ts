import {
  applyReplacementChoices,
  createSimulatorBattle,
  advancePreviewToBattle,
  battleHasPendingReplacements,
  buildAutoReplacementChoices,
  randomChoicesForSide,
  resolveTurnWithChoices,
  type SimulatorBattleState,
  type SimulatorChoice,
} from './simulator';
import { battleMusicTracks } from './battleMusic';
import { createTeam, makeId, resolvePokemonForm, sanitizeTeamForChampions, selectedPokemon } from './champions';
import type {
  BattleFormat,
  OnlineBattleAccount,
  OnlineBattleChatMessage,
  OnlineBattleChatParticipant,
  OnlineBattleRecordSummary,
  OnlineBattleReportEntry,
  OnlineBattleRoomHistoryEntry,
  OnlinePresenceStats,
  PokemonEntry,
  Team,
} from '../types';
export type { OnlineBattleTrack } from './battleMusic';

export type OnlineSeat = 'host' | 'guest';
export type OnlineRoomStage = 'lobby' | 'preview' | 'battle' | 'finished';

export interface OnlineBattleRoomState {
  code: string;
  format: BattleFormat;
  stage: OnlineRoomStage;
  createdAt: string;
  updatedAt: string;
  hostPlayerId: string;
  hostTrainerName: string;
  guestPlayerId: string | null;
  guestTrainerName: string | null;
  hostTeam: Team;
  guestTeam: Team | null;
  hostBringOrder: number[];
  guestBringOrder: number[];
  pendingHostChoices: SimulatorChoice[] | null;
  pendingGuestChoices: SimulatorChoice[] | null;
  battle: SimulatorBattleState | null;
  deadlineAt: string | null;
  matchDeadlineAt: string | null;
  timerSeconds: number;
  musicTrackId: string;
  hostAnnouncerEnabled: boolean;
  guestAnnouncerEnabled: boolean;
  winnerSeat: OnlineSeat | null;
  resultReason: 'normal' | 'forfeit' | 'timeout' | null;
  lastActionSummary: string;
  hostWinnerPick: OnlineSeat | null;
  guestWinnerPick: OnlineSeat | null;
  chatParticipants: OnlineBattleChatParticipant[];
  chatMessages: OnlineBattleChatMessage[];
  moderationReports: OnlineBattleReportEntry[];
  mirroredBattleLogCount: number;
}

export interface OnlineBattleRoomView {
  code: string;
  format: BattleFormat;
  stage: OnlineRoomStage;
  seat: OnlineSeat | null;
  playerId: string;
  opponentPlayerId: string | null;
  hostTrainerName: string;
  guestTrainerName: string | null;
  playerTeam: Team;
  opponentTeam: Team | null;
  battle: SimulatorBattleState | null;
  playerBringOrder: number[];
  opponentBringCount: number;
  deadlineAt: string | null;
  matchDeadlineAt: string | null;
  timerSeconds: number;
  playerChoicesLocked: boolean;
  opponentChoicesLocked: boolean;
  winnerName: string | null;
  resultReason: 'normal' | 'forfeit' | 'timeout' | null;
  musicTrackId: string;
  hostAnnouncerEnabled: boolean;
  guestAnnouncerEnabled: boolean;
  lastActionSummary: string;
  playerRecord: OnlineBattleRecordSummary;
  opponentRecord: OnlineBattleRecordSummary;
  chatParticipants: OnlineBattleChatParticipant[];
  chatMessages: OnlineBattleChatMessage[];
  playerChatJoined: boolean;
  opponentChatJoined: boolean;
  playerWinnerPick: OnlineSeat | null;
  opponentWinnerPick: OnlineSeat | null;
}

type StoredOnlineAccount = OnlineBattleAccount & {
  passwordHash: string;
};

type LocalPresenceStore = {
  totalVisits: number;
  sessions: Record<string, string>;
};

type LocalOnlineStore = {
  accounts: StoredOnlineAccount[];
  rooms: OnlineBattleRoomState[];
  presence: LocalPresenceStore;
};

const LOCAL_STORAGE_KEY = 'pokemon-champions-lab-online-v1';
const SESSION_STORAGE_KEY = 'pokemon-champions-lab-online-session';
const ACTIVE_WINDOW_MS = 90_000;
const NETLIFY_FUNCTION_ENDPOINT = '/.netlify/functions/arena';
const MATCH_TIMER_SECONDS = 10 * 60;

const hiddenPokemon: PokemonEntry = {
  id: 'hidden-slot',
  displayName: 'Hidden Pokemon',
  dexNumber: 0,
  types: ['Unknown'],
  classification: 'Unknown',
  height: '0',
  weight: '0',
  sprite: '',
  shinySprite: '',
  isMega: false,
  abilities: [],
  baseStats: {
    hp: 1,
    attack: 1,
    defense: 1,
    specialAttack: 1,
    specialDefense: 1,
    speed: 1,
  },
  neutralRanges: {
    hp: '1',
    attack: '1',
    defense: '1',
    specialAttack: '1',
    specialDefense: '1',
    speed: '1',
  },
  movePool: [],
  damageTaken: {},
  speciesSlug: 'hidden',
  baseSpecies: 'Hidden Pokemon',
  megaStone: null,
};

function nowIso() {
  return new Date().toISOString();
}

function clone<T>(value: T) {
  return structuredClone(value);
}

function emptyBattleRecordSummary(): OnlineBattleRecordSummary {
  return {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: 0,
  };
}

function normalizeRoomState(room: OnlineBattleRoomState): OnlineBattleRoomState {
  room.hostWinnerPick ??= null;
  room.guestWinnerPick ??= null;
  room.chatParticipants ??= [];
  room.chatMessages ??= [];
  room.moderationReports ??= [];
  room.mirroredBattleLogCount ??= 0;
  return room;
}

function sixDigitCode() {
  return `${Math.floor(100000 + Math.random() * 900000)}`;
}

function seatForPlayer(room: OnlineBattleRoomState, playerId: string): OnlineSeat | null {
  if (room.hostPlayerId === playerId) {
    return 'host';
  }
  if (room.guestPlayerId === playerId) {
    return 'guest';
  }
  return null;
}

function filledSlotIndices(team: Team) {
  return team.slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => Boolean(selectedPokemon(slot) ?? resolvePokemonForm(slot)))
    .map(({ index }) => index);
}

function seatTeam(room: OnlineBattleRoomState, seat: OnlineSeat) {
  return seat === 'host' ? room.hostTeam : room.guestTeam;
}

function setSeatTeam(room: OnlineBattleRoomState, seat: OnlineSeat, team: Team) {
  if (seat === 'host') {
    room.hostTeam = team;
  } else {
    room.guestTeam = team;
  }
}

function seatBringOrder(room: OnlineBattleRoomState, seat: OnlineSeat) {
  return seat === 'host' ? room.hostBringOrder : room.guestBringOrder;
}

function setSeatBringOrder(room: OnlineBattleRoomState, seat: OnlineSeat, order: number[]) {
  if (seat === 'host') {
    room.hostBringOrder = [...order];
  } else {
    room.guestBringOrder = [...order];
  }
}

function setSeatChoices(room: OnlineBattleRoomState, seat: OnlineSeat, choices: SimulatorChoice[] | null) {
  if (seat === 'host') {
    room.pendingHostChoices = choices ? clone(choices) : null;
  } else {
    room.pendingGuestChoices = choices ? clone(choices) : null;
  }
}

function trainerNameForSeat(room: OnlineBattleRoomState, seat: OnlineSeat) {
  return seat === 'host' ? room.hostTrainerName : room.guestTrainerName ?? 'Guest';
}

function playerIdForSeat(room: OnlineBattleRoomState, seat: OnlineSeat) {
  return seat === 'host' ? room.hostPlayerId : room.guestPlayerId ?? '';
}

function chatParticipantForSeat(room: OnlineBattleRoomState, seat: OnlineSeat): OnlineBattleChatParticipant {
  return {
    playerId: playerIdForSeat(room, seat),
    trainerName: trainerNameForSeat(room, seat),
    seat,
    joinedAt: nowIso(),
  };
}

function appendRoomMessage(
  room: OnlineBattleRoomState,
  message: Omit<OnlineBattleChatMessage, 'id' | 'createdAt'>,
) {
  room.chatMessages.push({
    ...message,
    id: makeId('room-message'),
    createdAt: nowIso(),
  });
}

function appendSystemMessage(
  room: OnlineBattleRoomState,
  text: string,
  kind: OnlineBattleChatMessage['kind'] = 'system',
) {
  appendRoomMessage(room, {
    kind,
    senderPlayerId: null,
    senderName: kind === 'announcer' ? 'Arena Commentary' : 'System',
    seat: null,
    text,
    emoji: null,
  });
}

function appendBattleLogMessages(room: OnlineBattleRoomState) {
  if (!room.battle?.log.length) {
    return;
  }
  const unseenCount = Math.max(0, room.battle.log.length - room.mirroredBattleLogCount);
  if (!unseenCount) {
    return;
  }
  room.battle.log
    .slice(0, unseenCount)
    .reverse()
    .forEach((entry) => appendSystemMessage(room, entry, 'announcer'));
  room.mirroredBattleLogCount = room.battle.log.length;
}

function recordSummaryForPlayer(rooms: OnlineBattleRoomState[], playerId: string): OnlineBattleRecordSummary {
  const summary = emptyBattleRecordSummary();
  for (const room of rooms) {
    const seat = seatForPlayer(room, playerId);
    if (!seat || room.stage !== 'finished') {
      continue;
    }
    summary.matches += 1;
    if (!room.winnerSeat) {
      summary.draws += 1;
    } else if (room.winnerSeat === seat) {
      summary.wins += 1;
    } else {
      summary.losses += 1;
    }
  }
  if (summary.matches) {
    summary.winRate = Math.round((summary.wins / summary.matches) * 100);
  }
  return summary;
}

function sanitizePreviewTeam(team: Team) {
  const next = clone(team);
  next.notes = '';
  next.slots = next.slots.map((slot) => ({
    ...slot,
    nickname: '',
    itemId: null,
    abilityName: null,
    moveIds: [],
    notes: '',
  }));
  return next;
}

function sanitizeBattleForViewer(battle: SimulatorBattleState, viewerSeat: OnlineSeat) {
  const next = clone(battle);
  if (viewerSeat === 'guest') {
    [next.player, next.opponent] = [next.opponent, next.player];
    if (next.winner === 'player') {
      next.winner = 'opponent';
    } else if (next.winner === 'opponent') {
      next.winner = 'player';
    }
  }

  const viewerSide = next.player;
  const opponentSide = next.opponent;

  viewerSide.name = 'You';
  opponentSide.name = 'Opponent';

  for (const unit of opponentSide.units) {
    unit.build = {
      ...unit.build,
      itemId: null,
      abilityName: null,
      moveIds: [],
      notes: '',
    };
    if (!unit.revealed && !opponentSide.active.includes(opponentSide.units.indexOf(unit))) {
      unit.pokemon = hiddenPokemon;
      unit.basePokemon = hiddenPokemon;
      unit.megaPokemon = null;
      unit.build.pokemonId = null;
    }
  }

  return next;
}

export function roomView(room: OnlineBattleRoomState, playerId: string, allRooms: OnlineBattleRoomState[] = [room]): OnlineBattleRoomView | null {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    return null;
  }

  const isHost = seat === 'host';
  const opponentSeat: OnlineSeat = isHost ? 'guest' : 'host';
  const playerIdForView = playerIdForSeat(room, seat);
  const playerTeam = clone((isHost ? room.hostTeam : room.guestTeam) ?? createTeam('Empty'));
  const opponentTeam = clone((isHost ? room.guestTeam : room.hostTeam) ?? createTeam('Empty'));
  const playerChatJoined = room.chatParticipants.some((participant) => participant.playerId === playerId);
  const opponentPlayerId = playerIdForSeat(room, opponentSeat);
  const opponentChatJoined = room.chatParticipants.some((participant) => participant.playerId === opponentPlayerId);
  return {
    code: room.code,
    format: room.format,
    stage: room.stage,
    seat,
    playerId: playerIdForView,
    opponentPlayerId: opponentPlayerId || null,
    hostTrainerName: room.hostTrainerName,
    guestTrainerName: room.guestTrainerName,
    playerTeam,
    opponentTeam: room.stage === 'lobby' ? null : sanitizePreviewTeam(opponentTeam),
    battle: room.battle ? sanitizeBattleForViewer(room.battle, seat) : null,
    playerBringOrder: clone(seatBringOrder(room, seat)),
    opponentBringCount: seatBringOrder(room, isHost ? 'guest' : 'host').length,
    deadlineAt: room.deadlineAt,
    matchDeadlineAt: room.matchDeadlineAt,
    timerSeconds: room.timerSeconds,
    playerChoicesLocked: seat === 'host' ? Boolean(room.pendingHostChoices) : Boolean(room.pendingGuestChoices),
    opponentChoicesLocked: seat === 'host' ? Boolean(room.pendingGuestChoices) : Boolean(room.pendingHostChoices),
    winnerName:
      room.winnerSeat === 'host'
        ? room.hostTrainerName
        : room.winnerSeat === 'guest'
          ? room.guestTrainerName
          : null,
    resultReason: room.resultReason,
    musicTrackId: room.musicTrackId,
    hostAnnouncerEnabled: room.hostAnnouncerEnabled,
    guestAnnouncerEnabled: room.guestAnnouncerEnabled,
    lastActionSummary: room.lastActionSummary,
    playerRecord: recordSummaryForPlayer(allRooms, playerId),
    opponentRecord: opponentPlayerId ? recordSummaryForPlayer(allRooms, opponentPlayerId) : emptyBattleRecordSummary(),
    chatParticipants: clone(room.chatParticipants),
    chatMessages: clone(room.chatMessages),
    playerChatJoined,
    opponentChatJoined,
    playerWinnerPick: isHost ? room.hostWinnerPick : room.guestWinnerPick,
    opponentWinnerPick: isHost ? room.guestWinnerPick : room.hostWinnerPick,
  };
}

export function roomHistoryEntry(room: OnlineBattleRoomState, playerId: string): OnlineBattleRoomHistoryEntry | null {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat || room.stage !== 'finished') {
    return null;
  }

  const isHost = seat === 'host';
  const trainerName = isHost ? room.hostTrainerName : room.guestTrainerName ?? 'Guest';
  const opponentName = isHost ? room.guestTrainerName ?? 'Guest' : room.hostTrainerName;
  const winnerName =
    room.winnerSeat === 'host'
      ? room.hostTrainerName
      : room.winnerSeat === 'guest'
        ? room.guestTrainerName ?? null
        : null;

  return {
    code: room.code,
    playedAt: room.updatedAt,
    format: room.format,
    trainerName,
    opponentName,
    result: room.winnerSeat === seat ? 'Win' : room.winnerSeat ? 'Loss' : 'Draw',
    resultReason: room.resultReason,
    turns: room.battle ? Math.max(1, room.battle.turn - 1) : 0,
    musicTrackId: room.musicTrackId,
    winnerName,
  };
}

function requiredBringCount(team: Team) {
  return Math.min(4, filledSlotIndices(team).length);
}

function allPreviewReady(room: OnlineBattleRoomState) {
  const hostNeeded = requiredBringCount(room.hostTeam);
  const guestNeeded = room.guestTeam ? requiredBringCount(room.guestTeam) : 0;
  return Boolean(room.guestTeam && room.hostBringOrder.length === hostNeeded && room.guestBringOrder.length === guestNeeded);
}

function startRoomBattle(room: OnlineBattleRoomState) {
  normalizeRoomState(room);
  if (!room.guestTeam || !allPreviewReady(room)) {
    return room;
  }

  const hostTeam = clone(room.hostTeam);
  const guestTeam = clone(room.guestTeam);
  hostTeam.format = room.format;
  guestTeam.format = room.format;
  room.battle = advancePreviewToBattle(createSimulatorBattle(room.format, hostTeam, room.hostBringOrder, guestTeam, room.guestBringOrder, null));
  if (room.battle.player.units.length !== room.hostBringOrder.length) {
    throw new Error('One or more selected host Pokemon are no longer legal in the current Champions roster. Re-open preview and lock a fresh bring order.');
  }
  if (room.battle.opponent.units.length !== room.guestBringOrder.length) {
    throw new Error('One or more selected guest Pokemon are no longer legal in the current Champions roster. Re-open preview and lock a fresh bring order.');
  }
  room.stage = room.battle.winner ? 'finished' : 'battle';
  room.deadlineAt = room.battle.winner ? null : new Date(Date.now() + room.timerSeconds * 1000).toISOString();
  room.matchDeadlineAt = room.battle.winner ? null : new Date(Date.now() + MATCH_TIMER_SECONDS * 1000).toISOString();
  room.pendingHostChoices = null;
  room.pendingGuestChoices = null;
  room.lastActionSummary = `${room.hostTrainerName} and ${room.guestTrainerName ?? 'Opponent'} entered the field.`;
  appendSystemMessage(room, `Battle start: ${room.hostTrainerName} and ${room.guestTrainerName ?? 'Opponent'} sent their leads to the field.`, 'announcer');
  appendBattleLogMessages(room);
  return room;
}

function finishRoomAsTimeout(room: OnlineBattleRoomState) {
  normalizeRoomState(room);
  if (!room.battle) {
    return room;
  }

  room.stage = 'finished';
  room.deadlineAt = null;
  room.matchDeadlineAt = null;
  room.pendingHostChoices = null;
  room.pendingGuestChoices = null;
  room.winnerSeat = null;
  room.resultReason = 'timeout';
  room.battle.stage = 'finished';
  room.battle.winner = null;
  room.battle.log.unshift('Match timer expired. Under the current Pokemon Champions timeout rule, the battle ends in a draw.');
  room.lastActionSummary = 'Match timer expired. The battle has been recorded as a draw.';
  appendBattleLogMessages(room);
  appendSystemMessage(room, 'Room closed on match time. The result is a draw.', 'system');
  return room;
}

function maybeResolvePendingTurn(room: OnlineBattleRoomState) {
  normalizeRoomState(room);
  if (room.stage !== 'battle' || !room.battle || room.winnerSeat || !room.guestPlayerId) {
    return room;
  }

  const matchDeadlineReached = room.matchDeadlineAt ? Date.now() >= new Date(room.matchDeadlineAt).getTime() : false;
  if (matchDeadlineReached) {
    return finishRoomAsTimeout(room);
  }

  const deadlineReached = room.deadlineAt ? Date.now() >= new Date(room.deadlineAt).getTime() : false;
  const bothPlayersLocked = Boolean(room.pendingHostChoices && room.pendingGuestChoices);
  if (!deadlineReached && !bothPlayersLocked) {
    return room;
  }

  if (battleHasPendingReplacements(room.battle)) {
    const nextBattle = applyReplacementChoices(
      room.battle,
      room.pendingHostChoices ?? buildAutoReplacementChoices(room.battle, 'player'),
      room.pendingGuestChoices ?? buildAutoReplacementChoices(room.battle, 'opponent'),
    );
    room.battle = nextBattle;
    room.pendingHostChoices = null;
    room.pendingGuestChoices = null;
    room.deadlineAt = nextBattle.winner ? null : new Date(Date.now() + room.timerSeconds * 1000).toISOString();
    room.matchDeadlineAt = nextBattle.winner ? null : room.matchDeadlineAt;
    room.lastActionSummary = nextBattle.winner
      ? `${nextBattle.winner === 'player' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} closed the battle.`
      : `Replacement send-outs are complete for Turn ${nextBattle.turn}. The next move phase is live.`;

    if (nextBattle.winner) {
      room.stage = 'finished';
      room.winnerSeat = nextBattle.winner === 'player' ? 'host' : 'guest';
      room.resultReason = room.resultReason ?? 'normal';
    }

    appendBattleLogMessages(room);
    if (nextBattle.winner) {
      appendSystemMessage(room, `Battle end: ${room.winnerSeat === 'host' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} wins the room.`, 'announcer');
    }

    return room;
  }

  const nextBattle = resolveTurnWithChoices(
    room.battle,
    room.pendingHostChoices ?? randomChoicesForSide(room.battle, 'player'),
    room.pendingGuestChoices ?? randomChoicesForSide(room.battle, 'opponent'),
  );
  room.battle = nextBattle;
  room.pendingHostChoices = null;
  room.pendingGuestChoices = null;
  room.deadlineAt = nextBattle.winner ? null : new Date(Date.now() + room.timerSeconds * 1000).toISOString();
  room.matchDeadlineAt = nextBattle.winner ? null : room.matchDeadlineAt;
  room.lastActionSummary = nextBattle.winner
    ? `${nextBattle.winner === 'player' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} closed the battle.`
    : `Turn ${nextBattle.turn - 1} resolved and the board has reset for the next decision.`;

  if (nextBattle.winner) {
    room.stage = 'finished';
    room.winnerSeat = nextBattle.winner === 'player' ? 'host' : 'guest';
    room.resultReason = room.resultReason ?? 'normal';
  }

  appendBattleLogMessages(room);
  if (nextBattle.winner) {
    appendSystemMessage(room, `Battle end: ${room.winnerSeat === 'host' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} wins the room.`, 'announcer');
  }

  return room;
}

export function createRoomState(
  account: OnlineBattleAccount,
  team: Team,
  format: BattleFormat,
  musicTrackId: string,
  announcerEnabled: boolean,
) {
  const createdAt = nowIso();
  return {
    code: sixDigitCode(),
    format,
    stage: 'lobby',
    createdAt,
    updatedAt: createdAt,
    hostPlayerId: account.playerId,
    hostTrainerName: account.trainerName,
    guestPlayerId: null,
    guestTrainerName: null,
    hostTeam: sanitizeTeamForChampions(clone(team)),
    guestTeam: null,
    hostBringOrder: [],
    guestBringOrder: [],
    pendingHostChoices: null,
    pendingGuestChoices: null,
    battle: null,
    deadlineAt: null,
    matchDeadlineAt: null,
    timerSeconds: 30,
    musicTrackId,
    hostAnnouncerEnabled: announcerEnabled,
    guestAnnouncerEnabled: true,
    winnerSeat: null,
    resultReason: null,
    lastActionSummary: `${account.trainerName} opened room ${musicTrackId ? `with ${musicTrackId}` : 'for a live battle'}.`,
    hostWinnerPick: null,
    guestWinnerPick: null,
    chatParticipants: [],
    chatMessages: [],
    moderationReports: [],
    mirroredBattleLogCount: 0,
  } satisfies OnlineBattleRoomState;
}

export function joinRoomState(
  room: OnlineBattleRoomState,
  account: OnlineBattleAccount,
  team: Team,
  musicTrackId: string,
  announcerEnabled: boolean,
) {
  normalizeRoomState(room);
  if (room.guestPlayerId && room.guestPlayerId !== account.playerId) {
    throw new Error('This room already has two battlers.');
  }

  room.guestPlayerId = account.playerId;
  room.guestTrainerName = account.trainerName;
  room.guestTeam = sanitizeTeamForChampions(clone(team));
  room.musicTrackId = musicTrackId || room.musicTrackId;
  room.guestAnnouncerEnabled = announcerEnabled;
  room.stage = 'preview';
  room.deadlineAt = new Date(Date.now() + 60_000).toISOString();
  room.lastActionSummary = `${account.trainerName} joined the room. Team preview is live.`;
  room.updatedAt = nowIso();
  appendSystemMessage(room, `${account.trainerName} entered room ${room.code}. Team preview is now live.`);
  return room;
}

export function submitBringOrderState(room: OnlineBattleRoomState, playerId: string, order: number[]) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }

  const currentTeam = seatTeam(room, seat);
  if (!currentTeam) {
    throw new Error('No team is loaded for this seat.');
  }

  const legalIndices = new Set(filledSlotIndices(currentTeam));
  const nextOrder = [...new Set(order)].filter((slotIndex) => legalIndices.has(slotIndex)).slice(0, 4);
  if (nextOrder.length !== requiredBringCount(currentTeam)) {
    throw new Error(`Select exactly ${requiredBringCount(currentTeam)} Pokemon before battle start.`);
  }

  setSeatBringOrder(room, seat, nextOrder);
  room.updatedAt = nowIso();
  room.lastActionSummary = `${seat === 'host' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} locked their bring-four order.`;
  appendSystemMessage(room, `${trainerNameForSeat(room, seat)} locked their bring-four order.`);
  return startRoomBattle(room);
}

export function submitTurnChoicesState(room: OnlineBattleRoomState, playerId: string, choices: SimulatorChoice[]) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }
  if (room.stage !== 'battle' || !room.battle) {
    throw new Error('The room is not currently in battle.');
  }

  setSeatChoices(room, seat, choices);
  room.updatedAt = nowIso();
  room.lastActionSummary = `${seat === 'host' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} locked their turn choices.`;
  appendSystemMessage(room, `${trainerNameForSeat(room, seat)} locked turn choices.`, 'system');
  const nextRoom = maybeResolvePendingTurn(room);
  if (
    nextRoom.stage === 'battle'
    && nextRoom.pendingHostChoices
    && nextRoom.pendingGuestChoices
    && nextRoom.deadlineAt
  ) {
    nextRoom.lastActionSummary = battleHasPendingReplacements(nextRoom.battle!)
      ? 'Both players are locked in. The new Pokemon are entering together at the top of the turn now.'
      : 'Both players are locked in. The turn is resolving right away.';
  }
  return nextRoom;
}

export function forfeitRoomState(room: OnlineBattleRoomState, playerId: string) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }

  room.stage = 'finished';
  room.winnerSeat = seat === 'host' ? 'guest' : 'host';
  if (room.battle) {
    room.battle.winner = room.winnerSeat === 'host' ? 'player' : 'opponent';
  }
  room.resultReason = 'forfeit';
  room.deadlineAt = null;
  room.matchDeadlineAt = null;
  room.pendingHostChoices = null;
  room.pendingGuestChoices = null;
  room.lastActionSummary = `${seat === 'host' ? room.hostTrainerName : room.guestTrainerName ?? 'Opponent'} forfeited the battle.`;
  room.updatedAt = nowIso();
  appendSystemMessage(room, `${trainerNameForSeat(room, seat)} forfeited the battle.`, 'announcer');
  return room;
}

export function touchRoomState(room: OnlineBattleRoomState) {
  normalizeRoomState(room);
  room.updatedAt = nowIso();
  return maybeResolvePendingTurn(room);
}

export function joinRoomChatState(room: OnlineBattleRoomState, playerId: string) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }
  if (!room.chatParticipants.some((participant) => participant.playerId === playerId)) {
    room.chatParticipants.push(chatParticipantForSeat(room, seat));
    appendSystemMessage(room, `${trainerNameForSeat(room, seat)} joined battle chat.`);
  }
  room.updatedAt = nowIso();
  return room;
}

export function leaveRoomChatState(room: OnlineBattleRoomState, playerId: string) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }
  const previousLength = room.chatParticipants.length;
  room.chatParticipants = room.chatParticipants.filter((participant) => participant.playerId !== playerId);
  if (room.chatParticipants.length !== previousLength) {
    appendSystemMessage(room, `${trainerNameForSeat(room, seat)} left battle chat.`);
  }
  room.updatedAt = nowIso();
  return room;
}

export function sendRoomChatMessageState(
  room: OnlineBattleRoomState,
  playerId: string,
  text: string,
  emoji: string | null = null,
) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }
  const trimmed = text.trim();
  if (!trimmed && !emoji) {
    throw new Error('Enter a message or choose a reaction.');
  }
  if (!room.chatParticipants.some((participant) => participant.playerId === playerId)) {
    joinRoomChatState(room, playerId);
  }
  appendRoomMessage(room, {
    kind: emoji && !trimmed ? 'reaction' : 'chat',
    senderPlayerId: playerId,
    senderName: trainerNameForSeat(room, seat),
    seat,
    text: trimmed,
    emoji,
  });
  room.updatedAt = nowIso();
  return room;
}

export function reportRoomPlayerState(
  room: OnlineBattleRoomState,
  reporterPlayerId: string,
  reportedPlayerId: string,
  reason: string,
) {
  normalizeRoomState(room);
  const reporterSeat = seatForPlayer(room, reporterPlayerId);
  const reportedSeat = seatForPlayer(room, reportedPlayerId);
  if (!reporterSeat || !reportedSeat || reporterPlayerId === reportedPlayerId) {
    throw new Error('Select a valid player to report.');
  }
  room.moderationReports.push({
    id: makeId('battle-report'),
    reporterPlayerId,
    reportedPlayerId,
    reportedTrainerName: trainerNameForSeat(room, reportedSeat),
    reason: reason.trim() || 'No reason provided.',
    createdAt: nowIso(),
    status: 'open',
  });
  appendSystemMessage(room, `${trainerNameForSeat(room, reporterSeat)} filed a conduct report.`);
  room.updatedAt = nowIso();
  return room;
}

export function voteRoomWinnerState(room: OnlineBattleRoomState, playerId: string, pick: OnlineSeat | null) {
  normalizeRoomState(room);
  const seat = seatForPlayer(room, playerId);
  if (!seat) {
    throw new Error('You are not seated in this room.');
  }
  if (seat === 'host') {
    room.hostWinnerPick = pick;
  } else {
    room.guestWinnerPick = pick;
  }
  room.updatedAt = nowIso();
  return room;
}

function initialLocalStore(): LocalOnlineStore {
  return {
    accounts: [],
    rooms: [],
    presence: {
      totalVisits: 0,
      sessions: {},
    },
  };
}

function readLocalStore() {
  if (typeof window === 'undefined') {
    return initialLocalStore();
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) {
      return initialLocalStore();
    }
    const parsed = JSON.parse(raw) as LocalOnlineStore;
    parsed.rooms = (parsed.rooms ?? []).map((room) => normalizeRoomState(room));
    return parsed;
  } catch {
    return initialLocalStore();
  }
}

function writeLocalStore(store: LocalOnlineStore) {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(store));
}

async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function activeBattleCount(rooms: OnlineBattleRoomState[]) {
  return rooms.filter((room) => room.stage === 'battle' || room.stage === 'preview').length;
}

export function heartbeatPresenceStore(store: LocalOnlineStore, sessionId: string) {
  const now = nowIso();
  if (!store.presence.sessions[sessionId]) {
    store.presence.totalVisits += 1;
  }
  store.presence.sessions[sessionId] = now;

  for (const [storedSessionId, lastSeen] of Object.entries(store.presence.sessions)) {
    if (Date.now() - new Date(lastSeen).getTime() > ACTIVE_WINDOW_MS) {
      delete store.presence.sessions[storedSessionId];
    }
  }

  return {
    activeUsers: Object.keys(store.presence.sessions).length,
    totalVisits: store.presence.totalVisits,
    activeBattles: activeBattleCount(store.rooms),
  } satisfies OnlinePresenceStats;
}

function findLocalRoom(store: LocalOnlineStore, code: string) {
  const room = store.rooms.find((entry) => entry.code === code) ?? null;
  return room ? normalizeRoomState(room) : null;
}

export async function localRegisterAccount(input: { trainerName: string; email: string; password: string }) {
  const store = readLocalStore();
  const trainerKey = input.trainerName.trim().toLowerCase();
  const emailKey = input.email.trim().toLowerCase();
  const existing = store.accounts.find(
    (account) => account.trainerName.trim().toLowerCase() === trainerKey || (emailKey && account.email.trim().toLowerCase() === emailKey),
  );
  if (existing) {
    throw new Error('That trainer name or email is already registered.');
  }

  const account = {
    playerId: makeId('pvp-player'),
    trainerName: input.trainerName.trim(),
    email: input.email.trim(),
    sessionToken: makeId('session'),
    registeredAt: nowIso(),
    passwordHash: await hashPassword(input.password),
  } satisfies StoredOnlineAccount;

  store.accounts.push(account);
  writeLocalStore(store);
  const { passwordHash: _passwordHash, ...publicAccount } = account;
  return publicAccount satisfies OnlineBattleAccount;
}

export async function localLoginAccount(input: { trainerNameOrEmail: string; password: string }) {
  const store = readLocalStore();
  const lookup = input.trainerNameOrEmail.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  const account = store.accounts.find(
    (entry) =>
      (entry.trainerName.trim().toLowerCase() === lookup || entry.email.trim().toLowerCase() === lookup) &&
      entry.passwordHash === passwordHash,
  );
  if (!account) {
    throw new Error('Account not found or password incorrect.');
  }

  account.sessionToken = makeId('session');
  writeLocalStore(store);
  const { passwordHash: _passwordHash, ...publicAccount } = account;
  return publicAccount satisfies OnlineBattleAccount;
}

export function localCreateRoom(input: {
  account: OnlineBattleAccount;
  team: Team;
  format: BattleFormat;
  musicTrackId: string;
  announcerEnabled: boolean;
}) {
  const store = readLocalStore();
  let room = createRoomState(input.account, input.team, input.format, input.musicTrackId, input.announcerEnabled);
  while (findLocalRoom(store, room.code)) {
    room = createRoomState(input.account, input.team, input.format, input.musicTrackId, input.announcerEnabled);
  }
  store.rooms = [...store.rooms.filter((entry) => entry.hostPlayerId !== input.account.playerId || entry.stage === 'finished'), room];
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not create the local room view.');
  }
  return nextView;
}

export function localJoinRoom(input: {
  account: OnlineBattleAccount;
  code: string;
  team: Team;
  musicTrackId: string;
  announcerEnabled: boolean;
}) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  joinRoomState(room, input.account, input.team, input.musicTrackId, input.announcerEnabled);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not open the joined room view.');
  }
  return nextView;
}

export function localFetchRoom(input: { account: OnlineBattleAccount; code: string }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    return null;
  }
  touchRoomState(room);
  writeLocalStore(store);
  return roomView(room, input.account.playerId, store.rooms);
}

export function localSubmitBringOrder(input: { account: OnlineBattleAccount; code: string; bringOrder: number[] }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  submitBringOrderState(room, input.account.playerId, input.bringOrder);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after bring order submission.');
  }
  return nextView;
}

export function localSubmitChoices(input: { account: OnlineBattleAccount; code: string; choices: SimulatorChoice[] }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  submitTurnChoicesState(room, input.account.playerId, input.choices);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after turn submission.');
  }
  return nextView;
}

export function localForfeitRoom(input: { account: OnlineBattleAccount; code: string }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  forfeitRoomState(room, input.account.playerId);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after the forfeit.');
  }
  return nextView;
}

export function localJoinRoomChat(input: { account: OnlineBattleAccount; code: string }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  joinRoomChatState(room, input.account.playerId);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after joining chat.');
  }
  return nextView;
}

export function localLeaveRoomChat(input: { account: OnlineBattleAccount; code: string }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  leaveRoomChatState(room, input.account.playerId);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after leaving chat.');
  }
  return nextView;
}

export function localSendRoomChatMessage(input: { account: OnlineBattleAccount; code: string; text: string; emoji?: string | null }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  sendRoomChatMessageState(room, input.account.playerId, input.text, input.emoji ?? null);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after sending chat.');
  }
  return nextView;
}

export function localReportRoomPlayer(input: { account: OnlineBattleAccount; code: string; reportedPlayerId: string; reason: string }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  reportRoomPlayerState(room, input.account.playerId, input.reportedPlayerId, input.reason);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after reporting a player.');
  }
  return nextView;
}

export function localVoteRoomWinner(input: { account: OnlineBattleAccount; code: string; pick: OnlineSeat | null }) {
  const store = readLocalStore();
  const room = findLocalRoom(store, input.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  voteRoomWinnerState(room, input.account.playerId, input.pick);
  writeLocalStore(store);
  const nextView = roomView(room, input.account.playerId, store.rooms);
  if (!nextView) {
    throw new Error('Could not refresh the room after saving your prediction.');
  }
  return nextView;
}

export function localPresenceHeartbeat(sessionId: string) {
  const store = readLocalStore();
  const stats = heartbeatPresenceStore(store, sessionId);
  writeLocalStore(store);
  return stats;
}

export function localFetchRoomHistory(input: { account: OnlineBattleAccount }) {
  const store = readLocalStore();
  return store.rooms
    .map((room) => roomHistoryEntry(room, input.account.playerId))
    .filter((entry): entry is OnlineBattleRoomHistoryEntry => Boolean(entry))
    .sort((left, right) => new Date(right.playedAt).getTime() - new Date(left.playedAt).getTime());
}

async function postArena<T>(action: string, payload: Record<string, unknown>) {
  const response = await fetch(NETLIFY_FUNCTION_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(data.error || 'The online arena request failed.');
  }
  return data;
}

async function tryRemote<T>(action: string, payload: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    throw new Error('Remote client is unavailable in this environment.');
  }

  const isLocalPreview = ['127.0.0.1', 'localhost'].includes(window.location.hostname);
  if (isLocalPreview) {
    throw new Error('Local preview uses the in-browser fallback.');
  }

  return postArena<T>(action, payload);
}

export async function heartbeatPresence(sessionId: string) {
  try {
    const remote = await tryRemote<{ stats: OnlinePresenceStats; remoteUnavailable?: boolean }>('heartbeat', { sessionId });
    if (remote.remoteUnavailable) {
      throw new Error('Remote heartbeat unavailable.');
    }
    return remote.stats;
  } catch {
    return localPresenceHeartbeat(sessionId);
  }
}

export async function registerOnlineAccount(input: { trainerName: string; email: string; password: string }) {
  try {
    const remote = await tryRemote<{ account: OnlineBattleAccount }>('register', input);
    return remote.account;
  } catch {
    return localRegisterAccount(input);
  }
}

export async function loginOnlineAccount(input: { trainerNameOrEmail: string; password: string }) {
  try {
    const remote = await tryRemote<{ account: OnlineBattleAccount }>('login', input);
    return remote.account;
  } catch {
    return localLoginAccount(input);
  }
}

export async function createOnlineRoom(input: {
  account: OnlineBattleAccount;
  team: Team;
  format: BattleFormat;
  musicTrackId: string;
  announcerEnabled: boolean;
}) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('create-room', input);
    return remote.room;
  } catch {
    return localCreateRoom(input);
  }
}

export async function joinOnlineRoom(input: {
  account: OnlineBattleAccount;
  code: string;
  team: Team;
  musicTrackId: string;
  announcerEnabled: boolean;
}) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('join-room', input);
    return remote.room;
  } catch {
    return localJoinRoom(input);
  }
}

export async function fetchOnlineRoom(input: { account: OnlineBattleAccount; code: string }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView | null }>('get-room', input);
    return remote.room;
  } catch {
    return localFetchRoom(input);
  }
}

export async function fetchOnlineRoomHistory(input: { account: OnlineBattleAccount }) {
  try {
    const remote = await tryRemote<{ history: OnlineBattleRoomHistoryEntry[] }>('history', input);
    return remote.history;
  } catch {
    return localFetchRoomHistory(input);
  }
}

export async function submitOnlineBringOrder(input: { account: OnlineBattleAccount; code: string; bringOrder: number[] }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('submit-bring-order', input);
    return remote.room;
  } catch {
    return localSubmitBringOrder(input);
  }
}

export async function submitOnlineChoices(input: { account: OnlineBattleAccount; code: string; choices: SimulatorChoice[] }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('submit-choices', input);
    return remote.room;
  } catch {
    return localSubmitChoices(input);
  }
}

export async function forfeitOnlineRoom(input: { account: OnlineBattleAccount; code: string }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('forfeit-room', input);
    return remote.room;
  } catch {
    return localForfeitRoom(input);
  }
}

export async function joinOnlineRoomChat(input: { account: OnlineBattleAccount; code: string }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('join-room-chat', input);
    return remote.room;
  } catch {
    return localJoinRoomChat(input);
  }
}

export async function leaveOnlineRoomChat(input: { account: OnlineBattleAccount; code: string }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('leave-room-chat', input);
    return remote.room;
  } catch {
    return localLeaveRoomChat(input);
  }
}

export async function sendOnlineRoomChatMessage(input: { account: OnlineBattleAccount; code: string; text: string; emoji?: string | null }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('send-room-chat', input);
    return remote.room;
  } catch {
    return localSendRoomChatMessage(input);
  }
}

export async function reportOnlineRoomPlayer(input: { account: OnlineBattleAccount; code: string; reportedPlayerId: string; reason: string }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('report-room-player', input);
    return remote.room;
  } catch {
    return localReportRoomPlayer(input);
  }
}

export async function voteOnlineRoomWinner(input: { account: OnlineBattleAccount; code: string; pick: OnlineSeat | null }) {
  try {
    const remote = await tryRemote<{ room: OnlineBattleRoomView }>('vote-room-winner', input);
    return remote.room;
  } catch {
    return localVoteRoomWinner(input);
  }
}

export function ensureOnlineSessionId() {
  if (typeof window === 'undefined') {
    return makeId('session');
  }

  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = makeId('session');
  window.localStorage.setItem(SESSION_STORAGE_KEY, created);
  return created;
}
