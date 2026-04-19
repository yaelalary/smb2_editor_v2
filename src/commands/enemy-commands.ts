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
    pageIndex: number,
    localX: number,
    localY: number,
    enemyId: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<EnemyBlock>;
    this.pageIndex = pageIndex;
    this.newEnemy = {
      id: enemyId,
      x: localX,
      y: localY,
      sourceBytes: new Uint8Array([enemyId, (localX << 4) | (localY & 0x0f)]),
      sourceRange: [0, 0],
    };
    this.targetSlot = targetSlot;
    this.label = `Place enemy ${enemyId} on page ${pageIndex} (${localX}, ${localY})`;
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

/**
 * Move an existing enemy to a new absolute (x, y). Crossing page
 * boundaries (X / 16) is handled transparently: the enemy is removed
 * from its original page and appended to the target page.
 */
export class MoveEnemyCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<EnemyBlock>;
  private readonly enemy: Mutable<EnemyItem>;
  private readonly oldPageIndex: number;
  private readonly oldLocalX: number;
  private readonly oldY: number;
  private readonly newPageIndex: number;
  private readonly newLocalX: number;
  private readonly newY: number;
  private oldIndexInPage = -1;

  constructor(
    block: EnemyBlock,
    enemy: EnemyItem,
    oldPageIndex: number,
    newPageIndex: number,
    newLocalX: number,
    newY: number,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<EnemyBlock>;
    this.enemy = enemy as Mutable<EnemyItem>;
    this.oldPageIndex = oldPageIndex;
    this.oldLocalX = enemy.x;
    this.oldY = enemy.y;
    this.newPageIndex = newPageIndex;
    this.newLocalX = newLocalX;
    this.newY = newY;
    this.targetSlot = targetSlot;
    this.label = `Move enemy ${enemy.id} to page ${newPageIndex} (${newLocalX}, ${newY})`;
  }

  execute(): void {
    const srcPage = this.block.pages[this.oldPageIndex] as Mutable<EnemyPage> | undefined;
    if (!srcPage) return;
    this.oldIndexInPage = (srcPage.enemies as EnemyItem[]).indexOf(this.enemy);
    if (this.oldIndexInPage === -1) return;

    if (this.newPageIndex === this.oldPageIndex) {
      this.enemy.x = this.newLocalX;
      this.enemy.y = this.newY;
    } else {
      (srcPage.enemies as EnemyItem[]).splice(this.oldIndexInPage, 1);
      srcPage.sizeByte = 1 + srcPage.enemies.length * 2;

      const dstPage = findOrCreatePage(this.block, this.newPageIndex);
      this.enemy.x = this.newLocalX;
      this.enemy.y = this.newY;
      (dstPage.enemies as EnemyItem[]).push(this.enemy);
      dstPage.sizeByte = 1 + dstPage.enemies.length * 2;
    }
    this.block.isEdited = true;
  }

  undo(): void {
    if (this.oldIndexInPage === -1) return;
    if (this.newPageIndex === this.oldPageIndex) {
      this.enemy.x = this.oldLocalX;
      this.enemy.y = this.oldY;
      return;
    }
    const dstPage = this.block.pages[this.newPageIndex] as Mutable<EnemyPage> | undefined;
    if (dstPage) {
      const idx = (dstPage.enemies as EnemyItem[]).indexOf(this.enemy);
      if (idx !== -1) {
        (dstPage.enemies as EnemyItem[]).splice(idx, 1);
        dstPage.sizeByte = 1 + dstPage.enemies.length * 2;
      }
    }
    const srcPage = this.block.pages[this.oldPageIndex] as Mutable<EnemyPage> | undefined;
    if (srcPage) {
      this.enemy.x = this.oldLocalX;
      this.enemy.y = this.oldY;
      (srcPage.enemies as EnemyItem[]).splice(this.oldIndexInPage, 0, this.enemy);
      srcPage.sizeByte = 1 + srcPage.enemies.length * 2;
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

/**
 * Batch-delete multiple enemies in a single history step. Indices are
 * snapshot at execute time so undo restores every enemy to its exact
 * per-page position — mirrors tile-commands.ts DeleteItemsCommand.
 */
export class DeleteEnemiesCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<EnemyBlock>;
  private readonly selections: ReadonlyArray<{ enemy: EnemyItem; pageIndex: number }>;
  private removedEntries: { pageIndex: number; indexInPage: number; enemy: EnemyItem }[] = [];

  constructor(
    block: EnemyBlock,
    selections: ReadonlyArray<{ enemy: EnemyItem; pageIndex: number }>,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<EnemyBlock>;
    this.selections = selections;
    this.targetSlot = targetSlot;
    this.label = `Delete ${selections.length} enemies`;
  }

  execute(): void {
    this.removedEntries = [];

    // Group selections by page so we can splice each page desc-by-index
    // and keep indices stable within the splice sequence.
    const byPage = new Map<number, EnemyItem[]>();
    for (const s of this.selections) {
      const bucket = byPage.get(s.pageIndex) ?? [];
      bucket.push(s.enemy);
      byPage.set(s.pageIndex, bucket);
    }

    let removedCount = 0;
    for (const [pageIndex, enemies] of byPage) {
      const page = this.block.pages[pageIndex] as Mutable<EnemyPage> | undefined;
      if (!page) continue;
      const arr = page.enemies as EnemyItem[];
      const indices = enemies
        .map((e) => arr.indexOf(e))
        .filter((i) => i !== -1)
        .sort((a, b) => b - a);
      for (const idx of indices) {
        const enemy = arr[idx]!;
        this.removedEntries.push({ pageIndex, indexInPage: idx, enemy });
        arr.splice(idx, 1);
        removedCount += 1;
      }
      page.sizeByte = 1 + arr.length * 2;
    }

    this.block.byteLength -= 2 * removedCount;
    this.block.isEdited = true;
  }

  undo(): void {
    // Re-insert in reverse of removal order so per-page indices match.
    for (const entry of [...this.removedEntries].reverse()) {
      const page = this.block.pages[entry.pageIndex] as Mutable<EnemyPage> | undefined;
      if (!page) continue;
      const arr = page.enemies as EnemyItem[];
      arr.splice(entry.indexInPage, 0, entry.enemy);
      page.sizeByte = 1 + arr.length * 2;
      this.block.byteLength += 2;
    }
  }
}

/**
 * Batch-move multiple enemies by the same (dx, dy). Each enemy computes
 * its own new page based on `isH`, so a group may split across pages
 * after the move. Rejects the whole batch if any enemy would land at a
 * negative coordinate (matches the single-enemy guard in LevelCanvas).
 *
 * The move is reference-preserving: `enemy.x/y` are mutated in place so
 * the caller's `selectedEnemies` references stay valid. The command
 * exposes the per-entry new page index via `getNewPage()` so the caller
 * can refresh its selection wrappers without recomputing.
 */
export class MoveEnemiesCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly block: Mutable<EnemyBlock>;
  private readonly entries: {
    enemy: Mutable<EnemyItem>;
    oldPageIndex: number;
    oldLocalX: number;
    oldLocalY: number;
    oldIndexInPage: number;
    newPageIndex: number;
    newLocalX: number;
    newLocalY: number;
  }[];
  private readonly rejected: boolean;

  constructor(
    block: EnemyBlock,
    selections: ReadonlyArray<{ enemy: EnemyItem; pageIndex: number }>,
    dx: number,
    dy: number,
    isH: boolean,
    targetSlot?: number,
  ) {
    this.block = block as Mutable<EnemyBlock>;
    this.targetSlot = targetSlot;
    this.label = `Move ${selections.length} enemies by (${dx}, ${dy})`;

    const entries: typeof this.entries = [];
    let anyNegative = false;
    for (const s of selections) {
      const oldAbsX = isH ? s.pageIndex * 16 + s.enemy.x : s.enemy.x;
      const oldAbsY = isH ? s.enemy.y : s.pageIndex * 16 + s.enemy.y;
      const newAbsX = oldAbsX + dx;
      const newAbsY = oldAbsY + dy;
      if (newAbsX < 0 || newAbsY < 0) {
        anyNegative = true;
        break;
      }
      const newPageIndex = isH ? Math.floor(newAbsX / 16) : Math.floor(newAbsY / 16);
      const newLocalX = isH ? newAbsX % 16 : newAbsX;
      const newLocalY = isH ? newAbsY : newAbsY % 16;
      entries.push({
        enemy: s.enemy as Mutable<EnemyItem>,
        oldPageIndex: s.pageIndex,
        oldLocalX: s.enemy.x,
        oldLocalY: s.enemy.y,
        oldIndexInPage: -1, // filled in execute()
        newPageIndex,
        newLocalX,
        newLocalY,
      });
    }
    this.entries = entries;
    this.rejected = anyNegative;
  }

  /** True when construction rejected the batch — caller should not run this. */
  get wasRejected(): boolean { return this.rejected; }

  /** New page index for the i-th selection — only meaningful after execute. */
  getNewPage(i: number): number {
    return this.entries[i]?.newPageIndex ?? 0;
  }

  execute(): void {
    if (this.rejected) return;

    // Pass 1 — remove every enemy from its source page, recording
    // intra-page index per-entry so undo can re-insert at the right
    // slot. Group by page + desc sort to keep indices stable.
    const byPage = new Map<number, number[]>();
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      const bucket = byPage.get(e.oldPageIndex) ?? [];
      bucket.push(i);
      byPage.set(e.oldPageIndex, bucket);
    }
    for (const [pageIndex, entryIndices] of byPage) {
      const page = this.block.pages[pageIndex] as Mutable<EnemyPage> | undefined;
      if (!page) continue;
      const arr = page.enemies as EnemyItem[];
      // Sort entry indices by descending arr-index so splices don't shift earlier ones.
      const withIdx = entryIndices.map((ei) => ({
        ei,
        arrIdx: arr.indexOf(this.entries[ei]!.enemy),
      }));
      withIdx.sort((a, b) => b.arrIdx - a.arrIdx);
      for (const { ei, arrIdx } of withIdx) {
        if (arrIdx === -1) continue;
        this.entries[ei]!.oldIndexInPage = arrIdx;
        arr.splice(arrIdx, 1);
      }
      page.sizeByte = 1 + arr.length * 2;
    }

    // Pass 2 — mutate coordinates in place and append to new page.
    for (const e of this.entries) {
      if (e.oldIndexInPage === -1) continue;
      e.enemy.x = e.newLocalX;
      e.enemy.y = e.newLocalY;
      const dst = findOrCreatePage(this.block, e.newPageIndex);
      (dst.enemies as EnemyItem[]).push(e.enemy);
      dst.sizeByte = 1 + dst.enemies.length * 2;
    }

    this.block.isEdited = true;
  }

  undo(): void {
    if (this.rejected) return;

    // Pass 1 — remove from new pages.
    for (const e of this.entries) {
      if (e.oldIndexInPage === -1) continue;
      const dst = this.block.pages[e.newPageIndex] as Mutable<EnemyPage> | undefined;
      if (!dst) continue;
      const arr = dst.enemies as EnemyItem[];
      const idx = arr.indexOf(e.enemy);
      if (idx !== -1) arr.splice(idx, 1);
      dst.sizeByte = 1 + arr.length * 2;
    }

    // Pass 2 — restore coordinates, re-insert in original pages in
    // reverse order so per-page indices match.
    for (const e of [...this.entries].reverse()) {
      if (e.oldIndexInPage === -1) continue;
      e.enemy.x = e.oldLocalX;
      e.enemy.y = e.oldLocalY;
      const src = this.block.pages[e.oldPageIndex] as Mutable<EnemyPage> | undefined;
      if (!src) continue;
      const arr = src.enemies as EnemyItem[];
      arr.splice(e.oldIndexInPage, 0, e.enemy);
      src.sizeByte = 1 + arr.length * 2;
    }
  }
}
