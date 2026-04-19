/**
 * Typed model of the parsed ROM, populated by the level parser (Unit 4)
 * and extended by later units (enemies, palettes, routing).
 *
 * Guiding principles for v0.1 (conservative round-trip mode):
 *   - Items carry their raw source bytes. The serializer re-emits those
 *     bytes verbatim so byte-identity of an unmodified ROM is trivial.
 *   - The interpreted level header is exposed for UI convenience, but
 *     serialization always uses `headerBytes` (the original 4 bytes).
 *     Constructive mode in Phase 2 will repack the interpreted header.
 *   - Every structural element records its `sourceRange` in the ROM so
 *     round-trip failures can be hex-diffed against a specific range.
 */

/** 0..209 — the level slot index in the 210-entry pointer table. */
export type LevelSlotId = number & { readonly __brand: 'LevelSlotId' };

export function levelSlotId(value: number): LevelSlotId {
  if (!Number.isInteger(value) || value < 0 || value >= 210) {
    throw new Error(`Level slot id out of range: ${value}`);
  }
  return value as LevelSlotId;
}

/** [startOffset, endOffset) in ROM-absolute byte offsets. */
export type ByteRange = readonly [start: number, end: number];

/** The kind of item the parser identified, used for byte-length dispatch. */
export type LevelItemKind =
  | 'regular' // position + id, 2 bytes
  | 'entrance' // door-like, 2 / 4 / 5 bytes depending on parameter
  | 'skipper' // 0xF2 / 0xF3, 1 byte
  | 'backToStart' // 0xF4, 1 byte
  | 'pointer' // 0xF5 + 2 param bytes, 3 bytes
  | 'groundSet' // 0xF0 / 0xF1, 2 bytes
  | 'groundType' // 0xF6, 2 bytes
  | 'unknown'; // 0xF7..0xFE (rare, read as 2 bytes like C++)

export interface LevelItem {
  readonly kind: LevelItemKind;
  /** Raw bytes of this item, length ∈ {1, 2, 3, 4, 5}. */
  readonly sourceBytes: Uint8Array;
  /** ROM-absolute byte range this item occupies. */
  readonly sourceRange: ByteRange;
  /**
   * Absolute tile coordinates, populated during parse by
   * `computeItemPositions`. Only meaningful for `regular` and
   * `entrance` items (meta items like skipper/backToStart don't have
   * a visible position). -1 means "no position" (meta item).
   *
   * Phase 2+ editing modifies these; the constructive serializer
   * re-encodes the byte stream from them.
   */
  tileX: number;
  tileY: number;
  /**
   * The raw item ID byte (byte[1] for regular/entrance, -1 for meta
   * items). Stored separately from sourceBytes for editing convenience.
   */
  itemId: number;
  /**
   * Absolute start position on the travel axis (column for horizontal
   * levels, row for vertical). Only set for `groundSet` items; cached
   * at parse time so editor-side ground edits persist across edits of
   * surrounding stream items. The constructive serializer re-encodes
   * the byte pair from this value — see `serializeConstructive`.
   */
  absoluteStartPos?: number;
}

/**
 * Interpreted level header. Every field maps to a specific bit slice
 * of the on-disk 4-byte big-endian header. Reserved bits are carried
 * through as a single opaque value so conservative serialization stays
 * exact and constructive serialization can reproduce them later.
 */
export interface LevelHeader {
  readonly direction: number; // 1 bit  (bit 31)
  readonly palette: number; // 3 bits (bits 29-27)
  readonly enemyColor: number; // 2 bits (bits 25-24)
  readonly groundSet: number; // 5 bits (bits 20-16)
  readonly length: number; // 4 bits (bits 15-12)
  readonly objectType: number; // 4 bits (bits 11-8)
  readonly groundType: number; // 3 bits (bits 5-3)
  readonly music: number; // 2 bits (bits 1-0)
  /**
   * Reserved bits packed in the order they appear on disk:
   *   bit 30, bit 26, bit 23, bit 22, bit 21, bit 7, bit 6, bit 2.
   * Almost always zero in the canonical ROM; tracked so constructive
   * serialization in Phase 2 can reproduce the original exactly.
   */
  readonly reservedBits: number;
  /** Original 4 header bytes, used for conservative serialization. */
  readonly sourceBytes: Uint8Array;
}

/**
 * One physical level data block. Multiple {@link LevelSlotId}s may
 * point to the same `LevelBlock` (the ROM deduplicates). The model
 * represents this by mapping slot → block via {@link LevelMap}, not
 * by duplicating blocks per slot.
 */
export interface LevelBlock {
  /** ROM-absolute offset where this block begins. */
  readonly romOffset: number;
  readonly header: LevelHeader;
  readonly items: LevelItem[];
  /** Total byte length including header (4), items, and terminator (1). */
  byteLength: number;
  /** ROM-absolute byte range of the whole block. */
  readonly sourceRange: ByteRange;
  /** Slot IDs that reference this block (≥ 1; canonical ROM has shared blocks). */
  readonly referencingSlots: ReadonlyArray<LevelSlotId>;
  /**
   * Set to true when any item or the header has been modified by a
   * command. The serializer uses this to decide between conservative
   * (original bytes) and constructive (re-encode from model) modes.
   */
  isEdited: boolean;
}

/**
 * The full parsed level state of a ROM. Preserves block-level sharing:
 * `blocks` holds each unique physical block once; `slotToBlock` maps
 * each of the 210 level slots to its owning block index.
 */
export interface LevelMap {
  readonly blocks: ReadonlyArray<LevelBlock>;
  /** Length = {@link MAX_LEVELS}. Each entry is an index into `blocks`. */
  readonly slotToBlock: ReadonlyArray<number>;
}

// ─── Enemies ────────────────────────────────────────────────────────

/** One enemy placement: 2 bytes on disk (id + packed x/y). */
export interface EnemyItem {
  /** Enemy type ID (0..127, see `g_pszEnemies[]` in the reference tool). */
  readonly id: number;
  /** Column within the page (0..15). */
  readonly x: number;
  /** Row (0..15). */
  readonly y: number;
  /** Original 2 bytes that encoded this enemy. */
  readonly sourceBytes: Uint8Array;
  /** ROM-absolute byte range this enemy occupies. */
  readonly sourceRange: ByteRange;
}

/** One page inside an enemy block (page index = its position in the block). */
export interface EnemyPage {
  /** Size byte that preceded this page, always `1 + 2 * enemies.length`. */
  readonly sizeByte: number;
  readonly enemies: ReadonlyArray<EnemyItem>;
  /** ROM-absolute byte range of the size byte + enemies. */
  readonly sourceRange: ByteRange;
}

/**
 * One physical enemy data block. Like level blocks, multiple slots may
 * point to the same block. The block's byte length is determined from
 * outside (via adjacent-pointer distance or trailing-0xFF scan), not
 * from any terminator inside the block itself.
 */
export interface EnemyBlock {
  readonly romOffset: number;
  readonly pages: EnemyPage[];
  /** Length in bytes as originally allocated in the ROM. */
  byteLength: number;
  readonly sourceRange: ByteRange;
  readonly referencingSlots: ReadonlyArray<LevelSlotId>;
  isEdited: boolean;
}

/**
 * Enemy counterpart of {@link LevelMap}. `slotToBlock` is indexed the
 * same way (0..MAX_LEVELS-1); together with a `LevelMap` it fully
 * describes which level- and enemy-block each slot references.
 */
export interface EnemyMap {
  readonly blocks: ReadonlyArray<EnemyBlock>;
  readonly slotToBlock: ReadonlyArray<number>;
}
