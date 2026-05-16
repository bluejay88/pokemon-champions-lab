import { getStore } from '@netlify/blobs';
import type { OnlineBattleAccount } from '../../src/types';
import {
  createRoomState,
  forfeitRoomState,
  heartbeatPresenceStore,
  joinRoomChatState,
  joinRoomState,
  leaveRoomChatState,
  reportRoomPlayerState,
  roomHistoryEntry,
  roomView,
  sendRoomChatMessageState,
  submitBringOrderState,
  submitTurnChoicesState,
  touchRoomState,
  voteRoomWinnerState,
  type OnlineBattleRoomState,
} from '../../src/lib/online';
import type { SimulatorChoice } from '../../src/lib/simulator';

type ArenaPayload = {
  action?: string;
  sessionId?: string;
  trainerName?: string;
  email?: string;
  password?: string;
  trainerNameOrEmail?: string;
  account?: OnlineBattleAccount;
  team?: unknown;
  format?: 'Singles' | 'Doubles';
  code?: string;
  musicTrackId?: string;
  announcerEnabled?: boolean;
  bringOrder?: number[];
  choices?: unknown[];
  text?: string;
  emoji?: string | null;
  reportedPlayerId?: string;
  reason?: string;
  pick?: 'host' | 'guest' | null;
};

type StoredAccount = OnlineBattleAccount & {
  passwordHash: string;
};

type PresenceState = {
  totalVisits: number;
  sessions: Record<string, string>;
};

const store = getStore('pokemon-champions-lab-online');

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

async function readJson<T>(key: string, fallback: T) {
  const entry = await store.get(key, { type: 'json' });
  return (entry as T | null) ?? fallback;
}

async function writeJson(key: string, value: unknown) {
  await store.setJSON(key, value);
}

async function hashPassword(password: string) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function allRooms() {
  const { blobs } = await store.list({ prefix: 'rooms/' });
  const rooms = await Promise.all(
    blobs.map(async (blob) => (await store.get(blob.key, { type: 'json' })) as OnlineBattleRoomState | null),
  );
  return rooms.filter((room): room is OnlineBattleRoomState => Boolean(room));
}

async function saveRoom(room: OnlineBattleRoomState) {
  await writeJson(`rooms/${room.code}`, room);
}

async function findRoom(code: string) {
  return await readJson<OnlineBattleRoomState | null>(`rooms/${code}`, null);
}

async function readAccounts() {
  return readJson<StoredAccount[]>('accounts', []);
}

async function saveAccounts(accounts: StoredAccount[]) {
  await writeJson('accounts', accounts);
}

async function readPresence() {
  return readJson<PresenceState>('presence', {
    totalVisits: 0,
    sessions: {},
  });
}

async function savePresence(presence: PresenceState) {
  await writeJson('presence', presence);
}

async function authenticate(account: OnlineBattleAccount | undefined | null) {
  if (!account?.playerId || !account.sessionToken) {
    throw new Error('You need to sign in for online battles.');
  }

  const accounts = await readAccounts();
  const stored = accounts.find((entry) => entry.playerId === account.playerId && entry.sessionToken === account.sessionToken);
  if (!stored) {
    throw new Error('Online account session expired. Please sign in again.');
  }
  const { passwordHash: _passwordHash, ...publicAccount } = stored;
  return publicAccount satisfies OnlineBattleAccount;
}

async function handleHeartbeat(sessionId: string | undefined) {
  if (!sessionId) {
    throw new Error('Missing heartbeat session ID.');
  }

  const presence = await readPresence();
  const rooms = await allRooms();
  const stats = heartbeatPresenceStore(
    {
      accounts: [],
      rooms,
      presence,
    },
    sessionId,
  );
  await savePresence(presence);
  return { stats };
}

async function handleRegister(payload: ArenaPayload) {
  const trainerName = payload.trainerName?.trim();
  const email = payload.email?.trim() ?? '';
  const password = payload.password ?? '';
  if (!trainerName || password.length < 4) {
    throw new Error('Trainer name and a password of at least 4 characters are required.');
  }

  const accounts = await readAccounts();
  const existing = accounts.find(
    (entry) =>
      entry.trainerName.trim().toLowerCase() === trainerName.toLowerCase() ||
      (email && entry.email.trim().toLowerCase() === email.toLowerCase()),
  );
  if (existing) {
    throw new Error('That trainer name or email is already registered.');
  }

  const account = {
    playerId: `pvp-player-${crypto.randomUUID()}`,
    trainerName,
    email,
    sessionToken: `session-${crypto.randomUUID()}`,
    registeredAt: new Date().toISOString(),
    passwordHash: await hashPassword(password),
  } satisfies StoredAccount;

  accounts.push(account);
  await saveAccounts(accounts);
  const { passwordHash: _passwordHash, ...publicAccount } = account;
  return { account: publicAccount satisfies OnlineBattleAccount };
}

async function handleLogin(payload: ArenaPayload) {
  const lookup = payload.trainerNameOrEmail?.trim().toLowerCase();
  const password = payload.password ?? '';
  if (!lookup || !password) {
    throw new Error('Trainer name or email and password are required.');
  }

  const passwordHash = await hashPassword(password);
  const accounts = await readAccounts();
  const account = accounts.find(
    (entry) =>
      (entry.trainerName.trim().toLowerCase() === lookup || entry.email.trim().toLowerCase() === lookup) &&
      entry.passwordHash === passwordHash,
  );
  if (!account) {
    throw new Error('Account not found or password incorrect.');
  }

  account.sessionToken = `session-${crypto.randomUUID()}`;
  await saveAccounts(accounts);
  const { passwordHash: _passwordHash, ...publicAccount } = account;
  return { account: publicAccount satisfies OnlineBattleAccount };
}

async function handleCreateRoom(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.team || !payload.format) {
    throw new Error('Team and format are required to create a room.');
  }

  let room = createRoomState(account, payload.team as OnlineBattleRoomState['hostTeam'], payload.format, payload.musicTrackId ?? 'gen5-final', Boolean(payload.announcerEnabled));
  while (await findRoom(room.code)) {
    room = createRoomState(account, payload.team as OnlineBattleRoomState['hostTeam'], payload.format, payload.musicTrackId ?? 'gen5-final', Boolean(payload.announcerEnabled));
  }

  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleJoinRoom(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code || !payload.team) {
    throw new Error('Room code and team are required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }

  joinRoomState(room, account, payload.team as OnlineBattleRoomState['hostTeam'], payload.musicTrackId ?? room.musicTrackId, Boolean(payload.announcerEnabled));
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleGetRoom(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code) {
    throw new Error('Room code is required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    return { room: null };
  }
  touchRoomState(room);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleHistory(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  const rooms = await allRooms();
  const history = rooms
    .map((room) => roomHistoryEntry(room, account.playerId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => new Date(right.playedAt).getTime() - new Date(left.playedAt).getTime());
  return { history };
}

async function handleBringOrder(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code || !payload.bringOrder) {
    throw new Error('Room code and bring order are required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  submitBringOrderState(room, account.playerId, payload.bringOrder);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleSubmitChoices(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code || !payload.choices) {
    throw new Error('Room code and turn choices are required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  submitTurnChoicesState(room, account.playerId, payload.choices as SimulatorChoice[]);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleForfeit(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code) {
    throw new Error('Room code is required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  forfeitRoomState(room, account.playerId);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleJoinRoomChat(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code) {
    throw new Error('Room code is required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  joinRoomChatState(room, account.playerId);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleLeaveRoomChat(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code) {
    throw new Error('Room code is required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  leaveRoomChatState(room, account.playerId);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleSendRoomChat(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code) {
    throw new Error('Room code is required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  sendRoomChatMessageState(room, account.playerId, payload.text ?? '', payload.emoji ?? null);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleReportRoomPlayer(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code || !payload.reportedPlayerId) {
    throw new Error('Room code and target player are required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  reportRoomPlayerState(room, account.playerId, payload.reportedPlayerId, payload.reason ?? '');
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

async function handleVoteRoomWinner(payload: ArenaPayload) {
  const account = await authenticate(payload.account);
  if (!payload.code) {
    throw new Error('Room code is required.');
  }
  const room = await findRoom(payload.code);
  if (!room) {
    throw new Error('Room code not found.');
  }
  voteRoomWinnerState(room, account.playerId, payload.pick ?? null);
  await saveRoom(room);
  const rooms = await allRooms();
  return { room: roomView(room, account.playerId, rooms) };
}

export default async function handler(request: Request) {
  let action: string | undefined;
  try {
    const payload = (await request.json()) as ArenaPayload;
    action = payload.action;

    if (action === 'heartbeat') {
      return jsonResponse(await handleHeartbeat(payload.sessionId));
    }
    if (action === 'register') {
      return jsonResponse(await handleRegister(payload));
    }
    if (action === 'login') {
      return jsonResponse(await handleLogin(payload));
    }
    if (action === 'create-room') {
      return jsonResponse(await handleCreateRoom(payload));
    }
    if (action === 'join-room') {
      return jsonResponse(await handleJoinRoom(payload));
    }
    if (action === 'get-room') {
      return jsonResponse(await handleGetRoom(payload));
    }
    if (action === 'history') {
      return jsonResponse(await handleHistory(payload));
    }
    if (action === 'submit-bring-order') {
      return jsonResponse(await handleBringOrder(payload));
    }
    if (action === 'submit-choices') {
      return jsonResponse(await handleSubmitChoices(payload));
    }
    if (action === 'forfeit-room') {
      return jsonResponse(await handleForfeit(payload));
    }
    if (action === 'join-room-chat') {
      return jsonResponse(await handleJoinRoomChat(payload));
    }
    if (action === 'leave-room-chat') {
      return jsonResponse(await handleLeaveRoomChat(payload));
    }
    if (action === 'send-room-chat') {
      return jsonResponse(await handleSendRoomChat(payload));
    }
    if (action === 'report-room-player') {
      return jsonResponse(await handleReportRoomPlayer(payload));
    }
    if (action === 'vote-room-winner') {
      return jsonResponse(await handleVoteRoomWinner(payload));
    }

    return jsonResponse({ error: 'Unsupported arena action.' }, 400);
  } catch (error) {
    if (action === 'heartbeat') {
      return jsonResponse({
        stats: {
          activeUsers: 0,
          totalVisits: 0,
          activeBattles: 0,
        },
        remoteUnavailable: true,
        error: error instanceof Error ? error.message : 'Arena request failed.',
      });
    }
    if (action === 'history') {
      return jsonResponse({
        history: [],
        authExpired: true,
        error: error instanceof Error ? error.message : 'Arena request failed.',
      });
    }
    if (action === 'get-room') {
      return jsonResponse({
        room: null,
        authExpired: true,
        error: error instanceof Error ? error.message : 'Arena request failed.',
      });
    }
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : 'Arena request failed.',
      },
      400,
    );
  }
}
