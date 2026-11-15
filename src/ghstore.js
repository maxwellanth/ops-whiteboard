// GitHub file store: reads and writes one JSON file in a private repo through the
// contents API, using the file's blob SHA as an optimistic lock. Shared by the app and the CLI.

const enc = new TextEncoder();
const dec = new TextDecoder();
function b64encode(str) {
  const bytes = enc.encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

export class ConflictError extends Error {
  constructor() { super("The board changed since it was loaded (version conflict)"); this.code = "CONFLICT"; }
}
export class AuthError extends Error {
  constructor(status, msg) { super(msg); this.code = "AUTH"; this.status = status; }
}

export function createStore({ apiBase = "https://api.github.com", token = "", repo, path = "board.json", branch = "main" }) {
  const headers = (extra = {}) => ({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  async function gh(url, opts = {}) {
    const res = await fetch(apiBase + url, { cache: "no-store", ...opts, headers: headers(opts.headers) });
    if (res.status === 401 || res.status === 403) throw new AuthError(res.status, `GitHub refused access (${res.status}). The token may be missing, expired or not allowed on ${repo}.`);
    return res;
  }
  const enc_path = path.split("/").map(encodeURIComponent).join("/");

  return {
    repo, path, branch,
    /** Returns { board, sha, fetchedAt }. If the file does not exist, board is null. */
    async load(ref = branch) {
      const res = await gh(`/repos/${repo}/contents/${enc_path}?ref=${encodeURIComponent(ref)}`);
      if (res.status === 404) return { board: null, sha: null, fetchedAt: new Date().toISOString() };
      if (!res.ok) throw new Error(`GitHub load failed: ${res.status} ${await res.text()}`);
      const meta = await res.json();
      let text;
      if (meta.encoding === "base64" && meta.content) text = b64decode(meta.content);
      else {
        // Files over 1 MB come back without content, so fetch the blob instead (works up to 100 MB).
        const bl = await gh(`/repos/${repo}/git/blobs/${meta.sha}`);
        if (!bl.ok) throw new Error(`GitHub blob load failed: ${bl.status}`);
        text = b64decode((await bl.json()).content);
      }
      return { board: JSON.parse(text), sha: meta.sha, fetchedAt: new Date().toISOString() };
    },
    /** Saves the board. Throws ConflictError if the file changed since `sha`. Returns { sha, commit }. */
    async save(board, sha, message) {
      const body = { message, content: b64encode(JSON.stringify(board, null, 1) + "\n"), branch };
      if (sha) body.sha = sha;
      const res = await gh(`/repos/${repo}/contents/${enc_path}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.status === 409 || (res.status === 422 && !sha)) throw new ConflictError();
      if (res.status === 422) {
        const t = await res.text();
        if (/sha/i.test(t)) throw new ConflictError();
        throw new Error("GitHub save failed: 422 " + t);
      }
      if (!res.ok) throw new Error(`GitHub save failed: ${res.status} ${await res.text()}`);
      const j = await res.json();
      return { sha: j.content.sha, commit: j.commit.sha, committedAt: j.commit.committer?.date };
    },
    async history(limit = 20) {
      const res = await gh(`/repos/${repo}/commits?path=${enc_path}&sha=${encodeURIComponent(branch)}&per_page=${limit}`);
      if (!res.ok) throw new Error(`GitHub history failed: ${res.status}`);
      return (await res.json()).map((c) => ({ sha: c.sha, message: c.commit.message, date: c.commit.committer.date }));
    },
  };
}
