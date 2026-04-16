/**
 * DetachEnemyBlockCommand — Unit 12.
 *
 * When the active slot's enemy block is shared with other slots, this
 * command creates an independent copy so edits to this slot's enemies
 * no longer affect other levels.
 *
 * This is a compound mutation: it deep-copies pages, creates a new
 * EnemyBlock, pushes it to enemyMap.blocks, and updates
 * enemyMap.slotToBlock for the active slot. Undo reverses all of this.
 */

import type { Command, Mutable } from './types';
import type { EnemyBlock, EnemyItem, EnemyMap, EnemyPage, LevelSlotId } from '@/rom/model';
import { levelSlotId } from '@/rom/model';

export class DetachEnemyBlockCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly enemyMap: Mutable<EnemyMap>;
  private readonly slot: number;
  private readonly oldBlockIdx: number;
  private newBlockIdx = -1;

  constructor(enemyMap: EnemyMap, slot: number) {
    this.enemyMap = enemyMap as Mutable<EnemyMap>;
    this.slot = slot;
    this.oldBlockIdx = enemyMap.slotToBlock[slot]!;
    this.targetSlot = slot;
    this.label = `Detach enemies for slot ${slot}`;
  }

  execute(): void {
    const oldBlock = this.enemyMap.blocks[this.oldBlockIdx]! as Mutable<EnemyBlock>;

    // Deep-copy the pages and enemies.
    const newPages: EnemyPage[] = oldBlock.pages.map((page) => ({
      sizeByte: page.sizeByte,
      enemies: page.enemies.map((e): EnemyItem => ({
        id: e.id,
        x: e.x,
        y: e.y,
        sourceBytes: new Uint8Array(e.sourceBytes),
        sourceRange: [...e.sourceRange] as [number, number],
      })),
      sourceRange: [...page.sourceRange] as [number, number],
    }));

    const newBlock: EnemyBlock = {
      romOffset: 0, // new block, no original ROM position
      pages: newPages,
      byteLength: oldBlock.byteLength,
      sourceRange: [0, 0],
      referencingSlots: [levelSlotId(this.slot)],
      isEdited: true, // will use constructive serializer
    };

    // Add the new block to the map.
    this.newBlockIdx = this.enemyMap.blocks.length;
    (this.enemyMap.blocks as EnemyBlock[]).push(newBlock);

    // Update slot mapping.
    (this.enemyMap.slotToBlock as number[])[this.slot] = this.newBlockIdx;

    // Remove this slot from the old block's referencing slots.
    const oldRefs = oldBlock.referencingSlots as LevelSlotId[];
    const refIdx = oldRefs.indexOf(levelSlotId(this.slot));
    if (refIdx !== -1) oldRefs.splice(refIdx, 1);
  }

  undo(): void {
    const oldBlock = this.enemyMap.blocks[this.oldBlockIdx]! as Mutable<EnemyBlock>;

    // Restore slot mapping.
    (this.enemyMap.slotToBlock as number[])[this.slot] = this.oldBlockIdx;

    // Re-add this slot to the old block's referencing slots.
    (oldBlock.referencingSlots as LevelSlotId[]).push(levelSlotId(this.slot));

    // Remove the new block (it's the last one we pushed).
    if (this.newBlockIdx >= 0) {
      (this.enemyMap.blocks as EnemyBlock[]).splice(this.newBlockIdx, 1);
    }
  }
}
