# SMB2 Technical Notes

> Collected findings on SMB2 (USA PRG0) internals, relevant to level design in
> this editor. Grows over sessions via the `smb2-technical-notes` skill.
> Intended as raw material for a future in-app user guide.

Entries are durable facts (ROM encoding, runtime behavior, rendering quirks), not decisions or history. Code references use repo-relative paths; C++ references point to the reference tool in the sibling `smb2/` repo.

## Level data format

### Regular item encoding (2 bytes)

A plain `nliRegular` item occupies 2 bytes in the level stream: `[YYYYXXXX, itemId]`. High nibble of `byte[0]` is the X cell within the current page (0–15), low nibble is the Y row (0–15). Reference: [level-parser.ts:143-205](src/rom/level-parser.ts#L143-L205), C++ `cnesleveldata.cpp:80-100` (`SizeOfItem`).

### Extended items (size in low nibble)

Items with `itemId` in ranges `0x30–0x4F` and `0x50–0x5F` are variable-size: the low nibble of `byte[1]` encodes `size − 1`, repeated horizontally. Used for herb groups, multi-tile ladders (`0xA0–0xAF` / item `0x37`), and similar repeating objects. The editor's resize handle drives this nibble directly.

### Stream opcodes (meta items)

The item stream is not just a flat list of objects. Meta opcodes advance or reset cursor state:

- `skipper` — advances to the next page.
- `backToStart` — resets cursor to page 0 (used by doors that wrap the reader).
- `groundSet` / `groundType` — change the ground definition for subsequent tiles.
- `pointer` (`0xF5`) — declares a page-scoped transition target (see routing section).

The parser walks these in order to compute absolute `(tileX, tileY)` for every regular/entrance item. Reference: [level-parser.ts:212-246](src/rom/level-parser.ts#L212-L246).

### Zone physics is per-zone, not per-zone-index

Each ground zone in SMB2 has its physics fully determined by its own `groundType` (3 bits) combined with the level's world and `objectType`. There is **no rule like "zone 2 is always quicksand"** — zones are independent. Two adjacent zones can share a `groundType` (so share physics) but that's a level-design choice, not a structural constraint.

Practical consequence for the editor: the "Zone N" numbering in the Ground panel is a **display-only 1-based index** (re-numbered on render). Inserting, deleting, or reordering zones doesn't re-assign physics across zones — each zone keeps its own `groundType` through edits. When the user deletes zone 2 (say, a quicksand zone), the former zone 3 (walkable) slides up to be the new "Zone 2" in the UI, but its physics stays walkable.

### `groundType` selects BOTH the visual tile AND the physics, simultaneously

The 3-bit `groundType` field per zone (header for zone 1, `groundType` opcode value for stream zones) is a combined **visual + physics** selector. It doesn't just pick a behavior — it picks the rendered tile via `getBgTile(bgSet, groundType, world, isH)`, and the game's 6502 then interprets that tile ID for both drawing AND collision.

Three cases you encounter in vanilla:

1. **Same visual, different physics** — e.g., in World 6, `groundType=0` renders tile `0x99` (yellow dotted sand, walkable), `groundType=1` renders tile `0x8A`, and `groundType=2` renders tile `0x8B` — all three are pixel-identical sand, but only gT=0 is walkable; gT=1 and gT=2 are quicksand. This is intentional to let level designers hide quicksand in innocent-looking sand.
2. **Different visual, different physics** — e.g., World 6 `groundType=3` renders tile `0xA0` (brick-column pattern) which is diggable. The distinct visual tells the player "this tile is different — dig here".
3. **Mixed visuals via bitset** — some `groundType` values (like `5` in World 6) return *different* tile IDs depending on the density bitset (1, 2, or 3) — producing a multi-tile visual variant in a single zone.

Editor consequence: switching `groundType` on a zone changes BOTH the ground rendering AND the runtime physics in lockstep. The "Type" dropdown in the Ground panel is therefore a single control with two orthogonal but coupled effects.

### Per-zone `groundType` is designed-in and editable

The `groundType` field is 3 bits, natively per-zone: each zone carries its own type, and the level's stream encodes changes via `0xF6` opcodes. The C++ reference tool exposes this editability via `CNesEditor::ChangeGround(itemIndex, bSet, bType)` ([cneseditor_editor.cpp:335](../../smb2/smb2/cpp/NES/Level Editor/cneseditor_editor.cpp#L335)), and its serializer emits a `groundType` opcode whenever a zone's type differs from the carried-forward value ([cneseditor_objmaker.cpp:146-153](../../smb2/smb2/cpp/NES/Level Editor/cneseditor_objmaker.cpp#L146)).

Consequence: modifying a zone's `groundType` is safe and produces a vanilla-compatible ROM. Values must be masked to 3 bits (0–7). Values 6 and 7 often produce `tileId=0` in the per-world table (no rendered tile) but don't crash the engine — they just show a hole.

### `groundType` opcode retroactively rewrites the last groundSet's type

When a `groundType` opcode (`0xF6`) is encountered in the stream, it does **two** things (ported from C++ `cneseditor_loader.cpp:96-101`, `ItemFromList(iLastBgSet)->ChangeBgType(uGroundType)`):

1. Sets the carried-forward `groundType` for **subsequent** `groundSet` items.
2. **Retroactively overwrites the most recent zone's `groundType`** — the last zone added (header zone if no stream `groundSet` yet, or the most recent stream `groundSet` otherwise).

Vanilla SMB2 encodes per-zone ground type by emitting `groundSet` immediately followed by `groundType`, so each zone's type is set by the `groundType` opcode that trails it. Without the retro-rewrite step, the zone would inherit whatever `groundType` was carried from the previous zone (or the header), which resolves to wrong tile IDs in `getBgTile` and wrong rendering — e.g., 6-1·1 zone 2 would incorrectly resolve to tile `0xA0` (brown columns) instead of `0x8A` (yellow sand).

Implemented in [ground-pass.ts::computeGroundSegments](src/rom/ground-pass.ts) — the loop updates `segments[segments.length - 1].groundType` when a `groundType` opcode is encountered.

### Two serialization modes

The editor emits level bytes in one of two modes:

- **Conservative** (`block.isEdited === false`): re-emit original `sourceBytes` verbatim — byte-identity guarantee for unmodified blocks.
- **Constructive** (`block.isEdited === true`): walk items in stream order, drop old skippers/backToStart, regenerate cursor path from absolute positions. Direction-aware math: horizontal uses `floor(tileX / 16)` for page, vertical uses `floor(tileY / 15)`.

Reference: [level-serializer.ts:153-307](src/rom/level-serializer.ts#L153-L307).

## Doors, jars, pointers (routing)

### Valid entrance item IDs

Only these item IDs are entrances (routing-capable doors): `0x09, 0x0A, 0x0B, 0x13, 0x14, 0x15, 0x1C, 0x1D, 0x1E`. Any other `itemId` with entrance-looking bytes is malformed. The C++ tool hardcodes the same list in `cneseditor_editor.cpp:102-116`.

### Enterable vs static jars

Jars `0x06`, `0x07`, `0x08` are enterable and carry routing bytes like entrances. Jar `0x04` is static (decorative — Mario cannot enter). Jar `0x08` is specifically a warp jar, semantically distinct from `0x06`/`0x07` even though they share the routing byte format.

### Entrance byte layout (4 or 5 bytes)

An entrance item is either 4 or 5 bytes:

- **4-byte (slot ≤ 150)**: `[YYYYXXXX, itemId, tens, (ones<<4)|page]` where `destSlot = tens*10 + (lastByte>>4)` and `destPage = lastByte & 0x0F`.
- **5-byte (slot > 150, "far pointer")**: `[YYYYXXXX, itemId, 0xF5, tens, (ones<<4)|page]`. The `0xF5` sentinel in `byte[2]` promotes to the wider form.

Threshold constant: `FAR_POINTER_THRESHOLD = 150` in [routing-commands.ts:32](src/commands/routing-commands.ts#L32). Decoding logic: [routing-commands.ts:42-69](src/commands/routing-commands.ts#L42-L69).

### Pointer item (`0xF5`) — 3 bytes

A standalone pointer is always 3 bytes: `[0xF5, tens, (ones<<4)|page]`. There is no 5-byte form for pointers. Unlike entrances, pointers have no tile position — they apply to the page they're declared on. Reference: [routing-commands.ts:82-96](src/commands/routing-commands.ts#L82-L96), C++ `cneseditor_editor.cpp:201-219` (`InsertPointer`).

### One entrance or pointer per page (ROM constraint)

The ROM can only handle one routing item (entrance OR pointer) per page. The C++ tool enforces this at insertion time via `CheckPagePointers` (`cneseditor_editor.cpp:4-14`), returning `FALSE` if the target page already has one. Violating this constraint leads to undefined in-game behavior.

### Spawn position (mirror formula)

When Mario goes through a door/jar in room A to room B, the ROM places him at a position computed **from A's coordinates only** — B's tile position is ignored. The formula:

- `mirrorX = 15 − (A.x % 16)`
- `withinY = A.y % 15`
- Horizontal destination: `(destPage * 16 + mirrorX, withinY)`
- Vertical destination: `(mirrorX, destPage * 15 + withinY)`

This is why a "paired" door in the editor can be visually misaligned with where Mario actually spawns: the ROM doesn't care. Reference: [routing-commands.ts:337-348](src/commands/routing-commands.ts#L337-L348), C++ `cleveldlg_handler.cpp:190-202` (`OnNotify_Insert`).

### No back-pointer is stored

Each routing item stores only its own destination `(slot, page)`. There is no ROM-level "paired" relationship — pairing is purely conventional: if A points to B's room AND some item in B's room points back to A's, the pair is functional. If one side is missing, the room is entered but cannot be exited (soft-lock). The editor detects this via `findBackPointer` ([routing-commands.ts:186-206](src/commands/routing-commands.ts#L186-L206)); the C++ tool does not.

### Far-pointer threshold matches slot count

The threshold 150 exists because the ROM allocates the 4-byte form for low slot indices (fits in one byte split `tens/ones`) and needs the `0xF5` escape for high indices. Slots 150–209 require the 5-byte form.

## Enemies

### Enemy byte format

Enemy stream uses 3 bytes per enemy: position byte + enemy-id + page. The enemy-id byte has bit 7 as a **hidden flag** (spawns only after Mario disturbs a specific trigger). The remaining 7 bits index into a 128-entry table with intentional duplication: indices 28–63 mirror indices 92–127. Boss IDs land in the 92–127 range.

### Hawkmouth variants

Hawkmouth spawns under three distinct enemy IDs: `45`, `66`, `67`. They render differently depending on alive vs defeated state — the editor shows the default (alive) variant; in-game animation swaps based on boss flags.

### Bosses have per-world palettes (and per-world stats) independent of `enemyColor`

The level header's `enemyColor` field (2 bits, 4 atlases) controls the palette of **regular enemies** — Shy Guy, Snifit, Cobrat, etc. **Bosses override this** at runtime: when a boss fight starts, the engine loads a dedicated per-world boss palette from a separate ROM table. Evidence: the reference tool exposes per-world boss data including health/jump/throw parameters (`cmiscdatadlg.h:63-76`, e.g., `0x00657F` = Mouser World 1 health, `0x006586` = Mouser World 3 health), implying parallel per-world tables exist for other attributes including palettes.

Consequence: vanilla Mouser looks pink/red in 1-3·5 (World 1) but greenish in 3-3·9 (World 3), despite both rooms possibly sharing the same `enemyColor`. The palette difference is NOT stored in the level data — it's applied at runtime from a world-scoped boss table.

Editor limitation: our canvas renders boss sprites through the standard `enemyColor`-based atlas ([LevelCanvas.vue:1327](src/components/LevelCanvas.vue#L1327)), so bosses appear in their "regular enemy" palette instead of their runtime boss palette. To fix this faithfully would require mapping boss enemy IDs (29=Mouser, 30=Triclyde, 31=Fryguy, 33=Clawgrip, etc. and their `92+` duplicates) to world-specific palette tables in the ROM, which aren't currently wired up.

### Phanto triggers on a global `key_held` flag, not per-instance pairing

Phanto is enemy ID `23` (`0x17`). There is **no data-level linkage** between a Phanto and a key — the C++ reference tool has no Phanto-specific code beyond the name entry (`cnesenemydata.cpp:33`). At runtime, the ROM maintains a global "Mario is holding a key" flag in RAM. When Mario picks up any key (enemy IDs `61` / dup `125`), the flag sets and the Phanto in the current room transitions from idle (spinning in place at spawn) to chase state. Dropping the key or inserting it into a door clears the flag.

Placement rules:

- **Hard constraint: one Phanto per room.** Placing more than one in the same room corrupts the in-game behavior — animations stop playing correctly and enemies (including the Phantos themselves and other sprites) disappear at random. Observed empirically; the ROM's Phanto AI/animation logic is not designed for multiple simultaneous instances. Treat this as a placement limit the editor should eventually enforce.
- **No spatial constraint**: within the one-per-room budget, the Phanto and the key can sit anywhere in the room; no proximity required.
- **Room co-presence is enough to trigger**: a Phanto in a room with no key ever held will idle forever — the `key_held` flag has no way to fire locally.
- **Key carries across doors**: Mario can enter a new room still holding the key, which immediately wakes a Phanto in the destination room even if that room contains no key of its own.
- **Phanto is invincible**: veggies, shells, bombs, POW — nothing kills it. The only way to stop a Phanto is to drop the key.

### Enemy-slot POW block (`58` / dup `122`) has no observable runtime effect

The enemy table lists a POW block at enemy IDs `58` and `122` (metatiles `[0x45, 0x11]`), distinct from the level-item POW block (item `1`, metatile `0x15`). Empirical testing: placing the enemy-slot POW in a level produces no interaction — Mario passes through it, enemies ignore it, the POW effect doesn't trigger. Only the **item-slot form** (Blocks category) is functional: placed on the BG layer, solid, activated when Mario hits it from below.

The enemy-slot entry appears to be vestigial — present in the table (so the editor lists it) but not wired to any gameplay handler in vanilla SMB2. Treat it as a placeholder to avoid in level design.

### Enemy-slot sprites render with transparent background

Sprites from the enemy table (atlas `gfx+10`) render on the **sprite layer** where tile `0` is transparent. Level items from the item table render on the **background layer** where tile `0` is the level's BG color. This is why enemy-slot visuals look semi-transparent in the editor while item-slot visuals look filled — it's a faithful reflection of how the NES composites the two layers, not a rendering bug. Reference: [nesleveldef.ts:714-718](src/rom/nesleveldef.ts#L714-L718) for the enemy-sprite table.

## Vines and ladders

### No routing bytes

Climbable items `0x03, 0x05, 0x0C, 0x0D, 0x12, 0x37` are plain `nliRegular` 2-byte entries — no destination slot/page, no ROM-level pair. Mario climbs as long as a climb-tile is present at the next cell; the camera follows naturally.

### Cross-page climb uses a Pointer

To traverse from one page to another via a vine/ladder, a `Pointer` (`0xF5`) item on the **same page** as the climb-tile declares the target page. The vine itself is unchanged — the pointer is what teleports the camera/level state when Mario crosses the page boundary while climbing.

## Herbs and pickups

### Herb groups (extended items)

Items in the `0x50–0x5F` range are herb groups. The low nibble of `byte[1]` encodes `size − 1`, repeated horizontally. A `0x53` byte places 4 herbs in a row. The editor renders each instance with its own small-vegetable overlay above the base tile.

### Sub-space mushroom: two distinct item IDs

Items `43` and `45` are both sub-space mushrooms — visually and behaviorally identical to the player (pulled like any herb, grants the sub-space warp effect). They exist as two separate IDs because each tracks an **independent "collected" flag bit** in the save state, so a level can mark up to two distinct mushroom pickups per room without them stepping on each other.

### Sub-space mushrooms render rightmost-in-stream wins

If multiple sub-space mushrooms with the **same ID** appear in a single room, only the **rightmost occurrence in the byte stream** is visible in-game — earlier same-ID instances overwrite each other in a single render slot. Priority is by stream order (the parser's emit sequence), not by screen coordinates. Placing the same ID twice in a room is effectively placing it once.

## Boss rooms

### Big mouth entrance (item `30` / `0x1E`) — single vanilla instance

The "Big mouth entrance used in desert" is an `nliEntrance` item (4- or 5-byte form with destination pointer) rendered in-game as a **2×4 tile** Sphinx-style carved face that opens its mouth when Mario approaches. The multi-tile visual (mouth + eyes + face) is composed at runtime by the 6502 ASM, not encoded in the level data.

In the editor we render it as a single-tile sentinel (`0xFC` — pink "12?" placeholder) at [item-renderer.ts:218](src/rom/item-renderer.ts#L218) because we don't replicate the runtime composition. So the library thumbnail and the canvas show a 1×1 pink square where the actual in-game sprite will be 2×4.

Vanilla coverage: exactly **one instance in the entire ROM**, in slot 171 (6-3·2) at tile (73, 1). Its destination is the white-entrance companion below.

### White entrance (item `21` / `0x15`) — same 2×4 runtime composition

Like the big mouth, the "White entrance, extends to ground" is an `nliEntrance` that renders as a **2×4 tile** door in-game (composed from multiple CHR tiles by the 6502 at runtime) but as a single-tile sentinel `0xFC` in the editor ([item-renderer.ts:249-251](src/rom/item-renderer.ts#L249-L251)).

It's used as the **return / paired door** for other non-standard entrances. Example from vanilla: the big mouth in 6-3·2 (`bytes=[0x19, 0x1E, 0xF5, 0x11, 0x20]` → far-pointer to 6-3·3 page 0) is paired with a white entrance in 6-3·3 at tile (5, 6) (`bytes=[0x65, 0x15, 0x06, 0x13]`). Mario enters via the big mouth and emerges through the white entrance, 2×4 on both ends.

### Boss exit door is hardcoded in ASM

In every boss room (Mouser, Triclyde, Fryguy, Clawgrip, Wart, Birdo mini-bosses), a White entrance sprite appears after the boss is defeated so Mario can exit. **This door is not stored in the level's item stream** — its position is hardcoded in the 6502 ASM that runs on boss defeat. The C++ reference tool does not surface it either.

The editor keeps a manual registry in [boss-exit-doors.ts](src/rom/boss-exit-doors.ts) and renders a semi-transparent read-only ghost at the recorded position. Known positions (tile coords): Mouser 1-3·5 (24,11), Triclyde 2-3·7 (24,11), Mouser 3-3·9 (24,11), Fryguy 4-3·8 (8,11), Clawgrip 5-3·6 (24,7), Triclyde 6-3·7 (24,11), Wart 7-2·6 (40,11).

## Background objects (runtime-composed)

### Large red platform background (item `31` / `0x1F`)

Dispatched via the SMB2 ROM's `CreateObjects_10` jump table to a handler the disassembly labels `CreateObject_TreeBackground` (legacy Doki Doki Panic name; the same binary handler renders as red platforms in W5-3 because of the loaded CHR/palette). Source: `Xkeeper0/smb2 src/prg-6-7.asm`.

Geometry generated at runtime:

- Width is hardcoded at exactly 12 tiles per row. Row layout: `Left` + 5 × (`MiddleLeft`, `MiddleRight`) + `Right`, using the four `BackgroundTile_TreeBackground{Left,MiddleLeft,MiddleRight,Right}` nametable indices (`0x5C`, `0x5D`, `0x5F`, `0x5E` in `src/defs.asm`). The outer X loop with `LDX #$02` handles Left/Right ends; the inner `MiddleLoop` with counter `byte_RAM_7 = #$04` runs 5 iterations × 2 tiles.
- Height is dynamic — extends down until non-sky. After each row, the routine increments Y, jumps back to the entry, and re-reads the tile at the new `(x,y)`. If it equals `BackgroundTile_Sky` (`0x40`), draw another row; if it's anything else (ground, wall, another object), `RTS`.
- Implicit guard: the very first instruction reads the tile at the placement cell and exits immediately if it's not sky. Placing this object on a non-sky cell renders nothing.

Item encoding: standard 2-byte regular item — no length field. The runtime extent is computed entirely from neighboring tile state.

Vanilla coverage (via `scripts/find-item.ts 31`): only used in W5-3 sub-sections 2, 3, 5 (slots 141, 142, 144) — 8 placements total, all at `y=0`, `dir=1`, `fx=3`. Designer X-spacing of 24 tiles between adjacent placements is 12 tiles of pattern + 12 tiles of gap, not a property of the object.

Runtime stream-order interaction: items emitted earlier than the red bg in the byte stream get clobbered when the red bg writes its 12-tile rows over them — this is just sequential nametable RAM writes, no priority arbitration. Items emitted later overwrite the red bg in the cells they touch.

### Pyramid (item `23` / `0x17`)

Dispatched via `CreateObjects_10` entry `$17` → handler `CreateObject_Pyramid` in `Xkeeper0/smb2 src/prg-6-7.asm`. Same family as item `0x1F` (red platform bg): runtime-composed background, hardcoded shape, dynamic height, sky-gated descent.

Geometry generated at runtime:

- Shape is a symmetric triangle expanding downward. Row 0 is the apex: 2 tiles `[LeftAngle, RightAngle]`. Row N (1..) writes `2N+2` tiles: `[LeftAngle, N × LeftInner, N × RightInner, RightAngle]`. Each new row starts one column further left than the previous: after `INC byte_RAM_8`, the routine computes `Y = (E7 + 0x10) - byte_RAM_8`, shifting the left edge by `counter` cells per descent.
- Height is dynamic with the same sky-check pattern as the red bg — before each row, read the leftmost cell at the new `(col, row)`; if not `BackgroundTile_Sky` (`0x40`), `RTS`. Pyramid stops at the first row whose leftmost column is blocked.
- Implicit guard: placing on a non-sky cell renders nothing (first sky check fails).

Tile constants (`src/defs.asm`):
- `BackgroundTile_PyramidLeftAngle = 0x84` (left slope edge)
- `BackgroundTile_PyramidLeft = 0x85` (inner left fill)
- `BackgroundTile_PyramidRight = 0x86` (inner right fill)
- `BackgroundTile_PyramidRightAngle = 0x87` (right slope edge)

These are nametable indices interpreted via the loaded CHR bank — visual depends on the world.

Vanilla coverage (via `scripts/find-item.ts 23`): 7 slots; visible placements only in 2-1·1 (×4 at x = 10, 2, 23, 151), 2-3·2 (×1 at (152, 4)), and 6-3·5 (×1 at (39, 4)) — all `fx=2` (W2/desert tile bank, where `0x84-0x87` render as sandstone). Slots 1-3·3, 3-2·2, 7-2·2, 7-2·7 carry pyramid items at `(-1, -1)` — present in the stream but unreachable by the parser's cursor walk (e.g. after `backToStart`, or in vertical-level slots where horizontal-pyramid math doesn't apply).

C++ reference tool (`clvldraw_worker.cpp:558`, `DrawPyramidEx`) emits sentinel `0xFB` ("11?" pink placeholder) — same punt-pattern as the red bg.

### Pattern across `CreateObjects_10` runtime-composed handlers

Every entry in this jump table that draws a "background object that extends to ground" follows the same template:

1. Read the placement cell, compare to `BackgroundTile_Sky` (`0x40`); if not sky, `RTS`.
2. Write a row of fixed-or-counter-derived width using hardcoded tile constants from `src/defs.asm`.
3. Advance Y to the next row (with optional left-shift for triangular shapes).
4. Loop back to step 1.

Width and per-row tile pattern are encoded entirely in 6502 control flow and constants — not in any data table the editor could read. `Get*Dim` lookups don't help here. Editor faithfulness requires porting the routine itself.

## Rendering quirks (editor)

### Sentinel metatiles display as "NN?"

Metatile IDs `0xFB, 0xFC, 0xFD, 0xFE` have no graphical definition — they are placeholders. The C++ tool renders them as labeled pink squares (`11?`, `12?`, `13?`, `14?`) by design. The editor mirrors this convention; attempts to "upgrade" them to composed sprites would mask a real data error in the ROM.

### Ground tiles are per-world: same shape renders differently across worlds

Ground tiles come from `getBgTile(rom, bgSet, bgType, world, isH)` ([tile-reader.ts:359](src/rom/tile-reader.ts#L359)). The function resolves a final tile ID from four inputs: `bgSet` (2-bit density derived from the zone's shape pattern, 0–3), `bgType` (the level's `groundType` field, 0–7), the level's `world` (0–6), and direction. Each world has its own ground tile pointer table in the ROM.

Consequence: the **same** zone shape + `groundType` produces **visually and behaviorally different ground** depending on which world the level belongs to. A "solid fill" shape in World 1 (grass) renders as grass terrain; in World 2 (desert) it renders as desert sand; in World 3 (water) it renders as swimmable water; etc. There is no user-selectable "tile type" — the world is the gate.

### Special sand physics are gated by (world, objectType, tile ID)

SMB2 has multiple "sand" physics — **quicksand** (Mario sinks, rises on jump, used in 6-3·2 zone 2 and 6-1·1 zone 2) and **diggable sand** (Mario descends on B+Down, used in 6-3·3 zone 5) — that are all rendered via the same ground system. Naive gating on `(world, tileId)` is **insufficient**: in World 6, tile `0xA0` under `objectType=0` is quicksand, but under `objectType=2` the same tile is diggable. The game's 6502 engine uses the level header's `objectType` field (4 bits) as a discriminator, effectively selecting a "physics theme" for the whole level.

Confirmed data points (vanilla SMB2):

| Slot | World | objectType | Zone groundSet/groundType | Tile ID | Physics |
|---|---|---|---|---|---|
| 6-3·2 zone 2 | 5 | 0 | 12 / 0 | `0x99` | quicksand |
| 6-1·1 zone 2 | 5 | 0 | 13 / 3 | `0xA0` | quicksand |
| 6-3·3 zone 5 | 5 | 2 | 27 / 3 | `0xA0` | diggable |

Implications:

- **Sand is not a placeable library item.** It's a ground rendering emitted by the `groundSet` + `groundType` system, resolved through the level's world atlas.
- **`objectType` is a level-wide physics switch** for special tiles. Two levels with identical visual ground can have opposite runtime behavior based on `objectType` alone.
- **Registry keying**: the editor's `ground-physics.ts` uses `(world, objectType, tileId)` as the composite key. Capture via `scripts/identify-ground-physics.ts`.
- **No validation in the editor.** Placing a "sand zone" setup in a slot whose `objectType` doesn't trigger the expected physics is byte-valid but won't behave as intended.
- World 2 (desert) and other worlds may have their own `(objectType, tileId)` combos — not yet captured. Confirm empirically before asserting coverage.

### Item atlas mapping by FX

The level's `fx` field (0–3) selects which item atlas to use: `fx=0 → atlas 4`, `fx=1 → atlas 5`, `fx=2 → atlas 6`, `fx=3 → atlas 7`. Background tiles use the level's `gfx` directly; item/entity tiles use `gfx + 10`. Reference: [tile-reader.ts](src/rom/tile-reader.ts), C++ `cnesleveldata.cpp` (atlas dispatch).

### Gamma and enemy mask on palette

`UseGamma` post-processes a palette entry as `clr & 0x101010` then shifts — mimicking the NES's non-linear color ramp. `UseEnemyMask` applies a distinct ramp to enemy sprites so they stand apart from background palette. Both are part of the C++ atlas pipeline and are replicated in the editor's palette reader.

## Palettes and graphics

_No entries yet._
