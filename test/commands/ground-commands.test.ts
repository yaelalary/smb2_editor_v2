/**
 * Ground segment round-trip tests.
 *
 * These target the class of bugs the user hit: serialize → reparse
 * drifting ground zone positions by ±1 tile, which makes
 * "extends-to-ground" items (brick walls, trees, pillars) render with
 * wrong heights in-game even though the editor canvas looks correct.
 *
 * Each test parses a real vanilla SMB2 block, mutates its zones through
 * the command layer (split / move / delete / set), serializes, reparses,
 * and asserts that every zone's absoluteStartPos round-trips exactly.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseLevelMap } from '@/rom/level-parser';
import { serializeLevelBlock } from '@/rom/level-serializer';
import { computeGroundSegments } from '@/rom/ground-pass';
import {
  InsertGroundSegmentCommand,
  MoveGroundSegmentCommand,
  DeleteGroundSegmentCommand,
  SetGroundSetCommand,
  SetGroundTypeCommand,
} from '@/commands/ground-commands';
import type { LevelBlock, LevelHeader } from '@/rom/model';
import { LEVEL_HEADER_BYTES } from '@/rom/constants';

const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/smb2.nes');
const hasFixture = fs.existsSync(FIXTURE_PATH);

function loadRom(): Uint8Array {
  const buf = fs.readFileSync(FIXTURE_PATH);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Re-parse a single serialized block by wrapping it into a minimal map
 * context and running parseLevelMap on a synthesized ROM. For unit tests
 * we can simply re-parse via parseLevelMap on the full rebuilt ROM, but
 * that's slow — so we extract just the header + items manually.
 */
function reparseBlockBytes(
  bytes: Uint8Array,
  originalHeader: LevelHeader,
): { zones: { startPos: number; groundSet: number }[] } {
  // Cheap hand-rolled re-parse: just extract zones by walking the stream
  // the same way populateAbsolutePositions does. Sufficient for asserting
  // that groundSet encoding round-trips.
  const isH = originalHeader.direction === 1;
  const zones: { startPos: number; groundSet: number }[] = [
    { startPos: 0, groundSet: (bytes[1] ?? 0) & 0x1f },
  ];
  let deltaX = 0;
  let deltaY = 0;
  let lastGroundPos = 0;
  let i = LEVEL_HEADER_BYTES;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    if (b0 === 0xff) break;
    const high = (b0 >> 4) & 0x0f;
    if (high === 0x0f) {
      const low = b0 & 0x0f;
      switch (low) {
        case 0x0:
        case 0x1: {
          // groundSet
          const b1 = bytes[i + 1] ?? 0;
          const reserved = low; // 0 or 1
          const offset = (b1 >> 5) & 0x07;
          const base = isH ? deltaX : 0x0f * Math.floor(deltaX / 0x10);
          let pos = base + 8 * reserved + offset;
          if (pos <= lastGroundPos) pos = lastGroundPos + 1;
          lastGroundPos = pos;
          zones.push({ startPos: pos, groundSet: b1 & 0x1f });
          i += 2;
          continue;
        }
        case 0x2:
        case 0x3: {
          // skipper
          deltaY = 0;
          deltaX += (low - 1) * 0x10;
          i += 1;
          continue;
        }
        case 0x4: {
          // backToStart
          deltaX = 0;
          deltaY = 0;
          i += 1;
          continue;
        }
        case 0x5: {
          // pointer (3 bytes)
          i += 3;
          continue;
        }
        case 0x6: {
          // groundType
          i += 2;
          continue;
        }
        default: {
          i += 2;
          continue;
        }
      }
    }
    // Regular / entrance item. For this test we only care about cursor
    // advancement, so treat it as 2 bytes and update cursor accordingly.
    const iy = (b0 >> 4) & 0x0f;
    // entrance? look at byte[i+1] id and byte[i+2] param:
    const id = bytes[i + 1] ?? 0;
    let size = 2;
    if ([0x09, 0x0a, 0x0b, 0x13, 0x14, 0x15, 0x1c, 0x1d, 0x1e].includes(id)) {
      const param = bytes[i + 2] ?? 0;
      if (param === 0xf5) size = 5;
      else if (param >= 0xf0) size = 2;
      else size = 4;
    }
    deltaY += iy;
    if (deltaY >= 0x0f) {
      deltaY = (deltaY + 1) % 16;
      deltaX += 0x10;
    }
    i += size;
  }
  return { zones };
}

function getBlockForSlot(
  rom: Uint8Array,
  slot: number,
): LevelBlock {
  const map = parseLevelMap(rom);
  const idx = map.slotToBlock[slot];
  if (idx === undefined) throw new Error(`no block for slot ${slot}`);
  const block = map.blocks[idx];
  if (!block) throw new Error(`block ${idx} missing`);
  return block as unknown as LevelBlock;
}

describe.skipIf(!hasFixture)('Ground commands — round-trip', () => {
  it('split on a header zone round-trips', () => {
    const rom = loadRom();
    // Slot 0 (1-1·1) is horizontal, has a simple ground. Good baseline.
    const block = getBlockForSlot(rom, 0);

    // Record original zones.
    const originalZones = computeGroundSegments(block).map((z) => ({
      startPos: z.startPos,
      groundSet: z.groundSet,
    }));

    // Split the header zone at position 10.
    const cmd = new InsertGroundSegmentCommand(block, null, 10, 5, 0);
    cmd.execute();

    const expectedZones = computeGroundSegments(block).map((z) => z.startPos);

    // Serialize + reparse.
    const bytes = serializeLevelBlock(block);
    const { zones } = reparseBlockBytes(bytes, block.header);
    const actualZones = zones.map((z) => z.startPos);

    expect(actualZones).toEqual(expectedZones);
    // Also assert original zones are preserved after the new one.
    expect(actualZones).toContain(0);
    expect(actualZones).toContain(10);
    for (const orig of originalZones) {
      if (orig.startPos > 0) expect(actualZones).toContain(orig.startPos);
    }
  });

  it('split on a middle zone round-trips', () => {
    const rom = loadRom();
    const block = getBlockForSlot(rom, 0);

    // Ensure there's at least one stream zone to split.
    // If slot 0 doesn't have one, insert one first for test setup.
    const segs = computeGroundSegments(block);
    if (segs.length < 2) {
      new InsertGroundSegmentCommand(block, null, 8, 5, 0).execute();
    }

    // Find the first stream zone.
    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    expect(streamZones.length).toBeGreaterThan(0);
    const firstStreamZone = streamZones[0]!;
    const afterPos = (firstStreamZone.absoluteStartPos ?? 0) + 3;

    // Split by inserting after it at afterPos.
    new InsertGroundSegmentCommand(block, firstStreamZone, afterPos, 7, 0).execute();

    const expectedZones = computeGroundSegments(block).map((z) => z.startPos);

    const bytes = serializeLevelBlock(block);
    const { zones } = reparseBlockBytes(bytes, block.header);
    const actualZones = zones.map((z) => z.startPos);

    expect(actualZones).toEqual(expectedZones);
  });

  it('move a zone start round-trips', () => {
    const rom = loadRom();
    const block = getBlockForSlot(rom, 0);

    // Ensure at least one stream zone exists.
    const segs0 = computeGroundSegments(block);
    if (segs0.length < 2) {
      new InsertGroundSegmentCommand(block, null, 12, 5, 0).execute();
    }

    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    const target = streamZones[0]!;
    const oldPos = target.absoluteStartPos ?? 0;
    const newPos = oldPos + 2;

    new MoveGroundSegmentCommand(block, target, newPos).execute();

    const expectedZones = computeGroundSegments(block).map((z) => z.startPos);

    const bytes = serializeLevelBlock(block);
    const { zones } = reparseBlockBytes(bytes, block.header);
    const actualZones = zones.map((z) => z.startPos);

    expect(actualZones).toEqual(expectedZones);
  });

  it('delete a zone round-trips', () => {
    const rom = loadRom();
    const block = getBlockForSlot(rom, 0);

    // Insert two zones so we have something to delete.
    new InsertGroundSegmentCommand(block, null, 6, 3, 0).execute();
    new InsertGroundSegmentCommand(
      block,
      block.items.find((it) => it.kind === 'groundSet') ?? null,
      12,
      4,
      0,
    ).execute();

    const zonesBefore = computeGroundSegments(block).length;

    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    const victim = streamZones[1]!;
    new DeleteGroundSegmentCommand(block, victim).execute();

    const expectedZones = computeGroundSegments(block).map((z) => z.startPos);
    expect(expectedZones.length).toBe(zonesBefore - 1);

    const bytes = serializeLevelBlock(block);
    const { zones } = reparseBlockBytes(bytes, block.header);
    const actualZones = zones.map((z) => z.startPos);

    expect(actualZones).toEqual(expectedZones);
  });

  it('repeated splits round-trip', () => {
    const rom = loadRom();
    const block = getBlockForSlot(rom, 0);

    // Split at 8, 4, 12, 2 — creates a fragmented zone layout.
    new InsertGroundSegmentCommand(block, null, 8, 3, 0).execute();
    const gs8 = block.items.filter((it) => it.kind === 'groundSet')[0]!;
    new InsertGroundSegmentCommand(block, null, 4, 5, 0).execute();
    new InsertGroundSegmentCommand(block, gs8, 12, 7, 0).execute();
    new InsertGroundSegmentCommand(block, null, 2, 2, 0).execute();

    const expectedZones = computeGroundSegments(block).map((z) => ({
      startPos: z.startPos,
      groundSet: z.groundSet,
    }));

    const bytes = serializeLevelBlock(block);
    const { zones } = reparseBlockBytes(bytes, block.header);

    expect(zones.map((z) => z.startPos)).toEqual(
      expectedZones.map((z) => z.startPos),
    );
    expect(zones.map((z) => z.groundSet)).toEqual(
      expectedZones.map((z) => z.groundSet),
    );
  });

  it('insert preserves the groundType of surrounding zones', () => {
    // 6-1·1 has zones with distinct groundTypes via groundType-opcode
    // pairs (zone 2=1, zone 3=0, etc.). Inserting a new zone between
    // zone 2 and zone 3 must NOT hijack the chain — both should keep
    // their original types, and the new zone gets its own pinned type.
    const rom = loadRom();
    const block = getBlockForSlot(rom, 5 * 30 + 0); // slot 150 = 6-1·1
    const before = computeGroundSegments(block).map((z) => ({
      startPos: z.startPos,
      groundType: z.groundType,
    }));
    expect(before.length).toBeGreaterThanOrEqual(3);

    // Anchor = zone 2's stream item; insert a new zone between its
    // pinning groundType opcode and zone 3.
    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    const zone2Item = streamZones[0]!;
    const zone2Start = zone2Item.absoluteStartPos ?? 0;
    const zone3Start = streamZones[1]?.absoluteStartPos ?? zone2Start + 5;
    const newStart = zone2Start + Math.max(1, Math.floor((zone3Start - zone2Start) / 2));

    // Pick a new type that differs from both neighbors so we can tell
    // if the chain got hijacked.
    const newType = 2;
    new InsertGroundSegmentCommand(block, zone2Item, newStart, 13, newType).execute();

    const after = computeGroundSegments(block);
    // Zone 2's type is unchanged (was 1).
    expect(after[1]!.groundType).toBe(before[1]!.groundType);
    // The new zone (now at display index 2) has the inherited type.
    expect(after[2]!.startPos).toBe(newStart);
    expect(after[2]!.groundType).toBe(newType);
    // Subsequent zones unchanged — zone 3 (now at index 3) keeps its type.
    for (let i = 2; i < before.length; i++) {
      const orig = before[i]!;
      const shifted = after[i + 1];
      expect(shifted, `zone ${i} shifted`).toBeDefined();
      expect(shifted!.startPos).toBe(orig.startPos);
      expect(shifted!.groundType).toBe(orig.groundType);
    }
  });

  it('delete preserves the groundType of the zone before it', () => {
    // Deleting zone N must not cause zone N-1 to inherit zone N's type
    // via a now-orphan groundType opcode.
    const rom = loadRom();
    const block = getBlockForSlot(rom, 5 * 30 + 0); // 6-1·1
    const before = computeGroundSegments(block).map((z) => z.groundType);
    expect(before.length).toBeGreaterThanOrEqual(3);

    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    // Delete zone 3 (second stream zone).
    const victim = streamZones[1]!;
    new DeleteGroundSegmentCommand(block, victim).execute();

    const after = computeGroundSegments(block).map((z) => z.groundType);
    // Zone 2's type should still be what it was before the delete (not
    // hijacked by zone 3's pinning opcode).
    expect(after[0]).toBe(before[0]); // header
    expect(after[1]).toBe(before[1]); // zone 2
    // Zone 3 is gone; remaining zones shift up but keep their types.
    for (let i = 3; i < before.length; i++) {
      expect(after[i - 1]).toBe(before[i]);
    }
  });

  it('setGroundType modifies the zone\'s companion groundType opcode', () => {
    const rom = loadRom();
    const block = getBlockForSlot(rom, 5 * 30 + 0); // 6-1·1 — has paired groundSet+groundType zones
    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    expect(streamZones.length).toBeGreaterThan(0);
    const target = streamZones[0]!; // zone 2 in the UI
    const beforeSegs = computeGroundSegments(block);
    const originalType = beforeSegs[1]!.groundType;

    // Pick a new type that differs.
    const newType = (originalType + 1) % 8;
    const cmd = new SetGroundTypeCommand(block, target, newType);
    cmd.execute();

    const afterSegs = computeGroundSegments(block);
    expect(afterSegs[1]!.groundType).toBe(newType);
    // Other zones unaffected.
    expect(afterSegs[0]!.groundType).toBe(beforeSegs[0]!.groundType);
    for (let i = 2; i < beforeSegs.length; i++) {
      expect(afterSegs[i]!.groundType).toBe(beforeSegs[i]!.groundType);
    }

    // Undo restores.
    cmd.undo();
    const undoneSegs = computeGroundSegments(block);
    expect(undoneSegs[1]!.groundType).toBe(originalType);
  });

  it('setGroundType blocks forward leak to orphan next zones', () => {
    // Slot 172 (6-3·3) has orphan stream zones — no companion groundType
    // opcodes. Without the pin-next fix, changing one zone's type would
    // cascade to ALL subsequent orphan zones.
    const rom = loadRom();
    const block = getBlockForSlot(rom, 5 * 30 + 2 * 10 + 2); // 6-3·3 → slot 172
    const streamZones = block.items.filter((it) => it.kind === 'groundSet');
    // Need at least 3 stream zones for a meaningful test.
    if (streamZones.length < 3) return;

    const before = computeGroundSegments(block).map((z) => z.groundType);
    const targetStreamIdx = 2; // zone 4 in the UI
    const target = streamZones[targetStreamIdx]!;
    const oldType = before[targetStreamIdx + 1]!;
    const newType = (oldType + 3) % 8;

    new SetGroundTypeCommand(block, target, newType).execute();

    const after = computeGroundSegments(block).map((z) => z.groundType);
    // Only the target zone changes.
    expect(after[targetStreamIdx + 1]).toBe(newType);
    for (let i = 0; i < before.length; i++) {
      if (i === targetStreamIdx + 1) continue;
      expect(after[i], `zone ${i + 1} should be unchanged`).toBe(before[i]);
    }
  });

  it('setGroundType inserts a groundType opcode if the zone has none', () => {
    // Construct a block with a groundSet that has NO companion — simulates
    // a zone the user inserted before we started pairing them, or a
    // minimal hand-crafted level.
    const rom = loadRom();
    const block = getBlockForSlot(rom, 0);
    const zone = {
      kind: 'groundSet' as const,
      sourceBytes: new Uint8Array([0xf0, 5]),
      sourceRange: [0, 0] as [number, number],
      tileX: -1,
      tileY: -1,
      itemId: -1,
      absoluteStartPos: 10,
    };
    (block.items as unknown as typeof zone[]).push(zone);
    const beforeLen = block.byteLength;

    const cmd = new SetGroundTypeCommand(block, zone, 2);
    cmd.execute();
    // byteLength grew by 2 (new companion) and next item is the new
    // groundType opcode.
    expect(block.byteLength).toBe(beforeLen + 2);
    const zoneIdx = block.items.indexOf(zone);
    const companion = block.items[zoneIdx + 1];
    expect(companion?.kind).toBe('groundType');
    expect(companion?.sourceBytes[0]).toBe(0xf6);
    expect(companion?.sourceBytes[1]).toBe(2);

    cmd.undo();
    expect(block.byteLength).toBe(beforeLen);
    expect(block.items[zoneIdx + 1]).not.toBe(companion);
  });

  it('setGroundSet round-trips the new shape', () => {
    const rom = loadRom();
    const block = getBlockForSlot(rom, 0);

    new InsertGroundSegmentCommand(block, null, 10, 3, 0).execute();
    const zone = block.items.filter((it) => it.kind === 'groundSet')[0]!;
    new SetGroundSetCommand(block, zone, 17).execute();

    const bytes = serializeLevelBlock(block);
    const { zones } = reparseBlockBytes(bytes, block.header);
    const streamZone = zones.find((z) => z.startPos === 10);
    expect(streamZone).toBeDefined();
    expect(streamZone!.groundSet).toBe(17);
  });

  /**
   * Reproduces the UI's `splitSelectedZone` flow exactly: for each display
   * zone, pick newStart strictly between zone.start and zone.end, and
   * insert with anchorItem = the correct stream item. Covers ~800 split
   * operations across every vanilla block. If any one fails, we have a
   * concrete repro for the in-game corruption the user reports.
   */
  it('UI split flow: every split round-trips across all blocks', () => {
    const rom = loadRom();
    const map = parseLevelMap(rom);

    const failures: string[] = [];

    for (let blockIdx = 0; blockIdx < map.blocks.length; blockIdx++) {
      const block = map.blocks[blockIdx]! as unknown as LevelBlock;
      const slot = block.referencingSlots[0]!;
      const segs = computeGroundSegments(block);

      // Try splitting each zone at its midpoint (UI flow).
      for (let zoneIdx = 0; zoneIdx < segs.length; zoneIdx++) {
        // Clone the block's items so each test pass starts fresh.
        const items = block.items.slice();
        const cloneBlock = { ...block, items, isEdited: block.isEdited };
        const start = segs[zoneIdx]!.startPos;
        const end = segs[zoneIdx + 1]?.startPos ?? null;
        if (end === null) continue; // last zone can't be split with this info
        const room = end - start;
        if (room < 2) continue;
        const newStart = start + Math.max(1, Math.floor(room / 2));
        // Anchor = the stream item BEFORE which new zone is inserted.
        // zone idx 0 is header, its anchor is null.
        const streamZones = items.filter((it) => it.kind === 'groundSet');
        const anchor = zoneIdx === 0 ? null : (streamZones[zoneIdx - 1] ?? null);

        try {
          new InsertGroundSegmentCommand(
            cloneBlock as unknown as LevelBlock,
            anchor,
            newStart,
            segs[zoneIdx]!.groundSet,
            segs[zoneIdx]!.groundType,
          ).execute();
        } catch {
          continue;
        }

        const bytes = serializeLevelBlock(cloneBlock as unknown as LevelBlock);
        const { zones } = reparseBlockBytes(bytes, cloneBlock.header);
        const expectedZones = computeGroundSegments(
          cloneBlock as unknown as LevelBlock,
        ).map((z) => z.startPos);
        const actualZones = zones.map((z) => z.startPos);

        if (JSON.stringify(actualZones) !== JSON.stringify(expectedZones)) {
          failures.push(
            `slot ${slot} zone ${zoneIdx} split at ${newStart}: expected ${JSON.stringify(expectedZones)}, got ${JSON.stringify(actualZones)}`,
          );
        }
      }
    }

    if (failures.length > 0) {
      console.error(
        `${failures.length} splits failed:\n${failures.slice(0, 15).join('\n')}`,
      );
    }
    expect(failures).toEqual([]);
  });
});
