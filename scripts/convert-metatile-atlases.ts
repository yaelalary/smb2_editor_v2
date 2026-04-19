/**
 * Convert the C++ tool's metatile atlas BMP files to PNG.
 *
 * Reads 24-bit uncompressed BMPs from the cloned `loginsinex/smb2` repo
 * (MIT licensed), converts to PNG using pngjs, writes to
 * `src/assets/metatiles/`.
 *
 * BMP 24-bit uncompressed format (BITMAPINFOHEADER):
 *   - 14 bytes file header + 40 bytes DIB header = 54 bytes before pixels
 *   - Pixel rows are stored bottom-up, BGR order, padded to 4-byte boundary
 *
 * Usage: npm run convert-atlases
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'src', 'assets', 'metatiles');

const SMB2_REPO_PATH =
  process.env['SMB2_REPO_PATH'] ??
  path.resolve(PROJECT_ROOT, '..', 'smb2');

const RC_DIR = path.join(SMB2_REPO_PATH, 'smb2res', 'rc');

// Atlas indices match C++ `bmTpl[0..8]` (clevelinfodlg.cpp:19-27):
//   bmTpl[0..3] = IDB_BITMAP1..4 = 5/6/7/9.bmp (overworld A/B/C/D)  ← enemy atlases
//   bmTpl[4..7] = IDB_BITMAP5..8 = 1/2/3/11.bmp (interior/desert/castle/underground) ← item atlases
//   bmTpl[8]    = IDB_BITMAP10   = 12.bmp (enemy mask source)
// (See C:\Users\Yael\Documents\Dev\Web\smb2\smb2res\smb2res.rc.)
//
// UseEnemyMask(8, 0/1/2/3) in C++ masks bmTpl[0..3] using bmTpl[8]. In our
// port, enemies are rendered from atlas-0..3 directly (via `getAtlasImage`
// in LevelCanvas.vue, no UseGamma) — same contract as C++ `Draw(eColor,...)`.
// So the mask must be applied to atlas-0..3.
const ATLAS_FILES: { index: number; bmpName: string; description: string; mask?: boolean }[] = [
  { index: 0, bmpName: '5.bmp', description: 'overworld tiles A', mask: true },
  { index: 1, bmpName: '6.bmp', description: 'overworld tiles B', mask: true },
  { index: 2, bmpName: '7.bmp', description: 'overworld tiles C', mask: true },
  { index: 3, bmpName: '9.bmp', description: 'overworld tiles D', mask: true },
  { index: 4, bmpName: '1.bmp', description: 'interior / special tiles' },
  { index: 5, bmpName: '2.bmp', description: 'desert / ice tiles' },
  { index: 6, bmpName: '3.bmp', description: 'castle tiles' },
  { index: 7, bmpName: '11.bmp', description: 'underground tiles' },
  { index: 8, bmpName: '12.bmp', description: 'enemy mask (also used as preview in EnemyLibrary)' },
];

// Mask source: 12.bmp = IDB_BITMAP10 (loaded at C++ index 8).
// BLACK = keep, any non-black = erase. See clvldraw_render.cpp:276.
const MASK_BMP = '12.bmp';

const BG_FILES: { index: number; bmpName: string; description: string }[] = [
  { index: 0, bmpName: 'bg0.bmp', description: 'background strip world 0' },
  { index: 1, bmpName: 'bg1.bmp', description: 'background strip world 1' },
  { index: 2, bmpName: 'bg2.bmp', description: 'background strip world 2' },
  { index: 3, bmpName: 'bg3.bmp', description: 'background strip world 3' },
  { index: 4, bmpName: 'bg4.bmp', description: 'background strip world 4' },
];

interface MaskData {
  width: number;
  height: number;
  /** 1 byte per pixel: 1 = non-black (erase), 0 = black (keep). */
  nonBlack: Uint8Array;
}

/** Decode a 24-bit BMP into a mask where pixel>0 marks "erase". */
function bmpToMask(bmpPath: string): MaskData {
  const buf = fs.readFileSync(bmpPath);
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) throw new Error(`Not a BMP: ${bmpPath}`);
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24) throw new Error(`Only 24-bit BMP supported: ${bmpPath}`);
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;
  const rowStride = Math.ceil((width * 3) / 4) * 4;
  const nonBlack = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const srcOffset = dataOffset + srcRow * rowStride;
    for (let x = 0; x < width; x++) {
      const bmpIdx = srcOffset + x * 3;
      const b = buf[bmpIdx]!, g = buf[bmpIdx + 1]!, r = buf[bmpIdx + 2]!;
      nonBlack[y * width + x] = (r | g | b) !== 0 ? 1 : 0;
    }
  }
  return { width, height, nonBlack };
}

/**
 * Decode a 24-bit uncompressed BMP to PNG. Magenta pixels
 * (R=0xFF, G=0x00, B=0xFF) become transparent — this matches the
 * C++ UseGamma transparency key (clvldraw_render.cpp:335). When a
 * `mask` is supplied and dimensions match, pixels where
 * `mask.nonBlack` is set become transparent too (C++ UseEnemyMask,
 * clvldraw_render.cpp:276).
 */
function bmpToPng(bmpPath: string, mask?: MaskData): PNG {
  const buf = fs.readFileSync(bmpPath);

  // File header
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) {
    throw new Error(`Not a BMP file: ${bmpPath}`);
  }
  const dataOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  const compression = buf.readUInt32LE(30);

  if (bpp !== 24) {
    throw new Error(`Only 24-bit BMP supported, got ${bpp}bpp: ${bmpPath}`);
  }
  if (compression !== 0) {
    throw new Error(`Only uncompressed BMP supported: ${bmpPath}`);
  }

  // Height can be negative (top-down) or positive (bottom-up)
  const height = Math.abs(rawHeight);
  const bottomUp = rawHeight > 0;

  // Row stride: each row is padded to a 4-byte boundary
  const rowStride = Math.ceil((width * 3) / 4) * 4;

  const png = new PNG({ width, height, colorType: 6 });

  // Transparency key — matches the C++ tool's UseGamma check
  // (clvldraw_render.cpp:335): `if (clrf == 0x00FF00FF) → transparent`.
  // The source BMPs use **MAGENTA** (R=0xFF, G=0x00, B=0xFF) as their
  // transparency key, not 0xFEFEFE — that value is only the output
  // marker that UseGamma produces so the later TransparentBlt knows
  // what to skip. Here we short-circuit both steps by setting alpha=0
  // on magenta pixels directly.
  const KEY_R = 0xff;
  const KEY_G = 0x00;
  const KEY_B = 0xff;

  const useMask = mask !== undefined && mask.width === width && mask.height === height;

  for (let y = 0; y < height; y++) {
    const srcRow = bottomUp ? height - 1 - y : y;
    const srcOffset = dataOffset + srcRow * rowStride;

    for (let x = 0; x < width; x++) {
      const bmpIdx = srcOffset + x * 3;
      const pngIdx = (y * width + x) * 4;

      const b = buf[bmpIdx]!;
      const g = buf[bmpIdx + 1]!;
      const r = buf[bmpIdx + 2]!;

      png.data[pngIdx] = r;
      png.data[pngIdx + 1] = g;
      png.data[pngIdx + 2] = b;
      const isMagenta = r === KEY_R && g === KEY_G && b === KEY_B;
      const isMasked = useMask && mask.nonBlack[y * width + x] === 1;
      png.data[pngIdx + 3] = (isMagenta || isMasked) ? 0 : 0xff;
    }
  }

  return png;
}

function main(): void {
  if (!fs.existsSync(RC_DIR)) {
    console.error(
      `\nCannot find the smb2 C++ repo at: ${SMB2_REPO_PATH}\n` +
        `Clone https://github.com/loginsinex/smb2 next to this project, or set\n` +
        `SMB2_REPO_PATH to point to it.\n`,
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Source: ${RC_DIR}`);
  console.log(`Output: ${path.relative(PROJECT_ROOT, OUT_DIR)}\n`);

  const maskPath = path.join(RC_DIR, MASK_BMP);
  const mask = fs.existsSync(maskPath) ? bmpToMask(maskPath) : undefined;
  if (mask) console.log(`  (mask ${MASK_BMP} ${mask.width}×${mask.height} loaded)\n`);

  for (const { index, bmpName, description, mask: applyMask } of ATLAS_FILES) {
    const src = path.join(RC_DIR, bmpName);
    const dst = path.join(OUT_DIR, `atlas-${index}.png`);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP atlas-${index}: ${bmpName} not found`);
      continue;
    }
    const png = bmpToPng(src, applyMask ? mask : undefined);
    fs.writeFileSync(dst, PNG.sync.write(png));
    const masked = applyMask && mask && mask.width === png.width && mask.height === png.height ? ' [masked]' : '';
    console.log(`  atlas-${index}.png ← ${bmpName} (${description}) ${png.width}×${png.height}${masked}`);
  }

  for (const { index, bmpName, description } of BG_FILES) {
    const src = path.join(RC_DIR, bmpName);
    const dst = path.join(OUT_DIR, `bg-${index}.png`);
    if (!fs.existsSync(src)) {
      console.warn(`  SKIP bg-${index}: ${bmpName} not found`);
      continue;
    }
    const png = bmpToPng(src);
    fs.writeFileSync(dst, PNG.sync.write(png));
    console.log(`  bg-${index}.png ← ${bmpName} (${description}) ${png.width}×${png.height}`);
  }

  console.log('\nDone. Commit the generated PNGs in src/assets/metatiles/.');
}

main();
