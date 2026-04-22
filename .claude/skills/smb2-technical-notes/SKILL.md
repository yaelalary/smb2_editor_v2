---
name: smb2-technical-notes
description: Capture SMB2 (NES) technical findings into docs/smb2-technical-notes.md. Use whenever the user asks a technical question about SMB2 internals (ROM encoding, level data format, item/enemy bytes, routing, pointers, herbs, boss rooms, palettes, sprite atlases), or when a technical detail about the game surfaces during editor work that wasn't already documented. Don't use for feature requests, bug fixes, UI design discussions, or code refactors.
---

# SMB2 technical notes capture

Keep a running technical reference of SMB2 (USA PRG0) internals in `docs/smb2-technical-notes.md`. The document is raw material for a future in-app level-design guide — so entries must be durable facts, not conversational context.

## When to trigger

Trigger on questions or discussions about *how SMB2 works technically*. Examples:

- "Comment sont encodés les bytes d'une porte ?"
- "Pourquoi seul le champi le plus à droite s'affiche ?"
- "Est-ce qu'il y a une contrainte sur les pointeurs ?"
- "Comment le jeu détecte-t-il que Mario a touché la vigne ?"
- While reviewing code, a ROM format detail surfaces that's not yet documented.

Do **not** trigger on:

- Feature requests ("ajoute un bouton X", "crée une commande Y")
- Bug reports or fixes ("ça crashe quand…", "le rendu est cassé")
- UI/UX design discussions
- Questions about the editor's own implementation choices (those go in plans, not technical notes)
- Questions about Vue/TypeScript/Pinia patterns

## Workflow per trigger

1. **Answer the question first** — full explanation with code pointers, as usual. The user is asking for understanding; don't bury them in meta.

2. **Extract durable technical nuggets** from your answer. A nugget is:
   - A byte-level fact (encoding, flag bit, size, opcode)
   - A runtime behavior of the game (how a sprite spawns, how scroll works, how collision resolves)
   - An editor rendering quirk that faithfully reflects the ROM (sentinels, atlas indexing, gamma)

   **Not a nugget**:
   - "We decided to…" — that's a decision, not a fact
   - "This could be a bug…" — that's a TODO
   - "The user prefers…" — that's UX
   - "In this PR we…" — that's history

3. **Read `docs/smb2-technical-notes.md`** and find the relevant section (`## Level data format`, `## Doors, jars, pointers (routing)`, `## Enemies`, `## Vines and ladders`, `## Herbs and pickups`, `## Boss rooms`, `## Rendering quirks (editor)`, `## Palettes and graphics`). Add a section if a new topic genuinely needs one, but prefer reusing existing sections.

4. **Deduplicate strictly**. Grep for keywords from the nugget in the existing doc:
   - If the exact fact is already there → do nothing.
   - If a close entry exists but yours adds precision (a code ref, an exact byte, a boundary case) → refine the existing entry in place.
   - Only append a new `###` subsection if the fact is genuinely new.

5. **Write the entry** in this format:

   ```markdown
   ### Short noun-phrase title

   One to three factual sentences. Use inline code for byte values
   (`byte[2] = 0xF5`, `fx = 0..3`). Reference code with markdown links
   when possible: [routing-commands.ts:186](src/commands/routing-commands.ts#L186).
   Reference the C++ tool with `cpp-path.cpp:line-line` (no link — it's
   outside the repo).
   ```

   Tone: neutral, factual, present tense. No first person. No "we discovered", no "the user asked" — just the fact, as if written by a reference manual.

6. **Save silently.** No announcement to the user, no "I updated the doc". The user already knows the skill does this; surfacing it every time is noise. Only mention the doc if the user explicitly asks what changed.

## Formatting rules for the doc

- Sections ordered by scope: format → gameplay mechanics → rendering. Keep the existing order; don't reshuffle.
- Each `###` entry stands alone — don't rely on ordering for meaning.
- Code refs use repo-relative paths (`src/...`), never absolute.
- C++ refs use bare `cpp-path.cpp:line` form. They live in a sibling repo (`../smb2/`), not ours, so no markdown link.
- Byte values in inline code: `0xF5`, `byte[2]`, `0x0A`.
- No emojis. No bold/italics for emphasis inside entries (reserve bold for true section headers only).

## What this skill does NOT do

- Does not generate the in-app user guide. That's a future task, done once the doc has enough material.
- Does not retroactively scan past conversations. Starts from now, plus the seeded initial content.
- Does not delete entries. If something turns out wrong, rewrite it in place with the correction; don't erase history unless it's clearly a hallucination.
- Does not write about editor implementation choices, bugs, or TODOs. Those belong in plans and git history.
