# Test fixtures

This directory holds binary fixtures used by the test suite and the
build-time CHR extraction script (`npm run extract-chr`).

**No ROM file is ever committed to this repository.**

## Required fixture: `smb2.nes`

You must place your own legally-owned Super Mario Bros. 2 (USA, PRG0)
`.nes` file at:

```
test/fixtures/smb2.nes
```

The file is gitignored (see the repo root `.gitignore`).

### Who reads this file?

- `scripts/extract-chr.ts` — reads the CHR region and writes
  `src/assets/tiles/tile-NNNN.png`.
- Round-trip tests (Unit 4+) — verify byte-identical parse/serialize.

### Verifying your ROM

When you run `npm run extract-chr`, the script prints the CRC32 of the
PRG-ROM portion. Cross-reference it against a trusted source such as
the No-Intro DAT before using the generated tiles for anything
trustworthy. Unit 3 will enforce this CRC at application load time.

## What if the fixture is missing?

- `npm run extract-chr` exits with a clear error and a pointer to this
  document.
- Tests that depend on the ROM fail loudly; tests that don't (e.g. the
  pure decoder and CRC32 unit tests) still pass.
- `npm run dev` runs, but `src/assets/tiles/` is empty, so tile-backed
  components render placeholders (or fail) once Unit 6 lands.
