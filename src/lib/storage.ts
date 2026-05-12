import { createDefaultState, sanitizeAppState } from './champions';
import type { AppState } from '../types';

const STORAGE_KEY = 'pokemon-champions-lab-v1';
const PROFILE_LIBRARY_KEY = 'pokemon-champions-lab-profiles-v1';

type ProfileLibrary = Record<string, AppState>;

function profileKey(name: string) {
  return name.trim().toLowerCase();
}

function readProfileLibrary() {
  try {
    const raw = window.localStorage.getItem(PROFILE_LIBRARY_KEY);
    if (!raw) {
      return {} as ProfileLibrary;
    }
    return JSON.parse(raw) as ProfileLibrary;
  } catch {
    return {} as ProfileLibrary;
  }
}

function writeProfileLibrary(library: ProfileLibrary) {
  window.localStorage.setItem(PROFILE_LIBRARY_KEY, JSON.stringify(library));
}

export function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createDefaultState();
    }

    const parsed = JSON.parse(raw) as AppState;
    if (!parsed.teams?.length) {
      return createDefaultState();
    }

    const sanitized = sanitizeAppState(parsed);
    const trainerName = sanitized.profile.trainerName.trim();
    if (!trainerName) {
      return sanitized;
    }

    const storedProfile = readProfileLibrary()[profileKey(trainerName)];
    return storedProfile ? sanitizeAppState(storedProfile) : sanitized;
  } catch {
    return createDefaultState();
  }
}

export function saveState(state: AppState) {
  const sanitized = sanitizeAppState(state);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));

  const trainerName = sanitized.profile.trainerName.trim();
  if (trainerName) {
    const library = readProfileLibrary();
    library[profileKey(trainerName)] = sanitized;
    writeProfileLibrary(library);
  }
}

export function clearState() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(PROFILE_LIBRARY_KEY);
}

export function listStoredProfiles() {
  return Object.values(readProfileLibrary())
    .map((entry) => entry.profile?.trainerName?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .sort((left, right) => left.localeCompare(right));
}
