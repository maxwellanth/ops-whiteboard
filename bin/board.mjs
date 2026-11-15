#!/usr/bin/env node
// board: the command line for the Ops Whiteboard that Claude, Codex and you all share.
// It reads and writes the same private GitHub file as the phone app, so every change is a git commit.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStore, ConflictError } from "../src/ghstore.js";
import { applyOp, normalizeBoard, sortedProjects, statusView, snapshotHtml, ago, emptyBoard } from "../src/model.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HELP = `board: shared Ops Whiteboard CLI (data: private GitHub repo, every write is a commit)

Identify yourself on every write:  --as claude | codex | max   (or set BOARD_AGENT)

Read
  board list                                   one line per project, revenue work first
  board show [project] [--json]                full card(s), with honest status labels
  board log [n]                                recent activity
  board history [n]                            git commits of board.json
Write
  board set <project> <field> <value>          fields: name client revenue(paid|pipeline|internal) priority(1-5) goal currentStep related demo
  board add <project> <done|next|blocker|decision|link> "<text>" [--url URL]
  board resolve <project> <next|blocker|decision|link|done> <n|itemId> [--note "..."]
                                               next→moves to done; decision note is recorded as the decision
  board agent <project> <agentName> [--owns "..."] [--state reported|unknown] [--note "..."]
  board heartbeat <project> <agentName> --evidence "<what you checked just now>"   (sets LIVE for 10 min)
  board agent <project> <agentName> --remove
  board new <project-id> --name "..." [--client "..."] [--revenue paid] [--priority 1] [--goal "..."]
  board restore <commitSha>                    copy an old version back as a new commit (nothing is lost)
Export
  board export [--out DIR] [--drive]           readable HTML and Markdown snapshot; --drive copies to Google Drive and verifies it
Setup
  board init [--demo]                          create board.json in the repo (refuses to overwrite)

Rules: never claim LIVE without evidence you just checked; report what you did, not what you hope.`;

function args(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      flags[k] = v;
    } else pos.push(a);
  }
  return { pos, flags };
}

function config() {
  const f = join(ROOT, "board.config.json");
  const c = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  return { repo: process.env.BOARD_REPO || c.repo, path: process.env.BOARD_PATH || c.path || "board.json", branch: c.branch || "main", driveFolder: c.driveFolder || "gdrive:Ops Whiteboard" };
}

function token() {
  if (process.env.BOARD_GH_TOKEN) return process.env.BOARD_GH_TOKEN;
  try { return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim(); }
  catch { throw new Error("Not signed in to GitHub. Run: gh auth login"); }
}

function who(flags) {
  const w = flags.as || process.env.BOARD_AGENT;
  if (!w || w === true) throw new Error("Say who is writing: add --as claude, --as codex or --as max (or set BOARD_AGENT).");
  return String(w).toLowerCase();
}

async function mutate(store, op, by) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const { board, sha } = await store.load();
    if (!board) throw new Error("No board yet. Run: board init");
    const b = normalizeBoard(board);
    const msg = applyOp(b, op, by);
    try {
      const r = await store.save(b, sha, `[${by}] ${msg}`);
      console.log(`✓ saved to GitHub (commit ${r.commit.slice(0, 7)}): ${msg}`);
      return r;
    } catch (e) {
      if (e instanceof ConflictError && attempt < 6) { console.error(`… board changed underneath (attempt ${attempt}), re-reading and re-applying`); await new Promise((r) => setTimeout(r, 300 * attempt)); continue; }
      throw e;
    }
  }
}

function printCard(p) {
  const L = [];
  L.push(`\n■ ${p.revenue === "paid" ? "$ " : ""}${p.name}  [${p.id}]${p.demo ? "  (DEMO DATA)" : ""}`);
  L.push(`  ${p.client || "no client"} · ${p.revenue} · priority ${p.priority} · updated ${ago(p.updatedAt)} by ${p.updatedBy}`);
  L.push(`  GOAL: ${p.goal || "-"}`);
  L.push(`  NOW:  ${p.currentStep || "-"}`);
  L.push(`  AGENTS:`); for (const a of p.agents) { const v = statusView(a.status); L.push(`    - ${a.name} owns ${a.owns || "?"} | ${v.label}${v.detail ? " | " + v.detail : ""}`); }
  const sec = (t, arr) => { L.push(`  ${t}:`); arr.forEach((x, i) => L.push(`    ${i + 1}. ${x.text}${x.url ? " <" + x.url + ">" : ""}${x.at ? "  (" + ago(x.at) + (x.by ? ", " + x.by : "") + ")" : ""}`)); if (!arr.length) L.push("    -"); };
  sec("NEEDS MAX", p.decisions); sec("BLOCKED", p.blockers); sec("NEXT", p.next); sec("DONE", p.done.slice(-8)); sec("LINKS", p.links);
  if (p.conflicts.length) sec("CONFLICT NOTES", p.conflicts);
  console.log(L.join("\n"));
}

function markdown(b, fetchedAt) {
  const L = [`# ${b.title}: snapshot`, ``, `Generated ${new Date().toLocaleString()} · data fetched ${new Date(fetchedAt).toLocaleString()} · last change ${ago(b.updatedAt)} by ${b.updatedBy}`, ``];
  for (const p of sortedProjects(b)) {
    L.push(`## ${p.revenue === "paid" ? "$ " : ""}${p.name}${p.demo ? " (DEMO DATA)" : ""}`, `${p.client || "no client"} · ${p.revenue} · priority ${p.priority}`, ``, `**Goal:** ${p.goal || "-"}  `, `**Now:** ${p.currentStep || "-"}`, ``, `**Agents**`);
    for (const a of p.agents) { const v = statusView(a.status); L.push(`- ${a.name}: owns ${a.owns || "?"}. ${v.label}${v.detail ? ". " + v.detail : ""}`); }
    for (const [t, arr] of [["Needs your decision", p.decisions], ["Roadblocks", p.blockers], ["Next", p.next], ["Done", p.done], ["Links", p.links]]) {
      L.push(``, `**${t}**`); if (!arr.length) L.push(`- none`); for (const x of arr) L.push(`- ${x.url ? `[${x.text}](${x.url})` : x.text}`);
    }
    L.push(``);
  }
  return L.join("\n");
}

async function main() {
  const { pos, flags } = args(process.argv.slice(2));
  const cmd = pos[0];
  if (!cmd || cmd === "help" || flags.help) return console.log(HELP);
  const cfg = config();
  if (!cfg.repo) throw new Error("No repo configured. Set BOARD_REPO=owner/name or create board.config.json");
  const store = createStore({ token: token(), repo: cfg.repo, path: cfg.path, branch: cfg.branch });

  switch (cmd) {
    case "list": case "show": {
      const { board, fetchedAt } = await store.load();
      if (!board) return console.log("No board yet. Run: board init");
      const b = normalizeBoard(board);
      if (flags.json) return console.log(JSON.stringify(pos[1] ? b.projects[pos[1]] : b, null, 2));
      console.log(`${b.title} · fetched ${new Date(fetchedAt).toLocaleTimeString()} · last change ${ago(b.updatedAt)} by ${b.updatedBy}`);
      const ps = sortedProjects(b).filter((p) => !pos[1] || p.id === pos[1]);
      if (pos[1] && !ps.length) throw new Error(`No project ${pos[1]}`);
      if (cmd === "list") for (const p of ps) console.log(`${p.revenue === "paid" ? "$" : " "} ${p.id.padEnd(22)} P${p.priority} ${p.name}${p.demo ? " (DEMO)" : ""} | now: ${p.currentStep.slice(0, 60)} | ${p.decisions.length} decision(s), ${p.blockers.length} blocker(s)`);
      else ps.forEach(printCard);
      return;
    }
    case "log": {
      const { board } = await store.load();
      return normalizeBoard(board).log.slice(0, Number(pos[1] || 20)).forEach((l) => console.log(`${new Date(l.at).toLocaleString()}  ${l.by.padEnd(8)} ${l.msg}`));
    }
    case "history": {
      for (const c of await store.history(Number(pos[1] || 20))) console.log(`${c.sha.slice(0, 7)}  ${new Date(c.date).toLocaleString()}  ${c.message.split("\n")[0]}`);
      return;
    }
    case "set": return mutate(store, { type: "set", pid: pos[1], field: pos[2], value: pos.slice(3).join(" ") }, who(flags));
    case "add": return mutate(store, { type: "add", pid: pos[1], list: pos[2], text: pos.slice(3).join(" "), url: flags.url }, who(flags));
    case "resolve": return mutate(store, { type: "resolve", pid: pos[1], list: pos[2], item: pos[3], note: flags.note }, who(flags));
    case "agent": return mutate(store, { type: "agent", pid: pos[1], agent: pos[2], owns: flags.owns, state: flags.state, note: flags.note, evidence: flags.evidence, remove: !!flags.remove }, who(flags));
    case "heartbeat": return mutate(store, { type: "agent", pid: pos[1], agent: pos[2], state: "live", evidence: flags.evidence === true ? "" : flags.evidence, note: flags.note }, who(flags));
    case "new": return mutate(store, { type: "newProject", pid: pos[1], fields: { name: flags.name, client: flags.client, revenue: flags.revenue, priority: flags.priority, goal: flags.goal, currentStep: flags.now } }, who(flags));
    case "restore": {
      const by = who(flags);
      const old = await store.load(pos[1]);
      if (!old.board) throw new Error("That commit has no board.json");
      const cur = await store.load();
      const b = normalizeBoard(old.board);
      b.log = [{ id: "l_" + Date.now(), at: new Date().toISOString(), by, msg: `restored version ${pos[1].slice(0, 7)}` }, ...b.log];
      const r = await store.save(b, cur.sha, `[${by}] restore board to ${pos[1].slice(0, 7)}`);
      return console.log(`✓ restored ${pos[1].slice(0, 7)} as new commit ${r.commit.slice(0, 7)} (the previous version stays in history)`);
    }
    case "init": {
      const cur = await store.load();
      if (cur.board) throw new Error("board.json already exists; refusing to overwrite.");
      const b = flags.demo ? JSON.parse(readFileSync(join(ROOT, "seed/demo-board.json"), "utf8")) : emptyBoard();
      const r = await store.save(normalizeBoard(b), null, `[${who(flags)}] create board${flags.demo ? " with demo data" : ""}`);
      return console.log(`✓ board created (commit ${r.commit.slice(0, 7)})`);
    }
    case "export": {
      const { board, fetchedAt } = await store.load();
      const b = normalizeBoard(board);
      const out = resolve(flags.out && flags.out !== true ? flags.out : join(ROOT, "exports"));
      mkdirSync(out, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
      const html = join(out, `ops-board-${stamp}.html`), md = join(out, `ops-board-${stamp}.md`);
      writeFileSync(html, snapshotHtml(b, { source: `github:${cfg.repo}/${cfg.path}`, fetchedAt }));
      writeFileSync(md, markdown(b, fetchedAt));
      console.log(`✓ saved locally: ${html}\n✓ saved locally: ${md}`);
      if (flags.drive) {
        try {
          for (const f of [html, md]) execFileSync("rclone", ["copy", "--retries", "1", f, cfg.driveFolder], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
        } catch (e) {
          const why = /SCOPE_INSUFFICIENT|insufficientPermissions/.test(String(e.stderr)) ? "the rclone Drive remote only has read access (re-authorise it with write scope: rclone config reconnect " + cfg.driveFolder.split(":")[0] + ":)" : String(e.stderr || e.message).split("\n").find((l) => /ERROR/.test(l)) || e.message;
          console.log(`✗ NOT copied to Google Drive: ${why}\n  The snapshot exists only as the local files above.`);
          process.exitCode = 2;
          return;
        }
        // Verify: the remote listing must show both files with matching sizes before we call it synced.
        const listing = JSON.parse(execFileSync("rclone", ["lsjson", cfg.driveFolder], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
        for (const f of [html, md]) {
          const name = f.split("/").pop(), size = readFileSync(f).length;
          const hit = listing.find((x) => x.Name === name && x.Size === size);
          console.log(hit ? `✓ CONFIRMED in Google Drive: ${cfg.driveFolder}/${name} (${size} bytes, modified ${hit.ModTime})` : `✗ NOT confirmed in Drive: ${name}. Treat it as a local save only.`);
        }
      }
      return;
    }
    default: throw new Error(`Unknown command "${cmd}". Run: board help`);
  }
}

main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
