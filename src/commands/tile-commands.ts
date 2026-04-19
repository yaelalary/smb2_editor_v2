/**
 * Tile editing commands — Unit 10.
 *
 * PlaceTileCommand: adds a new regular item at an absolute grid position.
 * DeleteItemCommand: removes an item from the level's items array.
 * MoveItemCommand: changes an item's absolute position.
 *
 * All three mark the containing LevelBlock as `isEdited = true` so the
 * serializer knows to use constructive mode when downloading.
 */

import type { Command, Mutable } from './types';
import type { LevelBlock, LevelItem } from '@/rom/model';

/**
 * Create the sourceBytes for a new regular item at an absolute position.
 * The actual cursor-encoded bytes are computed by the constructive
 * serializer at download time; these "dummy" bytes store the itemId
 * and a placeholder position byte. What matters is `tileX`, `tileY`,
 * and `itemId` — the sourceBytes are only used by conservative mode
 * (which won't fire for edited blocks).
 */
function makeRegularItemBytes(itemId: number): Uint8Array {
  return new Uint8Array([0x00, itemId & 0xff]);
}

/**
 * Library drag-drop sends the UI-facing item index (0..60). The model
 * (parser, `renderItem`, serializer) works in **ROM-byte** space where
 * variable-size items occupy 0x30..0xFF with the high nibble encoding
 * the vid and the low nibble the size. The UI range 48..60 maps 1:1 to
 * vid 0..12 via `0x30 + (idx − 48) * 0x10` with default size = 0. Items
 * 0..47 are fixed and need no remapping.
 *
 * Without this conversion, `renderItem` interprets e.g. library idx 58
 * (Red Wood Platform) as ROM byte 0x3A = vid 0 size 10, and dispatches
 * to `renderHorzGround` producing 11 X-Block tiles.
 */
export function libraryIdToRomByte(libraryId: number): number {
  if (libraryId < 48 || libraryId > 60) return libraryId;
  return 0x30 + (libraryId - 48) * 0x10;
}

export class PlaceTileCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly newItem: LevelItem;
  // Tracked for potential future use (e.g., re-selecting after undo).

  constructor(
    block: LevelBlock,
    tileX: number,
    tileY: number,
    libraryId: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    const itemId = libraryIdToRomByte(libraryId);
    this.newItem = {
      kind: 'regular',
      sourceBytes: makeRegularItemBytes(itemId),
      sourceRange: [0, 0], // not meaningful for new items
      tileX,
      tileY,
      itemId,
    };
    this.targetSlot = targetSlot;
    this.label = `Place item 0x${itemId.toString(16).toUpperCase()} at (${tileX}, ${tileY})`;
  }

  execute(): void {
    this.block.items.push(this.newItem);
    this.block.byteLength += 2; // regular item = 2 bytes
    this.block.isEdited = true;
  }

  undo(): void {
    const idx = this.block.items.indexOf(this.newItem);
    if (idx !== -1) {
      this.block.items.splice(idx, 1);
      this.block.byteLength -= 2;
    }
  }
}

export class DeleteItemCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: LevelItem;
  private removedIndex = -1;

  constructor(block: LevelBlock, item: LevelItem, targetSlot?: number) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item;
    this.targetSlot = targetSlot;
    this.label = `Delete item 0x${item.itemId.toString(16).toUpperCase()} at (${item.tileX}, ${item.tileY})`;
  }

  execute(): void {
    const idx = this.block.items.indexOf(this.item);
    if (idx !== -1) {
      this.removedIndex = idx;
      this.block.items.splice(idx, 1);
      this.block.byteLength -= this.item.sourceBytes.byteLength;
      this.block.isEdited = true;
    }
  }

  undo(): void {
    if (this.removedIndex !== -1) {
      this.block.items.splice(this.removedIndex, 0, this.item);
      this.block.byteLength += this.item.sourceBytes.byteLength;
    }
  }
}

/**
 * Delete multiple items at once — single undo restores all.
 */
export class DeleteItemsCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly items: LevelItem[];
  private removedEntries: { index: number; item: LevelItem }[] = [];

  constructor(block: LevelBlock, items: LevelItem[], targetSlot?: number) {
    this.block = block as Mutable<LevelBlock>;
    this.items = items;
    this.targetSlot = targetSlot;
    this.label = `Delete ${items.length} items`;
  }

  execute(): void {
    this.removedEntries = [];
    // Remove in reverse index order to keep indices stable.
    const indices = this.items
      .map((item) => this.block.items.indexOf(item))
      .filter((i) => i !== -1)
      .sort((a, b) => b - a);
    for (const idx of indices) {
      const item = this.block.items[idx]!;
      this.removedEntries.push({ index: idx, item });
      this.block.items.splice(idx, 1);
      this.block.byteLength -= item.sourceBytes.byteLength;
    }
    this.block.isEdited = true;
  }

  undo(): void {
    // Re-insert in forward index order.
    for (const entry of [...this.removedEntries].reverse()) {
      this.block.items.splice(entry.index, 0, entry.item);
      this.block.byteLength += entry.item.sourceBytes.byteLength;
    }
  }
}

/**
 * Move multiple items by the same delta — single undo restores all.
 */
export class MoveItemsCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly entries: { item: Mutable<LevelItem>; oldX: number; oldY: number }[];
  private readonly dx: number;
  private readonly dy: number;

  constructor(
    block: LevelBlock,
    items: LevelItem[],
    dx: number,
    dy: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.dx = dx;
    this.dy = dy;
    this.entries = items.map((item) => ({
      item: item as Mutable<LevelItem>,
      oldX: item.tileX,
      oldY: item.tileY,
    }));
    this.targetSlot = targetSlot;
    this.label = `Move ${items.length} items by (${dx}, ${dy})`;
  }

  execute(): void {
    for (const e of this.entries) {
      e.item.tileX = e.oldX + this.dx;
      e.item.tileY = e.oldY + this.dy;
    }
    this.block.isEdited = true;
  }

  undo(): void {
    for (const e of this.entries) {
      e.item.tileX = e.oldX;
      e.item.tileY = e.oldY;
    }
  }
}

/**
 * Resize an extended item by updating its size nibble (low 4 bits of
 * itemId). Bypasses sourceBytes — the constructive serializer uses the
 * live `itemId` when re-encoding.
 */
export class ResizeItemCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: Mutable<LevelItem>;
  private readonly oldItemId: number;
  private readonly newItemId: number;

  constructor(
    block: LevelBlock,
    item: LevelItem,
    newSize: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item as Mutable<LevelItem>;
    this.oldItemId = item.itemId;
    this.newItemId = (item.itemId & 0xf0) | (newSize & 0x0f);
    this.targetSlot = targetSlot;
    this.label = `Resize item to ${newSize + 1} tiles`;
  }

  execute(): void {
    this.item.itemId = this.newItemId;
    this.block.isEdited = true;
  }

  undo(): void {
    this.item.itemId = this.oldItemId;
  }
}

export class MoveItemCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly item: Mutable<LevelItem>;
  private readonly block: Mutable<LevelBlock>;
  private readonly oldX: number;
  private readonly oldY: number;
  private readonly newX: number;
  private readonly newY: number;

  constructor(
    block: LevelBlock,
    item: LevelItem,
    newX: number,
    newY: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item as Mutable<LevelItem>;
    this.oldX = item.tileX;
    this.oldY = item.tileY;
    this.newX = newX;
    this.newY = newY;
    this.targetSlot = targetSlot;
    this.label = `Move item to (${newX}, ${newY})`;
  }

  execute(): void {
    this.item.tileX = this.newX;
    this.item.tileY = this.newY;
    this.block.isEdited = true;
  }

  undo(): void {
    this.item.tileX = this.oldX;
    this.item.tileY = this.oldY;
  }
}
