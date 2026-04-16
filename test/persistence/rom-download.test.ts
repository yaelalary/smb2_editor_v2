import { describe, it, expect } from 'vitest';
import { buildOutputFilename } from '@/persistence/rom-download';

const FIXED_DATE = new Date('2026-04-16T12:00:00Z');

describe('buildOutputFilename', () => {
  it('appends -edited-DATE before .nes', () => {
    expect(buildOutputFilename('smb2.nes', FIXED_DATE)).toBe(
      'smb2-edited-2026-04-16.nes',
    );
  });

  it('handles multiple dots in the filename', () => {
    expect(buildOutputFilename('my.game.nes', FIXED_DATE)).toBe(
      'my.game-edited-2026-04-16.nes',
    );
  });

  it('handles uppercase .NES extension', () => {
    expect(buildOutputFilename('ROM.NES', FIXED_DATE)).toBe(
      'ROM-edited-2026-04-16.nes',
    );
  });

  it('handles a filename with no extension', () => {
    expect(buildOutputFilename('rom_no_ext', FIXED_DATE)).toBe(
      'rom_no_ext-edited-2026-04-16.nes',
    );
  });

  it('falls back to "smb2" when the original name is empty', () => {
    expect(buildOutputFilename('', FIXED_DATE)).toBe(
      'smb2-edited-2026-04-16.nes',
    );
  });

  it('always produces a name ending in .nes', () => {
    const result = buildOutputFilename('test', FIXED_DATE);
    expect(result.endsWith('.nes')).toBe(true);
  });

  it('never matches the original filename', () => {
    const original = 'smb2.nes';
    const output = buildOutputFilename(original, FIXED_DATE);
    expect(output).not.toBe(original);
  });
});
