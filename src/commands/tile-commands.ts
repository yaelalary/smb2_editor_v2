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
    itemId: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
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
