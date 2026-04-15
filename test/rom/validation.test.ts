import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateRom,
  identifyPrg,
  type ValidationFailure,
} from '@/rom/validation';
import {
  INES_HEADER_SIZE,
  INES_MAGIC,
  MAX_ROM_BYTES,
  PRG_UNIT_SIZE,
  CHR_UNIT_SIZE,
  SMB2_USA_PRG0_PRG_BYTES,
  SMB2_USA_PRG0_PRG_CRC32,
  SMB2_USA_PRG1_PRG_CRC32,
  TRAINER_SIZE,
} from '@/rom/constants';

/**
 * Most tests use hand-crafted iNES buffers so the suite runs without
 * needing the real (legally-uncommittable) SMB2 ROM. The full happy
 * path — "a real SMB2 USA PRG0 file validates" — is covered by a
 * fixture-dependent test that skips when the fixture is absent.
 *
 * The PRG0/PRG1/UNKNOWN routing logic is tested against
 * {@link identifyPrg} directly, which sidesteps the need to synthesize
 * PRG bodies that happen to produce specific CRC-32 values.
 */
const FIXTURE_PATH = path.resolve(__dirname, '../fixtures/smb2.nes');

function hasFixture(): boolean {
  return fs.existsSync(FIXTURE_PATH);
}

function loadFixture(): Uint8Array {
  const buffer = fs.readFileSync(FIXTURE_PATH);
  return new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  );
}

/** Build a synthetic .nes file around a specific PRG-ROM body. */
function buildInesFile(options: {
  prg: Uint8Array;
  chr?: Uint8Array;
  withTrainer?: boolean;
  corruptMagic?: boolean;
}): Uint8Array {
  const { prg, chr, withTrainer = false, corruptMagic = false } = options;
  const chrBytes = chr ?? new Uint8Array(0);

  const header = new Uint8Array(INES_HEADER_SIZE);
  if (!corruptMagic) {
    for (let i = 0; i < INES_MAGIC.length; i++) {
      header[i] = INES_MAGIC[i]!;
    }
  }
  header[4] = prg.byteLength / PRG_UNIT_SIZE;
  header[5] = chrBytes.byteLength / CHR_UNIT_SIZE;
  header[6] = withTrainer ? 0b0000_0100 : 0;

  const trainer = withTrainer ? new Uint8Array(TRAINER_SIZE) : new Uint8Array(0);

  const total = new Uint8Array(
    header.byteLength + trainer.byteLength + prg.byteLength + chrBytes.byteLength,
  );
  let offset = 0;
  total.set(header, offset);
  offset += header.byteLength;
  total.set(trainer, offset);
  offset += trainer.byteLength;
  total.set(prg, offset);
  offset += prg.byteLength;
  total.set(chrBytes, offset);

  return total;
}

function fileOf(bytes: Uint8Array, name = 'rom.nes'): File {
  return new File([bytes], name, { type: 'application/octet-stream' });
}

function expectFailure(
  result: Awaited<ReturnType<typeof validateRom>>,
): ValidationFailure {
  if (result.ok) {
    throw new Error('Expected a failure result, got success.');
  }
  return result;
}

describe('identifyPrg — pure revision dispatch', () => {
  it('classifies the canonical PRG0 CRC as PRG0', () => {
    expect(identifyPrg(SMB2_USA_PRG0_PRG_CRC32)).toBe('PRG0');
  });

  it('classifies the PRG1 CRC as PRG1', () => {
    expect(identifyPrg(SMB2_USA_PRG1_PRG_CRC32)).toBe('PRG1');
  });

  it('classifies any other value as UNKNOWN', () => {
    expect(identifyPrg(0)).toBe('UNKNOWN');
    expect(identifyPrg(0xffffffff)).toBe('UNKNOWN');
    expect(identifyPrg(0xdeadbeef)).toBe('UNKNOWN');
  });
});

describe('validateRom — error paths (synthetic buffers)', () => {
  it('rejects an empty file as CORRUPTED', async () => {
    const result = await validateRom(fileOf(new Uint8Array(0)));
    expect(expectFailure(result).reason).toBe('CORRUPTED');
  });

  it('rejects a file smaller than the iNES header as CORRUPTED', async () => {
    const result = await validateRom(fileOf(new Uint8Array(10)));
    expect(expectFailure(result).reason).toBe('CORRUPTED');
  });

  it('rejects a file larger than 1 MiB as CORRUPTED', async () => {
    const result = await validateRom(fileOf(new Uint8Array(MAX_ROM_BYTES + 1)));
    expect(expectFailure(result).reason).toBe('CORRUPTED');
  });

  it('rejects an all-zeros buffer of plausible size as NOT_INES', async () => {
    const result = await validateRom(fileOf(new Uint8Array(262160)));
    expect(expectFailure(result).reason).toBe('NOT_INES');
  });

  it('rejects a file with a wrong magic header as NOT_INES', async () => {
    const prg = new Uint8Array(PRG_UNIT_SIZE);
    const file = buildInesFile({ prg, corruptMagic: true });
    const result = await validateRom(fileOf(file));
    expect(expectFailure(result).reason).toBe('NOT_INES');
  });

  it('reports WRONG_GAME when iNES is valid but the PRG CRC is unknown', async () => {
    // Deterministic pattern → a CRC that is neither PRG0 nor PRG1.
    const prg = new Uint8Array(SMB2_USA_PRG0_PRG_BYTES);
    for (let i = 0; i < prg.length; i++) prg[i] = (i * 31 + 7) & 0xff;
    const file = buildInesFile({ prg });
    const result = await validateRom(fileOf(file));
    expect(expectFailure(result).reason).toBe('WRONG_GAME');
  });

  it('reports CORRUPTED when the header claims more PRG than the file contains', async () => {
    // Header advertises 8 PRG units (128 KiB) but only 16 KiB are present.
    const undersizedPrg = new Uint8Array(PRG_UNIT_SIZE);
    const file = buildInesFile({ prg: undersizedPrg });
    const tampered = new Uint8Array(file);
    tampered[4] = 8; // overclaim PRG
    const result = await validateRom(fileOf(tampered));
    expect(expectFailure(result).reason).toBe('CORRUPTED');
  });

  it('reports CORRUPTED when the header claims zero PRG units', async () => {
    const prg = new Uint8Array(PRG_UNIT_SIZE);
    const file = buildInesFile({ prg });
    const tampered = new Uint8Array(file);
    tampered[4] = 0;
    const result = await validateRom(fileOf(tampered));
    expect(expectFailure(result).reason).toBe('CORRUPTED');
  });
});

describe('validateRom — natural-language failure messages', () => {
  it('returns a user-facing English message on every failure reason', async () => {
    const reasons = new Map<string, string>();

    // NOT_INES
    const notInes = expectFailure(
      await validateRom(fileOf(new Uint8Array(262160))),
    );
    reasons.set(notInes.reason, notInes.message);

    // WRONG_GAME
    const prg = new Uint8Array(SMB2_USA_PRG0_PRG_BYTES);
    for (let i = 0; i < prg.length; i++) prg[i] = (i * 31 + 7) & 0xff;
    const wrongGame = expectFailure(
      await validateRom(fileOf(buildInesFile({ prg }))),
    );
    reasons.set(wrongGame.reason, wrongGame.message);

    // CORRUPTED
    const corrupted = expectFailure(
      await validateRom(fileOf(new Uint8Array(0))),
    );
    reasons.set(corrupted.reason, corrupted.message);

    // All messages are non-empty and don't leak jargon like "CRC" or "iNES".
    for (const [, msg] of reasons) {
      expect(msg.length).toBeGreaterThan(10);
      expect(msg).not.toMatch(/CRC|iNES|PRG/i);
    }
  });
});

describe('validateRom — real fixture (skipped when absent)', () => {
  it.skipIf(!hasFixture())(
    'validates the local SMB2 USA PRG0 fixture end-to-end',
    async () => {
      const rom = loadFixture();
      const result = await validateRom(fileOf(rom));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.prgCrc32).toBe(SMB2_USA_PRG0_PRG_CRC32);
        expect(result.prgBytes).toBe(SMB2_USA_PRG0_PRG_BYTES);
        expect(result.hasTrainer).toBe(false);
        expect(result.rom.byteLength).toBe(rom.byteLength);
      }
    },
  );
});
