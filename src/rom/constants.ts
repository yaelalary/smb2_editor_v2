/**
 * ROM-level constants used throughout the editor.
 *
 * Keep this file additive and sparse. New constants move here only when
 * they would otherwise be duplicated in multiple modules.
 */

// ─── iNES format ────────────────────────────────────────────────────

/** iNES magic bytes: "NES" followed by MS-DOS EOF (0x1A). */
export const INES_MAGIC: ReadonlyArray<number> = [0x4e, 0x45, 0x53, 0x1a];

export const INES_HEADER_SIZE = 16;

/** Optional trainer block between header and PRG-ROM. */
export const TRAINER_SIZE = 512;

/** flags6 bit 2 — trainer present. */
export const INES_TRAINER_FLAG = 0b0000_0100;

/** Header byte offsets. */
export const INES_PRG_UNITS_OFFSET = 4;
export const INES_CHR_UNITS_OFFSET = 5;
export const INES_FLAGS6_OFFSET = 6;

/** Unit sizes declared in the iNES header. */
export const PRG_UNIT_SIZE = 16 * 1024;
export const CHR_UNIT_SIZE = 8 * 1024;

// ─── SMB2 USA PRG0 expected sizes and checksums ─────────────────────

/** 128 KiB PRG-ROM for the canonical SMB2 USA PRG0 cart. */
export const SMB2_USA_PRG0_PRG_BYTES = 128 * 1024;

/** 128 KiB CHR-ROM for the canonical SMB2 USA PRG0 cart. */
export const SMB2_USA_PRG0_CHR_BYTES = 128 * 1024;

/**
 * CRC-32 (IEEE) over the 131,072-byte PRG-ROM portion (header and
 * trainer stripped). Verified against:
 *   - nesdir.github.io per-chip CRC listing
 *   - romhacking.net file/ROM CRC breakdown
 *   - Xkeeper0/smb2 disassembly build artifacts
 *
 * Never change this value. If the editor encounters a ROM with a
 * different PRG-ROM CRC, that ROM is either a different revision,
 * a different game, or corrupted — not a PRG0.
 */
export const SMB2_USA_PRG0_PRG_CRC32 = 0x07854b3f;

/**
 * CRC-32 of the PRG1 (Rev A) revision's PRG-ROM. Used only to produce
 * a more specific "wrong revision" error when PRG0 is expected and a
 * user supplies PRG1 by mistake. The editor does NOT support PRG1.
 */
export const SMB2_USA_PRG1_PRG_CRC32 = 0x9ed99198;

// ─── Sanity guards ──────────────────────────────────────────────────

/** Reject files larger than this — no legitimate NES ROM approaches 1 MiB. */
export const MAX_ROM_BYTES = 1024 * 1024;

/** Smallest size that could possibly be a valid NES ROM (header + 16 KiB PRG). */
export const MIN_ROM_BYTES = INES_HEADER_SIZE + PRG_UNIT_SIZE;
