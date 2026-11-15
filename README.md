# Ops Whiteboard

A shared dry-erase whiteboard for the whole operation: projects as marker clusters and
doodles, a web of arrows, and an infinite canvas you can draw on. Claude, Codex and you
all read and write the **same** private board. See `DESIGN.md` for the architecture and
`AGENTS.md` for the assistant rules.

## Open it

**On the Mac (works now):**
```bash
cd ~/ops-whiteboard && npm run serve
```
Then open http://127.0.0.1:4173/. It uses your existing `gh` login, and no token is stored in the browser.

**On the phone:** not deployed yet. That needs your OK to publish the app **code** (not the
data) as a public GitHub Pages site; see the status table below. Once it's published, open the Pages URL, follow
the one-time token steps on screen, then use Share → Add to Home Screen.

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
| Private data repo `maxwellanth/ops-board-data` | ✅ Works. Unauthenticated reads return 404. |
| Mac app (`npm run serve`) | ✅ Works. The proxy listens on 127.0.0.1 only and rejects other hosts, origins and repos. |
| Codex writes through `board` | ✅ Tested with a real `codex exec` run. |
| Claude writes through `board` | ✅ Tested with a separate `claude -p` process. |
| Simultaneous writes | ✅ 3 parallel writes all landed (automatic re-read and retry). |
| Your edit vs an assistant's edit to the same field | ✅ Your value kept; the other value saved as a conflict note on the card. |
| Reopen with unsynced edits | ✅ The edits were restored from the device and merged with changes made meanwhile. |
| History / restore | ✅ Every save is a commit. Restore makes a new commit. |
| Snapshot (.html, printable) and PNG | ✅ Generated in the app (127 KB HTML with drawing, 690 KB PNG). |
| `board export` local files | ✅ Works. |
| Drive copy via `rclone` (`board export --drive`) | ❌ The `gdrive:` remote has read-only scope. Fix it yourself with `rclone config reconnect gdrive:` and grant write access. |
| Drive copy via the Claude Drive connector | ✅ Worked once from a Claude session (file read back at the same size). Codex can't use it. |
| Phone access via GitHub Pages | ⏳ Not deployed. Needs your OK to make the app-code repo public. |
| Automatic LIVE detection | ❌ None. LIVE appears only when an agent runs `heartbeat` with evidence, and it expires after 10 minutes. |
| Real iPhone test | ⏳ Only tested in a 375×812 emulated phone viewport. |

Demo projects are fictional and labelled DEMO on the board.
