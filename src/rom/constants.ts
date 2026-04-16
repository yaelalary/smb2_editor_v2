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

// ─── SMB2 level data region (all ROM offsets, PRG0) ─────────────────

/**
 * Number of level slots the game reserves. Multiple slots may share
 * the same physical level data block (ROM-space optimization).
 */
export const MAX_LEVELS = 210;

/**
 * Start and end of the writable level+enemy data region in ROM space.
 * The serializer must keep combined level data + enemy data + pointer
 * tables under (NES_PTR_EOF - NES_PTR_START) bytes.
 */
export const NES_PTR_START = 0x10010;
export const NES_PTR_EOF = 0x14010;
export const LEVEL_REGION_BYTES = NES_PTR_EOF - NES_PTR_START; // 0x4000 = 16384

/**
 * `DELTA_PTR` converts NES CPU addresses (what the ROM stores in its
 * pointer tables) to ROM file offsets (what we index into the
 * `Uint8Array` with). Derived from the cartridge's mapping of PRG-ROM
 * into the $8000-$FFFF CPU window, accounting for the 16-byte iNES
 * header.
 */
export const DELTA_PTR = 0x8010;

/**
 * ROM offsets that hold CPU-space addresses of the level pointer
 * arrays themselves. Dereferenced at load time to locate the actual
 * 210-entry low/high byte arrays (double indirection).
 */
export const NES_PTR_LEVELS1 = 0x1f770; // low-byte array
export const NES_PTR_LEVELS2 = 0x1f775; // high-byte array

/** Terminator byte that ends every level's item stream. */
export const LEVEL_TERMINATOR = 0xff;

// ─── Enemy pointer sub-tables ───────────────────────────────────────
//
// Enemy pointers reach the actual data via a three-level chain:
//
//   1. Four base pointers at NES_PTR_ENEMY[1..4] each hold a 16-bit CPU
//      address.
//   2. Pairs {1,2} and {3,4} locate two 21-byte arrays (one entry per
//      "world"). For world `w`, these give a hi-byte and a lo-byte that
//      together form a CPU address pointing to two 10-byte per-level
//      arrays (the hi-array and the lo-array of per-level pointers).
//   3. For level `l` within world `w`, the (hi, lo) pair at index `l`
//      of those per-level arrays combines into the final CPU address
//      of that slot's enemy data block. Add DELTA_PTR for the ROM
//      file offset.
//
// Total slots = WORLDS * LEVELS_PER_WORLD = 21 * 10 = MAX_LEVELS = 210.

export const NES_PTR_ENEMY1 = 0x1f791;
export const NES_PTR_ENEMY2 = 0x1f796;
export const NES_PTR_ENEMY3 = 0x1f79b;
export const NES_PTR_ENEMY4 = 0x1f7a0;

export const WORLDS = 21;
export const LEVELS_PER_WORLD = 10;

/** Exactly 4 bytes of packed level header precede every item stream. */
export const LEVEL_HEADER_BYTES = 4;

/**
 * Item IDs that the parser treats as "entrances" — doors and similar
 * transitions whose byte length depends on a following parameter byte.
 * Source: `loginsinex/smb2` `cnesleveldata.cpp` LoadLevel().
 */
export const ENTRANCE_ITEM_IDS: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0b, 0x13, 0x14, 0x15, 0x1c, 0x1d, 0x1e,
]);
