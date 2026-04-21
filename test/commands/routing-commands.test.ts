import { describe, it, expect } from 'vitest';
import {
  SetItemDestinationCommand,
  itemDestination,
  itemDestinationSlot,
} from '@/commands/routing-commands';
import type { LevelBlock, LevelItem } from '@/rom/model';

/**
 * Synthetic fixtures — no ROM needed.
 *
 * SMB2 entrance destination encoding:
 *   slot = tens * 10 + ones
 *   4-byte: [pos, id, tens, (ones<<4)|page]
 *   5-byte: [pos, id, 0xF5, tens, (ones<<4)|page]
 *     (far pointer — used when slot > 150)
 *   2-byte: [pos, id] → no destination
 */

function makeBlock(items: LevelItem[]): LevelBlock {
  return {
    header: {
      direction: 1, palette: 0, enemyColor: 0, groundSet: 0, length: 3,
      objectType: 0, groundType: 0, music: 0, reservedBits: 0,
      sourceBytes: new Uint8Array(4),
    },
    items,
    sourceRange: [0, 0],
    byteLength: items.reduce((n, it) => n + it.sourceBytes.byteLength, 0),
    isEdited: false,
    referencingSlots: [],
  } as LevelBlock;
}

function makeEntrance(...bytes: number[]): LevelItem {
  return {
    kind: 'entrance',
    sourceBytes: new Uint8Array(bytes),
    sourceRange: [0, 0],
    tileX: 0,
    tileY: 0,
    itemId: bytes[1] ?? 0,
  } as LevelItem;
}

describe('itemDestination', () => {
  it('returns null for 2-byte entrance', () => {
    expect(itemDestination(makeEntrance(0x00, 0x0a))).toBe(null);
  });

  it('decodes slot 42 from 4-byte entrance (tens=4, ones=2, page=0)', () => {
    // slot 42 → byte2=4, byte3=(2<<4)|0 = 0x20
    const item = makeEntrance(0x00, 0x0a, 4, 0x20);
    expect(itemDestination(item)).toEqual({ slot: 42, page: 0, farPointer: false });
  });

  it('preserves page nibble in decoded destination', () => {
    // slot 12, page 5 → byte2=1, byte3=(2<<4)|5 = 0x25
    const item = makeEntrance(0x00, 0x0a, 1, 0x25);
    expect(itemDestination(item)).toEqual({ slot: 12, page: 5, farPointer: false });
  });

  it('decodes slot 200 from 5-byte far pointer', () => {
    // slot 200 → byte3=20, byte4=(0<<4)|0 = 0x00
    const item = makeEntrance(0x00, 0x0a, 0xf5, 20, 0x00);
    expect(itemDestination(item)).toEqual({ slot: 200, page: 0, farPointer: true });
  });

  it('returns null for invalid decoded slot (>= 210)', () => {
    // byte2=21, byte3=(0<<4)|0 → slot 210 (out of range)
    const item = makeEntrance(0x00, 0x0a, 21, 0x00);
    expect(itemDestination(item)).toBe(null);
  });

  it('itemDestinationSlot is a back-compat shortcut', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20);
    expect(itemDestinationSlot(item)).toBe(42);
  });
});

describe('SetItemDestinationCommand', () => {
  it('promotes 2-byte entrance to 4-byte with correct encoding (slot 42)', () => {
    const item = makeEntrance(0x00, 0x0a);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 42).execute();
    // tens=4, ones=2, page=0 → byte3 = 0x20
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 4, 0x20]));
    expect(block.byteLength).toBe(4);
    expect(block.isEdited).toBe(true);
  });

  it('uses 5-byte far pointer for slot > 150', () => {
    const item = makeEntrance(0x00, 0x0a);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 200).execute();
    // slot 200 → tens=20, ones=0 → bytes [0xF5, 20, 0x00]
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 0xf5, 20, 0x00]));
    expect(block.byteLength).toBe(5);
  });

  it('preserves existing page when changing destination slot', () => {
    // Existing: slot 12, page 5 → [0, id, 1, 0x25]
    const item = makeEntrance(0x00, 0x0a, 1, 0x25);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 30).execute();
    // slot 30 → tens=3, ones=0 → byte3 = (0<<4)|5 = 0x05 (page preserved)
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 3, 0x05]));
    expect(itemDestination(item)).toEqual({ slot: 30, page: 5, farPointer: false });
  });

  it('shrinks to 2-byte when destination cleared (null)', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, null).execute();
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a]));
    expect(block.byteLength).toBe(2);
    expect(block.isEdited).toBe(true);
  });

  it('switches from 4-byte to 5-byte when crossing threshold', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20); // was slot 42
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 180).execute();
    // slot 180 → tens=18, ones=0 → far pointer
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 0xf5, 18, 0x00]));
    expect(block.byteLength).toBe(5);
  });

  it('switches from 5-byte to 4-byte when descending below threshold', () => {
    const item = makeEntrance(0x00, 0x0a, 0xf5, 20, 0x00); // was slot 200
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 50).execute();
    // slot 50 → tens=5, ones=0 → 4-byte
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 5, 0x00]));
    expect(block.byteLength).toBe(4);
  });

  it('clamps destination slot to 0..209', () => {
    const item = makeEntrance(0x00, 0x0a);
    const block = makeBlock([item]);
    new SetItemDestinationCommand(block, item, 500).execute();
    // slot 209 → tens=20, ones=9 → byte3 = 0x90, 5-byte
    expect(itemDestinationSlot(item)).toBe(209);
    new SetItemDestinationCommand(block, item, -1).execute();
    // slot 0 → 4-byte
    expect(itemDestinationSlot(item)).toBe(0);
  });

  it('undo restores original bytes and byteLength', () => {
    const item = makeEntrance(0x00, 0x0a, 4, 0x20); // slot 42
    const block = makeBlock([item]);
    const cmd = new SetItemDestinationCommand(block, item, null);
    cmd.execute();
    expect(item.sourceBytes.byteLength).toBe(2);
    cmd.undo();
    expect(item.sourceBytes).toEqual(new Uint8Array([0x00, 0x0a, 4, 0x20]));
    expect(block.byteLength).toBe(4);
  });
});
