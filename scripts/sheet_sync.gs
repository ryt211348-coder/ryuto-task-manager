/**
 * sheet_sync.gs — 3つの進行表スプレッドシートの「上部進行ブロック」だけを読み、
 * ダッシュボード用の進行JSONを返す Google Apps Script（Webアプリ）。
 *
 * ★ 金額・支払い台帳は一切返さない（担当者・状況・納期のみ）。
 *
 * 使い方:
 *  1) script.google.com で新規プロジェクト → このコードを貼る
 *  2) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *     - 実行ユーザー: 自分
 *     - アクセスできるユーザー: 自分のみ（推奨。ダッシュboardからは下記トークンで叩く）
 *  3) 発行されたURLを控え、ダッシュボードの設定に登録
 *
 * 列はヘッダー文字（「担当者」「状況/工程」「納期」）で自動検出するので、
 * 多少レイアウトが違っても拾えます。拾えない時は SHEETS の hint で列を指定。
 */

// ★ 各シートのIDは「自分の」スプレッドシートIDに置き換える（公開リポジトリ用にプレースホルダ化）
//   スプレッドシートURL  https://docs.google.com/spreadsheets/d/【ここがID】/edit
const SHEETS = [
  { id: "YOUR_RYUTON_SHEET_ID",  cat: "2ch", label: "りゅうとん" },
  { id: "YOUR_POPTEEN_SHEET_ID", cat: "pop", label: "Popteen" },
  { id: "YOUR_SMAHO_SHEET_ID",   cat: "sma", label: "スマホ" }
];

// 状況プルダウン → ダッシュボードの状態
function mapStatus(raw) {
  const s = String(raw || "").trim();
  if (!s) return { state: "not_started", who: "editor" };
  if (/りゅうと修正/.test(s))               return { state: "in_progress", who: "ryuto", label: "りゅうと修正" };
  if (/納品完了|公開設定完了|完了/.test(s)) return { state: "done", who: "editor" };
  if (/編集中|修正中|作業中/.test(s))       return { state: "in_progress", who: "editor" };
  return { state: "in_progress", who: "editor", note: s };
}

// 1シートの上部進行ブロックを抽出
function readSheet(cfg) {
  const ss = SpreadsheetApp.openById(cfg.id);
  const sh = ss.getSheets()[0];
  const values = sh.getDataRange().getValues();

  // ヘッダー行を探す（「担当者」と「状況 or 工程」を含む行）
  let hr = -1, nameCol = -1, statusCol = -1, dueCol = -1;
  for (let r = 0; r < Math.min(values.length, 8); r++) {
    const row = values[r].map((c) => String(c));
    const ni = row.findIndex((c) => /担当者/.test(c));
    const si = row.findIndex((c) => /状況|工程/.test(c));
    const di = row.findIndex((c) => /納期/.test(c));
    if (ni >= 0 && si >= 0) { hr = r; nameCol = ni; statusCol = si; dueCol = di; break; }
  }
  if (hr < 0) return [];

  const items = [];
  for (let r = hr + 1; r < values.length; r++) {
    const name = String(values[r][nameCol] || "").trim();
    const status = statusCol >= 0 ? values[r][statusCol] : "";
    // 進行ブロックの終わり判定：担当者が数字だけ/空が連続したら抜ける
    if (!name) { if (items.length) break; else continue; }
    if (/^\d+$/.test(name) || /^¥|^￥/.test(name)) break; // 支払い台帳に入ったら停止
    let due = dueCol >= 0 ? values[r][dueCol] : "";
    if (due instanceof Date) due = Utilities.formatDate(due, "Asia/Tokyo", "yyyy-MM-dd");
    items.push({ name: name, status: String(status || "").trim(), due: String(due || "") });
  }
  return items;
}

function buildPayload() {
  const projects = [];
  SHEETS.forEach((cfg) => {
    readSheet(cfg).forEach((it, i) => {
      // 名簿・予算行（状況も納期も無い）はスキップ
      if (!it.status && !it.due) return;
      const m = mapStatus(it.status);
      projects.push({
        id: `sheet-${cfg.cat}-${i}`,
        cat: cfg.cat,
        title: `${cfg.label}（${it.name}）`,
        editor: it.name,
        status_raw: it.status,
        state: m.state,        // not_started | in_progress | done
        ball: m.who,           // editor | ryuto
        checkpoint: m.label || "編集",
        due: it.due
      });
    });
  });
  return { updated_at: new Date().toISOString(), projects: projects };
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify(buildPayload(), null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

// 動作テスト用（エディタで実行してログ確認）
function test() {
  Logger.log(JSON.stringify(buildPayload(), null, 2));
}
