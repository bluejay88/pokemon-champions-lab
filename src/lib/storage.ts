import { createDefaultState, sanitizeAppState } from './champions';
import type { AppState } from '../types';

const STORAGE_KEY = 'pokemon-champions-lab-v1';

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

    return sanitizeAppState(parsed);
  } catch {
    return createDefaultState();
  }
}

export function saveState(state: AppState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeAppState(state)));
}

export function clearState() {
  window.localStorage.removeItem(STORAGE_KEY);
}
