/**
 * CHR extraction script — Unit 2.
 *
 * Reads the user-supplied canonical SMB2 USA PRG0 ROM from
 * `test/fixtures/smb2.nes`, decodes every 16-byte CHR tile, and writes
 * one 8x8 grayscale PNG per tile to `src/assets/tiles/tile-NNNN.png`.
 *
 * Runtime rendering (Unit 6) later re-colors these tiles with the
 * level's active NES palette via Canvas `getImageData` / `putImageData`.
 * Color index 0..3 is encoded as red-channel 0, 85, 170, 255.
 *
 * Invariants:
 *   - Input ROM must have a valid iNES header ("NES\x1A" magic).
 *   - CHR region is `prg_size_kb * 1024` bytes into the file, after
 *     the 16-byte header and optional 512-byte trainer.
 *   - Output is deterministic for a given input (pngjs encoder is
 *     stable on a given Node/zlib version).
 *
 * Usage:
 *   npm run extract-chr
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { decodeTile, TILE_BYTES, TILE_SIZE } from './chr-decoder.js';
import { crc32, formatCrc32 } from '../src/rom/crc32.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ROM_PATH = path.join(PROJECT_ROOT, 'test', 'fixtures', 'smb2.nes');
const OUT_DIR = path.join(PROJECT_ROOT, 'src', 'assets', 'tiles');

const INES_MAGIC = new Uint8Array([0x4e, 0x45, 0x53, 0x1a]); // "NES\x1A"
const INES_HEADER_SIZE = 16;
const PRG_UNIT_SIZE = 16 * 1024;
const CHR_UNIT_SIZE = 8 * 1024;
const TRAINER_SIZE = 512;
const INES_TRAINER_FLAG = 0b0000_0100; // flags6 bit 2

interface InesHeader {
  readonly prgRomBytes: number;
  readonly chrRomBytes: number;
  readonly hasTrainer: boolean;
}

function parseInesHeader(rom: Uint8Array): InesHeader {
  if (rom.length < INES_HEADER_SIZE) {
    throw new Error(
      `ROM is shorter than the iNES header (${rom.length} < ${INES_HEADER_SIZE} bytes). ` +
        `This does not look like a NES ROM.`,
    );
  }

  for (let i = 0; i < INES_MAGIC.length; i++) {
    if (rom[i] !== INES_MAGIC[i]) {
      throw new Error(
        `ROM does not start with the iNES magic "NES\\x1A". ` +
          `This does not look like a NES ROM file.`,
      );
    }
  }

  const prgUnits = rom[4]!;
  const chrUnits = rom[5]!;
  const flags6 = rom[6]!;

  return {
    prgRomBytes: prgUnits * PRG_UNIT_SIZE,
    chrRomBytes: chrUnits * CHR_UNIT_SIZE,
    hasTrainer: (flags6 & INES_TRAINER_FLAG) !== 0,
  };
}

function extractChrRegion(rom: Uint8Array, header: InesHeader): Uint8Array {
  if (header.chrRomBytes === 0) {
    throw new Error(
      `ROM reports 0 bytes of CHR-ROM in the iNES header. ` +
        `SMB2 USA PRG0 should carry 128 KB of CHR-ROM; this fixture is not usable.`,
    );
  }

  const chrStart =
    INES_HEADER_SIZE +
    (header.hasTrainer ? TRAINER_SIZE : 0) +
    header.prgRomBytes;
  const chrEnd = chrStart + header.chrRomBytes;

  if (chrEnd > rom.length) {
    throw new Error(
      `Computed CHR region [${chrStart}..${chrEnd}) exceeds ROM length ${rom.length}. ` +
        `The iNES header likely lies about PRG or CHR size.`,
    );
  }

  return rom.subarray(chrStart, chrEnd);
}

function encodeTilePng(pixels: number[][]): Buffer {
  const png = new PNG({ width: TILE_SIZE, height: TILE_SIZE, colorType: 6 });

  for (let row = 0; row < TILE_SIZE; row++) {
    const rowPixels = pixels[row]!;
    for (let col = 0; col < TILE_SIZE; col++) {
      const colorIndex = rowPixels[col]!;
      const gray = colorIndex * 85; // 0, 85, 170, 255 — preserves the 2-bit index
      const offset = (row * TILE_SIZE + col) * 4;
      png.data[offset] = gray;
      png.data[offset + 1] = gray;
      png.data[offset + 2] = gray;
      png.data[offset + 3] = 0xff;
    }
  }

  return PNG.sync.write(png);
}

function cleanPreviousTiles(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('tile-') && entry.endsWith('.png')) {
      fs.unlinkSync(path.join(dir, entry));
    }
  }
}

function main(): void {
  if (!fs.existsSync(ROM_PATH)) {
    console.error(
      `\nROM not found at ${ROM_PATH}.\n\n` +
        `Place your legally-owned SMB2 USA PRG0 .nes file at that path ` +
        `before running extract-chr. See README.md for details.\n`,
    );
    process.exit(1);
  }

  const romBuffer = fs.readFileSync(ROM_PATH);
  const rom = new Uint8Array(
    romBuffer.buffer,
    romBuffer.byteOffset,
    romBuffer.byteLength,
  );

  const header = parseInesHeader(rom);
  const chr = extractChrRegion(rom, header);
  const prgStart =
    INES_HEADER_SIZE + (header.hasTrainer ? TRAINER_SIZE : 0);
  const prg = rom.subarray(prgStart, prgStart + header.prgRomBytes);
  const prgCrc = crc32(prg);

  console.log(`ROM: ${path.relative(PROJECT_ROOT, ROM_PATH)}`);
  console.log(
    `  PRG-ROM: ${header.prgRomBytes} bytes (CRC32 ${formatCrc32(prgCrc)})`,
  );
  console.log(`  CHR-ROM: ${header.chrRomBytes} bytes`);
  console.log(`  Trainer: ${header.hasTrainer ? 'yes (512 bytes)' : 'no'}`);

  if (chr.length % TILE_BYTES !== 0) {
    throw new Error(
      `CHR size ${chr.length} is not a multiple of ${TILE_BYTES}; ROM is malformed.`,
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  cleanPreviousTiles(OUT_DIR);

  const tileCount = chr.length / TILE_BYTES;
  const padWidth = Math.max(4, String(tileCount - 1).length);

  console.log(`Decoding ${tileCount} tiles → ${path.relative(PROJECT_ROOT, OUT_DIR)}`);

  for (let i = 0; i < tileCount; i++) {
    const tileBytes = chr.subarray(i * TILE_BYTES, (i + 1) * TILE_BYTES);
    const pixels = decodeTile(tileBytes);
    const png = encodeTilePng(pixels);
    const filename = `tile-${String(i).padStart(padWidth, '0')}.png`;
    fs.writeFileSync(path.join(OUT_DIR, filename), png);
  }

  console.log(`Done. Wrote ${tileCount} PNGs.`);
  console.log(
    `\nVerify the PRG-ROM CRC32 above against a trusted source ` +
      `(e.g. No-Intro DAT) to confirm this is SMB2 USA PRG0. ` +
      `Unit 3 will enforce this checksum at app load time.`,
  );
}

main();
