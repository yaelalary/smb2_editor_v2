/**
 * Routing commands — per-item destination editing.
 *
 * SMB2 entrances (doors, jars, castle/light/desert/big-mouth entrances)
 * encode a destination **slot id (0..209) + page (0..9)** in their
 * parameter bytes. The encoding is tenths-place decimal decomposition,
 * not a raw byte index:
 *
 *   slot = tens * 10 + ones          (tens ∈ 0..20, ones ∈ 0..9)
 *
 * Two byte layouts exist, selected by the C++ tool based on slot:
 *
 *   4-byte (slot ≤ 150):
 *     [byte0 (pos), byte1 (itemId), tens, (ones<<4) | page]
 *
 *   5-byte "far pointer" (slot > 150, needs PRG bank switch):
 *     [byte0 (pos), byte1 (itemId), 0xF5, tens, (ones<<4) | page]
 *
 *   2-byte (no destination):
 *     [byte0 (pos), byte1 (itemId)]
 *     Triggered when byte[2] >= 0xF0 and ≠ 0xF5, or missing.
 *
 * See cleveldlg_handler.cpp:173-183 and ceditordlgs.cpp:41-112 in the
 * reference C++ implementation.
 */

import type { Command, Mutable } from './types';
import type { LevelBlock, LevelItem, LevelMap } from '@/rom/model';
import { ENTERABLE_JAR_IDS } from '@/rom/constants';

/** Destinations > this threshold use the 5-byte "far pointer" form. */
const FAR_POINTER_THRESHOLD = 150;

/** Decoded destination information attached to an entrance item. */
export interface ItemDestination {
  readonly slot: number; // 0..209
  readonly page: number; // 0..9 (where in the destination to spawn)
  readonly farPointer: boolean; // true = 5-byte (0xF5) layout
}

/** Decode a destination from an entrance item's sourceBytes, or null if none. */
export function itemDestination(item: LevelItem): ItemDestination | null {
  const bytes = item.sourceBytes;
  if (bytes.length < 4) return null;
  const b2 = bytes[2]!;

  if (b2 === 0xf5) {
    // 5-byte far pointer: tens at byte[3], ones+page at byte[4].
    if (bytes.length < 5) return null;
    const tens = bytes[3]!;
    const b4 = bytes[4]!;
    const ones = (b4 >> 4) & 0x0f;
    const page = b4 & 0x0f;
    const slot = tens * 10 + ones;
    if (slot >= 210) return null;
    return { slot, page, farPointer: true };
  }

  if (b2 >= 0xf0) return null; // other sentinel, not a destination

  // 4-byte: tens at byte[2], ones+page at byte[3].
  const tens = b2;
  const b3 = bytes[3]!;
  const ones = (b3 >> 4) & 0x0f;
  const page = b3 & 0x0f;
  const slot = tens * 10 + ones;
  if (slot >= 210) return null;
  return { slot, page, farPointer: false };
}

/** Back-compat helper for callers that only need the slot. */
export function itemDestinationSlot(item: LevelItem): number | null {
  return itemDestination(item)?.slot ?? null;
}

/**
 * Build the parameter bytes (everything after byte0/byte1) for the
 * given destination. Picks 4-byte or 5-byte form automatically based
 * on the slot and preserves the page nibble.
 */
function encodeDestinationBytes(slot: number, page: number): number[] {
  const s = Math.max(0, Math.min(209, Math.floor(slot)));
  const p = Math.max(0, Math.min(9, Math.floor(page))) & 0x0f;
  const tens = Math.floor(s / 10);
  const ones = s % 10;
  const onesAndPage = (ones << 4) | p;
  if (s > FAR_POINTER_THRESHOLD) {
    return [0xf5, tens, onesAndPage];
  }
  return [tens, onesAndPage];
}

/** True if this item can hold a destination (entrance or enterable jar). */
export function isRoutingItem(item: LevelItem): boolean {
  return item.kind === 'entrance' || ENTERABLE_JAR_IDS.has(item.itemId);
}

/**
 * Page where this item sits given the room's direction.
 * Horizontal rooms (direction=1) advance by 16 tiles per page on X.
 * Vertical rooms (direction=0) advance by 15 tiles per page on Y.
 */
export function tilePageOf(item: LevelItem, block: LevelBlock): number {
  const horizontal = block.header.direction === 1;
  const coord = horizontal ? item.tileX : item.tileY;
  const pageSize = horizontal ? 16 : 15;
  const raw = Math.floor(coord / pageSize);
  return Math.max(0, Math.min(9, raw));
}

/**
 * Strict pair lookup: the specific door in `destRoomSlot` at `destPage`
 * whose destination is (`sourceSlot`, `sourcePage`). Null if no such
 * door exists — the source is then considered "orphan".
 *
 * Both sides must match (slot AND page). Slot-only matching would
 * falsely classify a door as paired whenever its dest room happens to
 * contain *some* door pointing back — e.g. an orphan left over after
 * a re-pair, or a coincidental room co-location. The spawn-page fixes
 * the partner uniquely.
 */
export function findBackPointer(
  levelMap: LevelMap,
  sourceSlot: number,
  sourcePage: number,
  destRoomSlot: number,
  destPage: number,
): LevelItem | null {
  const blockIndex = levelMap.slotToBlock[destRoomSlot];
  if (blockIndex === undefined) return null;
  const block = levelMap.blocks[blockIndex];
  if (!block) return null;
  for (const item of block.items) {
    if (!isRoutingItem(item)) continue;
    if (tilePageOf(item, block) !== destPage) continue;
    const dest = itemDestination(item);
    if (dest?.slot !== sourceSlot) continue;
    if (dest.page !== sourcePage) continue;
    return item;
  }
  return null;
}

/**
 * True if this item has a destination but no strict pair partner
 * exists. The caller supplies the item's block so we can compute its
 * page (needed for the strict check on the other side).
 */
export function isOrphan(
  item: LevelItem,
  itemBlock: LevelBlock,
  itemSlot: number,
  levelMap: LevelMap,
): boolean {
  const dest = itemDestination(item);
  if (dest === null) return false;
  const sourcePage = tilePageOf(item, itemBlock);
  return findBackPointer(levelMap, itemSlot, sourcePage, dest.slot, dest.page) === null;
}

/**
 * Scan the whole level map and return every orphaned routing item.
 * An item is orphan iff it has a destination but no strict pair door
 * (page + slot match on both sides) exists in that destination room.
 *
 * Called once per `history.revision` by the canvas (orphan badges) and
 * by the export gate (blocks Download ROM when non-empty).
 */
export function buildOrphanIndex(levelMap: LevelMap): {
  orphans: Set<LevelItem>;
  count: number;
} {
  const orphans = new Set<LevelItem>();
  for (let slot = 0; slot < levelMap.slotToBlock.length; slot++) {
    const blockIndex = levelMap.slotToBlock[slot];
    if (blockIndex === undefined) continue;
    const block = levelMap.blocks[blockIndex];
    if (!block) continue;
    for (const item of block.items) {
      if (!isRoutingItem(item)) continue;
      const dest = itemDestination(item);
      if (dest === null) continue;
      const sourcePage = tilePageOf(item, block);
      const pair = findBackPointer(levelMap, slot, sourcePage, dest.slot, dest.page);
      if (!pair) orphans.add(item);
    }
  }
  return { orphans, count: orphans.size };
}

export class SetItemDestinationCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: Mutable<LevelItem>;
  private readonly oldBytes: Uint8Array;
  private readonly newBytes: Uint8Array;
  private readonly byteDelta: number;
  private readonly noop: boolean;

  constructor(
    block: LevelBlock,
    item: LevelItem,
    newDestSlot: number | null,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item as Mutable<LevelItem>;
    this.oldBytes = item.sourceBytes;
    this.targetSlot = targetSlot;

    if (newDestSlot === null) {
      // Shrink to 2-byte entrance (no destination).
      this.newBytes = this.oldBytes.slice(0, 2);
      this.label = `Remove destination`;
      this.noop = false;
    } else {
      // Preserve the existing page value so changing *where* a door
      // leads doesn't reset the entry screen. Default to 0 if the
      // current item has no destination yet.
      const current = itemDestination(item);
      const page = current?.page ?? 0;
      const params = encodeDestinationBytes(newDestSlot, page);
      this.newBytes = new Uint8Array([
        this.oldBytes[0]!,
        this.oldBytes[1]!,
        ...params,
      ]);
      this.label = `Set destination → slot ${newDestSlot}`;
      this.noop = false;
    }
    this.byteDelta = this.newBytes.byteLength - this.oldBytes.byteLength;
  }

  execute(): void {
    if (this.noop) return;
    this.item.sourceBytes = this.newBytes;
    this.block.byteLength += this.byteDelta;
    this.block.isEdited = true;
  }

  undo(): void {
    if (this.noop) return;
    this.item.sourceBytes = this.oldBytes;
    this.block.byteLength -= this.byteDelta;
  }
}

/** Produce new sourceBytes for `item` with destination (slot, page). */
function buildBytesWithDestination(
  item: LevelItem,
  slot: number,
  page: number,
): Uint8Array {
  const params = encodeDestinationBytes(slot, page);
  return new Uint8Array([item.sourceBytes[0]!, item.sourceBytes[1]!, ...params]);
}

/**
 * Pair two doors bidirectionally: itemA.dest = (slotB, pageOfItemB) and
 * itemB.dest = (slotA, pageOfItemA).
 *
 * Whatever each item was previously paired with becomes **orphan**
 * automatically — the old back-pointers still point here, but we now
 * point somewhere else, and the detection falls out of `buildOrphanIndex`.
 * That matches the SMB2 byte encoding: each entrance stores its own dest
 * independently; the ROM has no symmetric link to maintain.
 *
 * Edge case: if `blockA === blockB` (both items in the same room),
 * `block.byteLength += deltaA` followed by `block.byteLength += deltaB`
 * both mutate the same live object — the cumulative delta is correct.
 */
export class PairItemsCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly blockA: Mutable<LevelBlock>;
  private readonly itemA: Mutable<LevelItem>;
  private readonly blockB: Mutable<LevelBlock>;
  private readonly itemB: Mutable<LevelItem>;
  private readonly oldBytesA: Uint8Array;
  private readonly newBytesA: Uint8Array;
  private readonly oldBytesB: Uint8Array;
  private readonly newBytesB: Uint8Array;
  private readonly byteDeltaA: number;
  private readonly byteDeltaB: number;

  constructor(
    blockA: LevelBlock,
    itemA: LevelItem,
    slotA: number,
    blockB: LevelBlock,
    itemB: LevelItem,
    slotB: number,
    targetSlot?: number,
  ) {
    this.blockA = blockA as Mutable<LevelBlock>;
    this.itemA = itemA as Mutable<LevelItem>;
    this.blockB = blockB as Mutable<LevelBlock>;
    this.itemB = itemB as Mutable<LevelItem>;
    this.oldBytesA = itemA.sourceBytes;
    this.oldBytesB = itemB.sourceBytes;
    this.targetSlot = targetSlot;

    const pageA = tilePageOf(itemA, blockA);
    const pageB = tilePageOf(itemB, blockB);

    this.newBytesA = buildBytesWithDestination(itemA, slotB, pageB);
    this.newBytesB = buildBytesWithDestination(itemB, slotA, pageA);
    this.byteDeltaA = this.newBytesA.byteLength - this.oldBytesA.byteLength;
    this.byteDeltaB = this.newBytesB.byteLength - this.oldBytesB.byteLength;

    this.label = `Pair doors`;
  }

  execute(): void {
    this.itemA.sourceBytes = this.newBytesA;
    this.itemB.sourceBytes = this.newBytesB;
    this.blockA.byteLength += this.byteDeltaA;
    this.blockB.byteLength += this.byteDeltaB;
    this.blockA.isEdited = true;
    this.blockB.isEdited = true;
  }

  undo(): void {
    this.itemA.sourceBytes = this.oldBytesA;
    this.itemB.sourceBytes = this.oldBytesB;
    this.blockA.byteLength -= this.byteDeltaA;
    this.blockB.byteLength -= this.byteDeltaB;
  }
}
