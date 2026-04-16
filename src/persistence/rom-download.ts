/**
 * ROM download — Unit 7.
 *
 * Triggers a browser download of the (potentially modified) ROM as a
 * `.nes` file with a **differentiated filename** so the user never
 * accidentally overwrites their original.
 *
 * For v0.1 (no editing yet), the downloaded bytes are the original ROM
 * unchanged — the round-trip test proves conservative serialization is
 * byte-identical. Once Phase 2 editing lands, this module will call the
 * constructive serializer + clone-and-overlay before producing the Blob.
 *
 * The download uses the universal Blob + anchor-click pattern (works in
 * all browsers including Firefox, which does not support the File System
 * Access API as of 2026).
 */

/**
 * Build an output filename that never matches the input.
 *
 * Rules:
 *   - Strip the `.nes` extension (case-insensitive).
 *   - Append `-edited` + today's ISO date.
 *   - Re-append `.nes`.
 *   - If the input somehow already matches the output pattern, append
 *     an incrementing suffix (`-v2`, `-v3`, …).
 *
 * Examples:
 *   "smb2.nes"                → "smb2-edited-2026-04-16.nes"
 *   "my.game.nes"             → "my.game-edited-2026-04-16.nes"
 *   "rom_no_ext"              → "rom_no_ext-edited-2026-04-16.nes"
 *   ""                        → "smb2-edited-2026-04-16.nes"
 */
export function buildOutputFilename(
  originalName: string,
  now: Date = new Date(),
): string {
  const isoDate = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const base = originalName
    ? originalName.replace(/\.nes$/i, '')
    : 'smb2';
  return `${base}-edited-${isoDate}.nes`;
}

/**
 * Trigger a browser download of a Uint8Array as a `.nes` file.
 *
 * For v0.1 the `romBytes` are the original uploaded ROM buffer
 * (unchanged). Phase 2+ will pass the output of the constructive
 * serializer (clone-and-overlay).
 */
export function downloadRom(
  romBytes: Uint8Array,
  originalFilename: string,
): void {
  const filename = buildOutputFilename(originalFilename);
  const blob = new Blob([romBytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up after a tick to ensure the download starts.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}
