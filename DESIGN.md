# Ops Whiteboard: short design

## What it is
A single hand-drawn whiteboard for the whole operation. It is drawn with
**Excalidraw** (MIT licence), so every box, arrow and note on it is a real
editable object, not a picture. Project cards are generated from structured
project data. Anything you draw yourself (doodles, arrows, sticky notes) is
stored as Excalidraw elements and never overwritten by an assistant.

## Where the data lives (no new subscription)
| Piece | Where | Cost / limit checked 2026-11-14 |
|---|---|---|
| Board data `board.json` | **Private** GitHub repo `ops-board-data` | GitHub Free: unlimited private repos. The file API reads up to 100 MB per file through blobs. |
| History / undo | Every save is a git commit in that repo | Free. Any old version can be restored as a new commit. |
| App (code only, no data) | GitHub Pages from a separate repo | Free Pages only works on **public** repos, so the app code is public and the data is not. Soft limit of 100 GB/month bandwidth, 1 GB site. |
| Drawing engine | `@excalidraw/excalidraw` 0.18.1 | MIT. tldraw was rejected because it needs a licence key for production use. |
| Drive copy | `rclone` remote `gdrive:` (already on the Mac), or the Claude Drive connector | Free. Tested 2026-11-14: the rclone remote is **read-only** (a write gets a 403 scope error), and the connector upload worked. rclone also warns that its shared client ID is being retired during 2026. |

Vercel Hobby was rejected because its terms allow personal, non-commercial use
only, and this board tracks paid client work.

## Access control (real, not decorative)
* The data repo is private. GitHub's own permission check decides who can read or write it.
* Phone: a **fine-grained GitHub token** limited to that one repo, with Contents read/write. It is pasted once and kept only on that device. Anyone without such a token sees an empty app shell with no data.
* Mac: `npm run serve` runs a proxy bound to 127.0.0.1 only, which uses the existing `gh` login. No token is stored in the browser.
* Claude and Codex: the `board` CLI uses the existing `gh` login.

## Model (`board.json`)
`projects{id → {name, client, revenue: paid|pipeline|internal, priority, goal,
currentStep, agents[{id,name,owns,status{state,note,evidence,checkedAt,by}}],
done[], next[], blockers[], decisions[], links[], related[], pos}}`,
plus `scene.elements` (your drawings) and `log[]`.

### Status honesty rules
* `unknown` is the default when an agent has never reported.
* `reported` means the agent reported it. It is shown with the time it was reported.
* `live` must carry **evidence** (for example a running process or a fresh commit) and a
  `checkedAt` time. The app downgrades it automatically to "last reported" once it
  is older than 10 minutes. The CLI refuses `live` without evidence.
* Every card shows when it was last checked. The board header shows when it was last fetched from GitHub.

## Sync and conflicts
* GitHub's file SHA is used as a version lock. A save made against an old SHA is rejected (HTTP 409/422).
* On a rejection, the **app** fetches the remote copy and does a three-way merge:
  list items are merged by id, so additions from both sides survive. For fields where
  both sides changed, **your edit wins**, and the other value is kept in the card's
  `conflicts` list so nothing is lost. Drawn elements merge per element by version.
* On a rejection, the **CLI** re-reads the file and re-applies its one operation.
* The status pill shows the difference between saved locally (a draft kept on this device) and
  confirmed in GitHub (with the commit SHA).

## Export
* App: a printable HTML snapshot (every field, status times, links, plus the
  drawing as SVG) and a PNG of the board.
* CLI: `board export` writes HTML and Markdown snapshots. `--drive` copies them to Google
  Drive and reports "confirmed" only after rclone checks the remote file.
