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
import type { LevelBlock, LevelItem } from '@/rom/model';

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
