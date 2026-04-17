/**
 * localStorage auto-save — Unit 20.
 *
 * Best-effort persistence of the current edit state. Saves on every
 * Nth command (or every T seconds). On app boot, offers to resume
 * a previously auto-saved session.
 *
 * The stored format is:
 *   { romBase64: string, activeSlot: number, savedAt: string }
 *
 * The ROM stored is the EDITED version (after buildRom), so restoring
 * re-parses it exactly like a project import.
 *
 * All localStorage access is wrapped in try/catch for environments
 * where it's unavailable (private mode, WebViews, quota exceeded).
 */

import { buildRom } from '@/rom/rom-builder';
import { validateRom } from '@/rom/validation';
import { parseLevelMap } from '@/rom/level-parser';
import { parseEnemyMap } from '@/rom/enemy-parser';
import type { ValidationSuccess } from '@/rom/validation';
import type { LevelMap, EnemyMap } from '@/rom/model';

const STORAGE_KEY = 'smb2-editor:autosave';
const SAVE_INTERVAL_MS = 30_000; // 30 seconds
const SAVE_EVERY_N_COMMANDS = 5;

// ─── Safe localStorage wrapper ─────────────────────────────────────

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // no-op
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── Save ───────────────────────────────────────────────────────────

interface AutoSavePayload {
  romBase64: string;
  activeSlot: number;
  savedAt: string;
}

/**
 * Save the current state to localStorage. Returns true on success.
 */
export function autoSave(
  originalRom: Uint8Array,
  levelMap: LevelMap,
  enemyMap: EnemyMap,
  activeSlot: number,
): boolean {
  try {
    const editedRom = buildRom(originalRom, levelMap, enemyMap);
    const payload: AutoSavePayload = {
      romBase64: uint8ToBase64(editedRom),
      activeSlot,
      savedAt: new Date().toISOString(),
    };
    return safeSetItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    return false;
  }
}

/** Clear the auto-save slot. */
export function clearAutoSave(): void {
  safeRemoveItem(STORAGE_KEY);
}

// ─── Restore ────────────────────────────────────────────────────────

export interface AutoSaveData {
  validation: ValidationSuccess;
  levelMap: LevelMap;
  enemyMap: EnemyMap;
  activeSlot: number;
  savedAt: string;
}

/** Check if an auto-save exists without fully parsing it. */
export function hasAutoSave(): boolean {
  return safeGetItem(STORAGE_KEY) !== null;
}

/** Restore the auto-saved state. Returns null if unavailable or invalid. */
export async function restoreAutoSave(): Promise<AutoSaveData | null> {
  const raw = safeGetItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw) as AutoSavePayload;
    const romBytes = base64ToUint8(payload.romBase64);

    const romFile = new File([romBytes], 'autosave.nes');
    const validation = await validateRom(romFile);
    if (validation.status !== 'ok') return null;

    const levelMap = parseLevelMap(validation.rom);
    const enemyMap = parseEnemyMap(validation.rom);

    return {
      validation,
      levelMap,
      enemyMap,
      activeSlot: payload.activeSlot ?? 0,
      savedAt: payload.savedAt,
    };
  } catch {
    // Corrupted data — remove it
    safeRemoveItem(STORAGE_KEY);
    return null;
  }
}

// ─── Auto-save manager ──────────────────────────────────────────────

/**
 * Creates an auto-save manager that triggers saves based on command
 * count and time interval.
 */
export function createAutoSaveManager(
  getSaveData: () => {
    rom: Uint8Array;
    levelMap: LevelMap;
    enemyMap: EnemyMap;
    activeSlot: number;
  } | null,
  onSaveFailure?: () => void,
): {
  notifyCommand: () => void;
  stop: () => void;
  isAvailable: boolean;
} {
  let commandsSinceLastSave = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let available = true;

  function doSave(): void {
    const data = getSaveData();
    if (!data) return;
    const ok = autoSave(data.rom, data.levelMap, data.enemyMap, data.activeSlot);
    if (ok) {
      commandsSinceLastSave = 0;
    } else {
      available = false;
      onSaveFailure?.();
    }
  }

  // Time-based auto-save
  timer = setInterval(doSave, SAVE_INTERVAL_MS);

  return {
    notifyCommand(): void {
      commandsSinceLastSave++;
      if (commandsSinceLastSave >= SAVE_EVERY_N_COMMANDS) {
        doSave();
      }
    },
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    get isAvailable() {
      return available;
    },
  };
}
