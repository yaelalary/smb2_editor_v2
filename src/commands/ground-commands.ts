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

/**
 * Change a stream zone's `groundType` (0..7) by modifying the companion
 * `groundType` opcode that follows its `groundSet` in the stream. If no
 * companion exists yet, insert one. Mirrors what the C++ tool's
 * `ChangeGround(itemIndex, uSets, uType)` does but scoped to the type
 * half (groundSet changes go through `SetGroundSetCommand`).
 *
 * For the HEADER zone (which has no groundSet item in the stream), use
 * `SetLevelFieldCommand` on the header's `groundType` field instead.
 */
export class SetGroundTypeCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly zoneItem: LevelItem;
  private readonly newType: number;
  private oldCompanionBytes: Uint8Array | null = null;
  private insertedCompanion: LevelItem | null = null;

  constructor(
    block: LevelBlock,
    zoneItem: LevelItem,
    newType: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.zoneItem = zoneItem;
    this.newType = newType & 0x07;
    this.targetSlot = targetSlot;
    this.label = `Set ground type to ${this.newType}`;
  }

  execute(): void {
    const arr = this.block.items as LevelItem[];
    const idx = arr.indexOf(this.zoneItem);
    if (idx === -1) return;
    const companion = arr[idx + 1];
    if (companion && companion.kind === 'groundType') {
      this.oldCompanionBytes = new Uint8Array(companion.sourceBytes);
      (companion as { sourceBytes: Uint8Array }).sourceBytes = new Uint8Array([
        0xf6,
        this.newType,
      ]);
    } else {
      this.insertedCompanion = {
        kind: 'groundType',
        sourceBytes: new Uint8Array([0xf6, this.newType]),
        sourceRange: [0, 0] as ByteRange,
        tileX: -1,
        tileY: -1,
        itemId: -1,
      };
      arr.splice(idx + 1, 0, this.insertedCompanion);
      this.block.byteLength += 2;
    }
    this.block.isEdited = true;
  }

  undo(): void {
    const arr = this.block.items as LevelItem[];
    if (this.insertedCompanion) {
      const compIdx = arr.indexOf(this.insertedCompanion);
      if (compIdx !== -1) {
        arr.splice(compIdx, 1);
        this.block.byteLength -= 2;
      }
      this.insertedCompanion = null;
      return;
    }
    if (this.oldCompanionBytes) {
      const idx = arr.indexOf(this.zoneItem);
      if (idx === -1) return;
      const companion = arr[idx + 1];
      if (companion && companion.kind === 'groundType') {
        (companion as { sourceBytes: Uint8Array }).sourceBytes = this.oldCompanionBytes;
      }
      this.oldCompanionBytes = null;
    }
  }
}

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
 *
 * Vanilla SMB2 encodes per-zone physics via a `groundSet` + `groundType`
 * opcode pair (see the groundType retro-update semantic in ground-pass.ts).
 * If we insert a lone `groundSet` between an existing zone and its
 * trailing `groundType`, the retro-update gets hijacked by the new
 * zone — the previous zone loses its pinned type. To preserve the
 * chain, we insert BOTH a `groundSet` AND a `groundType` item,
 * pinning the new zone's type explicitly.
 */
export class InsertGroundSegmentCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly afterItem: LevelItem | null;
  private readonly newSetItem: LevelItem;
  private readonly newTypeItem: LevelItem;
  private insertedIdx = -1;

  constructor(
    block: LevelBlock,
    afterItem: LevelItem | null,
    startPos: number,
    groundSet: number,
    groundType: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<LevelBlock>;
    this.afterItem = afterItem;
    const clampedSet = Math.max(0, Math.min(31, groundSet));
    const clampedType = Math.max(0, Math.min(7, groundType));
    const pos = Math.max(1, Math.floor(startPos));
    // GroundSet: byte0 = 0xF0 (reserved low nibble), byte1 = shape.
    // The constructive serializer overwrites these based on
    // `absoluteStartPos` and the cursor at emit time.
    this.newSetItem = {
      kind: 'groundSet',
      sourceBytes: new Uint8Array([0xf0, clampedSet & 0x1f]),
      sourceRange: [0, 0] as ByteRange,
      tileX: -1,
      tileY: -1,
      itemId: -1,
      absoluteStartPos: pos,
    };
    // GroundType: byte0 = 0xF6, byte1 low 3 bits = groundType. Pins the
    // new zone's runtime type via the retro-update semantic.
    this.newTypeItem = {
      kind: 'groundType',
      sourceBytes: new Uint8Array([0xf6, clampedType & 0x07]),
      sourceRange: [0, 0] as ByteRange,
      tileX: -1,
      tileY: -1,
      itemId: -1,
    };
    this.targetSlot = targetSlot;
    this.label = `Insert ground segment at ${pos}`;
  }

  execute(): void {
    const arr = this.block.items as LevelItem[];
    if (this.afterItem === null) {
      arr.unshift(this.newSetItem, this.newTypeItem);
      this.insertedIdx = 0;
    } else {
      const afterIdx = arr.indexOf(this.afterItem);
      if (afterIdx === -1) return;
      // Skip over the anchor's own `groundType` companion if present so
      // our new pair lands AFTER it, preserving the anchor's pinned type.
      let insertAt = afterIdx + 1;
      if (arr[insertAt]?.kind === 'groundType') insertAt++;
      this.insertedIdx = insertAt;
      arr.splice(insertAt, 0, this.newSetItem, this.newTypeItem);
    }
    this.block.byteLength += 4; // 2 bytes each
    this.block.isEdited = true;
  }

  undo(): void {
    if (this.insertedIdx < 0) return;
    const arr = this.block.items as LevelItem[];
    // Find and remove the exact pair we inserted (by reference).
    const setIdx = arr.indexOf(this.newSetItem);
    if (setIdx !== -1) {
      // The groundType companion should be right after.
      const typeIdx = arr.indexOf(this.newTypeItem);
      if (typeIdx === setIdx + 1) {
        arr.splice(setIdx, 2);
        this.block.byteLength -= 4;
      } else {
        // Defensive: remove them individually if somehow separated.
        arr.splice(setIdx, 1);
        this.block.byteLength -= 2;
        const typeIdx2 = arr.indexOf(this.newTypeItem);
        if (typeIdx2 !== -1) {
          arr.splice(typeIdx2, 1);
          this.block.byteLength -= 2;
        }
      }
    }
    this.insertedIdx = -1;
  }
}

/**
 * Delete a ground segment item from the stream.
 *
 * Also removes the `groundType` opcode immediately following the
 * deleted groundSet (if any) — it was pinning this zone's type, and
 * leaving it in place would cause it to retroactively rewrite the
 * PREVIOUS zone's type (hijacking its physics). See the groundType
 * retro-update semantic in ground-pass.ts.
 */
export class DeleteGroundSegmentCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<LevelBlock>;
  private readonly item: LevelItem;
  private removedIdx = -1;
  private removedCompanion: LevelItem | null = null;

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
    const companion = arr[this.removedIdx + 1];
    if (companion && companion.kind === 'groundType') {
      this.removedCompanion = companion;
      arr.splice(this.removedIdx, 2);
      this.block.byteLength -=
        this.item.sourceBytes.byteLength + companion.sourceBytes.byteLength;
    } else {
      this.removedCompanion = null;
      arr.splice(this.removedIdx, 1);
      this.block.byteLength -= this.item.sourceBytes.byteLength;
    }
    this.block.isEdited = true;
  }

  undo(): void {
    if (this.removedIdx === -1) return;
    const arr = this.block.items as LevelItem[];
    if (this.removedCompanion) {
      arr.splice(this.removedIdx, 0, this.item, this.removedCompanion);
      this.block.byteLength +=
        this.item.sourceBytes.byteLength + this.removedCompanion.sourceBytes.byteLength;
    } else {
      arr.splice(this.removedIdx, 0, this.item);
      this.block.byteLength += this.item.sourceBytes.byteLength;
    }
  }
}
