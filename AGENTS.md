# Ops Whiteboard: instructions for assistants (Claude, Codex)

The whiteboard Max reads on his phone lives in the **private** GitHub repo
`maxwellanth/ops-board-data` (`board.json`). Change it **only** through the `board`
CLI, which is on PATH (`~/.local/bin/board`, which points to `bin/board.mjs` in this folder). Every write is a git commit.

Always identify yourself: `--as claude` or `--as codex`.

```bash
board list                                          # what's on the board
board show <project>                                # one card in full
board agent <project> Codex --owns "checkout + tests" --state reported --note "wrote 6 tests, 2 failing"
board heartbeat <project> Codex --evidence "running now in ~/x, pid 4121 (checked with ps)"   # LIVE for 10 min
board add <project> done "Pre-order form merged" --as codex
board add <project> next "Fix the 2 failing tests" --as codex
board add <project> blocker "Need Stripe test keys from Max" --as codex
board add <project> decision "Deposit or full prepay?" --as claude
board add <project> link "PR #12" --url https://github.com/... --as codex
board resolve <project> next 1 --as codex           # moves next item 1 to done
```

## Drawing on the board (freehand, like a marker)
You can draw on the shared whiteboard yourself, stroke by stroke. Each stroke is a list of points
you choose, saved as an editable freehand mark next to Max's S Pen marks.
```bash
board where                       # where projects, Max's marks and free space are
echo '[[[0,0],[40,-30],[80,0]], {"points":[[10,20],[70,20]],"color":"red"}]' | board draw --at 900,700 --color blue --width 4 --note "smile" --as claude
board marks --by claude           # your strokes and their ids
board erase <strokeId> --as claude   # only your own strokes
```
- Draw original sketches with your own points: arrows, little characters, circles around things,
  handwritten words made of strokes. Don't paste stock icons or repeat templates.
- Keep it readable at board scale (writing 40 to 80 units tall) and leave white space.
- Never draw over project writing or Max's marks. Use `board where` first.
- Never erase or move Max's marks.

## Rules
1. Report only what you actually did or observed. Never invent progress.
2. Use `heartbeat` (LIVE) only with evidence you checked just now. It expires after 10 minutes.
   When you finish or stop, set `--state reported` with a short note.
3. Do not touch other agents' entries except to read them.
4. Put anything that needs Max's choice in `decision`. Put anything stopping you in `blocker`.
5. Do not edit `board.json` by hand or with the GitHub API directly.
6. Projects marked DEMO are fictional sample data.

Code for the app itself: `src/` (React + Excalidraw), `bin/board.mjs` (CLI),
`src/model.js` (shared rules and merge). Run the tests with `npm test`.
