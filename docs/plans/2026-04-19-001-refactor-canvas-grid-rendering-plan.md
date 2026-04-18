---
title: "refactor: Port C++ canvas-grid rendering pipeline faithfully"
type: refactor
status: active
date: 2026-04-19
origin: docs/plans/2026-04-15-001-feat-smb2-editor-v2-implementation-plan.md
---

# refactor: Port C++ canvas-grid rendering pipeline faithfully

## Overview

Replace the current "render + patch" draw pipeline in the web port with a faithful port of the C++ tool's canvas-grid architecture (`m_Canvas.pItems[]` + `SetCanvasItem` placement-time priority + `DrawCanvas` single-pass render). Eliminate the four accumulated workarounds (`bgOccupancy` map, `bPriority` sort, `fillRect(bgColor)` transparency erase, `isBgStrip` tile flag) by matching the C++ model directly.

## Problem Frame

Over the last weeks we've shipped a series of fidelity patches as the editor drifted from the C++ tool's visual output. Each patch closed a symptom (vines extending through clouds, rondin passing behind columns, vine top ball missing, ground leaking through vine transparency, etc.). The root architectural mismatch was never addressed:

- **C++ pipeline** (`clvldraw_worker.cpp::DrawLevelEx` → `clvldraw_canvas.cpp::DrawCanvas`): allocates a grid of `NES_GITEM` cells, places each tile via `SetCanvasItem` which does priority resolution at write-time (BG_PRIOR + bPriority check, rejecting dominated tiles), then `DrawCanvas` renders each cell exactly once using the cell's `type` field to choose atlas (BG `gfx+10` when `type != 0`, item `fx+4` when `type == 0`).
- **Web pipeline** (`src/components/LevelCanvas.vue::draw`): paints ground to canvas, builds a secondary `bgOccupied` Set via a full shadow-render pass, sorts items by `bPriority`, then paints each item to canvas with a `fillRect(bgColor)` pre-wipe to simulate cell replacement.

Per project memory (`memory/feedback_parity.md`): "C++ is source of truth, no deviation". The accumulated workarounds are the category of "invented alternatives" the rule forbids. This plan ports the C++ architecture faithfully so future item/vine/cloud/pillar fidelity work stops being a patch stream.

## Requirements Trace

- **R1.** Vertical level 1-1·2 vines stop at clouds, other vines, and pillars, matching the C++ tool reference screenshot.
- **R2.** No visual regression on previously-fixed scenes: skipper deltaY reset, ground bitmask extraction, bgPriority=1 items clamped by ground, bridge/red-wood-platform in front of brown brick column, Hawkmouth/Wart multi-tile render, per-world BG atlas (gfx+10), enemy atlas via `3 - enemyColor`, item-atlas vs BG-atlas routing for horz/vert ground extended items, vid 10/11 via `GetHorzDim`, vid 9 vs 8/12 massive priority, `gd()` BE, `GroundCell { solid, tileId }` with invisible-solid cells, 0x1F initial-bg skip.
- **R3.** Rendering pipeline matches the C++ architectural shape: canvas grid owns all tiles, `setItem` does priority rejection at placement, `drawCanvas` renders once per cell from the right atlas.
- **R4.** Items processed in stream order (`DrawLevelEx` semantics), not `bPriority`-sorted.
- **R5.** Accumulated workarounds deleted: `computeBgOccupancy`, `BG_PRIORITY_IDS` + `needsGroundClamp`, `bPriority` sort pre-pass, `fillRect(bgColor)` eraser, `RenderedTile.isBgStrip`.
- **R6.** Unit tests updated to assert on canvas-grid state rather than `RenderedTile[]`.

## Scope Boundaries

- **In scope:** `DrawLevelEx` (initial draw) semantics: ground pass + non-ground pass in stream order, `SetCanvasItem` placement-time priority, `DrawCanvas` single-pass render.
- **Out of scope** (below): deferred to separate tasks.

### Deferred to Separate Tasks

- **Layer system** (`CountLayers`, `IsCanvasLineContainLayerLimit`, `fLimitByLayer`): used only by `RedrawLevel` after edits, not `DrawLevelEx`. Separate plan once edit flows need cross-layer correctness.
- **Special strip** (`pSpecial[]` 3-wide band for 0xF0/0xF5 markers via `SetSpecialCanvasItem`): markers are dev/debug overlays, not visible to lambda users.
- **RedrawLevel** (post-edit draw path — grounds sorted by position, items by layer): only matters after tile/item edit commands; current initial-render path is the full regression surface for this refonte.
- **Enemy hidden-duplicate** (sub-level 4 jar ghost enemies at `pos ± 0x10*10`): cosmetic debug, not in the common-case render.

## Context & Research

### Relevant Code and Patterns

**Web files touched:**
- `src/components/LevelCanvas.vue` — `draw()`, `drawGround()`, `drawItemOnCanvas()`, `computeBgOccupancy()`, `needsGroundClamp()`, `BG_PRIORITY_IDS`
- `src/rom/item-renderer.ts` — `renderItem()`, `renderSingle`, `renderHorizontal`, `renderVertical`, `renderMassive`, `renderHorzGround`, `renderVertGround`, `renderSpecialRegular`, `renderEntrance`, `pushTile`/`pushBgTile`
- `src/rom/tile-reader.ts` — KEEP AS-IS: `getBgTile`, `getBgSet`, `getObjTile`, `getWorldGfx`, `getSingDim`/`getHorzDim`/`getVertDim`/`getMasvDim`/`getEntrDim`, `isSingBg`/`isVertBg`/`isMasvBg`/`isEntrBg`, `getBPriority`
- `src/rom/nesleveldef.ts` — extend with `getBgPriorityFlag(rawId)` and BG_PRIOR sub-palette tables (`g_mbgPriority`/`g_mvbgPriority`)
- `src/assets/metatiles/index.ts` — KEEP AS-IS: `getColorizedAtlas`, `getColorizedBgAtlas`, `metatileRect`, `bgTileRect`

**C++ source of truth:**
- `C:/Users/Yael/Documents/Dev/Web/smb2/smb2/cpp/GUI/Dialogs/Level Draw/clvldraw_canvas.cpp` — `AllocCanvas` (4), `SetCanvasItem` (146), `SetCanvasNullItem` (257), `GetCanvasItem` (275), `DrawCanvas` (335)
- `C:/Users/Yael/Documents/Dev/Web/smb2/smb2/cpp/GUI/Dialogs/Level Draw/clvldraw_worker.cpp` — `DrawLevelEx` (5), `DrawObjectEx` (148), `DrawGroundEx` (611), per-type renderers
- `C:/Users/Yael/Documents/Dev/Web/smb2/smb2/h/GUI/Dialogs/clvldraw.h` — `BG_PRIOR` macro, `CONVERT_REGULAR` macro
- `C:/Users/Yael/Documents/Dev/Web/smb2/smb2/cpp/NES/nesleveldef.cpp` — `g_mPriorityList` (1317), `g_mbgPriority` (1382), `g_mvbgPriority` (1425)

### Institutional Learnings

- `memory/feedback_parity.md` — "C++ is source of truth, no deviation". Port line-by-line. Never invent alternatives.
- `memory/reference_cpp_ground_rendering.md` — 10 lessons already documented: two atlases (items `fx+4`, BG `gfx+10`), `GetFX` per-world lookup, Get\*Dim = ROM + type=4, z-priority in `SetCanvasItem`, invisible-solid cells (`fVisible=TRUE`, `idTile=0xFF`), skipper `deltaY=0`, stream-order + priority rejection, bPriority table, canvas-grid replace + magenta-shows-bgColor, position formula by direction.
- `memory/project_context.md` — Unit 4 level parser + serializer round-trip byte-identity is the v0.1 gate; this refonte must not break `parseLevelBlock` / `populateAbsolutePositions`.

### External References

- None used. The C++ clone at `C:/Users/Yael/Documents/Dev/Web/smb2/smb2/` is the reference.

## Key Technical Decisions

- **Decision:** `CanvasGrid` lives in a new module `src/rom/canvas-grid.ts`, not `LevelCanvas.vue`. **Rationale:** Rendering logic becomes pure + testable, Vue component owns the DOM canvas only.
- **Decision:** `setItem()` mirrors `SetCanvasItem` all three priority cases verbatim (no "simplified to one branch"). **Rationale:** `feedback_parity.md` — simplification is the trap.
- **Decision:** Process items in **stream order** (as in `DrawLevelEx`), delete the `bPriority` sort. **Rationale:** C++ resolves conflicts via `SetCanvasItem` at write-time, so sorting is redundant and actively wrong for vine stop-check semantics (vines see earlier stream items, not all items).
- **Decision:** `RenderedTile` type retired. Each `render*` function in `item-renderer.ts` becomes `(grid: CanvasGrid, ...) => void` that calls `grid.setItem()` directly. **Rationale:** Mirrors the C++ `SetCanvasItem(&pItem, x, y)` calls literally.
- **Decision:** `drawCanvas()` reads each `CanvasCell.type` to pick atlas (item `fx+4` when `type=0`, BG `gfx+10` when `type>0`). No more `isBgStrip` flag. **Rationale:** Mirrors `DrawCanvas` line 351 literally.
- **Decision:** `fillRect(bgColor)` eraser removed. Single-pass `drawCanvas` writes each cell exactly once onto the initial bgColor-filled canvas, so magenta-transparent pixels naturally reveal bgColor. **Rationale:** Structural consequence of single-pass model; no workaround needed.
- **Decision:** Unit tests on `renderItem` migrated to drive a `CanvasGrid` and assert grid state. **Rationale:** User chose grid-state migration over adapter (more faithful, surfaces grid bugs directly).
- **Decision:** Cutover as a single PR. Old draw path not kept behind a flag. **Rationale:** User chose direct cutover. The existing `?dev=rendering` debug view gives us side-by-side comparison for regression checking.

## Open Questions

### Resolved During Planning

- **Scope: full refonte or partial?** → Full canvas-grid port (user choice).
- **Tests: adapter or migration?** → Migrate to grid-state (user choice).
- **Delivery: flag or cutover?** → Direct cutover (user choice).
- **`BG_PRIOR` macro port: per-world table or constant?** → Port `g_mbgPriority[]` (horizontal) and `g_mvbgPriority[]` (vertical) as typed tables in `nesleveldef.ts`, indexed by `8*fx + groundType`, matching C++ literal.
- **Stream order vs bPriority sort for draw order?** → Stream order. `setItem` priority rejection replaces the sort.
- **Enemy rendering path?** → Keep as separate overlay (`pEnemyItems[]` in C++). Enemies render directly from `atlas = 3 - enemyColor`, not through the canvas grid. No change from current implementation.

### Deferred to Implementation

- **Exact `CanvasGrid` API shape** — `setItem(cell, x, y)` vs `setItem(x, y, ...fields)`: decide during Unit 1 based on what reads cleanest at call sites.
- **Ground-pass cell shape** — one `CanvasCell` type for ground + items, or separate types merged at draw time: Unit 2 decision. C++ uses a single `NES_GITEM` so probably one type.
- **Special-item sentinel tiles (0xFB/0xFC/0xFD/0xFE for pyramid/desert/red-bg/star-bg)** — currently passed through to blit. Confirm they still work under the new path during Unit 8 visual regression.

## Output Structure

```
src/
├── rom/
│   ├── canvas-grid.ts          (NEW — CanvasCell type, CanvasGrid class, setItem with priority, drawCanvas)
│   ├── item-renderer.ts        (MODIFIED — render* become grid writers, RenderedTile deleted)
│   ├── nesleveldef.ts          (MODIFIED — add g_mbgPriority, g_mvbgPriority, getBgPriorityFlag)
│   ├── tile-reader.ts          (UNCHANGED)
│   └── ...
├── components/
│   └── LevelCanvas.vue         (MODIFIED — draw() orchestrates alloc → groundPass → itemPass → drawCanvas)
└── ...

test/
└── rom/
    └── item-renderer.test.ts   (MODIFIED — drive CanvasGrid, assert on grid state)
```

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

### Data flow

```
draw(canvas, block)
  │
  ├─ palette = readLevelPalette(rom, slot, header.palette)
  ├─ ctx.fillStyle = palette.bgColorCss; ctx.fillRect(0,0,w,h)   ← initial bgColor fills canvas ONCE
  │
  ├─ grid = CanvasGrid.alloc(widthTiles, heightTiles, fx, gfx)
  │
  ├─ groundPass(grid, block)                                      ← equivalent to C++ "draw bg only" loop
  │     for each groundSet segment (including initial from header):
  │       compute bitmask from ROM (getBgSet)
  │       for each cell in segment's range:
  │         bitset = extract(bitmask)
  │         if bitset == 0: grid.setNullItem(x, y)
  │         else:            grid.setItem({ tileId: getBgTile(...), type: bitset }, x, y)
  │
  ├─ itemPass(grid, block)                                        ← equivalent to C++ "draw objects" loop
  │     for item of block.items (stream order):
  │       renderItem(grid, item, rom, slot, header)               ← writes into grid via grid.setItem
  │
  ├─ drawCanvas(ctx, grid, palette)                               ← equivalent to C++ DrawCanvas
  │     for (y = 0..h-1) for (x = 0..w-1):
  │       cell = grid.get(x, y)
  │       if !cell.visible: continue
  │       atlas = cell.type != 0 ? getColorizedBgAtlas(gfx) : getColorizedAtlas(fx+4)
  │       rect  = cell.type != 0 ? bgTileRect(cell.tileId) : metatileRect(cell.tileId)
  │       ctx.drawImage(atlas, ...rect, x*16, y*16, 16, 16)
  │
  └─ enemyOverlay(ctx, block)                                     ← unchanged, direct blits from atlas 3-enemyColor
```

### `setItem` priority check (port of `SetCanvasItem` lines 154-173)

```
setItem(newCell, x, y):
  existing = grid[x, y]
  if existing.visible:
    // 3 cases, lowered nibble of type = "bg" (ground) bit
    bg   = existing.type & 3
    mybg = newCell.type  & 3

    // Case 1: existing regular + new ground, bg-priority test
    if !bg && mybg && BG_PRIOR(existing.regularId, mybg, fx, mybg.groundType, isH):
      return  // reject new — existing regular wins

    // Case 2: existing ground + new regular, bg-priority test
    if bg && !mybg && BG_PRIOR(newCell.regularId, bg, fx, bg.groundType, isH):
      return  // reject new — existing ground wins

    // Case 3: both regular, bPriority compare
    if !bg && !mybg && g_mPriorityList[existing.regularId].bPriority < g_mPriorityList[newCell.regularId].bPriority:
      return  // reject new — existing is more forward

  grid[x, y] = { ...newCell, visible: true }
```

### Vines stop-check: direct canvas read

Vine renderers (non-inverted vine, inverted vine 0x12) iterate cells from `posY` upward/downward. At each cell:

```
cell = grid.get(posX, cy)
if cell.visible && cell.tileId != 0x40 && cell.type != 0:
  return  // stop — hit ceiling/ground/item
grid.setItem({ tileId: dim.middle, type: 4, regularId: itemId }, posX, cy)
```

No pre-computed `bgOccupancy`, no separate callback. The grid state is read live, exactly as C++ `GetCanvasItem` does.

## Implementation Units

- [ ] **Unit 1: `CanvasGrid` module skeleton + types**

**Goal:** Create `src/rom/canvas-grid.ts` with `CanvasCell`, `CanvasGrid` class, `alloc`/`setNullItem`/`getItem` methods (no priority logic yet). Establishes the shape the rest of the refonte consumes.

**Requirements:** R3, R5.

**Dependencies:** None.

**Files:**
- Create: `src/rom/canvas-grid.ts`
- Test:   `test/rom/canvas-grid.test.ts`

**Approach:**
- `CanvasCell` carries `{ visible: boolean, tileId: number, type: number, regularId: number, groundType: number }`. Mirrors `NES_GITEM` fields used by `SetCanvasItem`.
- `CanvasGrid` constructor takes `width`, `height`, `fx`, `gfx`, `isH`. Stores a flat `Cell[width * height]` zero-initialized.
- `setNullItem(x, y)` zeros the cell (mirrors `SetCanvasNullItem`).
- `getItem(x, y)` returns the cell or a frozen "empty" sentinel when out of bounds.
- Expose `width`, `height`, `fx`, `gfx`, `isH` as readonly.

**Patterns to follow:**
- `src/rom/tile-reader.ts` — pure-function module style, no side effects beyond ROM reads.
- `src/rom/nesleveldef.ts` — typed const tables with clear comments referencing C++ source lines.

**Test scenarios:**
- Happy path: `alloc(16, 60, 3, 1, false)` → grid has 16×60 cells, all `visible=false`.
- Happy path: `setItem` followed by `getItem` at same coords round-trips.
- Edge case: `setItem(x, y)` with `x >= width` or `y >= height` returns without writing (mirrors `SetCanvasItem` line 148 bounds check).
- Edge case: `getItem` out of bounds returns non-visible sentinel.
- Edge case: `setNullItem` on a visible cell clears it (mirrors `SetCanvasNullItem`).

**Verification:**
- Grid allocation matches expected dimensions.
- Bounds-check protections present.

---

- [ ] **Unit 2: Port `SetCanvasItem` priority check + BG_PRIOR tables**

**Goal:** Add `CanvasGrid.setItem(cell, x, y)` with full 3-case priority resolution. Port `g_mbgPriority[]` and `g_mvbgPriority[]` tables from `nesleveldef.cpp:1382` and `1425` into `src/rom/nesleveldef.ts`. Add `getBgPriorityFlag(rawId)` helper (already have `getBPriority`).

**Requirements:** R2 (priority-driven scenes must still work), R3.

**Dependencies:** Unit 1.

**Files:**
- Modify: `src/rom/canvas-grid.ts`   (add `setItem`)
- Modify: `src/rom/nesleveldef.ts`   (add `g_mbgPriority`, `g_mvbgPriority`, `getBgPriorityFlag`)
- Test:   `test/rom/canvas-grid.test.ts`   (priority cases)

**Approach:**
- Port `BG_PRIOR` macro from `h/GUI/Dialogs/clvldraw.h` as a function `bgPrior(regular, bitset, fx, grtype, isH)`. Returns 0 when `g_mPriorityList[regular].bgPriority == 0`; otherwise indexes into the horizontal or vertical per-`(fx, grtype)` table.
- `setItem` implements the three C++ priority cases verbatim. No simplification.
- `CONVERT_REGULAR(r) = r >= 0x30 ? 0x30 + (r-0x30)/0x10 : r` — ported as a helper (already implicit in `getBPriority`, surface it as named function).

**Patterns to follow:**
- `src/rom/tile-reader.ts::getWorldGfx` — how to port a C++ lookup to TS with a named const table.

**Test scenarios:**
- Happy path: place two regulars at same cell, lower-bPriority one wins.
- Happy path: place ground then regular with `bgPriority=1` (e.g., jar), ground wins — regular rejected.
- Happy path: place regular with `bgPriority=1`, then ground — regular wins — ground rejected.
- Happy path: place ground then regular with `bgPriority=0` (e.g., cherry), regular wins — overwrites.
- Edge case: place over empty cell (no existing) — always writes, no priority check.
- Edge case: second call at same cell with equal bPriority — existing wins (C++ `<` not `<=`).
- Integration: replicate the W0:L3 "rondin devant green column" scene from session history — stream-order placement + priority rejection must produce bridge on top.

**Verification:**
- All 3 priority cases behave identically to the C++ source.
- Priority table lookup matches ROM address offsets.

---

- [ ] **Unit 3: Port `DrawGroundEx` as grid writer**

**Goal:** Refactor `drawGround()` in `LevelCanvas.vue` to populate the grid via `setItem`/`setNullItem` instead of blitting. No canvas draws in this pass.

**Requirements:** R2 (ground patterns), R3.

**Dependencies:** Unit 2.

**Files:**
- Modify: `src/components/LevelCanvas.vue`   (refactor `drawGround`, rename to `groundPass`)
- Test:   `test/rom/ground-pass.test.ts`   (new)

**Approach:**
- Signature changes from `drawGround(ctx, b, ..., palette, segments) → GroundCell[][]` to `groundPass(grid, b, rom, segments) → void`.
- Iterate segments (existing `computeGroundSegments` stays — it writes nothing to canvas).
- For each cell: `bitset == 0` → `grid.setNullItem(x, y)`. Else → `grid.setItem({ tileId: getBgTile(...), type: bitset, groundType, regularId: 0 }, x, y)`.
- Invisible-solid cells (`tileId === 0xFF`) still write `setItem` (type > 0 marks them solid) — `drawCanvas` in Unit 5 handles the "don't blit 0xFF" logic.
- `GroundCell { solid, tileId }` type in LevelCanvas.vue deleted — replaced by `CanvasCell`.

**Patterns to follow:**
- Current `drawGround` logic for the two bitmask-extraction loops (horizontal vs vertical) — keep identical, change only what each iteration does.
- `computeGroundSegments` already wired to the skipper `deltaY=0` fix — don't touch.

**Test scenarios:**
- Happy path: 1-1·1 slot 0 ground segments populate expected cells (horizontal level).
- Happy path: 1-1·2 slot 1 ground segments populate expected cells (vertical level).
- Edge case: initial-bg `0x1F` groundSet skipped (segment index 0 only).
- Edge case: stream groundSet `0x1F` NOT skipped (bug regression test from earlier session).
- Edge case: tile 0xFF → cell is `visible=true, type>0, tileId=0xFF` (invisible-solid semantics).
- Edge case: bitset=0 → cell `visible=false` (hole).

**Verification:**
- Grid state after `groundPass` matches expected bitmask pattern for known levels.
- `drawGround` no longer calls `blitTile` or `ctx.drawImage`.

---

- [ ] **Unit 4: Port item renderers as grid writers**

**Goal:** Convert every `render*` function in `src/rom/item-renderer.ts` from returning `RenderedTile[]` to writing into a `CanvasGrid`. Delete `RenderedTile` type, `pushTile`/`pushBgTile` helpers, `IsSolidGroundFn`/`IsBlockingCellFn`. Delete `isBgStrip` flag.

**Requirements:** R1 (vines live-read grid), R2 (all items render correctly), R3, R5.

**Dependencies:** Unit 2.

**Files:**
- Modify: `src/rom/item-renderer.ts`
- Test:   `test/rom/item-renderer.test.ts`   (migrate from `RenderedTile[]` assertions to grid assertions — user chose grid-state migration)

**Approach:**
- New signature: `renderItem(grid: CanvasGrid, item: LevelItem, rom: Uint8Array, slot: number, header: LevelHeader): void`.
- Each `render*` function follows the same pattern: call `Get*Dim`, then for each tile position call `grid.setItem({ tileId, type, regularId, groundType }, x, y)`. `type = 4` for BG-atlas items (mirroring `GetSingDim`/`GetHorzDim`/`GetVertDim`/`GetMasvDim`/`GetEntrDim` setting `type=4` in C++). `type = 0` for default item atlas.
- Vines (0x0C/0x0D/0x0F) inside `renderVertical` non-inverted branch read `grid.getItem(posX, posY+i)` in the loop and break when cell is visible with non-0x40 tile and non-zero type — **live canvas read**, no callback, no bgOccupancy.
- Inverted vine (0x12) same pattern, reading upward.
- Horz ground (vid 0-4) / vert ground (vid 5-7) emit `type=4` cells with `getObjTile` tile IDs.
- `renderHorizontal` (vid 10-11, via `getHorzDim`) emits `type=4`.
- `renderSpecialRegular` case 16 (big cloud) uses `getSingDim` → `type=4`. Cases 14, 23, 30, 31 use sentinel tiles (`0xFE`, `0xFB`, `0xFC`, `0xFD`) with `type=0` (item atlas).
- `renderEntrance` follows `getEntrDim` + `isEntrBg` for `type` choice.
- All sentinels preserved; `drawCanvas` in Unit 5 special-cases them via the existing atlas-tile conventions.

**Patterns to follow:**
- C++ `DrawHorzObjectEx` (clvldraw_worker.cpp:278), `DrawVertObjectEx` (300), `DrawSingleObjectEx` (268), `DrawMasvObjectEx` (426), `DrawHorzGrObjectEx` (381), `DrawVertGrObjectEx` (397), `DrawSpecialObjectEx` (466) — call `SetCanvasItem(pItem, x, y)` where `pItem.idTile` and `pItem.Item.Item.type` were set by the relevant `Get*Dim`.
- Keep existing `Get*Dim` + `is*Bg` functions in `tile-reader.ts` as-is; they're the correctly-ported primitives.

**Test scenarios:**
- Happy path: single item (e.g., POW block, `rawId=1`) writes one grid cell at `(tileX, tileY)` with `type=4`, `tileId` from `getSingDim`.
- Happy path: jar (vid, `rawId=6`, vertical) writes `size+1` cells with `type=4`, top/middle/bottom tiles from `getVertDim`.
- Happy path: bridge (`rawId=0xd5`, vid 10) writes `size+1` cells with `type=4` from `getHorzDim`.
- Happy path: cherry (`rawId=0x29`) writes one cell with `type=4` from `getSingDim` (cherry is in `isSingBg` range).
- Happy path: mass item (24, bricks) writes `6 × 15` cell rectangle with `type=4`.
- Edge case: vine (`rawId=0x0c`) at `(5, 4)` in a grid where `(5, 10)` has a pre-placed cloud cell — vine stops at `y=9` (last tile before cloud), no `bottomleft` emitted.
- Edge case: vine with no obstacles extends full length per the formula `size = 0x0f * ceil((posY+0x0f)/0x0f) - posY - 1 + 0x0f`.
- Edge case: sentinel items (14/23/30/31) write `type=0` cells with fixed tileIds 0xFE/0xFB/0xFC/0xFD.
- Integration: multi-tile enemies still render via the separate enemy overlay path (grid untouched), dim lookup via `ENEMY_DIM`.
- Integration: W0:L3 "rondin over water" — grid state after `itemPass` has bridge cells at higher priority than overlapping column cells, rejecting column in the overlap.

**Verification:**
- `renderItem` has no references to `RenderedTile`, `pushTile`, `pushBgTile`, `isBgStrip`, `IsSolidGroundFn`, `IsBlockingCellFn`.
- `test/rom/item-renderer.test.ts` asserts grid state; no residual `.tiles[0].tileId` style assertions.

---

- [ ] **Unit 5: Port `DrawCanvas` — single grid → screen pass**

**Goal:** Add `drawCanvas(ctx, grid, palette)` to `src/rom/canvas-grid.ts`. Single iteration over cells; chooses atlas by `cell.type`. Sentinel tiles (0xFB-0xFE) fall through to item-atlas blit with their literal tileId.

**Requirements:** R2, R3, R5.

**Dependencies:** Unit 4.

**Files:**
- Modify: `src/rom/canvas-grid.ts`   (add `drawCanvas` export)
- Test:   `test/rom/canvas-grid.test.ts`   (drawCanvas scenarios)

**Approach:**
- Iterate `y = 0..height-1`, `x = 0..width-1`.
- Skip cells with `!visible` (no blit — initial bgColor shows through).
- Skip cells with `tileId === 0xFF` (invisible-solid — no blit, but cell state kept for blocking semantics already handled by Units 2/4).
- `type !== 0` → BG atlas: `getColorizedBgAtlas(grid.gfx, palette)` + `bgTileRect(cell.tileId)`.
- `type === 0` → item atlas: `getColorizedAtlas(grid.fx + 4, palette)` + `metatileRect(cell.tileId)`.
- **Mirrors C++ `DrawCanvas` line 346-358 one-for-one.**

**Patterns to follow:**
- `clvldraw_canvas.cpp::DrawCanvas` (335): `if (type) DrawGrGamma else DrawGamma`.
- Current `blitTile` helper in `LevelCanvas.vue` — its core logic moves into `drawCanvas`.

**Test scenarios:**
- Happy path: grid with one `type=4` cell → exactly one `drawImage` from `bgAtlas`.
- Happy path: grid with one `type=0` cell → exactly one `drawImage` from `itemAtlas`.
- Happy path: mixed cells — correct atlas per cell, correct source rect.
- Edge case: cell with `tileId=0xFF` → no `drawImage` call (verify via mock).
- Edge case: cell with `visible=false` → no `drawImage` call.
- Edge case: palette null → function bails cleanly (no exception).

**Verification:**
- No `fillRect(bgColor)` calls inside `drawCanvas` (only initial canvas fill in `draw()`).
- Each visible cell gets exactly one `drawImage` call.

---

- [ ] **Unit 6: Rewire `LevelCanvas.vue::draw()` + delete workarounds**

**Goal:** Orchestrate the new pipeline in `draw()`. Delete `computeBgOccupancy`, `needsGroundClamp`, `BG_PRIORITY_IDS`, `bPriority` sort pre-pass, `fillRect(bgColor)` eraser, `drawItemOnCanvas`'s `clampAgainstGround` filter, `IsSolidGroundFn` wiring.

**Requirements:** R4 (stream order), R5 (workarounds deleted).

**Dependencies:** Units 3, 4, 5.

**Files:**
- Modify: `src/components/LevelCanvas.vue`

**Approach:**
- New `draw()` orchestration:
  1. `ctx.fillStyle = palette.bgColorCss; ctx.fillRect(0, 0, cssW, cssH)` — unchanged.
  2. Grid + page-separator overlays — unchanged.
  3. `segments = computeGroundSegments(b)` — unchanged.
  4. `gfx = getWorldGfx(rom, world)`, `fx = getFxForSlot(slot)`, `isH = header.direction === 1`.
  5. `grid = new CanvasGrid(widthTiles, heightTiles, fx, gfx, isH)`.
  6. `groundPass(grid, b, rom, segments)`.
  7. `for (const item of b.items) renderItem(grid, item, rom, slot, b.header)` — stream order, no sort.
  8. `drawCanvas(ctx, grid, palette)`.
  9. Enemy overlay — unchanged.
  10. Ghost/rubberband/selection overlays — unchanged.
- Delete: `computeBgOccupancy`, `BG_PRIORITY_IDS`, `needsGroundClamp`, `drawItemOnCanvas` (replaced by Unit 4 renderItem writing into grid).
- Keep: `GroundSegment` type, `computeGroundSegments`, `groundSetAtColumn` (if still used), enemy overlay logic.

**Patterns to follow:**
- `clvldraw_worker.cpp::DrawLevelEx` (5-73) — exact sequence to mirror.

**Test scenarios:**
- Visual (manual): 1-1·1 horizontal, no regression on ground + items + enemies.
- Visual (manual): 1-1·2 vertical, vines stop at clouds — core R1 check.
- Visual (manual): W0:L3 rondin appears in front of green brick column.
- Visual (manual): W1:L1 ladder area — ladder passes over ground correctly.
- Visual (manual): Waterfall levels — cascade tiles render, ground behind correctly hidden.
- Visual (manual): Boss levels (Wart 1-3, Fryguy, etc.) — multi-tile enemies render whole.
- Visual (manual): Vertical climb levels (1-1·2) — enemies on vines, vines anchored on platforms.

**Verification:**
- `grep -r computeBgOccupancy src/` returns no results.
- `grep -r BG_PRIORITY_IDS src/` returns no results.
- `grep -r isBgStrip src/` returns no results.
- `grep -r RenderedTile src/` returns no results except intentional backward-compat comments.
- `npx vue-tsc --noEmit` clean.
- `npx eslint src/` clean.

---

- [ ] **Unit 7: Migrate tests to grid-state assertions**

**Goal:** Rewrite `test/rom/item-renderer.test.ts` (and any other test asserting on `RenderedTile[]`) to drive a `CanvasGrid` and assert on grid cells.

**Requirements:** R6.

**Dependencies:** Units 4, 5.

**Files:**
- Modify: `test/rom/item-renderer.test.ts`
- Possibly modify: other files under `test/rom/` matching `\.tileId` or `RenderedTile` patterns.

**Approach:**
- Test helper: `createTestGrid(w, h, fx, gfx, isH) → CanvasGrid`.
- Replace each test's `const tiles = renderItem(...)` pattern with `const grid = createTestGrid(...); renderItem(grid, ...); const cell = grid.getItem(x, y);`.
- Assertions: `expect(cell.tileId).toBe(0xc2)` instead of `expect(tiles[0].tileId).toBe(0xc2)`.
- Scenarios that previously asserted tileCount → now count visible cells in grid.
- Tests that only ran round-trip on binary data (parser tests, serializer tests) — unchanged.

**Patterns to follow:**
- Existing Vitest style in the repo (top-level `environment: 'node'`, imports from `src/rom/`).

**Test scenarios:**
- All previously passing `renderItem` scenarios still pass under the new assertion style.
- New test: vine stops at pre-placed cloud cell (scenario that exercises the Unit 4 live-read-grid check).
- New test: priority rejection (two items at same cell, lower bPriority wins).

**Verification:**
- `npx vitest run` green.
- No references to `RenderedTile` type in test files.

---

- [ ] **Unit 8: Visual regression pass + cleanup**

**Goal:** Walk worlds 1-7 in the editor, diff against C++ tool reference screenshots, fix any divergences discovered. Delete any leftover workaround code. Update memory references.

**Requirements:** R1, R2.

**Dependencies:** Units 1-7.

**Files:**
- Possibly touch any of Units 1-6 files if regressions found.
- Update: `C:/Users/Yael/.claude/projects/c--Users-Yael-Documents-Dev-Web-smb2-editor-v2/memory/reference_cpp_ground_rendering.md` — add §11 documenting the canvas-grid refonte as the now-ported architecture.
- Update: `C:/Users/Yael/.claude/projects/c--Users-Yael-Documents-Dev-Web-smb2-editor-v2/memory/MEMORY.md` — remove stale `project_rendering_bug.md` pointer (already missing on disk per institutional-learnings research).

**Approach:**
- Use `?dev=rendering` debug route for side-by-side ROM vs static-table checks (still useful for atlas verification).
- Keep C++ tool running alongside; compare slots that previously exposed bugs.
- Priority regression scenes to verify:
  - 1-1·1 (horizontal outdoor, first level)
  - 1-1·2 (vertical climb — vines must stop at clouds)
  - 1-1·3 (waterfall)
  - 1-3 any (Pidgit boss intro)
  - 2-1·1 (desert horizontal)
  - 3-1·1 (night cave)
  - 4-1·1 (winter)
  - 5-3 or 6-3 (vertical tower)
  - 7-2 (castle — Wart level)
  - W0:L3, W1:L1 (past bug scenes from session history)

**Test scenarios:**
- Happy path (per world): the first 3 slots of each world match C++ tool reference.
- Edge case: slot 1 vertical vines match reference exactly.
- Edge case: boss sprites (Wart, Fryguy, Triclyde, Pidgit, Hawkmouth, Mouser, Birdo, Clawglip) render whole.
- Regression: all 10 lessons in `reference_cpp_ground_rendering.md` still observable (skipper deltaY, priority, 0x1F initial skip, invisible-solid cells, stream order, bPriority, canvas-grid replace → magenta shows bg, vertical position formula, BG atlas routing via `gfx+10`, enemy atlas via `3 - enemyColor`).

**Verification:**
- Visual diff with C++ tool is negligible on surveyed slots.
- No remaining console errors during navigation.
- `grep` for each deleted workaround returns nothing.

## System-Wide Impact

- **Interaction graph:** `item-renderer.ts` consumers — `LevelCanvas.vue::draw()` is the primary caller. `DevRenderingDebug.vue` may also import `renderItem` — check and migrate if so. `ItemPalette`/`TileLibrary` components render from static atlases independently (not affected).
- **Error propagation:** `CanvasGrid` methods are non-throwing (bounds-check returns silently, same as C++). Palette null → `drawCanvas` bails cleanly. ROM missing → `LevelCanvas::draw` returns early as today.
- **State lifecycle risks:** Grid allocated per-draw, no persistent state. Canvas element state cleared via `ctx.setTransform` at draw start (unchanged). No caching concerns.
- **API surface parity:** `RenderedTile` is internal, no external consumers. `renderItem` signature change is a breaking internal API change — all callers migrated in the refonte.
- **Integration coverage:** Unit tests (migrated) cover grid-state invariants; manual visual regression in Unit 8 covers cross-file integration. No automated visual diff tooling yet — acceptable per project scope.
- **Unchanged invariants:**
  - Level parser / serializer round-trip byte-identity (Unit 4 of v0.1 plan) — unchanged, we don't touch `level-parser.ts` or `level-serializer.ts`.
  - Enemy overlay path (direct blits from atlas `3 - enemyColor`) — unchanged.
  - Palette reader (`readLevelPalette`) — unchanged.
  - ROM-lookup helpers (`get*Dim`, `get*Bg`, `getBgSet`, `getBgTile`, `getObjTile`, `getWorldGfx`, `getBPriority`) — unchanged.
  - Atlas PNG files and `metatileRect` / `bgTileRect` helpers — unchanged.
  - `populateAbsolutePositions` direction-aware formula — unchanged.

## Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Stream order + new priority rejection surfaces regressions on scenes currently masked by bPriority sort (per research agent warning) | Unit 8 visual regression walks all 7 worlds explicitly. Keep C++ tool open for side-by-side. |
| `SetCanvasItem` priority check ported incorrectly (3 cases are subtle — `bg` vs `mybg`, `!bg && mybg` vs `bg && !mybg`) | Unit 2 tests exhaustively cover each case with explicit input/output pairs. Port with C++ source open next to TS. |
| `BG_PRIOR` table layout (`g_mbgPriority[8*fx + grtype].gr.gr[bitset]`) mis-indexed on port | Unit 2 tests include known C++ outcomes for specific (fx, groundType, bitset) combinations. |
| `drawCanvas` performance degradation with `w × h` iteration | Bench: horizontal level 240×15 = 3600 cells, vertical 16×60 = 960 cells. ~10k cells × ~1µs per `drawImage` = ~10ms. Acceptable (prior pipeline already did ~same work in `computeBgOccupancy` + two passes). |
| Test migration larger than expected if multiple test files reference `RenderedTile` | Unit 7 starts with a grep to size the migration. If >5 files, split Unit 7 into 7a (infrastructure) + 7b (remaining files). |
| Vue component reactivity broken by moving rendering logic out (if any computed deps lurk) | Rendering logic in `LevelCanvas.vue::draw` is already imperatively called on revision changes; canvas-grid port keeps that trigger model. |
| Documentation drift (`memory/reference_cpp_ground_rendering.md` already lists 10 lessons, canvas-grid IS the port target) | Unit 8 explicitly adds §11 documenting the refonte; also removes stale `project_rendering_bug.md` pointer. |

## Documentation / Operational Notes

- Update `memory/reference_cpp_ground_rendering.md` with a new §11 "Canvas grid is now ported faithfully — the 4 workarounds are deleted" once Unit 8 lands.
- Remove stale `project_rendering_bug.md` pointer from `memory/MEMORY.md`.
- No user-facing docs change (internal refactor).
- No rollout / monitoring — local dev app.

## Sources & References

- **Origin document:** [docs/plans/2026-04-15-001-feat-smb2-editor-v2-implementation-plan.md](docs/plans/2026-04-15-001-feat-smb2-editor-v2-implementation-plan.md) (parent plan)
- **C++ source of truth:** `C:/Users/Yael/Documents/Dev/Web/smb2/smb2/` (local clone, MIT)
  - `clvldraw_canvas.cpp::SetCanvasItem` line 146
  - `clvldraw_canvas.cpp::DrawCanvas` line 335
  - `clvldraw_worker.cpp::DrawLevelEx` line 5
  - `clvldraw_worker.cpp::DrawObjectEx` line 148
  - `clvldraw_worker.cpp::DrawGroundEx` line 611
  - `h/GUI/Dialogs/clvldraw.h` — `BG_PRIOR`, `CONVERT_REGULAR` macros
  - `cpp/NES/nesleveldef.cpp` — `g_mPriorityList` (1317), `g_mbgPriority` (1382), `g_mvbgPriority` (1425)
- **Institutional learnings:**
  - `memory/feedback_parity.md` — C++ is source of truth
  - `memory/reference_cpp_ground_rendering.md` — 10 rendering lessons (architecture reference)
  - `memory/project_context.md` — v0.1 byte-identity round-trip gate
