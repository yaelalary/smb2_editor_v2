---
title: SMB2 NES Level Editor v2 — Implementation
type: feat
status: active
date: 2026-04-15
origin: docs/brainstorms/smb2-editor-v2-requirements.md
---

# SMB2 NES Level Editor v2 — Implementation

## Overview

Greenfield implementation of a web-based level editor for Super Mario Bros. 2
(NES, USA PRG0 only). The editor is a 100% client-side Vue 3 SPA that accepts
a user-supplied ROM file, decodes its levels/enemies/properties visually,
allows drag-and-drop editing in a Mario-Maker-inspired interface, and exports
a modified `.nes` file.

The project is a **functional-parity rewrite** of `github.com/loginsinex/smb2`
(C++/Win32, abandoned 2017). Delivery is **staged across six development
checkpoints** (v0.1 → v1.0). Checkpoints are internal — they exist to
validate each layer of the stack before the next one is built.
**No public release until v1.0** (complete editor). Earlier checkpoints
(v0.1 visualizer, v0.2 layout editor, etc.) are developer-facing
validation, not shippable user-facing products.

## Problem Frame

No maintained SMB2 NES level editor exists in 2026. Existing tools are
Windows-native, abandoned since 2014–2017, and assume users already know ROM
hacking concepts. The target user is a curious gamer who has never edited a
ROM and wants to modify SMB2 levels with a browser-based tool.

See origin: [`docs/brainstorms/smb2-editor-v2-requirements.md`](../brainstorms/smb2-editor-v2-requirements.md).

## Requirements Trace

Mapped directly from the origin requirements doc (sections 4.1–4.7 and 8).

- **R1.** Parse SMB2 USA PRG0 ROM into an editable in-memory model, including
  level layout, enemies, properties, palettes, in-level pointers, world
  routing (origin §4.1–§4.5).
- **R2.** Serialize the in-memory model back to a valid `.nes` file that boots
  unmodified in FCEUX/Mesen/Nestopia (origin §8 criterion 3).
- **R3.** Round-trip an unmodified ROM byte-identically — a hard gate before
  any editing feature ships (origin §8 criterion 3 note).
- **R4.** Edit level layouts via drag-and-drop from a sidebar library
  (origin §4.1).
- **R5.** Edit enemies with visual placement, preserving the ROM's shared-data
  semantics via explicit UI (origin §4.2).
- **R6.** Edit the 8 user-facing level property fields with UI labels in
  natural language (origin §4.3).
- **R7.** Edit world and selection-screen palettes with visual NES color grid
  (origin §4.4).
- **R8.** Edit in-level pointer items AND world-level routing table (origin
  §4.5.a and §4.5.b — two distinct concepts).
- **R9.** Enforce the ~16 KB ROM memory budget in real-time and refuse saves
  that would overflow (origin §4.6).
- **R10.** Provide undo/redo, Export/Import project file, and best-effort
  browser auto-save as a secondary safety net (origin §4.7).
- **R11.** Differentiated output filename to avoid overwriting the original
  ROM (origin §4.6).
- **R12.** Zero-install, zero-backend, static-hosted (origin §6).
- **R13.** UI strings in **English only** (resolved during planning — see
  Key Technical Decisions).

## Scope Boundaries

- **Only SMB2 USA PRG0** is supported. All other NES ROMs are rejected with
  a natural-language error.
- **No NES emulator** is integrated. The user tests on their own emulator.
- **No graphics (CHR) editing** — the tool uses pre-rendered tile sprites
  bundled at build time.
- **No music/audio editing**, no title-screen editing, no community features
  (accounts, sharing, leaderboards), no real-time collaboration.
- **Single output format: `.nes`.** No IPS/BPS patches in v1 (user explicitly
  confirmed strict parity with the old tool; see origin §5).
- **Desktop-only in v1.** Mobile/tablet is explicitly unsupported. When
  the viewport is below a desktop breakpoint, the app shows a short
  message ("This editor requires a desktop browser") instead of the
  loader. Rationale: even if the UI could be adapted, a ROM upload is
  rarely possible on mobile browsers without significant friction, and
  the editing interactions (precision drag-and-drop on a tile grid) are
  fundamentally built for mouse input. A future "mobile companion" flow
  (edit on mobile, merge back on desktop) is out of scope.

### Deferred to Separate Tasks

- Emulator integration (envisioned for post-v1).
- Multi-ROM support (Europe, Japan/Doki Doki Panic): post-v1.
- CHR graphics editing: post-v1.
- Graph view for world routing table (origin §4.5.b) — revisit post-v1
  if list view proves insufficient.
- Cycle / orphan detection in level links — not in the reference tool,
  revisit post-v1 based on user feedback.

## Context & Research

### Relevant Code and Patterns

- **Reference implementation (authoritative for data-layer logic):**
  [`github.com/loginsinex/smb2`](https://github.com/loginsinex/smb2) —
  especially `cnesfile.cpp` (ROM load/save + `GetMemoryStatus`),
  `cnesleveldata.cpp` (level parser/serializer and variable-length item
  encoding), `cnesenemydata.cpp` (enemy parser with reference-counted
  sharing), `clevelinfodlg.cpp` (8 editable level fields — authoritative
  over Data Crystal), `nesleveldef.cpp` (~1,870 lines of lookup tables:
  tile dimensions, ground sets, enemy dimensions, NES palette).
- **CHR decoding reference (algorithmic):**
  [NESDev PPU pattern tables](https://www.nesdev.org/wiki/PPU_pattern_tables).
- **UX reference for tile editors:** [Tiled](https://www.mapeditor.org/)
  (palette panel left, canvas center, properties right),
  [blurymind/tilemap-editor](https://github.com/blurymind/tilemap-editor)
  (zero-dep browser grid editor, useful canvas patterns).

### Institutional Learnings

None applicable. `docs/solutions/` is empty (greenfield project, first
substantial work).

### External References

- **Stack versions pinned (April 2026):** Vue `~3.5.32`, Vite `~8.0.8`,
  Pinia `~3.0.4`, Vitest `~4.1.4`, TypeScript `~5.7`.
- **Data Crystal:**
  [SMB2 NES ROM map](https://datacrystal.tcrf.net/wiki/Super_Mario_Bros._2_(NES)/ROM_map),
  [SMB2 RAM map](https://datacrystal.tcrf.net/wiki/Super_Mario_Bros._2:RAM_map).
- **Binary handling in browser:**
  [MDN DataView](https://developer.mozilla.org/en-US/docs/Web/API/DataView),
  [MDN Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob).
- **File download:** [browser-fs-access](https://github.com/GoogleChromeLabs/browser-fs-access)
  or manual Blob+anchor.click pattern.

## Key Technical Decisions

- **UI language: English only.** Resolved during planning. No i18n layer;
  strings hard-coded in components. Retrofit possible later with `vue-i18n`
  if needed.
  _Rationale: the ROM-hacking audience is predominantly anglophone. YAGNI
  applies for a solo-built v1._
- **State management: Pinia 3 with setup-style stores.** Split by domain:
  `useRomStore` (binary buffer + parsed model), `useEditorStore` (selection,
  current tool, viewport state), `useHistoryStore` (undo/redo command
  stack), `useProjectStore` (auto-save + export state). Ephemeral UI state
  (hover, drag ghost) stays in local `ref`/`shallowRef` — not in Pinia.
  _Rationale: a complex editor needs devtools time-travel and typed cross-
  component state; Pinia's setup stores give both with full TS inference._
- **Rendering: single HTML5 Canvas 2D per level viewport.** No SVG, no
  WebGL, no per-tile DOM elements. Pre-rendered tile spritesheet is blitted
  via `drawImage` with source-rect clipping.
  _Rationale: research confirms SVG degrades past ~100 DOM nodes; SMB2
  levels can have hundreds of visible tiles. WebGL is overkill at this
  scale._
- **Drag-and-drop: native HTML5 `draggable` + `drop` events.** No
  `vuedraggable`/`Sortable.js` (those are list-reordering tools, not
  canvas-drop).
  _Rationale: sidebar tile → canvas-position is a one-shot drag; native
  DnD computes the drop point directly via the drop event's clientX/Y._
- **Binary I/O: raw `DataView` + `Uint8Array`, no external parser.**
  The ROM data logic is ported by hand from `loginsinex/smb2`'s C++
  (`cnesfile.cpp`, `cnesleveldata.cpp`, `cnesenemydata.cpp`, `nesleveldef.cpp`),
  idiomatized to TypeScript with typed model classes. **Endianness:
  NES CPU address pointers (pointer tables) are little-endian and read
  with `dataView.getUint16(offset, true)`. Data-field byte order
  within level/enemy structures is verified against the C++ source on
  a per-read basis** — do not apply the little-endian flag blindly.
  _Rationale: published JS/TS NES libraries (kkoch986/nesjs, jsnes, etc.)
  are either abandoned, read-only, or emulation-focused. Kaitai's JS runtime
  doesn't round-trip serialize. A hand-ported parser gives byte-identical
  control._
- **Undo/redo: command pattern over Immer patches.** Each mutation produces
  a `Command { do(model), undo(model), label }`. Two stacks (undo, redo).
  _Rationale: Immer's JSON-patch model maps poorly to bit-packed binary
  fields. Command objects capture minimal deltas, are serializable for
  potential future collaboration, and map naturally to named user actions._
- **Project persistence: localStorage** (aligned with origin §4.7).
  The ROM is base64-encoded for storage (256 KB → ~340 KB), which fits
  comfortably within the ~5 MB per-origin quota. No extra dependency,
  standard Web Storage API everywhere.
  _Rationale: an earlier draft proposed IndexedDB + `idb` wrapper for
  native binary storage, but the added complexity isn't justified for
  a single 256 KB ROM. localStorage is sufficient and consistent with
  the requirements doc. If real usage ever hits the quota, revisit then._
- **CHR asset pipeline: build-time extraction script.** A Node script
  (`scripts/extract-chr.ts`, not shipped in the runtime bundle) reads the
  canonical ROM once and writes individual tile PNGs to
  `src/assets/tiles/`. Runtime imports these statically via Vite's asset
  pipeline.
  _Rationale: confirmed in origin §4.1 — parity with the old tool's
  bitmap-resource approach. Runtime CHR decoding is unnecessary because
  only the canonical ROM is accepted._
- **Testing: Vitest with `environment: 'node'` for all binary tests.**
  Round-trip tests read a fixture ROM from `test/fixtures/`, parse and
  re-serialize, assert byte-identity. Fixture storage caveat: the
  canonical ROM itself is not committed; tests assert against a SHA-256
  constant defined in-repo and the fixture is supplied locally by the
  developer (documented in `README.md`).
  _Rationale: research flagged the jsdom `ArrayBuffer` class mismatch as
  a common gotcha; `environment: 'node'` sidesteps it entirely._
- **Project file format: zip container with snapshot state.**
  `.smb2proj` is a ZIP containing (a) the unmodified source ROM as
  `original.nes`, (b) `state.json` — a **full state snapshot** of the
  current parsed model (levels, enemies, palettes, routing) plus a
  top-level `schemaVersion: number` field, not a replay log of commands.
  Library: `fflate` (MIT, tiny, no WASM).
  _Rationale: a snapshot is format-version-stable — adding a new
  command type in v1.1 can't break old project files. The tradeoff is
  that undo history is lost on import, which is acceptable for a solo
  v1. `schemaVersion` lives inside `state.json` so the format has a
  single point of version truth, no separate `version` file needed._
  _Sharing posture: `.smb2proj` is a **personal-use file**, not a
  sharing format — no social features, no upload/download in v1. The
  ROM being embedded is safe because the file never leaves the
  user's own devices._
- **Visual treatment specification is deferred to implementation,
  per unit.** Fine-grained details like drag-ghost opacity, selection
  highlight ring color/width, progress-bar exact styling, banner
  placement and dismissal behavior are decided at the moment each
  component is implemented, not pre-specified in this plan. The unit
  that introduces each visual affordance is authoritative for its
  treatment. This keeps the plan focused on architecture and defers
  polish to the moment the developer is in the component's code and
  can iterate with live feedback.
- **ROM validation: CRC32 over PRG-ROM** after stripping iNES header
  (16 bytes) and trainer (512 bytes, if iNES header flag set). Reference
  CRC constant hard-coded as `SMB2_USA_PRG0_PRG_CRC32`.
  _Rationale: origin §7 — accept PRG-identical ROMs regardless of header
  variations. CRC32 is fast, trivially implementable, sufficient here._
- **Tile/enemy view: toggleable overlay, enemies on by default.**
  The origin doc (§4.2) left this open ("Vue combinée ou toggle");
  resolving toward overlay-default is less destructive for first-time
  users who need to see everything at once to understand a level.
  Enemies render **on top of tiles** (z-order). Toggle button in the
  canvas toolbar to hide enemies when doing pure-layout work.
- **Undo scope: global across the entire ROM.** A single undo/redo
  stack regardless of which level the user is currently viewing.
  Simpler mental model than per-level undo, and more importantly,
  per-level undo breaks for shared enemy blocks (editing in level 1-1
  affects level 1-2; a per-level stack can't represent that cleanly).
  Paired with off-screen undo feedback (see Unit 14) so users aren't
  confused when Ctrl+Z reverts something on a level they're not
  viewing.
- **Command pattern is enforced by the TypeScript type system
  (compile-time readonly).** The parsed ROM model is exposed from
  `useRomStore` as `DeepReadonly<Rom>`. Any attempt to mutate it
  directly (`rom.levels[0].items.push(...)`) fails to type-check.
  The only way to mutate the model is through an internal
  `applyCommand(cmd)` gateway on the store, which takes a `Command`
  object and applies it while capturing the inverse for the undo
  stack. This makes it structurally impossible to bypass undo/redo.
  Pattern reference: Redux Toolkit's `createSlice` plus the readonly
  `state` parameter in reducers; we apply the same shape without the
  library.

## Open Questions

### Resolved During Planning

- **UI language:** English only (see Key Technical Decisions).
- **Rendering technology:** Canvas 2D (see Key Technical Decisions).
- **Parsing library:** Port-by-hand from C++ (see Key Technical Decisions).
- **CHR handling:** Build-time extraction to PNG bundle (resolved in origin
  §4.1).
- **Auto-save format:** localStorage stores a single base64-encoded
  snapshot of the current project (ROM + edit state) under one key
  (see Key Technical Decisions).
- **In-memory data model shape:** See High-Level Technical Design below.
- **Test strategy:** Vitest + fixture ROM + SHA-256 golden round-trip + unit
  round-trip per structure (see Key Technical Decisions).

### Deferred to Implementation

- **Exact bitfield layout of the 4-byte level header.** Data Crystal is
  incomplete; the authoritative source is `cnesleveldata.cpp` bit positions.
  Resolved during Phase 1 Unit 4 implementation by reading the C++ source.
- **Exact encoding of variable-length level items** (1–5 bytes depending on
  item type, context-dependent entrance-item parsing). Port-by-hand from
  `LoadLevel()` in `cnesleveldata.cpp` line ~225. Fidelity proven by the
  round-trip test gate (R3), not by static reasoning.
- **Visual rendering of level tiles "in context"** vs. as individual sprites
  — i.e., whether to pre-compose metatiles (2×2 tile blocks) into larger
  sprites or blit tile-by-tile at runtime. Resolved during Phase 1 Unit 2
  when generating the tile atlas; blit-by-metatile is likely simpler, but
  the CHR extraction script will emit both tile- and metatile-level
  PNGs if it's ambiguous.
- **Touch input / mobile support scope.** v1 is desktop-first. If trivial
  adjustments (e.g., coarse pointer support for tablets) are free during
  canvas interaction implementation (Phase 2 Unit 8/9), include them;
  otherwise defer.

### Deferred for Design Judgment

Resolved in Key Technical Decisions or unit text (tile/enemy overlay,
global undo scope, reset-to-original semantics, drop-on-occupied tile
behavior). Remaining deferrals:

- **Rectangular multi-select in v0.1/v0.2 or only in v1.0?** — plan defers
  to v1.0 Phase 6 Unit 19, consistent with the origin §4 Jalons table.
  The user confirmed keeping it in v1.0 during brainstorm review.
- **Level-link integrity checks** (cycle detection, orphans): **not in
  v1**, per strict-parity directive and the fact that the reference
  C++ tool has no such validation. Listed in Deferred to Separate Tasks.
- **Accessibility stance:** desktop-only, keyboard navigation beyond
  Ctrl+Z/Ctrl+Shift+Z not in v1. Revisit post-v1 based on user feedback.
  Standard ARIA roles (modal focus trap on `ConfirmationDialog`,
  `aria-valuenow` on `MemoryBudgetIndicator`, list semantics on
  `LevelList`) are included in v1 as low-cost baseline even though
  full accessibility is not a v1 goal.

## Output Structure

```text
smb2_editor_v2/
├── docs/
│   ├── brainstorms/
│   │   └── smb2-editor-v2-requirements.md           (exists)
│   └── plans/
│       └── 2026-04-15-001-feat-smb2-editor-v2-implementation-plan.md
├── public/
│   └── favicon.svg
├── scripts/
│   └── extract-chr.ts                                (Node, build-time only)
├── src/
│   ├── assets/
│   │   └── tiles/                                    (generated by scripts/extract-chr.ts)
│   ├── components/
│   │   ├── RomLoader.vue
│   │   ├── LevelList.vue
│   │   ├── LevelCanvas.vue
│   │   ├── TileLibrary.vue
│   │   ├── EnemyLibrary.vue
│   │   ├── PropertiesPanel.vue
│   │   ├── PaletteEditor.vue
│   │   ├── LevelLinksEditor.vue
│   │   ├── MemoryBudgetIndicator.vue
│   │   └── ConfirmationDialog.vue
│   ├── composables/
│   │   ├── useCanvasInteraction.ts
│   │   └── useKeyboardShortcuts.ts
│   ├── rom/
│   │   ├── constants.ts                              (ROM offsets, CRC, budget)
│   │   ├── validation.ts                             (iNES + CRC32 validation)
│   │   ├── model.ts                                  (in-memory types)
│   │   ├── level-parser.ts
│   │   ├── level-serializer.ts
│   │   ├── enemy-parser.ts
│   │   ├── enemy-serializer.ts
│   │   ├── palette-parser.ts
│   │   ├── palette-serializer.ts
│   │   ├── lookup-tables.ts                          (ported from nesleveldef.cpp)
│   │   └── memory-budget.ts                          (GetMemoryStatus equivalent)
│   ├── stores/
│   │   ├── rom.ts                                    (Pinia: ROM buffer + parsed model)
│   │   ├── editor.ts                                 (Pinia: selection, tool, viewport)
│   │   ├── history.ts                                (Pinia: undo/redo)
│   │   └── project.ts                                (Pinia: auto-save + export state)
│   ├── commands/
│   │   ├── types.ts                                  (Command interface)
│   │   ├── tile-commands.ts
│   │   ├── enemy-commands.ts
│   │   ├── property-commands.ts
│   │   └── palette-commands.ts
│   ├── persistence/
│   │   ├── localstorage.ts                           (safe wrapper)
│   │   └── project-file.ts                           (zip via fflate)
│   ├── App.vue
│   └── main.ts
├── test/
│   ├── fixtures/
│   │   └── README.md                                 (explains user-supplied ROM)
│   ├── rom/
│   │   ├── round-trip.test.ts                        (golden hash test)
│   │   ├── level-parser.test.ts
│   │   ├── enemy-parser.test.ts
│   │   └── memory-budget.test.ts
│   └── stores/
│       └── history.test.ts
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

This tree is a scope declaration showing the expected output shape. The
implementer may adjust the structure if implementation reveals a better
layout. The per-unit `Files:` sections remain authoritative.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for
> review, not implementation specification. The implementing agent should
> treat it as context, not code to reproduce.*

### Data flow: load → edit → save

```
ROM file (user upload)
        │
        ▼
┌──────────────────┐
│ validation.ts    │  iNES strip, CRC32 check, error if not SMB2 USA PRG0
└────┬─────────────┘
     │ Uint8Array (PRG + CHR, 256 KB)
     ▼
┌──────────────────┐      ┌────────────────────────┐
│ level-parser.ts  │─────▶│                        │
│ enemy-parser.ts  │─────▶│  in-memory Rom model   │
│ palette-parser.ts│─────▶│  (typed, mutable)      │
└──────────────────┘      └────────┬───────────────┘
                                   │
                                   ▼
                          ┌────────────────┐
                          │  Pinia stores  │
                          │  (reactive)    │
                          └────┬───────────┘
                               │
                               ▼
                     ┌─────────────────────┐
                     │  Vue components     │
                     │  (Canvas + panels)  │
                     └────┬────────────────┘
                          │ user action
                          ▼
                     ┌─────────────────────┐
                     │  Command (do/undo)  │───▶ mutate model,
                     └────┬────────────────┘     push on history stack
                          │
                          ▼
                  ┌───────────────────────┐
                  │  memory-budget.ts     │
                  │  (live, blocks save   │
                  │   on overflow)        │
                  └───────────────────────┘
                          │
                          ▼
                  ┌───────────────────────┐
                  │ level-serializer.ts   │
                  │ enemy-serializer.ts   │
                  │ palette-serializer.ts │
                  └────┬──────────────────┘
                       │ Uint8Array (new ROM)
                       ▼
                  ┌───────────────────────┐
                  │ Blob + anchor click   │  .nes download,
                  │ (different filename)  │  OR .smb2proj via fflate
                  └───────────────────────┘
```

### Key shape: the in-memory model

Rather than mutating the raw `Uint8Array` as you edit, the model is a parsed
intermediate structure. The ROM buffer is treated as immutable input; a
**cloned** `Uint8Array` is produced on export.

**Serialization strategy — "clone and overlay":** the output ROM is built
by (1) cloning the original uploaded `Uint8Array` in full, then (2)
**overwriting** only the parsed regions (level data, enemy data, palette
tables, pointer tables) with their re-serialized bytes. This guarantees
that all other regions — game code, music data, text strings, title
screen data, CHR, and any uninterpreted padding — are preserved
byte-for-byte. Without this strategy, round-trip byte-identity is
impossible because the parsers only model a subset of the ROM.

When a parsed region grows or shrinks after editing (most common for
level and enemy data, which are variable-length and packed
contiguously), the serializer re-packs all blocks of that kind
sequentially into their region and rewrites the associated pointer
table with new offsets. Unit 13's memory budget check prevents any
edit that would cause the packed region to overflow its fixed ROM
allocation.

```typescript
// Directional sketch -- final shape decided in Unit 4 implementation.
interface Rom {
  header: InesHeader;                    // kept verbatim on export
  prg: Uint8Array;                       // 128 KB, contains sections below
  chr: Uint8Array;                       // 128 KB, untouched in v1
  parsed: {
    levels: Level[];                     // 210 slots
    enemyBlocks: EnemyBlock[];           // fewer entries than levels (sharing)
    worldRouting: WorldRoutingTable;     // maps slot → level+enemy block
    palettes: PaletteSet;
  };
}

interface Level {
  header: LevelHeader;                   // 8 user fields + 5 reserved bits
  items: LevelItem[];                    // variable-length, tile/object/pointer
  enemyBlockRef: EnemyBlockId;           // may be shared across levels
  sourceByteRange: [number, number];     // for round-trip debugging
}
```

### Command pattern for mutations

```typescript
// Directional sketch.
interface Command {
  readonly label: string;       // e.g. "Place tile at (5, 12)"
  do(model: Rom): void;
  undo(model: Rom): void;
}
// HistoryStore maintains undoStack: Command[] and redoStack: Command[].
// Applying a Command calls do(), pushes to undoStack, clears redoStack.
// Undo pops from undoStack, calls undo(), pushes to redoStack.
```

## Implementation Units

### Phase 1 — v0.1 Foundation

- [ ] **Unit 1: Project scaffold**

**Goal:** Stand up the Vue 3 + Vite + TS + Pinia + Vitest toolchain with
strict TypeScript, linting, and a working dev server showing a placeholder
landing view.

**Requirements:** R12.

**Dependencies:** None.

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `eslint.config.js`, `index.html`, `src/main.ts`,
  `src/App.vue`, `README.md`, `.gitignore` (extend existing).

**Approach:**
- Initialize via `npm create vue@latest` but strip unused options (no
  router, no test boilerplate beyond Vitest), then align versions to the
  pinned ones: Vue `~3.5.32`, Vite `~8.0.8`, Pinia `~3.0.4`, Vitest
  `~4.1.4`, TS `~5.7`.
- `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`.
  These two cover the real `undefined` risk in binary parsing (array
  index access returns `T | undefined`). `exactOptionalPropertyTypes`
  was considered and rejected: it creates friction with Vue/Pinia
  third-party types for no additional binary-safety benefit.
- `vite.config.ts`: `assetsInlineLimit: 0` so tile PNGs are always
  emitted as files, not base64-inlined.
- `vitest.config.ts`: default `environment: 'node'` for all tests (binary
  safety); override per-file for component tests needing jsdom.
- `README.md`: setup instructions, fixture ROM note ("place your
  legally-owned SMB2 USA PRG0 ROM at `test/fixtures/smb2.nes` before
  running tests").

**Patterns to follow:**
- Tiled's panel layout is the north-star UI reference for later units, not
  this one.

**Test scenarios:**
- Test expectation: none — pure scaffolding. Verified by `npm run dev`
  starting, `npm run build` producing a dist, and `npm run test` running
  zero tests without error.

**Verification:**
- `npm run dev` serves a page on localhost.
- `npm run build` succeeds with zero type errors and zero lint warnings.
- `npm run test` runs and reports "0 tests" successfully.

---

- [ ] **Unit 2: Build-time CHR extraction script**

**Goal:** Produce the tile sprite atlas used for rendering. A Node script
reads the canonical SMB2 USA PRG0 ROM (supplied by the developer locally,
not committed), decodes all CHR tiles using the NES 2bpp planar format,
and writes individual tile PNGs to `src/assets/tiles/`.

**Requirements:** Prerequisite for R1 rendering (Unit 6).

**Dependencies:** Unit 1.

**Files:**
- Create: `scripts/extract-chr.ts`, `src/assets/tiles/.gitkeep`.
- Create: `src/assets/tiles/index.ts` (manifest mapping tile IDs → imported
  PNG URLs) — may be generated by the script.
- Test: `test/scripts/extract-chr.test.ts` (unit tests the decode
  algorithm against a known 16-byte tile).

**Approach:**
- Script runs as `npm run extract-chr` (added to `package.json` scripts).
- Reads `test/fixtures/smb2.nes` (user-supplied), validates CRC32, decodes
  CHR region starting at iNES offset `0x8010`.
- For each 16-byte tile: combine two bitplanes into a 2-bit color index,
  emit as 8×8 PNG using **`pngjs`** (pure JS, ~90 KB, no native build —
  `sharp` is overkill for a one-shot script emitting ~8,000 tiny PNGs).
- **Output: tile-level PNGs only** (not metatile-level). Runtime
  re-colors tiles via Canvas `getImageData`/`putImageData` using the
  level's active palette. Metatile composition, if needed, happens at
  runtime in Unit 6.
- Generated PNGs are **committed to source control** (`src/assets/tiles/`).
  Determinism across Node versions and zlib implementations is not
  guaranteed byte-for-byte, but the files are stable as long as the
  script isn't re-run. If they need regeneration (e.g., bug fix in the
  decoder), `git diff` will show the change and the reviewer can
  visually spot-check the output matches the previous atlas.
- Script writes a manifest `index.ts` with typed tile ID → URL mapping
  so components import tiles as `import { TILE_GROUND } from
  '@/assets/tiles'`. The manifest is also committed.

**Patterns to follow:**
- NES CHR decode reference: [NESDev PPU pattern tables](https://www.nesdev.org/wiki/PPU_pattern_tables).

**Test scenarios:**
- Happy path: hand-crafted 16-byte tile input decodes to the expected 8×8
  color-index matrix (validate the bitplane combine logic).
- Edge case: all-zeros tile produces an all-zero pixel matrix.
- Edge case: all-ones tile (both bitplanes 0xFF) produces all-3 pixel
  matrix.
- Integration (manual, doc'd in README): running `npm run extract-chr`
  with a valid ROM produces > 0 PNG files in `src/assets/tiles/`.

**Verification:**
- Unit tests pass.
- `npm run extract-chr` generates the tile atlas deterministically (same
  ROM in → same PNGs out, verified by hash).
- The manifest `index.ts` type-checks.

---

- [ ] **Unit 3: ROM validation layer**

**Goal:** Accept a user-uploaded `.nes` file, strip iNES header (+
optional trainer), compute CRC32 over PRG-ROM, validate against
`SMB2_USA_PRG0_PRG_CRC32`. Return either a validated `Uint8Array` or a
natural-language error.

**Requirements:** R1 (precondition), R13, origin §7.

**Dependencies:** Unit 1.

**Files:**
- Create: `src/rom/constants.ts` (ROM offsets, CRC constants, budget
  constants), `src/rom/validation.ts`, `src/components/RomLoader.vue`
  (minimal upload UI).
- Test: `test/rom/validation.test.ts`.

**Approach:**
- **First-load state (before any ROM is uploaded):** the app shows a
  centered upload drop zone with a short instruction ("Drop your SMB2
  (USA, PRG0) .nes file here, or click to browse"), a one-sentence
  note about the editor ("Edit Super Mario Bros. 2 levels in your
  browser. Your ROM never leaves your device."), and a small
  legal/usage disclaimer link. All side panels (level list, tile
  library, properties) are hidden until a valid ROM is loaded. On a
  mobile/tablet viewport the page shows a simple "This editor needs a
  desktop browser" message instead of the loader.
- `validation.ts` exports `validateRom(file: File): Promise<ValidationResult>`.
- Parse iNES header: 16 bytes, verify magic `NES\x1A`, read PRG size,
  CHR size, flag bits (trainer bit = bit 2 of flags6).
- If trainer bit set, skip 512 bytes after header.
- Extract PRG-ROM bytes, compute CRC32 (implement pure-JS CRC32 table
  method — ~20 lines, no dep), compare to `SMB2_USA_PRG0_PRG_CRC32`.
- Error categories with user-facing natural-language messages:
  - `NOT_INES`: "This doesn't look like a NES ROM file."
  - `WRONG_GAME`: "This is a NES ROM but not Super Mario Bros. 2 (USA).
    Try a different file."
  - `WRONG_REVISION`: "This is SMB2 USA but a different revision. This
    editor only works with the PRG0 (original) revision."
  - `CORRUPTED`: "This ROM file appears corrupted."

**Execution note:** Start with a failing round-trip test that loads a
fixture ROM via `validateRom`, asserts success, and uses the returned
buffer for later units. This anchors all subsequent binary work.

**Patterns to follow:**
- `loginsinex/smb2` `cnesfile.cpp` `LoadFile()` is the authoritative
  reference for header handling.

**Test scenarios:**
- Happy path: fixture SMB2 USA PRG0 ROM (with standard iNES header)
  validates successfully; returned Uint8Array has length 256 KB.
- Happy path: same ROM with trainer section (hand-crafted variant)
  validates successfully after trainer strip.
- Error path: all-zeros 256-KB file → `NOT_INES`.
- Error path: valid iNES header but random PRG → `WRONG_GAME` (CRC mismatch).
- Error path: SMB2 USA PRG1 (CRC differs from PRG0) → `WRONG_REVISION`
  (implementer adds the known PRG1 CRC as a secondary match for a more
  specific error message; if unknown, fall back to `WRONG_GAME`).
- Edge case: empty file → `CORRUPTED`.
- Edge case: file smaller than iNES header (< 16 bytes) → `CORRUPTED`.
- Edge case: file larger than 1 MB → `CORRUPTED` (sanity guard).

**Verification:**
- All tests pass.
- Running the app and dropping a non-SMB2 ROM shows the correct English
  error message and does not allow editing to begin.

---

- [ ] **Unit 4: Level data parser + serializer with round-trip test**

**Goal:** Parse the 210 level slots' pointer table and variable-length
item streams into typed `Level` objects, and serialize back. Hardest
structural work in the project. **Byte-identical round-trip of an
unmodified ROM is a hard gate** — no editing features ship until this
test is green.

**Requirements:** R1, R2, R3.

**Dependencies:** Unit 3.

**Files:**
- Create: `src/rom/model.ts` (types for `Level`, `LevelItem`, `LevelHeader`,
  `LevelPointerItem`, etc.), `src/rom/level-parser.ts`,
  `src/rom/level-serializer.ts`, `src/rom/lookup-tables.ts` (ported from
  `nesleveldef.cpp`).
- Test: `test/rom/level-parser.test.ts`, `test/rom/round-trip.test.ts`
  (the golden-hash round-trip test for levels).

**Approach:**
- Port `LoadLevels()` and its callees from `cnesleveldata.cpp`
  (loginsinex/smb2). Specifically:
  - Level pointer table: 210 × 2 bytes at ROM offset `0x10025`.
  - Level data region: `0x101C9` to `0x12433`. Each level is a variable-
    length stream terminated by `0xFF`.
  - Level header: 4 bytes preceding the item stream; 8 user fields packed
    into 13 bit positions (5 reserved bits). Bit positions ported
    verbatim from `clevelinfodlg.cpp`.
  - Variable-length items: 1–5 bytes depending on type. Entrance items
    (IDs `0x09`, `0x0a`, `0x0b`, `0x13`, `0x14`, `0x15`, `0x1c`, `0x1d`,
    `0x1e`) have special length rules if the next byte is `>= 0xF0`
    (adds 2 extra bytes) or `== 0xF5` (adds 3 extra bytes). Pointer
    items (`nliPtr`) are 3 bytes.
- Every `LevelItem` retains its `sourceByteRange` to support debugging
  of round-trip failures (hex-diff which region diverges).
- Serializer walks the `Level[]` model, re-emitting each item in its
  original encoding. Two modes:
  - **Conservative mode** (v0.1): re-emit verbatim from captured source
    bytes whenever the item hasn't been edited. Guarantees round-trip
    byte-identity for unmodified ROMs.
  - **Constructive mode** (Phase 2+): re-encode items from the model
    directly, for edited levels.

**Execution note:** Characterization-first. Write the round-trip
`round-trip.test.ts` test before completing the parser: load fixture ROM,
parse every level, serialize, assert byte-identical. Expect the test to
fail while the parser is incomplete; each parser fix should move it
closer to green. Do not start Unit 5 until this test is green.

**Two gates, not one:**
1. **Conservative round-trip** (v0.1 ship gate): parse → serialize in
   conservative mode (re-emit captured source bytes for unmodified items)
   → byte-identical. This proves the parser captured enough information to
   reproduce the input.
2. **Constructive round-trip** (Phase 2 entry gate, required before any
   editing feature): parse → serialize in constructive mode (re-encode
   every item from the model, not from captured bytes) → byte-identical.
   This proves the parser actually *understood* the encoding. Without this
   gate, the first real edit could silently produce corrupt output because
   conservative mode masks encoding bugs.

**Patterns to follow:**
- `loginsinex/smb2` `cnesleveldata.cpp` — especially the `LoadLevel()`
  function at line ~225 and `MakeByteArray()` serializer.
- Use `DataView` with `true` endian flag for all `getUint16`/`getUint32`.

**Test scenarios:**
- **Happy path (critical):** Load fixture ROM, parse all 210 levels,
  serialize, assert the resulting PRG-ROM bytes are byte-identical to the
  input. SHA-256 hash comparison.
- Happy path: parse one specific level (e.g., 1-1), assert item count and
  the first 3 items match known values documented in code comments.
- Edge case: empty level stream (just `0xFF`) round-trips correctly.
- Edge case: level with exactly one pointer item `nliPtr` round-trips.
- Edge case: level with an entrance item followed by `0xF5` (4-byte
  variant) round-trips.
- Error path: corrupt level stream (missing `0xFF`) raises a typed error
  with the byte offset.
- Integration: serialize → parse → serialize → byte-identity (two-pass
  round-trip, catches any non-deterministic serializer bugs).

**Verification:**
- Conservative round-trip test is green locally (fixture ROM is
  developer-supplied; this test cannot run in CI by design — see
  Testing infrastructure note below).
- Parsing one level and logging the result produces human-readable
  structured output.

**Testing infrastructure note:** The fixture ROM is legally not
committed. Any test depending on it is **developer-local only** and
runs as part of a local `npm run test:local` (or equivalent) script.
CI runs only tests that do not require the fixture (pure algorithmic
tests, component tests with mocked data). The round-trip gate is
therefore a manual pre-merge check, not a CI guard. The gate test
fails loudly if the fixture is absent so nobody ships without having
run it at least once.

---

- [ ] **Unit 5: Enemy data parser + serializer**

**Goal:** Parse the enemy pointer table (210 entries) and the shared
enemy data blocks, preserving the ROM's reference-count sharing
semantics (multiple level slots pointing to one physical enemy block).
Serialize back byte-identically.

**Requirements:** R1, R2, R3, R5.

**Dependencies:** Unit 4 (round-trip gate must be green before enemies
build on it).

**Files:**
- Create: `src/rom/enemy-parser.ts`, `src/rom/enemy-serializer.ts`.
- Extend: `src/rom/model.ts` with `EnemyBlock`, `EnemyItem`,
  `EnemyBlockId`, `WorldRoutingTable`.
- Test: `test/rom/enemy-parser.test.ts`, extend `test/rom/round-trip.test.ts`
  to include enemy region byte-identity.

**Approach:**
- Port `LoadEnemies()` from `cnesenemydata.cpp`. Pointer table at
  `0x12564`–`0x12707` (210 × 2 bytes). Data region at `0x12708`–`0x1303F`.
- Size-calculation heuristic: since enemy data has no end-of-block marker,
  sizes are computed by sorting adjacent pointers. The last block scans
  for `0xFF` or region-end. Port this heuristic exactly — it's fragile
  and matters for round-trip.
- Build a **reference map**: each unique pointer offset becomes a single
  `EnemyBlock`; multiple `levelSlot`s may reference the same
  `EnemyBlockId`. The parsed `Level[]` holds an `EnemyBlockId`, not
  inline enemy data.
- The world routing table construction (also in this unit): a
  `WorldRoutingTable` maps each of the 210 slot indices to its level-
  data block and enemy-data block. Sharing is visible at this layer.
- Serializer emits pointer table first, then enemy data blocks in
  ascending pointer order. Like Unit 4, **conservative mode** (verbatim
  re-emit of unchanged blocks) is v0.1; constructive mode comes later.

**Patterns to follow:**
- `loginsinex/smb2` `cnesenemydata.cpp`, especially the
  `AddRef`/`Release` pattern (lines 297–314) — that's the reference
  counting this design preserves structurally (each `EnemyBlock` has a
  `referencingLevels: LevelId[]` field).

**Test scenarios:**
- **Happy path (critical):** round-trip test now covers pointer table +
  enemy data + level data; byte-identity enforced.
- Happy path: fixture ROM produces an `EnemyBlock[]` whose count is
  **strictly less than 210** (because of sharing). Asserts sharing is
  preserved during parse.
- Happy path: at least one `EnemyBlock` has `referencingLevels.length > 1`.
- Edge case: a level pointing to an enemy block that is shared with one
  other level — editing the block must be visible from both levels
  (asserted at the model level, UI in Phase 3).
- Integration: round-trip.test.ts verifies the enemy region is
  byte-identical on conservative serialize.

**Verification:**
- Full ROM (header + PRG with levels + enemies + palette + everything
  else) round-trips byte-identically after Units 3, 4, 5. This is the
  v0.1 foundational gate.

---

- [ ] **Unit 6: Read-only level viewer**

**Goal:** Given a parsed ROM, display the list of 210 levels in a left
sidebar, and when a level is selected, render its layout as a 2D tile
canvas using pre-rendered PNG sprites. No editing. No scrolling UX
polish. Just "you can see your levels." This proves the data model is
viable for rendering and makes the round-trip work visually legible.

**Requirements:** R1 (display), prerequisite for R4.

**Dependencies:** Units 2, 4.

**Files:**
- Create: `src/stores/rom.ts` (Pinia store holding `Rom` + active level
  selection), `src/components/LevelList.vue`,
  `src/components/LevelCanvas.vue`,
  `src/composables/useCanvasInteraction.ts` (stub — pan/zoom for now,
  DnD in later units).
- Modify: `src/App.vue` to wire up loader → list → canvas.
- Test: light component tests only (see below).

**Approach:**
- `LevelList.vue`: renders 210 level slots grouped by world (1-1, 1-2,
  … 7-2, plus the 3 warp zones). Label each with its `slot index` and a
  tiny swatch of its assigned palette.
- `LevelCanvas.vue`: a single `<canvas>` sized to the level's logical
  dimensions (width × height pages, multiplied by tile pixels × DPR for
  HiDPI). Iterate through `Level.items`, look up each item's tile ID in
  the imported `src/assets/tiles/` manifest, `drawImage` the sprite at
  the correct position.
- For Phase 1, the canvas is sized to the level's full logical width
  and height; if it exceeds the viewport, the surrounding container
  div shows CSS-native scrollbars. **Pan/zoom is explicitly deferred
  to Phase 2 Unit 10** (part of `useCanvasInteraction.ts` development
  for DnD): scroll-wheel zoom, middle-drag pan, and a "fit level to
  viewport" button. This keeps Unit 6 narrow while committing the
  polish work to a specific later unit, not to "someday".
- DPR handling: `canvas.width = logicalWidth * devicePixelRatio`, and
  scale the 2D context so tiles stay crisp on HiDPI.
- No enemies rendered yet (Phase 3 Unit 10).

**Patterns to follow:**
- blurymind/tilemap-editor canvas draw loop structure.
- Vue 3 Composition API with `<script setup lang="ts">`.

**Test scenarios:**
- Happy path (component): `LevelList.vue` receives a parsed ROM and
  renders 210 entries (or equivalent grouped count).
- Happy path (component): `LevelCanvas.vue` mounts with a level selected
  and calls `drawImage` at least once per item in the level's
  `items[]`. Verify via a spied `CanvasRenderingContext2D`.
- Edge case: selecting a level with zero items (shouldn't exist in the
  canonical ROM, but defensively) renders an empty canvas without crash.
- Edge case: switching between levels clears and redraws the canvas.

**Verification:**
- Running the app, uploading the fixture ROM, and clicking through
  levels produces visibly recognizable SMB2 level layouts matching the
  ones in-game.

---

- [ ] **Unit 7: ROM download**

**Goal:** A visible "Download modified ROM" button that triggers a
`.nes` file download with a differentiated filename (never overwriting
the user's original). For v0.1 this serializes the unmodified model;
once editing units land, it serializes the current state.

**Requirements:** R2, R11.

**Dependencies:** Units 3, 4, 5.

**Files:**
- Create: `src/persistence/rom-download.ts`.
- Modify: `src/App.vue` or a new `src/components/DownloadRomButton.vue`.

**Approach:**
- `rom-download.ts` exports `downloadModifiedRom(rom: Rom,
  originalFilename: string): void`.
- Build output filename: strip the `.nes` extension, append `-edited` +
  ISO-date suffix, re-append `.nes`. Example: `smb2.nes` →
  `smb2-edited-2026-04-15.nes`. Never overwrite the input filename.
- Serialize the ROM via Unit 4/5 serializers → concatenate full PRG +
  CHR + re-built iNES header → create a `Blob`, `URL.createObjectURL`,
  anchor-click pattern, `URL.revokeObjectURL`.
- No File System Access API yet (Firefox incompatible as of 2026); the
  Blob + anchor pattern works universally.

**Patterns to follow:**
- Standard MDN Blob download pattern.

**Test scenarios:**
- Happy path: function called with the model produced by parsing an
  unmodified ROM produces a Blob whose `.size` equals 256 KB + iNES
  header.
- Happy path: the output filename always differs from the input
  filename (even if input is `smb2-edited-2026-04-15.nes` —
  de-duplicate with `-v2`, `-v3`, etc).
- Edge case: filename with no extension gets `-edited.nes` appended.
- Edge case: filename with multiple dots (`my.game.nes`) handled correctly.
- Integration: in a browser, clicking the button downloads a file
  whose bytes match the fixture ROM exactly (manual verification on
  v0.1; automated later once a headless browser test is wired up).

**Verification:**
- **v0.1 milestone ready:** upload fixture → view level list → select
  level → see it rendered → click Download → receive byte-identical
  `.nes` file. This is the shippable v0.1 demo flow.

---

### Phase 2 — v0.2 Layout editing

- [ ] **Unit 8: Level properties panel**

**Goal:** Right-side panel showing the 8 user-facing level properties
for the currently selected level, editable via UI controls (selectors,
sliders, visual pickers). Connected to the history store so each change
is a command.

**Requirements:** R6, R10 (undo/redo applies).

**Dependencies:** Phase 1 complete (v0.1 milestone), Unit 4 serializer
upgraded to constructive mode for level headers.

**Files:**
- Create: `src/components/PropertiesPanel.vue`,
  `src/commands/property-commands.ts`,
  `src/stores/history.ts` (introduced here, used by later units too).
- Extend: `src/stores/rom.ts` with a `setLevelHeader(cmd)` action.
- Test: `test/stores/history.test.ts`,
  `test/components/PropertiesPanel.test.ts`.

**Approach:**
- `PropertiesPanel.vue` binds to `useRomStore().activeLevel`. Each of
  the 8 fields from origin §4.3 table maps to a UI control:
  - Length → numeric input with live preview of resulting level width.
  - Direction → `<select>` with "Horizontal / Vertical" options.
  - Music → `<select>` with music names (table hard-coded from
    `loginsinex/smb2` music enum).
  - Palette → horizontal palette grid, clicking applies preview.
  - Enemy color → same pattern as palette.
  - Ground Set ("Decor") → preview thumbnails of each tileset.
  - Ground Type ("Decor style") → variants visible within current Ground
    Set.
  - Object Type ("Level kind") → preview thumbnails.
- Every change goes through `useHistoryStore().execute(SetLevelFieldCommand)`.
- **Command pattern intro (used here for the first time):**
  `SetLevelFieldCommand` stores `levelId`, `field`, `newValue`, and the
  captured `oldValue` at construction. `do()` assigns newValue on the
  level; `undo()` restores oldValue. The history store has no hard cap
  in v1 — command objects are small, typical sessions stay well under
  1 MB.

**Execution note:** Test-first on the command pattern. Write
`history.test.ts` first: execute command → assert state changes; undo
→ assert state restored; redo → re-applied; clearing redo on new
execute.

**Patterns to follow:**
- Command pattern as sketched in High-Level Technical Design.

**Test scenarios:**
- Happy path (store): execute `SetLevelFieldCommand('music', 'Boss')`
  changes the active level's music field.
- Happy path: undo reverts it; redo re-applies.
- Happy path (component): changing the Music `<select>` triggers a
  command and the active level's music is updated.
- Happy path: the label shown in `UndoMenu` (future) reflects the
  command's `label`.
- Edge case: executing a command when no level is selected is a
  **no-op**. Commands carry a `levelId` target; if it doesn't match a
  current selection, `execute` silently does nothing (no error surface).
- Edge case: the undo stack has no hard cap in v1. A typical editing
  session produces < 1 MB of command objects even with hundreds of
  edits (each command stores minimal field deltas). If memory becomes
  an issue post-v1, a cap can be added then.
- Integration: changing music + download → the exported ROM's music
  byte for that level differs from the original.

**Verification:**
- Can select a level, change any of the 8 properties, hit Ctrl+Z, state
  reverts. Exported ROM reflects the final state only (not the undone
  state).

---

- [ ] **Unit 9: Tile library sidebar + drag source**

**Goal:** Left-side panel listing draggable tile/object types (from the
ported `lookup-tables.ts`). Users drag from this library onto the canvas
to place items.

**Requirements:** R4.

**Dependencies:** Unit 2, Unit 6.

**Files:**
- Create: `src/components/TileLibrary.vue`.
- Extend: `src/rom/lookup-tables.ts` with a user-friendly library grouping
  of placeable item types (basic tiles, special objects, doors, plants,
  platforms — per origin §4.1).

**Approach:**
- Each library entry is a `<div draggable="true">` wrapping the item's
  tile sprite + a label. On `dragstart`, set `e.dataTransfer.setData(
  'application/smb2-item', JSON.stringify({ itemType, variant }))`.
- Library is grouped by category (Ground/Blocks, Enemies stub, Doors,
  Plants, Platforms). Search/filter is post-v1.

**Patterns to follow:**
- Standard HTML5 DnD. Avoid vuedraggable — it's for list reordering.

**Test scenarios:**
- Happy path (component): library renders all expected categories and
  items.
- Happy path: `dragstart` on an item sets the expected dataTransfer MIME
  and payload.
- Edge case: dragging outside the browser window does not throw.
- Edge case: keyboard users can still … (deferred — not in v1).

**Verification:**
- Users see a categorized library and can start a drag from it (drops
  wired in Unit 10).

---

- [ ] **Unit 10: Canvas drop handler + tile placement command**

**Goal:** Canvas accepts drops from the tile library, snapping to the
tile grid, emitting a `PlaceTileCommand` through the history store. Also
supports selecting, moving, and deleting existing items.

**Requirements:** R4, R10.

**Dependencies:** Units 8, 9, Unit 4 serializer constructive mode for
level items.

**Files:**
- Create: `src/commands/tile-commands.ts` (`PlaceTileCommand`,
  `MoveItemCommand`, `DeleteItemCommand`).
- Modify: `src/components/LevelCanvas.vue` with `dragover`/`drop`,
  click-to-select, drag-to-move, Delete-key-to-delete logic.
- Extend: `src/composables/useCanvasInteraction.ts` with grid-snap
  math **plus pan/zoom**: scroll-wheel zoom (1× to 4×), middle-mouse
  drag pan, and a "fit to viewport" action. Pan/zoom are deferred
  from Unit 6 to this unit since they naturally share the
  viewport-transform math with DnD coordinate calculations.

**Approach:**
- On `dragover`: `preventDefault` + show a ghost preview at the
  snapped grid position.
- On `drop`: read dataTransfer payload, compute grid coordinates, emit
  `PlaceTileCommand(levelId, gridX, gridY, itemType)`.
- Click on canvas: ray-cast (tile-grid math) to the item under the
  cursor, set `useEditorStore().selection = itemId`. Selection
  visualized as a highlight ring in the next frame.
- Drag a selected item: emit `MoveItemCommand(itemId, oldXY, newXY)` on
  mouseup.
- Delete key while item selected: emit `DeleteItemCommand(itemId)`.
- No rectangular multi-select in this unit — that's Phase 6 Unit 18.

**Patterns to follow:**
- Command pattern established in Unit 8.
- Canvas hit-test is pure math, no libraries.

**Test scenarios:**
- Happy path: dropping a Ground tile at coordinate (5, 12) creates a new
  item in the level's items at that position.
- Happy path: dropping on an occupied tile **replaces** it (matches
  the C++ reference tool). The `PlaceTileCommand` captures both the
  old and the new item so undo restores the original.
- Happy path: clicking an item selects it; selection is reflected in
  `useEditorStore()`.
- Happy path: dragging a selected item to a new position emits a
  `MoveItemCommand`.
- Happy path: pressing Delete deletes the selected item.
- Edge case: drop outside the level bounds is rejected silently with
  cursor feedback.
- Edge case: drop on the exact level end (`0xFF`) is rejected.
- Error path: drop of an invalid dataTransfer payload (e.g., a random
  text drag) is ignored.
- Integration: place tile → save ROM → reload saved ROM → tile is at the
  same position.

**Verification:**
- The v0.2 milestone demo flow works end-to-end: load ROM → select
  level → edit tiles via DnD → change properties → Ctrl+Z / Ctrl+Shift+Z
  → Download → verify in emulator.

---

### Phase 3 — v0.3 Enemies

- [ ] **Unit 11: Enemy placement layer**

**Goal:** Enemies appear overlaid on the level canvas (toggleable view).
Users can drag enemies from an enemy library, select/move/delete them.
The shared-data semantics from the ROM are preserved.

**Requirements:** R5, R10.

**Dependencies:** Phase 2 complete.

**Files:**
- Create: `src/components/EnemyLibrary.vue`,
  `src/commands/enemy-commands.ts`.
- Modify: `src/components/LevelCanvas.vue` to render enemies on a
  compositing layer.
- Extend: `src/stores/editor.ts` with a `showEnemies: boolean` toggle.

**Approach:**
- Decision in this unit: **tile/enemy view is a toggleable overlay
  (on by default), not a tab**. This resolves the origin §4.2
  overlay-vs-toggle open question — overlay is the less destructive
  default for seeing everything at once.
- Enemy sprites come from the CHR extraction (Unit 2).
- `PlaceEnemyCommand`, `MoveEnemyCommand`, `DeleteEnemyCommand` mirror
  the tile commands but operate on `EnemyBlock.items`.
- If the active level's enemy block is shared, the command mutates the
  shared block — which is correct and matches the ROM semantics.
- **Minimal budget guard shipped in this phase:** before `downloadModifiedRom`
  (Unit 7) produces a `.nes` file, it calls `computeUsage()` (the
  function signature from Unit 13's planned `memory-budget.ts`) and
  **refuses** to emit a corrupt ROM if serialized level + enemy + palette
  regions exceed the 16 KB region. The full UI indicator comes in
  Phase 4 Unit 13; this phase ships only the save-blocking check so v0.3
  cannot export corrupt ROMs.

**Test scenarios:**
- Happy path: drag Shy Guy from library onto canvas at (X, Y); enemy is
  added to the level's enemy block at that position.
- Happy path: toggling `showEnemies` off hides enemies without mutating
  the model.
- Edge case: placing an enemy on a tile-occupied cell is allowed (NES
  allows overlap).
- Integration: placing an enemy → save → reload → enemy appears at the
  same position.

**Verification:**
- Enemies are visible, placeable, movable, deletable in the canvas.

---

- [ ] **Unit 12: Shared enemy UI**

**Goal:** When the active level's enemy block is referenced by more
than one level, the UI indicates this clearly and offers a "Make
independent" action.

**Requirements:** R5, origin §4.2.

**Dependencies:** Unit 11, Unit 5's referencingLevels data structure.

**Files:**
- Modify: `src/components/EnemyLibrary.vue` or a new
  `src/components/SharedEnemyBadge.vue`.
- Create: `src/commands/enemy-commands.ts` extended with a
  `DetachEnemyBlockCommand` (copies the shared block for this level
  only, updating the routing table).

**Approach:**
- When `activeLevel.enemyBlock.referencingLevels.length > 1`, show a
  badge: "Shared with <level names>. Changes apply to all."
- Button "Make independent": emits `DetachEnemyBlockCommand`. On
  execute: allocate a new `EnemyBlockId`, deep-copy items, update the
  world routing table to point this level at the new block.
- `DetachEnemyBlockCommand.undo()` restores the original pointer and
  removes the copied block.
- Important: detaching **costs memory budget**. The memory budget
  indicator (Phase 4 Unit 13) must reflect this in real-time.

**Test scenarios:**
- Happy path: loading the canonical ROM, at least one level shows the
  shared badge.
- Happy path: clicking "Make independent" changes the routing table
  entry; subsequent enemy edits only affect the active level.
- Happy path: undo restores the shared state exactly (routing table
  entry back to original, new block removed).
- Edge case: detaching when there's not enough ROM budget is refused
  with an error message (requires Unit 13).
- Integration: modify shared enemy block → confirm via UI change in
  all referencing levels → save → reload → confirm persistent.

**Verification:**
- Users see sharing. Detaching works. Saving preserves semantics.

---

### Phase 4 — v0.4 Integrity

- [ ] **Unit 13: Memory budget indicator and save gating**

**Goal:** Display live usage of the ~16 KB level+enemy data region
(origin §4.6). Refuse to serialize/download if the budget is exceeded.

**Requirements:** R9.

**Dependencies:** Phase 3 complete.

**Files:**
- Create: `src/rom/memory-budget.ts`,
  `src/components/MemoryBudgetIndicator.vue`.
- Modify: `src/persistence/rom-download.ts` to check budget before
  producing the Blob.

**Approach:**
- `memory-budget.ts` exports `computeUsage(rom: Rom): { used, total,
  perSection }`. Used = total serialized length of levels + enemies +
  pointer tables. Total = `NES_PTR_EOF - NES_PTR_START` = 16,400 bytes.
- `MemoryBudgetIndicator.vue` shows a progress bar in the top bar. Green
  < 80%, yellow 80–95%, red > 95%, blocking red ≥ 100%.
- Download button disabled when ≥ 100%, with tooltip "Too much data —
  remove some items or make shared enemies independent to recover
  space" (natural-language message, NOT "ROM budget exceeded").

**Patterns to follow:**
- `loginsinex/smb2` `cnesfile.cpp` `GetMemoryStatus()` line ~644.

**Test scenarios:**
- Happy path: unmodified ROM shows usage < 100%.
- Happy path: a programmatically-crafted model that overflows marks
  the indicator red and disables download.
- Edge case: exactly 100% allowed; 100% + 1 byte blocked.
- Edge case: detaching a shared block increases usage by the size of
  the copied block.
- Integration: place tiles until budget exhausted, observe indicator
  red, download blocked.

**Verification:**
- Live indicator accurate. Download button obeys it.

---

- [ ] **Unit 14: Undo/redo polish and keyboard shortcuts**

**Goal:** Global Ctrl+Z / Ctrl+Shift+Z (and Cmd+Z/Cmd+Shift+Z on macOS)
bind to undo/redo across all command types. Undo/Redo menu items
show the command label.

**Requirements:** R10.

**Dependencies:** Units 8, 10, 11 (commands exist across domains).

**Files:**
- Create: `src/composables/useKeyboardShortcuts.ts`.
- Modify: `src/App.vue` to wire the composable.

**Approach:**
- `useKeyboardShortcuts.ts` registers global keydown handlers (scoped
  to the editor view), respects input-field focus (no undo/redo while
  typing in a text input).
- **Decision in this unit: undo scope is global across the ROM** (one
  stack for all edits, regardless of level). This is the simpler
  mental model for the lambda user ("Ctrl+Z always undoes my last
  change"). The per-level alternative was considered but rejected as
  surprising when edits propagate through shared blocks.
- **Off-screen undo feedback:** when Ctrl+Z/Ctrl+Shift+Z affects a
  level other than the currently-viewed one, show a transient
  notification ("Undone: Place enemy on Level 1-1") so the user isn't
  confused by invisible state changes. Use the command's `label` field.

**Test scenarios:**
- Happy path: Ctrl+Z in the canvas undoes the last tile/enemy/property
  edit regardless of which domain it came from.
- Happy path: typing in the Properties Panel Music selector; Ctrl+Z
  in the input is handled by the browser (cursor-level undo, not
  model undo).
- Edge case: empty undo stack, Ctrl+Z is a no-op.
- Edge case: focus on a text input, Ctrl+Z doesn't escape to model
  undo.

**Verification:**
- Keyboard feels right across all domains.

---

- [ ] **Unit 15: Project Export / Import**

**Goal:** Users can download a `.smb2proj` file containing their
original ROM + edit state, and re-upload it later to resume.

**Requirements:** R10.

**Dependencies:** Units 4, 5 (model is serializable), Unit 14 (history
can be captured).

**Files:**
- Create: `src/persistence/project-file.ts` (uses `fflate`).
- Create: `src/components/ProjectMenu.vue` (wraps Export/Import buttons).
- Extend: `src/stores/project.ts`.

**Approach:**
- `.smb2proj` format: ZIP with `original.nes` (the pristine user-
  uploaded ROM) and `state.json`. The `state.json` is a **snapshot**
  of the full parsed model + `schemaVersion: number` + metadata
  (`exportedAt`, `appVersion`). No command-replay log; undo history
  is deliberately not preserved across export/import (acceptable
  trade-off for a solo v1 — it keeps the format forward-compatible
  with new command types).
- Export: zip via `fflate.zip()`, download via the Blob pattern.
- Import: unzip via `fflate.unzip()`, validate `original.nes` with the
  Unit 3 validator, load the snapshot directly into the Pinia model.
- `useProjectStore` tracks "dirty" state (has the user edited since
  last export?); after 10 minutes of dirty time, show a non-blocking
  "Consider exporting your project" banner (origin §4.7). Banner
  dismissible, appears in a top notification strip, non-modal.

**Patterns to follow:**
- `fflate` docs for zip/unzip.

**Test scenarios:**
- Happy path: export → the resulting Blob is a valid ZIP containing
  `original.nes` and `state.json` (with `schemaVersion` set).
- Happy path: export → import round-trip recovers the same edit state.
- Happy path: importing a project with a different ROM version than the
  user has loaded loads the project's own ROM.
- Edge case: importing a non-SMB2 project file shows a clear error.
- Edge case: importing a project created by a future app version shows
  a "this project was made with a newer version" warning.
- Integration: make edits → export → refresh page → import → edits
  recovered.

**Verification:**
- Round-trip export/import works reliably. Users can recover work after
  a browser restart by importing their file.

---

- [ ] **Unit 16: Destructive action confirmations**

**Goal:** Any action that causes irreversible-feeling data loss prompts
a confirmation dialog. (Technically undo covers most cases, but the
lambda user doesn't always remember Ctrl+Z exists.)

**Requirements:** Origin §4.6.

**Dependencies:** None structurally; Phase 4 is a natural place.

**Files:**
- Create: `src/components/ConfirmationDialog.vue`.
- Apply to: "Reset level to original" action (new), "Clear all enemies
  in this level" (new, optional), "Load a new ROM while unsaved" etc.

**Approach:**
- Reusable `<ConfirmationDialog>` modal; component users pass a
  message + destructive-action callback.
- **"Reset level to original" definition:** "original" means the state
  of that level when the current ROM was first loaded this session
  (from `RomLoader` upload or `.smb2proj` import). It does **not**
  mean the state at last export. The Pinia `useRomStore` keeps the
  initial parsed model snapshot for exactly this purpose.
- Messages in natural language: "Reset Level 1-1 to its original state?
  This will undo all your edits to this level."

**Test scenarios:**
- Happy path: clicking "Reset Level" shows the dialog; canceling keeps
  state; confirming resets.
- Edge case: ESC key cancels the dialog.
- Edge case: clicking outside the dialog cancels.

**Verification:**
- Destructive actions always require an explicit confirm.

---

### Phase 5 — v0.5 Palettes & Links

- [ ] **Unit 17: Palette editors (world + selection screen)**

**Goal:** Users can edit the world palettes and the level-select-screen
palette via a visual NES color grid (56 colors).

**Requirements:** R7.

**Dependencies:** Unit 4 round-trip gate green; palette parser/serializer
(to be added here or factored from Unit 4).

**Files:**
- Create: `src/rom/palette-parser.ts`, `src/rom/palette-serializer.ts`,
  `src/components/PaletteEditor.vue`,
  `src/commands/palette-commands.ts`.
- Extend: `src/rom/model.ts` with `PaletteSet`, `Palette` (4 colors each),
  `PaletteColor` (0–55 NES color index).

**Approach:**
- Palette editor UI: two main sections, "World palettes" (multiple
  palettes per world) and "Selection screen". Each palette is shown as 4
  swatches. Clicking a swatch opens a 56-color NES color picker (laid
  out as the canonical 7×8 grid).
- `SetPaletteColorCommand` mirrors other commands.

**Test scenarios:**
- Happy path: changing a palette color updates the model, and
  subsequent level rendering uses the new color.
- Integration: edit palette → save → reload → color persists.

**Verification:**
- Visible color changes in the level canvas when palettes change.

---

- [ ] **Unit 18: Level links editor (in-level pointers + world routing)**

**Goal:** Implement editing for both kinds of links from origin §4.5:
- In-level pointer items (`nliPtr`) — edited inline with other level
  items in the canvas.
- World routing table — a separate panel (tabular list view) mapping
  each of the 210 level slots to its level-data and enemy-data blocks.

**Requirements:** R8.

**Dependencies:** Units 4, 5, 10.

**Files:**
- Create: `src/components/LevelLinksEditor.vue` (the routing table).
- Modify: `src/components/LevelCanvas.vue` to render pointer items
  with a "door" / "transition" visual affordance.

**Approach:**
- In-level pointers: on the canvas, appear as distinct "door" sprites.
  Editing is via a small inline form (which level does this door lead
  to?).
- World routing: a table with rows "Slot → Level block → Enemy block".
  Dropdowns let the user reassign a slot to a different block. Graph
  view representation is **not in scope** (reference tool has no graph
  view either — strict parity).
- **No cycle or orphan validation in v1.** The reference C++ tool has no
  such validation, and strict parity is the v1 goal. If user feedback
  post-v1 reveals a need, this can be added later as a non-blocking
  advisory.

**Test scenarios:**
- Happy path: editing a pointer item's destination updates the model.
- Happy path: reassigning a routing table slot changes which block is
  loaded in that slot.
- Happy path: user can create any valid SMB2 pointer configuration the
  reference tool supports, including ones that would loop in-game (no
  blocking validation).
- Integration: edited links survive save/reload.

**Verification:**
- Both kinds of links are editable with the same operations available
  in the reference C++ tool.

---

### Phase 6 — v1.0 Finishing

*Phase 6 is intentionally small after restructure: Unit 19 (rectangular
multi-select) only. Unit 20 (auto-save) was moved into Phase 4 alongside
Unit 15 so persistence ships as one coherent checkpoint.*

- [ ] **Unit 19: Rectangular multi-select**

**Goal:** Click-and-drag a selection rectangle on empty canvas space
to select multiple items; move/delete them as a group.

**Requirements:** Origin §4.1 final bullet.

**Dependencies:** Unit 10.

**Files:**
- Modify: `src/components/LevelCanvas.vue`,
  `src/composables/useCanvasInteraction.ts`.
- Modify: `src/commands/tile-commands.ts` with `MoveItemsCommand` and
  `DeleteItemsCommand` (plural variants, wrap the singular ones).

**Approach:**
- Drag from empty space draws a rubber-band rectangle. On release, find
  all items whose bounding box intersects the rectangle, select them.
- Group move: drag any selected item, all translate by the same delta.
- Shift+click adds to selection; Ctrl+click toggles individual.

**Test scenarios:**
- Happy path: rubber-band over 3 tiles selects all 3; Delete removes
  all 3 in one command (single undo restores all).
- Edge case: rubber-band over 0 items is a no-op.
- Edge case: rubber-band across level bounds only selects in-bounds
  items.

**Verification:**
- Multi-select works; undo treats the group as one operation.

---

- [ ] **Unit 20: localStorage auto-save layer** *(belongs to Phase 4,
  next to Unit 15 — placed late in the document for historical reasons
  but must land in the same milestone as Export/Import so both
  persistence paths ship together. Do not defer to Phase 6.)*

**Goal:** Best-effort persistence of the current edit state to
localStorage on every N commands, so a browser refresh doesn't lose
work between explicit Exports.

**Requirements:** R10 (best-effort tier).

**Dependencies:** Unit 15 (`.smb2proj` format already serializable).

**Files:**
- Create: `src/persistence/localstorage.ts`.
- Extend: `src/stores/project.ts` with auto-save throttling.

**Approach:**
- On every Nth command (or every T seconds, whichever first), serialize
  the current state (ROM as base64 + state snapshot) to a single
  localStorage key (e.g. `"smb2-editor:current-project"`). Keep it in
  the same snapshot format as `.smb2proj` so Export reuses the same
  serializer.
- On app boot, if a stored project exists, show "Resume previous
  session?" prompt before asking for a ROM.
- Auto-save explicitly tagged as best-effort; Export remains the
  authoritative save.
- **localStorage unavailable handling** (some WebViews, private mode
  on certain browsers, quota exceeded): wrap every `localStorage`
  access in a safe wrapper that catches exceptions and falls back to
  no-op. If writes keep failing, **show a visible banner** — "Auto-save
  isn't available in this browser. Export your project often." — so
  the user knows the safety net is off.

**Test scenarios:**
- Happy path: editing triggers auto-save within N actions; refresh →
  session recovered.
- Edge case: localStorage unavailable → auto-save silently no-ops,
  banner shown.
- Edge case: quota exceeded → drop the stored project key, surface a
  warning.

**Verification:**
- Refresh after editing → prompt appears → accepting resumes state.

---

## System-Wide Impact

- **Interaction graph:** The Command pattern is the central integration
  seam. Every user-visible mutation flows through `useHistoryStore()
  .execute()`. The compile-time `DeepReadonly<Rom>` shape makes it
  structurally impossible to bypass — direct mutations fail to
  type-check, so new code cannot silently break undo/redo.
- **Error propagation:** ROM parse errors propagate as typed
  `RomValidationError` from `validation.ts`; UI components must render
  natural-language messages, not raw error objects. Download is gated
  by memory-budget (`BudgetExceededError`).
- **State lifecycle risks:** (a) The ROM buffer is the source of truth
  for CHR/header regions (never mutated); the parsed model is the
  source of truth for level/enemy/palette regions. A bug that mixes
  these domains can produce corrupt ROMs. Unit 4's round-trip test is
  the structural guard. (b) localStorage auto-save can lag behind the
  live Pinia state during a throttle window; on crash, up to N
  commands of work may be lost — this is acceptable per the "best-
  effort" framing.
- **API surface parity:** N/A (no public API). The only external
  surface is the `.nes` file format and the `.smb2proj` file format;
  both are documented in-code and version-tagged for future migration.
- **Integration coverage:** The round-trip test
  (`test/rom/round-trip.test.ts`) is the cross-layer guarantee. It
  exercises header parsing, level parsing, enemy parsing, palette
  parsing, pointer table preservation, and serialization in one
  assertion. Unit tests for each parser alone are insufficient —
  sharing semantics and pointer-table consistency only surface at the
  full-ROM level.
- **Unchanged invariants:** The ROM's CHR region is never modified by
  v1. The iNES header is preserved verbatim (including trainer if
  present on input).

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| **Round-trip test never goes green** due to a subtle encoding edge case in the variable-length item parser. Stops v0.1 from shipping. | Characterization-first execution posture in Unit 4. Granular per-level round-trip so a failure points at a specific level. Hex-diff logging on mismatch identifies the diverging byte range. |
| **Variable bit-packed level header (13 positions, 5 reserved bits) is decoded wrong**, causing a ROM to boot but with scrambled properties. | Headers round-trip (Unit 4) and the 8 field names match documented values for known levels (unit tests assert specific known-good values). |
| **Memory budget is subtly off-by-one** vs. the C++ tool, leading to ROMs that claim to fit but corrupt on boot. | Port `GetMemoryStatus` precisely; Unit 13 tests cross-check against a known-good pack of levels derived from the reference ROM's actual usage. |
| **Shared enemy semantics break under edit**, where a level's edits silently propagate to unrelated levels because the UI doesn't surface sharing clearly enough. | Unit 11 + Unit 12 are scoped together; Unit 12's shared badge is mandatory. Integration test verifies that detaching + editing doesn't leak to the original block. |
| **localStorage quota exceeded or disabled in private browsing** silently drops auto-save, user loses work. | Unit 20's auto-save is explicitly best-effort; Unit 15's Export is the authoritative save; the UI nudges the user toward Export on long sessions (origin §4.7); a visible banner alerts the user when localStorage writes fail repeatedly. |
| **CHR extraction script produces subtly wrong sprites** (e.g., wrong palette application), making level canvas visually misleading. | Unit 2 tests the decode algorithm against a hand-crafted tile. Phase 1 Unit 6 uses real sprites in the read-only viewer; any obvious visual regression is caught during manual playtest of the demo. |
| **Solo abandonment mid-project.** Identified in review. | Phased delivery (v0.1 is shippable without the rest). Each milestone produces a usable-if-limited tool. v0.1 alone already proves the most technically risky work (parse + serialize). |

## Documentation / Operational Notes

- `README.md` must document:
  - How to supply the fixture ROM for development (local path, never
    committed).
  - The `npm run extract-chr` step before first `npm run dev`.
  - The `.smb2proj` file format version.
  - Browser support matrix (Chromium, Firefox, Safari; desktop-first).
- A short in-app "About" / legal note: "You must own your SMB2 ROM. No
  ROMs are distributed by this tool." Mirrors origin §11.
- Release notes only apply from v1.0 onward (there is no public release
  before v1.0). Internal checkpoint branches can carry short
  "what-changed" notes for dev reference but these are not user-facing.

## Staged Development (not phased public delivery)

The six phases above are **internal development checkpoints**, not
public releases. Each checkpoint is a technical validation that
proves the layer below it is working before the next layer is built:

- Checkpoints v0.1 through v0.5 are never published. They exist on
  branches / pre-release tags for the developer's own validation.
- **Public release starts at v1.0** (complete editor with all parity
  features). No earlier milestone is shipped to users.

This reframes the "each milestone is independently shippable" idea:
it is not "each milestone is independently releasable to users" but
"each checkpoint is a natural stop-and-evaluate point where progress
is measurable and the pipeline is still demonstrably working." The
abandonment-risk mitigation is preserved (a halted project leaves a
working codebase at the last checkpoint), but without the pretense
that interim checkpoints are user-facing products.

**Critical path checkpoint:** Phase 1's round-trip test (Unit 4 / 5)
is the single largest de-risker. Until it's green, no editing units
should start.

## Sources & References

- **Origin document:** [`docs/brainstorms/smb2-editor-v2-requirements.md`](../brainstorms/smb2-editor-v2-requirements.md).
- **Reference implementation:** [github.com/loginsinex/smb2](https://github.com/loginsinex/smb2).
- **NES PPU pattern tables:** https://www.nesdev.org/wiki/PPU_pattern_tables
- **SMB2 NES ROM map:** https://datacrystal.tcrf.net/wiki/Super_Mario_Bros._2_(NES)/ROM_map
- **Tiled map editor (UX reference):** https://www.mapeditor.org/
- **blurymind/tilemap-editor (canvas reference):** https://github.com/blurymind/tilemap-editor
- **Stack docs pinned to April 2026:** Vue 3.5, Vite 8, Pinia 3, Vitest 4.1.
