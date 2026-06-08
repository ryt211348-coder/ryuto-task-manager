// data.js — tasks.json の読み込み・保存
// 優先順: localStorage の作業コピー → なければ同梱 tasks.json を fetch
// 保存: 常に localStorage。GitHub 設定があれば API でコミット（SHA取得→PUT→409リトライ）

const LS_KEY = "ryuto_tasks_v3";
const LS_GH = "ryuto_gh_config"; // { owner, repo, path, branch, token }

export function loadGhConfig() {
  try { return JSON.parse(localStorage.getItem(LS_GH) || "null"); } catch { return null; }
}
export function saveGhConfig(cfg) {
  localStorage.setItem(LS_GH, JSON.stringify(cfg));
}

export async function loadData() {
  // 同梱 tasks.json は config の最新値（コード管理）として常に参照を試みる
  let bundled = null;
  try {
    const res = await fetch("tasks.json", { cache: "no-store" });
    if (res.ok) bundled = await res.json();
  } catch { /* オフライン時はスキップ */ }

  const local = localStorage.getItem(LS_KEY);
  if (local) {
    try {
      const data = JSON.parse(local);
      if (bundled?.config) data.config = bundled.config; // config は常に最新で上書き
      return data;
    } catch { /* fallthrough */ }
  }
  if (!bundled) throw new Error("tasks.json 読み込み失敗");
  localStorage.setItem(LS_KEY, JSON.stringify(bundled));
  return bundled;
}

// ローカル保存（即時・オフライン）
export function saveLocal(data) {
  data.updated_at = new Date().toISOString();
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// GitHub にコミット（任意）。409 は最新SHA再取得で最大3回リトライ
export async function pushToGithub(data) {
  const cfg = loadGhConfig();
  if (!cfg || !cfg.token) throw new Error("GitHub 未設定（設定からPATを登録してください）");
  const { owner, repo, token } = cfg;
  const path = cfg.path || "docs/tasks.json";
  const branch = cfg.branch || "main";
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + "\n")));

  for (let attempt = 0; attempt < 3; attempt++) {
    // 最新SHA取得
    let sha;
    const cur = await fetch(`${api}?ref=${branch}`, { headers });
    if (cur.ok) sha = (await cur.json()).sha;
    else if (cur.status !== 404) throw new Error("SHA取得失敗: " + cur.status);

    const put = await fetch(api, {
      method: "PUT",
      headers,
      body: JSON.stringify({ message: `update tasks ${new Date().toISOString()}`, content, sha, branch }),
    });
    if (put.ok) return await put.json();
    if (put.status === 409) continue; // 競合 → SHA再取得
    throw new Error("コミット失敗: " + put.status + " " + (await put.text()));
  }
  throw new Error("コミット競合が解消できませんでした（3回リトライ）");
}

// 保存：ローカル即時 + GitHub設定があれば push（失敗してもローカルは保持）
export async function save(data) {
  saveLocal(data);
  if (loadGhConfig()?.token) {
    try { await pushToGithub(data); return { synced: true }; }
    catch (e) { return { synced: false, error: e.message }; }
  }
  return { synced: false };
}

export function resetLocal() {
  localStorage.removeItem(LS_KEY);
}

// ---- スプレッドシート進行（GAS Webアプリ）----
const LS_SHEET = "ryuto_sheet_url";
export function loadSheetUrl() { return localStorage.getItem(LS_SHEET) || ""; }
export function saveSheetUrl(u) { localStorage.setItem(LS_SHEET, u || ""); }

export async function fetchSheetProgress(url) {
  if (!url) return null;
  // GAS WebアプリのブラウザfetchはCORSが不安定なので最大4回リトライ
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url, { redirect: "follow", cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { throw new Error("JSONでない応答（アクセス権が「全員」か確認）"); }
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  throw new Error("シート取得失敗: " + (lastErr?.message || "不明"));
}
