import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useHistoryStore } from '@/stores/history';
import { SetLevelFieldCommand } from '@/commands/property-commands';
import type { LevelHeader } from '@/rom/model';

/**
 * Tests for the history store + property commands.
 *
 * Uses a synthetic LevelHeader (a plain object with the right shape)
 * rather than parsing a real ROM — the header fields are just numbers
 * and the command pattern doesn't care where they came from.
 */

function makeFakeHeader(overrides: Partial<LevelHeader> = {}): LevelHeader {
  return {
    direction: 1,
    palette: 0,
    enemyColor: 0,
    groundSet: 0,
    length: 3,
    objectType: 0,
    groundType: 0,
    music: 0,
    reservedBits: 0,
    sourceBytes: new Uint8Array(4),
    ...overrides,
  };
}

describe('useHistoryStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts with empty stacks', () => {
    const history = useHistoryStore();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.revision).toBe(0);
  });

  it('execute: applies command and pushes to undo stack', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader({ music: 0 });

    history.execute(new SetLevelFieldCommand(header, 'music', 2));

    expect(header.music).toBe(2);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.revision).toBe(1);
    expect(history.lastUndoLabel).toBe('Set Music → 2');
  });

  it('undo: reverts command and pushes to redo stack', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader({ music: 0 });

    history.execute(new SetLevelFieldCommand(header, 'music', 2));
    history.undo();

    expect(header.music).toBe(0);
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(true);
    expect(history.revision).toBe(2);
  });

  it('redo: re-applies undone command', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader({ music: 0 });

    history.execute(new SetLevelFieldCommand(header, 'music', 2));
    history.undo();
    history.redo();

    expect(header.music).toBe(2);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it('execute clears redo stack', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader({ palette: 0 });

    history.execute(new SetLevelFieldCommand(header, 'palette', 3));
    history.undo();
    expect(history.canRedo).toBe(true);

    // New command clears redo.
    history.execute(new SetLevelFieldCommand(header, 'palette', 5));
    expect(history.canRedo).toBe(false);
    expect(header.palette).toBe(5);
  });

  it('multiple commands stack correctly', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader({ music: 0, palette: 0 });

    history.execute(new SetLevelFieldCommand(header, 'music', 1));
    history.execute(new SetLevelFieldCommand(header, 'palette', 4));
    history.execute(new SetLevelFieldCommand(header, 'music', 3));

    expect(header.music).toBe(3);
    expect(header.palette).toBe(4);

    history.undo(); // revert music 3 → 1
    expect(header.music).toBe(1);

    history.undo(); // revert palette 4 → 0
    expect(header.palette).toBe(0);

    history.undo(); // revert music 1 → 0
    expect(header.music).toBe(0);

    expect(history.canUndo).toBe(false);
  });

  it('undo on empty stack returns null and is a no-op', () => {
    const history = useHistoryStore();
    const result = history.undo();
    expect(result).toBeNull();
    expect(history.revision).toBe(0);
  });

  it('redo on empty stack returns null and is a no-op', () => {
    const history = useHistoryStore();
    const result = history.redo();
    expect(result).toBeNull();
  });

  it('clear resets both stacks and revision', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader();

    history.execute(new SetLevelFieldCommand(header, 'music', 2));
    history.undo();
    history.clear();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.revision).toBe(0);
  });

  it('lastUndoLabel / lastRedoLabel track the correct command', () => {
    const history = useHistoryStore();
    const header = makeFakeHeader();

    expect(history.lastUndoLabel).toBeNull();
    expect(history.lastRedoLabel).toBeNull();

    history.execute(new SetLevelFieldCommand(header, 'direction', 0));
    expect(history.lastUndoLabel).toBe('Set Direction → 0');

    history.undo();
    expect(history.lastRedoLabel).toBe('Set Direction → 0');
    expect(history.lastUndoLabel).toBeNull();
  });
});

describe('SetLevelFieldCommand', () => {
  it('captures the old value at construction time', () => {
    const header = makeFakeHeader({ groundSet: 7 });
    const cmd = new SetLevelFieldCommand(header, 'groundSet', 19);

    // Not yet executed — header unchanged.
    expect(header.groundSet).toBe(7);

    cmd.execute();
    expect(header.groundSet).toBe(19);

    cmd.undo();
    expect(header.groundSet).toBe(7);
  });

  it('includes the target slot in the label for off-screen undo', () => {
    const header = makeFakeHeader();
    const cmd = new SetLevelFieldCommand(header, 'music', 2, 42);
    expect(cmd.targetSlot).toBe(42);
  });
});
