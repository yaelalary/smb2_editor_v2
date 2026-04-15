# SMB2 Editor v2

Web-based level editor for Super Mario Bros. 2 (NES, USA PRG0 only). A Vue 3 SPA that edits a user-supplied ROM entirely in the browser — no backend, no uploads, no accounts.

Functional-parity rewrite of [loginsinex/smb2](https://github.com/loginsinex/smb2) (C++/Win32, abandoned 2017) with a modern drag-and-drop UX.

## Status

Under active development. Not yet released. See [the implementation plan](docs/plans/2026-04-15-001-feat-smb2-editor-v2-implementation-plan.md) and [the requirements doc](docs/brainstorms/smb2-editor-v2-requirements.md).

## Stack

- Vue 3.5 + Vite 8 + TypeScript 5.7
- Pinia 3 for state
- Vitest 4.1 for tests
- Strict TS (`strict: true`, `noUncheckedIndexedAccess: true`) — binary parsing has no tolerance for undefined leaks.

## Prerequisites

- Node.js 22.12+ (required by Vite 8).
- A legally-owned Super Mario Bros. 2 (USA, PRG0) `.nes` ROM for development and testing. The ROM is **never committed** to this repository.

## Setup

```bash
npm install
```

For development work that involves rendering tiles or running the round-trip tests, place your ROM at `test/fixtures/smb2.nes` (gitignored). This path is only read by the CHR extraction script (Unit 2) and round-trip tests (Unit 4+); the app itself expects the user to upload their own ROM at runtime.

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Start the Vite dev server. |
| `npm run build` | Type-check and produce a static production bundle. |
| `npm run preview` | Serve the production bundle locally. |
| `npm run test` | Run the Vitest suite once (node environment). |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run typecheck` | Type-check without emitting. |
| `npm run lint` | Lint `src/` and `scripts/`. |

## Legal

You must own your SMB2 ROM. This editor never distributes any ROM data. The ROM you upload stays in your browser — it is not sent to any server.

## License

TBD.
