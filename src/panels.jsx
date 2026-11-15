import { useEffect, useState } from "react";
import { statusView, ago } from "./model.js";

function Sheet({ title, onClose, children }) {
  return (
    <aside className="sheet" role="dialog" aria-label={title}>
      <div className="sheet-head"><h2>{title}</h2><button className="x" onClick={onClose} aria-label="Close">✕</button></div>
      <div className="sheet-body">{children}</div>
    </aside>
  );
}

function AddRow({ onAdd }) {
  const [list, setList] = useState("next");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  return (
    <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (onAdd(list, text.trim(), url.trim() || undefined)) { setText(""); setUrl(""); } }}>
      <select value={list} onChange={(e) => setList(e.target.value)}>
        <option value="next">Next action</option><option value="done">Done</option><option value="blocker">Roadblock</option><option value="decision">Decision for me</option><option value="link">Link to work</option>
      </select>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="What?" required />
      {list === "link" && <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" type="url" required />}
      <button type="submit">Add</button>
    </form>
  );
}

function Items({ title, items, cls, onResolve, resolveLabel, prompt: ask }) {
  return (
    <section className={"items " + (cls || "")}>
      <h3>{title} <small>({items.length})</small></h3>
      {!items.length && <p className="none">none</p>}
      <ul>{items.map((it, i) => (
        <li key={it.id}>
          <span>{it.url ? <a href={it.url} target="_blank" rel="noreferrer">{it.text}</a> : it.text}{it.at && <small> · {ago(it.at)}{it.by ? " · " + it.by : ""}</small>}</span>
          {onResolve && <button className="mini" onClick={() => { const note = ask ? window.prompt(ask, "") : undefined; if (ask && note === null) return; onResolve(i + 1, note || undefined); }}>{resolveLabel}</button>}
        </li>))}</ul>
    </section>
  );
}

function AgentRow({ a, pid, doOp }) {
  const [edit, setEdit] = useState(false);
  const [owns, setOwns] = useState(a.owns || "");
  const [state, setState] = useState(a.status?.state === "live" ? "reported" : a.status?.state || "unknown");
  const [note, setNote] = useState(a.status?.note || "");
  const v = statusView(a.status);
  return (
    <li className="agent">
      <div><b>{a.name}</b> owns <i>{a.owns || "?"}</i></div>
      <div className={"st " + v.tone}>{v.label}</div>{v.detail && <div className="fine">{v.detail}</div>}
      {!edit ? <button className="mini" onClick={() => setEdit(true)}>Edit</button> : (
        <form className="agent-edit" onSubmit={(e) => { e.preventDefault(); if (doOp({ type: "agent", pid, agent: a.id, owns, state, note })) setEdit(false); }}>
          <label>Owns <input value={owns} onChange={(e) => setOwns(e.target.value)} /></label>
          <label>Status <select value={state} onChange={(e) => setState(e.target.value)}><option value="reported">reported (by you, now)</option><option value="unknown">unknown</option></select></label>
          <label>Note <input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <p className="fine">LIVE can only be set by an agent's heartbeat with evidence. It expires after 10 minutes.</p>
          <button type="submit">Save</button> <button type="button" onClick={() => setEdit(false)}>Cancel</button>{" "}
          <button type="button" className="danger" onClick={() => confirm(`Remove ${a.name} from this project?`) && doOp({ type: "agent", pid, agent: a.id, remove: true })}>Remove</button>
        </form>)}
    </li>
  );
}

export function ProjectPanel({ p, all, doOp, onClose, onFocus }) {
  // Fields you are typing in are kept even if an assistant updates the card meanwhile.
  const [draft, setDraft] = useState({});
  useEffect(() => setDraft({}), [p.id]);
  const f = { ...p, ...draft };
  const setF = (next) => setDraft((d) => { const out = { ...d }; for (const k of fields) if (next[k] !== f[k]) out[k] = next[k]; return out; });
  const fields = ["name", "client", "revenue", "priority", "goal", "currentStep"];
  const changed = fields.filter((k) => k in draft && String(draft[k] ?? "") !== String(p[k] ?? ""));
  const [newAgent, setNewAgent] = useState("");
  return (
    <Sheet title={(p.revenue === "paid" ? "$ " : "") + p.name} onClose={onClose}>
      {p.demo && <p className="demo-note">DEMO DATA: this card is fictional sample content. Delete it or replace it with a real project.</p>}
      <p className="fine">Updated {ago(p.updatedAt)} by {p.updatedBy}. <button className="link" onClick={onFocus}>Zoom to card</button></p>
      {p.conflicts.length > 0 && (
        <section className="items conflict"><h3>Conflicting edits kept for review</h3><ul>{p.conflicts.map((c) => <li key={c.id}>{c.text} <small>{ago(c.at)}</small></li>)}</ul>
          <button className="mini" onClick={() => doOp({ type: "clearConflicts", pid: p.id })}>I've reviewed these</button></section>)}
      <form className="fields" onSubmit={(e) => { e.preventDefault(); for (const k of changed) doOp({ type: "set", pid: p.id, field: k, value: f[k] }); setDraft({}); }}>
        <label>Name <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Client <input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></label>
        <div className="row">
          <label>Type <select value={f.revenue} onChange={(e) => setF({ ...f, revenue: e.target.value })}><option value="paid">$ Paid client</option><option value="pipeline">Pipeline / sales</option><option value="internal">Internal / other</option></select></label>
          <label>Priority <select value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>P{n}</option>)}</select></label>
        </div>
        <label>Goal <textarea rows={2} value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} /></label>
        <label>Current step <textarea rows={2} value={f.currentStep} onChange={(e) => setF({ ...f, currentStep: e.target.value })} /></label>
        <button type="submit" disabled={!changed.length}>{changed.length ? `Save ${changed.length} change(s)` : "No changes"}</button>
      </form>

      <Items title="Needs your decision" cls="dec" items={p.decisions} resolveLabel="Decide" prompt="Your decision (recorded under Done):" onResolve={(n, note) => doOp({ type: "resolve", pid: p.id, list: "decision", item: n, note })} />
      <Items title="Roadblocks" cls="blk" items={p.blockers} resolveLabel="Cleared" onResolve={(n) => doOp({ type: "resolve", pid: p.id, list: "blocker", item: n })} />
      <Items title="Next actions" items={p.next} resolveLabel="✓ Done" onResolve={(n) => doOp({ type: "resolve", pid: p.id, list: "next", item: n })} />
      <section className="items"><h3>Who owns what</h3>
        <ul>{p.agents.map((a) => <AgentRow key={a.id} a={a} pid={p.id} doOp={doOp} />)}</ul>
        <form className="addrow" onSubmit={(e) => { e.preventDefault(); if (newAgent.trim() && doOp({ type: "agent", pid: p.id, agent: newAgent.trim(), state: "unknown", owns: "" })) setNewAgent(""); }}>
          <input value={newAgent} onChange={(e) => setNewAgent(e.target.value)} placeholder="Assign an agent (Claude, Codex, a person…)" /><button type="submit">Assign</button>
        </form></section>
      <Items title="Done" items={[...p.done].reverse()} />
      <Items title="Links to the actual work" items={p.links} resolveLabel="Remove" onResolve={(n) => doOp({ type: "resolve", pid: p.id, list: "link", item: n })} />
      <h3>Add to this card</h3>
      <AddRow onAdd={(list, text, url) => doOp({ type: "add", pid: p.id, list, text, url })} />
      <label className="related">Related projects (dashed lines):
        <select multiple value={p.related} onChange={(e) => doOp({ type: "set", pid: p.id, field: "related", value: [...e.target.selectedOptions].map((o) => o.value) })}>
          {Object.values(all).filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select></label>
      <p><button className="danger" onClick={() => confirm(`Delete project "${p.name}"? It stays recoverable from History.`) && (doOp({ type: "deleteProject", pid: p.id }), onClose())}>Delete project</button></p>
    </Sheet>
  );
}

export function HistoryPanel({ store, log, onRestore, onClose }) {
  const [commits, setCommits] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { store.history(30).then(setCommits).catch((e) => setErr(e.message)); }, [store]);
  return (
    <Sheet title="History" onClose={onClose}>
      <p className="fine">Every save is a git commit in the private repo. Restoring copies an old version back as a <b>new</b> version, so nothing is erased.</p>
      <h3>Saved versions</h3>
      {err && <p className="error">{err}</p>}
      {!commits && !err && <p>Loading…</p>}
      <ul className="history">{commits?.map((c, i) => (
        <li key={c.sha}><code>{c.sha.slice(0, 7)}</code> {new Date(c.date).toLocaleString()}<br /><span>{c.message.split("\n")[0]}</span>
          {i > 0 && <button className="mini" onClick={() => confirm(`Restore the board to ${c.sha.slice(0, 7)}? Your current version stays in history.`) && onRestore(c.sha)}>Restore</button>}</li>))}</ul>
      <h3>Activity log</h3>
      <ul className="history">{log.slice(0, 40).map((l) => <li key={l.id}><small>{new Date(l.at).toLocaleString()}</small> <b>{l.by}</b>: {l.msg}</li>)}</ul>
    </Sheet>
  );
}

export function SettingsPanel({ conn, onClose, onForget }) {
  return (
    <Sheet title="Connection & privacy" onClose={onClose}>
      <p><b>Data:</b> <code>{conn.repo}</code> / board.json (private GitHub repo).</p>
      {conn.mode === "mac" ? <p><b>This device:</b> Mac mode. A local proxy on 127.0.0.1 uses the Mac's GitHub login, and no token is stored in this browser.</p>
        : <><p><b>This device:</b> uses a fine-grained GitHub token stored only in this browser. GitHub checks it on every read and write. Without it, this page shows no data.</p>
          <button className="danger" onClick={() => confirm("Remove the token from this device? You'll need to paste it again.") && onForget()}>Forget token on this device</button></>}
      <h3>What the status words mean</h3>
      <ul><li><span className="st live">LIVE</span> an agent sent evidence it is working within the last 10 minutes.</li>
        <li><span className="st reported">last reported</span> what someone said, with the time. It is not re-checked.</li>
        <li><span className="st stale">was live, now unverified</span> the evidence is older than 10 minutes.</li>
        <li><span className="st unknown">unknown</span> nobody has reported.</li></ul>
      <h3>Saving</h3>
      <p>The pill at the top says <b>Saved in GitHub</b> only after GitHub accepted the commit. <b>Unsynced</b> means the change is saved on this device only and will upload when online.</p>
    </Sheet>
  );
}

export function SetupScreen({ repo: initialRepo, templateUrl, onSave }) {
  const [repo, setRepo] = useState(initialRepo || "");
  const [token, setToken] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const owner = repo.split("/")[0];
  return (
    <div className="setup">
      <h1>Ops Whiteboard</h1>
      <p>This board is private. Its data lives in a private GitHub repository, and GitHub decides who can read it. Connect this device once:</p>
      <ol>
        <li><a href={templateUrl(owner)} target="_blank" rel="noreferrer">Create a fine-grained GitHub token</a>. On that page, choose <b>Only select repositories → {repo.split("/")[1] || "ops-board-data"}</b>. Leave <b>Contents: Read and write</b> as the only repository permission.</li>
        <li>Paste the token below. It stays in this browser on this device only.</li>
        <li>Then add this page to your Home Screen: Share → Add to Home Screen.</li>
      </ol>
      <form onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(await onSave(repo, token)); setBusy(false); }}>
        <label>Repository <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/ops-board-data" required autoCapitalize="none" autoCorrect="off" /></label>
        <label>Token <input value={token} onChange={(e) => setToken(e.target.value)} type="password" placeholder="github_pat_…" required autoComplete="off" /></label>
        <button type="submit" disabled={busy}>{busy ? "Checking with GitHub…" : "Connect"}</button>
        {err && <p className="error">{err}</p>}
      </form>
    </div>
  );
}
