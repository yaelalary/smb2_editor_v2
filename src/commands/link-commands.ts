/**
 * Level link commands — Unit 18.
 *
 * Two command types:
 * 1. SetPointerDestCommand — changes an in-level pointer item's
 *    destination bytes (the 2 param bytes after 0xF5).
 * 2. SetSlotMappingCommand — reassigns a level slot to a different
 *    level block and/or enemy block in the routing table.
 */

import type { Command, Mutable } from './types';
import type { LevelItem, LevelMap, EnemyMap } from '@/rom/model';

/**
 * Edit the destination of a pointer item (0xF5 + 2 param bytes).
 * sourceBytes[1] = destination low, sourceBytes[2] = destination high.
 */
export class SetPointerDestCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly item: Mutable<LevelItem>;
  private readonly oldLo: number;
  private readonly oldHi: number;
  private readonly newLo: number;
  private readonly newHi: number;

  constructor(item: LevelItem, newLo: number, newHi: number, slot: number) {
    this.item = item as Mutable<LevelItem>;
    this.oldLo = item.sourceBytes[1] ?? 0;
    this.oldHi = item.sourceBytes[2] ?? 0;
    this.newLo = newLo;
    this.newHi = newHi;
    this.targetSlot = slot;
    this.label = `Set pointer dest to 0x${((newHi << 8) | newLo).toString(16).padStart(4, '0')}`;
  }

  execute(): void {
    this.item.sourceBytes[1] = this.newLo;
    this.item.sourceBytes[2] = this.newHi;
  }

  undo(): void {
    this.item.sourceBytes[1] = this.oldLo;
    this.item.sourceBytes[2] = this.oldHi;
  }
}

/**
 * Reassign a level slot to a different level block and/or enemy block.
 * This edits the slotToBlock routing tables without touching the blocks
 * themselves.
 */
export class SetSlotMappingCommand implements Command {
  readonly label: string;
  readonly targetSlot: number;

  private readonly levelMap: Mutable<LevelMap>;
  private readonly enemyMap: Mutable<EnemyMap>;
  private readonly slot: number;
  private readonly oldLevelBlock: number;
  private readonly newLevelBlock: number;
  private readonly oldEnemyBlock: number;
  private readonly newEnemyBlock: number;

  constructor(
    levelMap: LevelMap,
    enemyMap: EnemyMap,
    slot: number,
    newLevelBlock: number,
    newEnemyBlock: number,
  ) {
    this.levelMap = levelMap as Mutable<LevelMap>;
    this.enemyMap = enemyMap as Mutable<EnemyMap>;
    this.slot = slot;
    this.targetSlot = slot;
    this.oldLevelBlock = levelMap.slotToBlock[slot]!;
    this.newLevelBlock = newLevelBlock;
    this.oldEnemyBlock = enemyMap.slotToBlock[slot]!;
    this.newEnemyBlock = newEnemyBlock;

    const w = Math.floor(slot / 10);
    const l = slot % 10;
    this.label = `Remap W${w}:L${l} → lvl#${newLevelBlock} enm#${newEnemyBlock}`;
  }

  execute(): void {
    (this.levelMap.slotToBlock as number[])[this.slot] = this.newLevelBlock;
    (this.enemyMap.slotToBlock as number[])[this.slot] = this.newEnemyBlock;
  }

  undo(): void {
    (this.levelMap.slotToBlock as number[])[this.slot] = this.oldLevelBlock;
    (this.enemyMap.slotToBlock as number[])[this.slot] = this.oldEnemyBlock;
  }
}
