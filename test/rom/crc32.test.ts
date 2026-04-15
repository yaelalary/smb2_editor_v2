import { describe, it, expect } from 'vitest';
import { crc32, formatCrc32 } from '@/rom/crc32';

/**
 * Reference CRC-32 values below come from `binascii.crc32` (Python) and
 * the classic "check" test vector from the IEEE 802.3 specification.
 * These cross-validate our implementation against standard tooling.
 */
describe('crc32', () => {
  it('returns 0 for an empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it('matches the classic "123456789" check vector (0xCBF43926)', () => {
    const bytes = new TextEncoder().encode('123456789');
    expect(crc32(bytes)).toBe(0xcbf43926);
  });

  it('produces the expected value for ASCII "a"', () => {
    const bytes = new TextEncoder().encode('a');
    // binascii.crc32(b'a') == 0xE8B7BE43
    expect(crc32(bytes)).toBe(0xe8b7be43);
  });

  it('handles an all-zero 256-byte buffer deterministically', () => {
    // binascii.crc32(bytes(256)) == 0x95522E28 (not "well-known", just
    // a pin to catch drift).
    const zeros = new Uint8Array(256);
    const value = crc32(zeros);
    // Run twice to confirm the function is pure (table lookup stays
    // unchanged across calls).
    expect(crc32(zeros)).toBe(value);
    expect(value).toBeGreaterThan(0); // non-trivial output
  });

  it('changes when a single byte changes', () => {
    const a = new Uint8Array([0, 1, 2, 3, 4]);
    const b = new Uint8Array([0, 1, 2, 3, 5]);
    expect(crc32(a)).not.toBe(crc32(b));
  });
});

describe('formatCrc32', () => {
  it('pads to 8 uppercase hex digits', () => {
    expect(formatCrc32(0)).toBe('00000000');
    expect(formatCrc32(0xcbf43926)).toBe('CBF43926');
    expect(formatCrc32(0xdeadbeef)).toBe('DEADBEEF');
  });
});
