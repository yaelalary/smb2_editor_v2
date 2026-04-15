# AGENTS.md — Coding Conventions

Project-level rules for anyone (human or agent) contributing code. These
complement the [implementation plan](docs/plans/2026-04-15-001-feat-smb2-editor-v2-implementation-plan.md)
and [requirements doc](docs/brainstorms/smb2-editor-v2-requirements.md),
which own the *what* and *why*. This file owns the *how*.

Keep this short. If a rule needs explaining for more than three lines,
question whether it belongs here at all.

---

## Language and file conventions

- **Everything is TypeScript.** Strict mode, `noUncheckedIndexedAccess`
  enforced at the compiler. No `any` — use `unknown` and narrow. Prefer
  `type` over `interface` unless declaration merging is actually needed.
- **UI is English only.** Strings are hard-coded in templates; no i18n
  framework. A future retrofit is possible but not planned.
- **File naming:**
  - Vue components: `PascalCase.vue` (e.g., `LevelCanvas.vue`)
  - Composables: `camelCase.ts` starting with `use` (e.g., `useCanvasInteraction.ts`)
  - Other TS modules: `kebab-case.ts` (e.g., `level-parser.ts`)
  - Tests: `<name>.test.ts` next to the source under `src/`, or mirrored
    under `test/` for integration and ROM round-trip tests.

## Vue 3 component style

- **Always `<script setup lang="ts">`.** No Options API anywhere.
- **Section order in `.vue` files:** `<script>` → `<template>` →
  (no `<style>` — see Styling section). Be consistent.
- **Typed props and emits, no runtime declarations:**
  ```ts
  const props = defineProps<{ level: Level; editable?: boolean }>();
  const emit = defineEmits<{ (e: 'select', id: ItemId): void }>();
  ```
- **v-model via `defineModel<T>()`** (Vue 3.4+). Never mutate props
  directly.
- **Components stay thin.** Domain logic lives in composables or stores,
  not inside the component script. A component decides layout and
  events; a composable decides behavior.
- **One responsibility per component.** If a component's template has
  two clearly independent regions, extract one into a subcomponent. Err
  on the side of smaller; it's easier to compose larger later than
  untangle a mega-component.

## Styling: Tailwind + Composable Base Components

The project uses **Tailwind CSS v4** via `@tailwindcss/vite`. There is
**no scoped `<style>` block** in feature components — utility classes
live in templates, and reusable surface treatment lives in the base
components.

- **Design tokens** are declared in `src/style.css` inside `@theme { }`.
  Tailwind 4 auto-generates canonical utility classes from every token
  (`--color-ink` → `text-ink`, `bg-ink`, `border-ink`;
  `--spacing-panel-library` → `w-panel-library`, etc.). **Always use
  the canonical class form, not the arbitrary-value form**:
  - ✅ `class="text-ink-muted bg-panel border-panel-border"`
  - ❌ `class="text-[var(--color-ink-muted)] bg-[var(--color-panel)]"`
  The ESLint / Tailwind IDE integration flags the arbitrary-value form
  as a warning; fix it by using the canonical name. Tokens only appear
  as `var(--…)` inside `style.css` itself.
- **Token-promotion threshold:** add a token only when a value is used
  in **three or more** places; otherwise inline the raw Tailwind class.
- **Never put raw hex colors, pixel sizes, or magic numbers in
  templates** for anything that could be themed. Prefer `text-ink` or
  `w-panel-library` over `#333` or `w-64`.
- **Base components in `src/components/common/`** own the cross-cutting
  visual treatment. Today: `BaseButton`, `BasePanel`. Add more when a
  pattern repeats — specifically:
  - Any element used three or more times with the same visual treatment
    graduates into `common/` as a base component.
  - Base components use Tailwind utilities internally; feature
    components compose them via slots and props.
- **Feature components** (e.g., `LevelCanvas`, `TileLibrary`) must
  compose base components; they do not reimplement button / panel /
  dialog styling.
- **Variants live on the base component** via a typed `variant` prop
  mapped through a `Record<Variant, string>` of Tailwind classes. See
  `BaseButton.vue` for the pattern. Do not use CSS class name
  conventions (`btn--primary`) to encode variants — the prop is the
  source of truth.
- **No `@apply`.** Tailwind v4 discourages it, and it re-introduces
  the "which file owns the style?" problem. Either inline utilities or
  extract a base component.
- **Scoped `<style>` blocks only for truly one-off cases** — for
  example, a `<canvas>` element that needs `image-rendering: pixelated`
  set once. If a scoped style grows past ~10 lines, that's a signal
  the styling belongs in a base component or a new design token.

Reusability checklist before starting a new component:
1. Does this element already appear in another component? Reuse the
   existing base component.
2. Does this element combine existing base components? Compose them.
3. Is this genuinely new? Build it as a feature component that uses
   base components internally, and watch for the third usage — that's
   when it becomes a base component itself.

## State management

- **Pinia for cross-component state, local refs for everything else.**
  Ephemeral state (hover, drag ghost, current tool selection scoped to
  a single view) stays in component-local `ref`/`shallowRef`.
- **Stores are setup-style:**
  ```ts
  export const useRomStore = defineStore('rom', () => {
    const model = ref<Rom | null>(null);
    const applyCommand = (cmd: Command) => { /* ... */ };
    return { model: readonly(model), applyCommand };
  });
  ```
- **The parsed ROM model is `DeepReadonly<Rom>` outside its store.**
  Direct mutation is impossible by design — all changes go through
  `useHistoryStore().execute(cmd)`, which delegates to the store's
  internal gateway.
- **No direct `.do()` calls on command objects.** Always route through
  the history store so undo/redo stays consistent.

## Binary I/O conventions

- **Use `DataView` with an explicit endian flag.** Never rely on the
  default (it's big-endian, wrong for NES).
  ```ts
  view.getUint16(offset, true);  // true = little-endian
  ```
- **Verify endianness per-read against the C++ reference source.**
  Don't apply little-endian to every multi-byte read blindly.
- **Every `LevelItem` / `EnemyItem` carries its `sourceByteRange`** for
  round-trip debugging. Never drop this on the floor during construction.
- **Serialization strategy: clone and overlay.** The output ROM is
  built by cloning the original uploaded `Uint8Array` and overwriting
  only parsed regions. Never construct the output buffer from scratch.

## Error handling

- **Typed errors at boundaries.** Validation, parsing, and serialization
  throw named `Error` subclasses (`RomValidationError`,
  `LevelParseError`, `BudgetExceededError`). UI components catch typed
  errors and render natural-language messages — never raw `error.message`.
- **Include context.** Parse errors carry the byte offset where the
  problem was detected. Budget errors carry the overage in bytes.
- **No `try/catch` swallowing.** Either handle the specific error or
  let it propagate.

## Command pattern (critical)

Every model mutation is a `Command`:

```ts
interface Command {
  readonly label: string;         // natural-language, shown in undo UI
  readonly targetLevel?: LevelId; // for off-screen undo notifications
  do(model: WritableDraft<Rom>): void;
  undo(model: WritableDraft<Rom>): void;
}
```

- Rules:
  - Always construct with all inverse state captured up front.
  - `do` and `undo` must be pure in terms of external effects. No I/O.
  - A command that feels like it needs multiple sub-mutations is a
    *composite command* — own the composition explicitly rather than
    leaking mutations through the model.
  - Execute via `useHistoryStore().execute(cmd)`. Nowhere else.

## Testing conventions

- **Vitest, `environment: 'node'` default.** Component tests needing
  DOM set `// @vitest-environment jsdom` at the top of the file.
- **Test file structure:** one `describe` per unit under test, one
  `it` per scenario. Name scenarios by the outcome (`it('rejects ROM
  with wrong checksum')`), not by the test (`it('test validation')`).
- **Coverage categories:** for every feature-bearing unit, the tests
  should include at minimum: happy path + relevant edge cases + error
  paths. Integration tests live under `test/`, not `src/`.
- **Round-trip byte-identity** is the primary correctness signal for
  parsers/serializers. Hash comparison on the full PRG region is the
  gate.
- **Minimal mocking.** Prefer real Pinia stores and real parsers in
  tests. Mock only external boundaries (network, file I/O) — and this
  project has neither.
- **The canonical ROM fixture is never committed.** Tests that need it
  read `test/fixtures/smb2.nes`; if absent, the test fails loudly with
  a message pointing the developer to `README.md`.

## Accessibility baseline

Full accessibility is out of scope for v1, but these cost near-zero
and ship anyway:

- Modals carry `role="dialog"` and trap focus.
- Progress bars carry `aria-valuenow/valuemin/valuemax`.
- Icon-only buttons carry `aria-label`.
- Interactive lists use `role="listbox"` / `role="option"` where
  appropriate.
- Keyboard shortcuts are listed in `README.md`.

## Comments

- Comment on **why**, not on **what**. If `what` needs explaining, the
  code probably needs renaming.
- Call out non-obvious ROM-format reasons: "entrance items use a
  context-sensitive length encoding, see cnesleveldata.cpp:225."
- No JSDoc on TypeScript functions unless it's a public API. Types
  are documentation.

## Linting / formatting

- ESLint + `@vue/eslint-config-typescript` + `eslint-plugin-vue`.
- No Prettier — ESLint handles formatting sufficiently for this
  project's scale.
- `npm run lint` must pass before any push.

## Git workflow

- Feature branches per phase: `feat/v0.1-foundation`, `feat/v0.2-layout`,
  etc. No direct pushes to `master`.
- Conventional commit messages: `feat(scope):`, `fix(scope):`,
  `refactor(scope):`, `test(scope):`, `docs(scope):`, `chore(scope):`.
- Commit boundaries align with plan implementation units when possible.
  A commit that says "WIP Unit N" should be amended or squashed before
  merge.

## When in doubt

- The reference C++ implementation at [loginsinex/smb2](https://github.com/loginsinex/smb2)
  is the authoritative source for ROM data-layer behavior. Match its
  semantics unless there's a documented reason not to.
- The plan is authoritative for architecture and unit boundaries.
  The requirements doc is authoritative for user-visible behavior.
  This file is authoritative for style and craftsmanship.
- If these three documents contradict each other, surface the conflict
  and update one — don't silently pick one.
