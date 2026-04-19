/**
 * Ground segment editing commands.
 *
 * Ground segments live in the level's item stream as `groundSet` items.
 * Each one carries a cached `absoluteStartPos` (populated at parse time
 * in level-parser.ts and honoured by the constructive serializer). The
 * commands below mutate that cache — the serializer re-encodes the
 * byte pair from it at download time.
 *
 * The level header itself carries the first segment (startPos = 0);
 * editing its groundSet goes through the existing SetLevelFieldCommand.
 */

import type { Command, Mutable } from './types';
import type { ByteRange, LevelBlock, LevelItem } from '@/rom/model';

/** Change a ground segment's preset (0..31). */
export class SetGroundSetCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: Mutable<LevelItem>;
  private readonly oldBytes: Uint8Array;
  private readonly newBytes: Uint8Array;

  constructor(
    block: LevelBlock,
    item: LevelItem,
    newGroundSet: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item as Mutable<LevelItem>;
    this.oldBytes = new Uint8Array(item.sourceBytes);
    const src = item.sourceBytes;
    const byte0 = src[0] ?? 0;
    const byte1 = src[1] ?? 0;
    const clamped = Math.max(0, Math.min(31, newGroundSet));
    // Keep the current offset bits (5..7) intact — they're regenerated
    // at serialize time from absoluteStartPos anyway, but keeping them
    // stable here means the raw sourceBytes still look coherent for any
    // diagnostic that peeks at them pre-serialize.
    const newByte1 = (byte1 & 0xe0) | (clamped & 0x1f);
    this.newBytes = new Uint8Array([byte0, newByte1]);
    this.targetSlot = targetSlot;
    this.label = `Set ground pattern to ${clamped}`;
  }

  execute(): void {
    (this.item as { sourceBytes: Uint8Array }).sourceBytes = this.newBytes;
    this.block.isEdited = true;
  }

  undo(): void {
    (this.item as { sourceBytes: Uint8Array }).sourceBytes = this.oldBytes;
  }
}

/** Move a ground segment's start position. */
export class MoveGroundSegmentCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: Mutable<LevelItem>;
  private readonly oldPos: number;
  private readonly newPos: number;

  constructor(
    block: LevelBlock,
    item: LevelItem,
    newStartPos: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item as Mutable<LevelItem>;
    this.oldPos = item.absoluteStartPos ?? 0;
    this.newPos = Math.max(1, Math.floor(newStartPos));
    this.targetSlot = targetSlot;
    this.label = `Move ground segment to ${this.newPos}`;
  }

  execute(): void {
    this.item.absoluteStartPos = this.newPos;
    this.block.isEdited = true;
  }

  undo(): void {
    this.item.absoluteStartPos = this.oldPos;
  }
}

/**
 * Insert a new ground segment. `afterItem` is the existing groundSet
 * item the new one should follow in the stream, or `null` to insert at
 * the head (right after the header, becoming the first stream segment).
 */
export class InsertGroundSegmentCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly afterItem: LevelItem | null;
  private readonly newItem: LevelItem;
  private insertedIdx = -1;

  constructor(
    block: LevelBlock,
    afterItem: LevelItem | null,
    startPos: number,
    groundSet: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.afterItem = afterItem;
    const clampedSet = Math.max(0, Math.min(31, groundSet));
    const pos = Math.max(1, Math.floor(startPos));
    // Byte0 = 0xF0 (low-nibble = 0 reserved), byte1 = groundSet. The
    // constructive serializer overwrites these based on
    // `absoluteStartPos` and the cursor at emit time.
    const byte0 = 0xf0;
    const byte1 = clampedSet & 0x1f;
    this.newItem = {
      kind: 'groundSet',
      sourceBytes: new Uint8Array([byte0, byte1]),
      sourceRange: [0, 0] as ByteRange,
      tileX: -1,
      tileY: -1,
      itemId: -1,
      absoluteStartPos: pos,
    };
    this.targetSlot = targetSlot;
    this.label = `Insert ground segment at ${pos}`;
  }

  execute(): void {
    const arr = this.block.items as LevelItem[];
    if (this.afterItem === null) {
      arr.unshift(this.newItem);
      this.insertedIdx = 0;
    } else {
      const afterIdx = arr.indexOf(this.afterItem);
      if (afterIdx === -1) return;
      this.insertedIdx = afterIdx + 1;
      arr.splice(this.insertedIdx, 0, this.newItem);
    }
    this.block.byteLength += 2;
    this.block.isEdited = true;
  }

  undo(): void {
    if (this.insertedIdx < 0) return;
    const arr = this.block.items as LevelItem[];
    const idx = arr.indexOf(this.newItem);
    if (idx !== -1) {
      arr.splice(idx, 1);
      this.block.byteLength -= 2;
    }
    this.insertedIdx = -1;
  }
}

/** Delete a ground segment item from the stream. */
export class DeleteGroundSegmentCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: LevelItem;
  private removedIdx = -1;

  constructor(block: LevelBlock, item: LevelItem, targetSlot?: number) {
    this.block = block as Mutable<LevelBlock>;
    this.item = item;
    this.targetSlot = targetSlot;
    this.label = `Delete ground segment at ${item.absoluteStartPos ?? '?'}`;
  }

  execute(): void {
    const arr = this.block.items as LevelItem[];
    this.removedIdx = arr.indexOf(this.item);
    if (this.removedIdx === -1) return;
    arr.splice(this.removedIdx, 1);
    this.block.byteLength -= this.item.sourceBytes.byteLength;
    this.block.isEdited = true;
  }

  undo(): void {
    if (this.removedIdx === -1) return;
    const arr = this.block.items as LevelItem[];
    arr.splice(this.removedIdx, 0, this.item);
    this.block.byteLength += this.item.sourceBytes.byteLength;
  }
}
