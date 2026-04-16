/**
 * Enemy editing commands — Unit 11.
 *
 * Operate on EnemyBlock pages. Adding an enemy inserts it into the
 * appropriate page (determined by absolute X / 16). Removing/moving
 * updates the page structure. All commands mark the block for
 * constructive serialization.
 */

import type { Command, Mutable } from './types';
import type { EnemyBlock, EnemyItem, EnemyPage } from '@/rom/model';

function findOrCreatePage(
  block: Mutable<EnemyBlock>,
  pageIndex: number,
): Mutable<EnemyPage> {
  // Grow pages array if needed.
  while (block.pages.length <= pageIndex) {
    (block.pages as EnemyPage[]).push({
      sizeByte: 1, // empty page
      enemies: [],
      sourceRange: [0, 0],
    });
  }
  return block.pages[pageIndex] as Mutable<EnemyPage>;
}

export class PlaceEnemyCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<EnemyBlock>;
  private readonly pageIndex: number;
  private readonly newEnemy: EnemyItem;

  constructor(
    block: EnemyBlock,
    absoluteX: number,
    y: number,
    enemyId: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<EnemyBlock>;
    this.pageIndex = Math.floor(absoluteX / 16);
    const localX = absoluteX % 16;
    this.newEnemy = {
      id: enemyId,
      x: localX,
      y,
      sourceBytes: new Uint8Array([enemyId, (localX << 4) | (y & 0x0f)]),
      sourceRange: [0, 0],
    };
    this.targetSlot = targetSlot;
    this.label = `Place enemy ${enemyId} at (${absoluteX}, ${y})`;
  }

  execute(): void {
    const page = findOrCreatePage(this.block, this.pageIndex);
    (page.enemies as EnemyItem[]).push(this.newEnemy);
    page.sizeByte = 1 + page.enemies.length * 2;
    this.block.byteLength += 2;
    this.block.isEdited = true;
  }

  undo(): void {
    const page = this.block.pages[this.pageIndex] as Mutable<EnemyPage> | undefined;
    if (!page) return;
    const idx = (page.enemies as EnemyItem[]).indexOf(this.newEnemy);
    if (idx !== -1) {
      (page.enemies as EnemyItem[]).splice(idx, 1);
      page.sizeByte = 1 + page.enemies.length * 2;
      this.block.byteLength -= 2;
    }
  }
}

export class DeleteEnemyCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<EnemyBlock>;
  private readonly pageIndex: number;
  private readonly enemy: EnemyItem;
  private removedIdx = -1;

  constructor(
    block: EnemyBlock,
    pageIndex: number,
    enemy: EnemyItem,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<EnemyBlock>;
    this.pageIndex = pageIndex;
    this.enemy = enemy;
    this.targetSlot = targetSlot;
    this.label = `Delete enemy ${enemy.id} at page ${pageIndex}`;
  }

  execute(): void {
    const page = this.block.pages[this.pageIndex] as Mutable<EnemyPage> | undefined;
    if (!page) return;
    this.removedIdx = (page.enemies as EnemyItem[]).indexOf(this.enemy);
    if (this.removedIdx !== -1) {
      (page.enemies as EnemyItem[]).splice(this.removedIdx, 1);
      page.sizeByte = 1 + page.enemies.length * 2;
      this.block.byteLength -= 2;
      this.block.isEdited = true;
    }
  }

  undo(): void {
    if (this.removedIdx === -1) return;
    const page = this.block.pages[this.pageIndex] as Mutable<EnemyPage> | undefined;
    if (!page) return;
    (page.enemies as EnemyItem[]).splice(this.removedIdx, 0, this.enemy);
    page.sizeByte = 1 + page.enemies.length * 2;
    this.block.byteLength += 2;
  }
}
