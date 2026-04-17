/**
 * Project file export/import — Unit 15.
 *
 * Format: `.smb2proj` is a ZIP containing:
 *   - `original.nes`  — the pristine user-uploaded ROM
 *   - `state.json`    — snapshot of level + enemy maps + active slot
 *
 * Undo history is NOT preserved (acceptable trade-off — keeps the format
 * forward-compatible with new command types).
 */

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { validateRom } from '@/rom/validation';
import type { ValidationSuccess } from '@/rom/validation';
import { parseLevelMap } from '@/rom/level-parser';
import { parseEnemyMap } from '@/rom/enemy-parser';
import type { LevelMap, EnemyMap } from '@/rom/model';
import { buildRom } from '@/rom/rom-builder';

const SCHEMA_VERSION = 1;

// ─── State snapshot ────────────────────────────────────────────────

interface ProjectSnapshot {
  schemaVersion: number;
  exportedAt: string;
  activeSlot: number;
}

// ─── Export ────────────────────────────────────────────────────────

/**
 * Build a `.smb2proj` Uint8Array (ZIP) from the current editor state.
 *
 * The ROM inside is the EDITED version (after buildRom), so importing
 * restores the exact state including all edits.
 */
export function exportProject(
  originalRom: Uint8Array,
  levelMap: LevelMap,
  enemyMap: EnemyMap,
  activeSlot: number,
): Uint8Array {
  // Build the edited ROM so import restores the full state.
  const editedRom = buildRom(originalRom, levelMap, enemyMap);

  const snapshot: ProjectSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    activeSlot,
  };

  return zipSync({
    'original.nes': editedRom,
    'state.json': strToU8(JSON.stringify(snapshot, null, 2)),
  });
}

/** Trigger browser download of the project file. */
export function downloadProject(
  originalRom: Uint8Array,
  levelMap: LevelMap,
  enemyMap: EnemyMap,
  activeSlot: number,
): void {
  const data = exportProject(originalRom, levelMap, enemyMap, activeSlot);
  const blob = new Blob([data], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smb2-project-${new Date().toISOString().slice(0, 10)}.smb2proj`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
}

// ─── Import ────────────────────────────────────────────────────────

export interface ImportResult {
  validation: ValidationSuccess;
  activeSlot: number;
  levelMap: LevelMap;
  enemyMap: EnemyMap;
}

export type ImportError =
  | { kind: 'invalid_zip'; message: string }
  | { kind: 'missing_rom'; message: string }
  | { kind: 'invalid_rom'; message: string }
  | { kind: 'invalid_state'; message: string }
  | { kind: 'future_version'; message: string };

/**
 * Import a `.smb2proj` file. Returns the validation result + restored
 * state, or an error.
 */
export async function importProject(
  file: File,
): Promise<ImportResult | ImportError> {
  let files: Record<string, Uint8Array>;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    files = unzipSync(buf);
  } catch {
    return { kind: 'invalid_zip', message: 'This file is not a valid project archive.' };
  }

  const romData = files['original.nes'];
  if (!romData) {
    return { kind: 'missing_rom', message: 'Project file is missing the ROM data.' };
  }

  const stateData = files['state.json'];
  if (!stateData) {
    return { kind: 'invalid_state', message: 'Project file is missing state data.' };
  }

  // Parse state
  let snapshot: ProjectSnapshot;
  try {
    snapshot = JSON.parse(strFromU8(stateData)) as ProjectSnapshot;
  } catch {
    return { kind: 'invalid_state', message: 'Project state data is corrupted.' };
  }

  if (snapshot.schemaVersion > SCHEMA_VERSION) {
    return {
      kind: 'future_version',
      message: `This project was created with a newer version of the editor (schema v${snapshot.schemaVersion}). Please update the editor.`,
    };
  }

  // Validate the ROM
  const romBlob = new File([romData], 'original.nes');
  const validation = await validateRom(romBlob);
  if (validation.status !== 'ok') {
    return { kind: 'invalid_rom', message: validation.message };
  }

  // Parse level + enemy data from the (potentially edited) ROM
  const levelMap = parseLevelMap(validation.rom);
  const enemyMap = parseEnemyMap(validation.rom);

  return {
    validation,
    activeSlot: snapshot.activeSlot ?? 0,
    levelMap,
    enemyMap,
  };
}
