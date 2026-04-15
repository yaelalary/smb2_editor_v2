/**
 * CRC-32 (IEEE 802.3 / ISO 3309) over a byte sequence.
 *
 * Pure JS, no dependencies. Used by the CHR extraction script (Unit 2)
 * to sanity-check the fixture ROM and by `src/rom/validation.ts` (Unit 3)
 * to validate ROMs at upload time.
 *
 * Polynomial: 0xEDB88320 (little-endian reflection of 0x04C11DB7).
 * This matches the standard "crc32" that tools like `crc32` CLI,
 * Python's `binascii.crc32`, and Go's `hash/crc32` IEEE variant produce.
 */

// Lazily-built lookup table. The compiler cannot prove the table is
// populated after the IIFE runs, so we narrow via a cached reference.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ CRC_TABLE[idx]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Format a CRC-32 value as an 8-digit uppercase hex string. */
export function formatCrc32(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, '0');
}
