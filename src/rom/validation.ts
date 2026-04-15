/**
 * ROM validation — Unit 3.
 *
 * Single entry point: {@link validateRom} takes a File (from a drop
 * zone or <input type="file">) and returns a tagged result that is
 * either a validated ROM or a typed failure the UI can render in
 * natural language.
 *
 * Design notes:
 *   - We return a result union instead of throwing. Validation is a
 *     user-facing boundary — typed failures keep branches explicit and
 *     remove try/catch from callers.
 *   - The file is read fully into memory (≤ 1 MiB guard), then
 *     validated sequentially. Each step narrows failure modes so the
 *     most specific error surfaces first.
 *   - This function produces the PRG-ROM CRC-32 as a side output so
 *     callers can log or display it, but the CRC is not authoritative
 *     by itself — the caller should only trust `ok: true`.
 */

import {
  INES_CHR_UNITS_OFFSET,
  INES_FLAGS6_OFFSET,
  INES_HEADER_SIZE,
  INES_MAGIC,
  INES_PRG_UNITS_OFFSET,
  INES_TRAINER_FLAG,
  MAX_ROM_BYTES,
  MIN_ROM_BYTES,
  PRG_UNIT_SIZE,
  CHR_UNIT_SIZE,
  SMB2_USA_PRG0_PRG_CRC32,
  SMB2_USA_PRG1_PRG_CRC32,
  TRAINER_SIZE,
} from './constants';
import { crc32 } from './crc32';

export type ValidationFailureReason =
  | 'NOT_INES'
  | 'WRONG_GAME'
  | 'WRONG_REVISION'
  | 'CORRUPTED';

export interface ValidationSuccess {
  readonly ok: true;
  /** Full .nes file contents, with header and trainer intact. */
  readonly rom: Uint8Array;
  /** Offset of the first PRG-ROM byte within `rom`. */
  readonly prgOffset: number;
  /** Length of the PRG-ROM region in bytes. */
  readonly prgBytes: number;
  /** Offset of the first CHR-ROM byte within `rom`. */
  readonly chrOffset: number;
  /** Length of the CHR-ROM region in bytes. */
  readonly chrBytes: number;
  /** CRC-32 computed over the PRG-ROM region — always matches PRG0 here. */
  readonly prgCrc32: number;
  /** True when the source file had a 512-byte trainer between header and PRG. */
  readonly hasTrainer: boolean;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly reason: ValidationFailureReason;
  /** Natural-language message the UI can show directly to the user. */
  readonly message: string;
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const MESSAGES: Readonly<Record<ValidationFailureReason, string>> = {
  NOT_INES: "This doesn't look like a NES ROM file.",
  WRONG_GAME:
    'This is a NES ROM but not Super Mario Bros. 2 (USA). Try a different file.',
  WRONG_REVISION:
    'This is Super Mario Bros. 2 (USA) but a different revision. ' +
    'This editor only works with the PRG0 (original) revision.',
  CORRUPTED: 'This ROM file appears corrupted.',
};

function fail(reason: ValidationFailureReason): ValidationFailure {
  return { ok: false, reason, message: MESSAGES[reason] };
}

function hasInesMagic(rom: Uint8Array): boolean {
  if (rom.byteLength < INES_MAGIC.length) return false;
  for (let i = 0; i < INES_MAGIC.length; i++) {
    if (rom[i] !== INES_MAGIC[i]) return false;
  }
  return true;
}

/**
 * Validate a user-uploaded `.nes` file.
 *
 * The returned `ValidationSuccess.rom` is a fresh `Uint8Array` backed by
 * the file's bytes (safe to mutate without affecting the original File).
 * Callers that want to round-trip or edit should hold onto the `rom`
 * plus the offsets rather than reading the file twice.
 */
export async function validateRom(file: File): Promise<ValidationResult> {
  // 1. Size sanity — refuse before reading anything huge.
  if (file.size === 0 || file.size < MIN_ROM_BYTES) {
    return fail('CORRUPTED');
  }
  if (file.size > MAX_ROM_BYTES) {
    return fail('CORRUPTED');
  }

  // 2. Read file into a fresh Uint8Array.
  const buffer = await file.arrayBuffer();
  const rom = new Uint8Array(buffer);

  // 3. iNES magic check. Any failure here is NOT_INES, not CORRUPTED —
  //    the file *size* was plausible, the *contents* are wrong.
  if (!hasInesMagic(rom)) {
    return fail('NOT_INES');
  }

  // 4. Header fields.
  const prgUnits = rom[INES_PRG_UNITS_OFFSET]!;
  const chrUnits = rom[INES_CHR_UNITS_OFFSET]!;
  const flags6 = rom[INES_FLAGS6_OFFSET]!;
  const hasTrainer = (flags6 & INES_TRAINER_FLAG) !== 0;

  if (prgUnits === 0) {
    return fail('CORRUPTED');
  }

  const prgBytes = prgUnits * PRG_UNIT_SIZE;
  const chrBytes = chrUnits * CHR_UNIT_SIZE;
  const prgOffset = INES_HEADER_SIZE + (hasTrainer ? TRAINER_SIZE : 0);
  const chrOffset = prgOffset + prgBytes;
  const declaredEnd = chrOffset + chrBytes;

  // 5. Declared size must match the bytes we actually have.
  if (declaredEnd > rom.byteLength) {
    return fail('CORRUPTED');
  }

  // 6. CRC-32 over the PRG-ROM region tells us which ROM this really is.
  const prgRegion = rom.subarray(prgOffset, prgOffset + prgBytes);
  const prgCrc32 = crc32(prgRegion);

  const identification = identifyPrg(prgCrc32);
  switch (identification) {
    case 'PRG0':
      return {
        ok: true,
        rom,
        prgOffset,
        prgBytes,
        chrOffset,
        chrBytes,
        prgCrc32,
        hasTrainer,
      };
    case 'PRG1':
      return fail('WRONG_REVISION');
    case 'UNKNOWN':
      return fail('WRONG_GAME');
  }
}

/**
 * Classify a PRG-ROM CRC-32 as one of the known SMB2 USA revisions, or
 * `UNKNOWN` if it matches neither. Exposed separately from
 * {@link validateRom} so tests can verify the revision-detection logic
 * without having to synthesize a ROM that produces a specific CRC.
 */
export function identifyPrg(crc32: number): 'PRG0' | 'PRG1' | 'UNKNOWN' {
  if (crc32 === SMB2_USA_PRG0_PRG_CRC32) return 'PRG0';
  if (crc32 === SMB2_USA_PRG1_PRG_CRC32) return 'PRG1';
  return 'UNKNOWN';
}
