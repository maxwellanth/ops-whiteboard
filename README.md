# Ops Whiteboard

A shared dry-erase whiteboard for the whole operation: projects as marker clusters and
doodles, a web of arrows, and an infinite canvas you can draw on. Claude, Codex and you
all read and write the **same** private board. See `DESIGN.md` for the architecture and
`AGENTS.md` for the assistant rules.

## Open it

**Phone (installable web app):** https://maxwellanth.github.io/ops-whiteboard/
1. Android Chrome: open the link, then ⋮ → **Add to Home screen / Install app**. iPhone Safari: Share → **Add to Home Screen**.
2. Open it **from the home-screen icon** and connect there. (On iPhone the home-screen app keeps its own storage, separate from Safari.)
3. Paste a fine-grained GitHub token that you create yourself: **Only select repositories → ops-board-data**, **Contents: Read and write**. It is stored only on that device.

It's a web app (PWA), not a native store app. Offline it opens the app shell plus the last board copy this device
downloaded, clearly labelled as possibly out of date. Edits made offline stay on the device until GitHub accepts them.

**Mac:** `cd ~/ops-whiteboard && npm run serve`, then http://127.0.0.1:4173/ (uses the Mac's `gh` login, no token).

**Using the board:** fixed scale (no zoom). One finger pans; tap a project to read and edit it. A pen (e.g. S Pen)
draws with the marker. **lens** opens a movable magnifier, and pen strokes inside it land at the same board spot.
**tools** shows the eraser, colours and select tools. **more** has new project, history and snapshots.

## Assistants
`board` is on PATH (`~/.local/bin/board`). Examples:
```bash
board list
board show demo-acme-site
board agent demo-acme-site Codex --state reported --note "wrote checkout tests" --as codex
board heartbeat demo-acme-site Codex --evidence "running now, pid 4121" --as codex
board add demo-acme-site decision "Deposit or full prepay?" --as claude
board export --drive
```

## Status of each piece (verified 2026-11-14)
| Piece | Status |
|---|---|
| Live URL (GitHub Pages, app code only) | ✅ HTTPS. The service worker is active, the manifest and all icons are served, and only the sign-in shows without a token. |
| Private data repo `maxwellanth/ops-board-data` | ✅ Unauthenticated reads return 404. The public code has no data or credentials. |
| Phone sign-in on the live URL | ⏳ Waiting on Max's own token. The authenticated live board isn't tested yet (the same code is tested in Mac mode). |
| Codex and Claude: text updates and freehand drawing | ✅ Real `codex exec` and `claude -p` runs each drew an original doodle with `board draw`. |
| Conflicts, reopening offline, history and restore, exports | ✅ Tested earlier this session. |
| Fixed scale, finger pan, no pinch, wheel or keyboard zoom | ✅ Browser **simulation** only (synthetic pointer, wheel and key events at 375×812). |
| Pen drawing, and drawing through the magnifier at the same coordinates | ✅ Browser **simulation** with synthetic pen events (coordinates matched exactly). |
| Real S Pen, pressure, palm rejection | ❌ Not tested. No Samsung device was reachable from the Mac. Needs Max's own test. |
| Drive copy via `rclone` | ❌ The `gdrive:` remote is read-only. The Claude Drive connector upload worked once. |

Demo projects are fictional and labelled DEMO on the board.
