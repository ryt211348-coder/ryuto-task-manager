// app.js — カレンダー＋時間割レイアウト。データは tasks.json（projects/capacity/events/sheet同期）。
import { loadData, save, saveLocal, loadGhConfig, saveGhConfig, resetLocal,
         loadSheetUrl, saveSheetUrl, fetchSheetProgress } from "./data.js";
import { ballHolder } from "./metrics.js";
import { computeCapacity, computeOutput, round1 } from "./capacity.js";

let data = null;
let curYear, curMonth, selectedDate;
const $ = (s) => document.querySelector(s);
const now = () => new Date();

// ---- helpers ----
const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const fmtDisp = (ds) => { const d=new Date(ds+"T00:00:00"); return `${d.getMonth()+1}月${d.getDate()}日（${"日月火水木金土"[d.getDay()]}）`; };
const blockKey = (ds,label,t) => `${ds}__${label}__${t}`;
const timeToMin = (t) => { const [h,m]=t.split(":").map(Number); return h*60+(m||0); };
const startOfToday = () => { const d=now(); d.setHours(0,0,0,0); return d; };
const TBCLS = { "2ch":"tb-2ch", pop:"tb-pop", sma:"tb-sma", mtg:"tb-mtg", ops:"tb-ops" };
const CATBG = { "2ch":"#FEF0EC", pop:"#FDF0F6", sma:"#EDFAF4", mtg:"#F0EFFE", ops:"#F4F3F1" };
const CATFILL = { "2ch":"#F3B49E", pop:"#F0AEC6", sma:"#86D8BC", mtg:"#BFBAF2", ops:"#CFCDC2" };
const fillBg = (cat, prog) => `linear-gradient(90deg, ${CATFILL[cat]||CATFILL.ops} ${prog}%, ${CATBG[cat]||CATBG.ops} ${prog}%)`;
const GOAL_SHEET_URL = "https://docs.google.com/spreadsheets/d/16wE7P2V6o4NFx7BrlZVsfDHk3naRguBWszd3_uo1aXM/edit?gid=472092447#gid=472092447";
const EVCLS = { "2ch":"ev-2ch", pop:"ev-pop", sma:"ev-sma", mtg:"ev-mtg", ops:"ev-ops" };
const esc = (s) => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// 調整パネルの値を config に上書き適用（絶対値なので冪等）
function applyAdj(config, adj) {
  if (!adj) return config;
  const c = JSON.parse(JSON.stringify(config));
  const B = c.capacity && c.capacity.businesses; if (!B) return c;
  if (adj.ryuton_weekly != null) B["2ch"].weekly_target = adj.ryuton_weekly;
  if (adj.script_h != null) { const ph=(B["2ch"].phases||[]).find((p)=>p.key==="script"); if(ph) ph.h_per_unit=adj.script_h; }
  if (adj.sma_weekly != null) B.sma.weekly_target = adj.sma_weekly;
  if (adj.pop_monthly != null) B.pop.monthly_target = adj.pop_monthly;
  if (adj.smaDays != null) { c.schedule = c.schedule || {}; c.schedule.smaDays = adj.smaDays; }
  return c;
}

// ---- 平日テンプレート（りゅうとん集中日／スマホ集中日）----
function ryutonWeekday() {
  return [
    {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:"CW / Discord / SLACK 確認・返信"},
    {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 企画・台本①",detail:"集中2h"},
    {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 企画・台本②",detail:"集中2h"},
    {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
    {t:"13:00",end:"15:00",cat:"2ch",label:"りゅうとん 企画・台本③",detail:"集中2h"},
    {t:"15:00",end:"17:00",cat:"2ch",label:"りゅうとん 編集FB",detail:"全本チェック・修正指示"},
    {t:"17:00",end:"18:30",cat:"pop",label:"Popteen 確認・FB",detail:"素材確認・修正指示"},
    {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"未完・突発対応",buf:true},
  ];
}
// スマホ日＝午前にりゅうとん台本（1日分ストック）→ 午後スマホ（企画・台本・FB）
function smaWeekday() {
  return [
    {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:"CW / Discord / SLACK"},
    {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 台本（ストック）",detail:"まず1日分"},
    {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 台本（ストック）",detail:""},
    {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
    {t:"13:00",end:"15:00",cat:"sma",label:"スマホ 企画・台本",detail:"由美子 週1本"},
    {t:"15:00",end:"17:00",cat:"pop",label:"Popteen 確認・FB・修正",detail:"素材確認・修正指示"},
    {t:"17:00",end:"18:30",cat:"sma",label:"スマホ 編集FB",detail:""},
    {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"未完・突発対応",buf:true},
  ];
}
// 火曜は智哉さんMTGを14:00に固定で差し込む（どの曜日割でも）
function injectTuesdayMtg(day, dow) {
  if (dow !== 2) return day;
  const out = [];
  day.forEach((b)=>{
    const s=timeToMin(b.t), e=timeToMin(b.end);
    if (s<840 && e>=900 && !b.lunch && !b.buf) {
      out.push({...b, end:"14:00"});
      out.push({t:"14:00",end:"15:00",cat:"mtg",label:"智哉さん週次MTG",detail:"毎週固定"});
      if (e>900) out.push({...b, t:"15:00"});
    } else out.push(b);
  });
  return out;
}

// ---- 週次ベーススケジュール 7:00-20:00 ----
function baseSchedule(dow) {
  const S = {
    1:[ {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:"CW / Discord / SLACK 確認・返信"},
        {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 企画・台本①",detail:"集中2h"},
        {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 企画・台本②",detail:"集中2h"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"2ch",label:"りゅうとん 企画・台本③",detail:"集中2h"},
        {t:"15:00",end:"17:00",cat:"2ch",label:"りゅうとん 編集FB",detail:"全本チェック・修正指示"},
        {t:"17:00",end:"18:30",cat:"pop",label:"Popteen 確認・FB",detail:"素材確認・修正指示"},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"未完・突発対応",buf:true} ],
    2:[ {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:"CW / Discord / SLACK"},
        {t:"8:00",end:"10:00",cat:"sma",label:"スマホ① 企画・撮影チェック",detail:"由美子 1本目（週2本）"},
        {t:"10:00",end:"12:00",cat:"sma",label:"スマホ① 台本・サムネ",detail:""},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"14:00",cat:"sma",label:"スマホ① 台本・サムネ続き",detail:""},
        {t:"14:00",end:"15:00",cat:"mtg",label:"智哉さん週次MTG",detail:"毎週固定"},
        {t:"15:00",end:"17:00",cat:"sma",label:"スマホ① 台本・サムネ仕上げ",detail:""},
        {t:"17:00",end:"18:30",cat:"2ch",label:"りゅうとん 台本（巻き取り）",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"未完・突発対応",buf:true} ],
    3:[ {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:""},
        {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 企画・台本①",detail:"集中2h"},
        {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 企画・台本②",detail:"集中2h"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"2ch",label:"りゅうとん 企画・台本③",detail:"集中2h"},
        {t:"15:00",end:"17:00",cat:"2ch",label:"りゅうとん 編集FB",detail:""},
        {t:"17:00",end:"18:30",cat:"pop",label:"Popteen 確認・FB",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"",buf:true} ],
    4:[ {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:""},
        {t:"8:00",end:"10:00",cat:"sma",label:"スマホ② 企画・撮影チェック",detail:"由美子 2本目（週2本）"},
        {t:"10:00",end:"12:00",cat:"sma",label:"スマホ② 台本・サムネ",detail:""},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"sma",label:"スマホ② 台本・サムネ",detail:""},
        {t:"15:00",end:"17:00",cat:"sma",label:"スマホ② 台本・サムネ仕上げ",detail:""},
        {t:"17:00",end:"18:30",cat:"2ch",label:"りゅうとん 編集FB",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"",buf:true} ],
    5:[ {t:"7:00",end:"8:00",cat:"ops",label:"ミーティング準備",detail:"週次整理"},
        {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 来週仕込み①",detail:"集中2h"},
        {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 来週仕込み②",detail:"集中2h"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"2ch",label:"りゅうとん 台本③ ＋ 編集FB",detail:""},
        {t:"15:00",end:"17:00",cat:"2ch",label:"りゅうとん 編集FB 仕上げ",detail:""},
        {t:"17:00",end:"18:30",cat:"pop",label:"Popteen 週末前 確認・FB",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"",buf:true} ],
    6:[ {t:"7:00",end:"12:00",cat:"2ch",label:"りゅうとん 作業（午前）",detail:"遅れ分キャッチアップ"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"20:00",cat:"2ch",label:"りゅうとん 作業・バッファ",detail:"間に合わない分を進める",buf:true} ],
    0:[ {t:"7:00",end:"12:00",cat:"2ch",label:"りゅうとん 作業（午前）",detail:"台本ストック"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"20:00",cat:"2ch",label:"りゅうとん 作業（午後）",detail:"ストック積み増し・遅れ分"} ],
  };
  let day;
  if (dow===6 || dow===0) day = S[dow] || [];
  else {
    const isSma = (data.config.schedule?.smaDays || [2,4]).includes(dow);
    day = injectTuesdayMtg(isSma ? smaWeekday() : ryutonWeekday(), dow);
  }
  // 全日共通: 6:00〜7:00 早朝予備 ＋ 20:00〜24:00 夜バッファ（20時以降も予定/対応を入れられる）
  const early = {t:"6:00",end:"7:00",cat:"ops",label:"早朝（予備）",detail:"早く始めるならここに",buf:true};
  const night = {t:"20:00",end:"24:00",cat:"ops",label:"夜バッファ（20時以降の追加対応OK）",detail:"スポットや未完をここに",buf:true};
  return [early, ...day, night];
}

// ---- 案件の状態分類（self / chase / wait）----
function classifyProj(p) {
  const ball = ballHolder(p);
  if (!ball) return null;
  const isRyuto = ball.member_id === "ryuto";
  const due = p.due_at ? new Date(p.due_at) : null;
  const st = startOfToday();
  const overdue = due && due < st;
  const soon = due && (due - st) / 86400000 <= 2;
  const behind = overdue || (p.cat === "pop" && soon);
  const type = isRyuto ? "self" : (behind ? "chase" : "wait");
  return { type, ball, overdue, member: data.members.find((m) => m.id === ball.member_id) };
}
const dueDate = (p) => p.due_at ? fmt(new Date(p.due_at)) : null;

// ════ レンダリング ════
function renderAll() { renderCapStrip(); renderAlerts(); renderCalendar(); renderDay(selectedDate); renderTaskList(); }

// 曜日別の既定本数目標（スマホ日はスマホ1本＋りゅうとん巻き取り1、他はりゅうとん集中）
function quotaDefault(dow) {
  const smaSet = new Set(data.config.schedule?.smaDays || [2,4]);
  if (dow===0) return { "2ch":3, "sma":0 };           // 日曜午後もりゅうとん
  if (dow===6) return { "2ch":3, "sma":0 };
  if (smaSet.has(dow)) return { "2ch":3, "sma":1 };   // 混合日: 午前りゅうとん3＋午後スマホ1
  return { "2ch":4, "sma":0 };
}
function todayTargets(ds = fmt(now())) {
  const dow = new Date(ds+"T00:00:00").getDay();
  const def = quotaDefault(dow); const ov = (data.quota_target||{})[ds] || {};
  return { "2ch": ov["2ch"] ?? def["2ch"], "sma": ov["sma"] ?? def["sma"] };
}
// 完了した作業ブロック数で本数をカウント（チェックで自動増減）
function quotaDone(ds) {
  const blocks = dayBlocks(ds);
  const cnt = { "2ch":0, "sma":0 };
  blocks.forEach((b)=>{
    if (b.lunch || b.buf || b.cat==="mtg") return;
    if (b.cat!=="2ch" && b.cat!=="sma") return;
    if ((data.done||{})[blockKey(ds,b.label,b.t)]) cnt[b.cat]++;
  });
  return cnt;
}
const QUOTA_MSGS = ["ノルマ いこう💪","1本目ナイス🔥","2本目、乗ってきた⚡","3本目！手が止まらない🙌","絶好調😤","量産モード🚀"];
// 日付の横に出すノルマ（チェック数/目標）＋応援
function renderDayMeta(ds) {
  const isToday = ds===fmt(now());
  const tgt = todayTargets(ds), done = quotaDone(ds);
  const LBL = { "2ch":"りゅうとん", "sma":"スマホ" }, COL = { "2ch":"var(--c2ch)", "sma":"var(--csma)" };
  const parts = [];
  if (isToday) parts.push(`<span style="color:var(--text3)">今日</span>`);
  ["2ch","sma"].forEach((cat)=>{
    const t=tgt[cat]||0, n=done[cat]||0; if (t<=0 && n<=0) return;
    const mark = n>=t&&t>0 ? (n>t?" 🔥":" ✓") : "";
    parts.push(`<span data-tgt="${cat}" title="クリックで目標本数を変更" style="color:${COL[cat]};font-weight:700;cursor:pointer">${LBL[cat]} ${n}/${t}${mark}</span>`);
  });
  const totalA=(done["2ch"]||0)+(done["sma"]||0), totalT=(tgt["2ch"]||0)+(tgt["sma"]||0);
  let praise = QUOTA_MSGS[Math.min(totalA, QUOTA_MSGS.length-1)];
  if (totalT>0 && totalA>=totalT) praise = "🎉 ノルマ達成！えらい！";
  if (totalT>0 && totalA>totalT) praise = `🔥 +${totalA-totalT}本 最高！`;
  parts.push(`<span style="color:var(--cmtg);font-weight:700">${praise}</span>`);
  $("#day-meta").innerHTML = parts.join(" ・ ");
}

function renderCapStrip() {
  const c = computeCapacity(data.config, now(), data.events || []);
  if (!c) { $("#cap-strip").innerHTML = ""; return; }
  const over = c.balance < 0;
  $("#cap-strip").innerHTML = `
    <div class="cap-box"><b style="color:${over?'var(--danger)':'var(--ok)'}">${round1(c.demand)}h</b><small>必要/週</small></div>
    <span class="cap-sep">vs</span>
    <div class="cap-box"><b>${round1(c.available)}h</b><small>使える/週</small></div>
    <span class="cap-bal ${over?'ng':'ok'}">${over?`⚠${round1(-c.balance)}h超過`:`✓${round1(c.balance)}h余裕`}</span>
    <span class="cap-pill ${c.sundayWork?'pill-ok':c.sundayCanRest?'pill-ok':'pill-ng'}">${c.sundayWork?'日曜午後もりゅうとん':c.sundayCanRest?'日曜午後 休める':'日曜午後 要稼働'}</span>
    <span style="margin-left:auto;font-size:11px;color:var(--text3)">ノルマは右の日付の横に表示 →</span>`;
}

function renderAlerts() {
  const bar = $("#alert-bar"); bar.innerHTML = "";
  const st = startOfToday();
  (data.projects || []).forEach((p) => {
    if (p.status !== "active" || !p.due_at) return;
    const diff = Math.round((new Date(p.due_at) - st) / 86400000);
    const c = classifyProj(p);
    if (diff < 0 && c && c.type !== "wait") {
      bar.insertAdjacentHTML("beforeend", `<div class="alert-item alert-danger">⚠️ <strong>${esc(p.title)}</strong> 締切 ${Math.abs(diff)}日超過${c.type==="chase"?` → ${esc(c.member?.name||"")}に確認`:""}</div>`);
    } else if (diff >= 0 && diff <= 1 && c && c.type === "self") {
      bar.insertAdjacentHTML("beforeend", `<div class="alert-item alert-warn">⏰ <strong>${esc(p.title)}</strong> あと${diff}日 → ${esc(c.ball.checkpoint.label)}</div>`);
    }
  });
}

function renderCalendar() {
  const M = ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"];
  $("#cal-month").textContent = `${curYear}年 ${M[curMonth]}`;
  const first = new Date(curYear, curMonth, 1).getDay();
  const days = new Date(curYear, curMonth+1, 0).getDate();
  const prev = new Date(curYear, curMonth, 0).getDate();
  const today = fmt(now());
  const grid = $("#cal-grid"); grid.innerHTML = "";
  for (let i=first-1;i>=0;i--) grid.insertAdjacentHTML("beforeend", `<div class="cal-cell other"><div class="dnum">${prev-i}</div></div>`);
  for (let d=1;d<=days;d++) {
    const ds = `${curYear}-${String(curMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const dow = new Date(curYear, curMonth, d).getDay();
    let html = `<div class="dnum">${d}</div>`;
    const chips = [];
    (data.projects||[]).forEach((p) => {
      if (dueDate(p)!==ds || p.status==="canceled") return;
      let cls=EVCLS[p.cat]||"ev-ops";
      if (p.cat==="pop"){ if(/和也/.test(p.title)) cls="ev-suba"; else if(/長田|Slack/.test(p.title)) cls="ev-subb"; }
      chips.push({ cls, txt:p.title.replace(/（.*）/,"") });
    });
    (data.events||[]).forEach((e) => { if (e.date===ds) chips.push({cls:"ev-priv", txt:"🗓 "+(e.label||"私用")}); });
    (data.spots?.[ds]||[]).forEach((s) => chips.push({cls:"ev-mtg", txt:"▶ "+s.label}));
    (data.notes?.[ds]||[]).forEach((n) => chips.push({cls:"ev-shoot", txt:"📷 "+n}));
    chips.slice(0,3).forEach((c) => html += `<div class="ev-chip ${c.cls}">${esc(c.txt)}</div>`);
    if (chips.length>3) html += `<div style="font-size:8px;color:var(--text3);text-align:center">+${chips.length-3}</div>`;
    const cls = `cal-cell${dow===0?" sun":dow===6?" sat":""}${ds===today?" today":""}${ds===selectedDate?" selected":""}`;
    const cell = document.createElement("div"); cell.className=cls; cell.innerHTML=html;
    cell.onclick = () => { selectedDate=ds; renderCalendar(); renderDay(ds); };
    grid.appendChild(cell);
  }
  const rem = (first+days)%7===0?0:7-(first+days)%7;
  for (let i=1;i<=rem;i++) grid.insertAdjacentHTML("beforeend", `<div class="cal-cell other"><div class="dnum">${i}</div></div>`);
}

// ---- 1日の並び（編集すると dayPlan[ds] に保存）----
function dayBlocks(ds) {
  if (data.dayPlan && data.dayPlan[ds]) return data.dayPlan[ds].map((b)=>({...b}));
  const dow = new Date(ds+"T00:00:00").getDay();
  const blocks = baseSchedule(dow).map((b)=>({...b}));
  (data.spots?.[ds]||[]).forEach((sp)=>blocks.push({t:sp.t,end:sp.end,cat:sp.cat,label:sp.label,detail:"スポット追加",spot:true,spotId:sp.id}));
  blocks.sort((a,b)=>timeToMin(a.t)-timeToMin(b.t));
  return blocks;
}
function materializeDay(ds){ data.dayPlan=data.dayPlan||{}; if(!data.dayPlan[ds]) data.dayPlan[ds]=dayBlocks(ds); return data.dayPlan[ds]; }

// ドラッグで2つの枠の中身を入れ替え（時刻は固定）
function swapBlocks(ds,i,j){
  if(i===j || i==null || j==null) return;
  const arr=materializeDay(ds); const a=arr[i], b=arr[j]; if(!a||!b) return;
  const keep=new Set(["t","end"]);
  const na={t:a.t,end:a.end}, nb={t:b.t,end:b.end};
  Object.keys(b).forEach((k)=>{ if(!keep.has(k)) na[k]=b[k]; });
  Object.keys(a).forEach((k)=>{ if(!keep.has(k)) nb[k]=a[k]; });
  arr[i]=na; arr[j]=nb;
  saveLocal(data); renderDay(ds); toast("入れ替えました");
}

// バッファ/早朝枠に入れるタスクを選ぶ（前日の未完も候補）
function bufferPick(ds, idx){
  const yds=fmt(new Date(new Date(ds+"T00:00:00").getTime()-86400000));
  const yInc=dayBlocks(yds).filter((b)=>!b.lunch&&!b.buf&&b.cat!=="mtg"&&["2ch","sma","pop"].includes(b.cat)&&!(data.done||{})[blockKey(yds,b.label,b.t)]).map((b)=>b.label);
  const base=["りゅうとん 台本","りゅうとん 企画","スマホ 台本・サムネ","Popteen 確認・FB"];
  const opts=[...base, ...yInc.map((l)=>"前日: "+l), "（バッファに戻す）"];
  const pick=prompt("この枠に入れるタスク：\n"+opts.map((o,i)=>`${i+1}. ${o}`).join("\n")+"\n\n番号を入力", "");
  if(!pick) return; const n=parseInt(pick)-1; if(isNaN(n)||n<0||n>=opts.length) return;
  const arr=materializeDay(ds); const blk=arr[idx]; if(!blk) return;
  if(n===opts.length-1){ Object.assign(blk,{label:"バッファ",cat:"ops",buf:true,detail:"未完・突発対応"}); }
  else { const label=opts[n].replace(/^前日: /,""); let cat="2ch"; if(/スマホ/.test(label))cat="sma"; else if(/Popteen/.test(label))cat="pop";
    Object.assign(blk,{label,cat,buf:false,detail:opts[n].startsWith("前日:")?"前日からの繰越":"バッファに配置"}); }
  saveLocal(data); renderDay(ds); toast("配置しました");
}

function renderDay(ds) {
  const d = new Date(ds+"T00:00:00"), dow = d.getDay();
  $("#day-title").textContent = fmtDisp(ds);
  renderDayMeta(ds);
  const body = $("#day-body"); body.innerHTML = "";

  // 撮影日などのメモ（自分のタスクではないが関連情報）
  const notes = data.notes?.[ds] || [];
  if (notes.length) {
    body.insertAdjacentHTML("beforeend", `<div class="day-notes">${notes.map((n,i)=>
      `<span class="note-chip">📷 ${esc(n)}<button data-rmnote="${i}" data-stop="1">×</button></span>`).join("")}</div>`);
  }

  // 本日のアクション：その日が締切の案件（今日なら超過分も）
  const st = startOfToday();
  const acts = (data.projects||[]).filter((p) => {
    if (p.status!=="active") return false;
    if (dueDate(p)===ds) return true;
    if (ds===fmt(now()) && p.due_at && new Date(p.due_at)<st) return true; // 今日：超過も拾う
    return false;
  }).map((p)=>({p, c:classifyProj(p)})).filter((x)=>x.c);
  if (acts.length) {
    let h = `<div class="act-box"><div class="act-h">📌 本日のアクション</div>`;
    acts.sort((a,b)=>({chase:0,self:1,wait:2})[a.c.type]-({chase:0,self:1,wait:2})[b.c.type]);
    acts.forEach(({p,c})=>{
      const color = ({ "2ch":"var(--c2ch)",pop:"var(--cpop)",sma:"var(--csma)",ops:"var(--cops)" })[p.cat]||"var(--cops)";
      let doTxt, cls="";
      if (c.type==="self"){ doTxt=esc(c.ball.checkpoint.label); cls="self"; }
      else if (c.type==="chase"){ doTxt=`${esc(c.member?.name||"")} に進捗確認`; cls="chase"; }
      else doTxt=`${esc(c.member?.name||"")} 対応中・待ち`;
      h += `<div class="act-row"><div class="act-dot" style="background:${color}"></div><div><span style="font-weight:500">${esc(p.title)}</span> <span class="act-do ${cls}">→ ${doTxt}</span></div></div>`;
    });
    h += `</div>`;
    body.insertAdjacentHTML("beforeend", h);
  }

  // 時間割（編集済みなら dayPlan を使う）
  const blocks = dayBlocks(ds);
  if (!blocks.length){ body.insertAdjacentHTML("beforeend",`<div class="empty-day">スケジュールなし</div>`); return; }

  // 完了サマリ（上にまとめて表示）
  const doneList = blocks.filter((b)=>!b.lunch && (data.done||{})[blockKey(ds,b.label,b.t)]);
  if (doneList.length) body.insertAdjacentHTML("beforeend",
    `<div class="done-summary">✓ 完了 ${doneList.length}：${doneList.map((b)=>esc(b.label)).join(" / ")}</div>`);

  body.insertAdjacentHTML("beforeend", `<div class="drag-hint">↕ ドラッグで入替／バッファ枠はクリックでタスク配置</div>`);

  blocks.forEach((b,i)=>{
    const key = blockKey(ds,b.label,b.t);
    const isDone = (data.done||{})[key] || false;
    const prog = (data.progress||{})[key] ?? (isDone?100:0);
    const isMtg = b.cat==="mtg";
    const noProg = b.lunch || b.buf || isMtg;           // MTG・昼食・バッファは%なし
    let tb = TBCLS[b.cat]||"tb-ops"; if (b.lunch) tb="tb-lunch"; if (b.buf) tb="tb-buf";
    const styleAttr = noProg ? "" : ` style="background:${fillBg(b.cat, prog)}"`;
    let html = `<div class="tblock" draggable="true" data-idx="${i}"><div class="tblock-time">${b.t}</div>`
      + `<div class="tblock-card ${tb}${isDone?" done":""}" data-done="${key}" data-cat="${b.cat}" data-idx="${i}"${b.buf?' data-buf="1"':''}${styleAttr}>`;
    if (b.spot) html += `<div class="spot-badge">スポット</div>`;
    html += `<div class="tblock-name">${esc(b.label)}</div>`;
    if (b.detail) html += `<div class="tblock-detail">${esc(b.detail)}</div>`;
    if (b.label==="ミーティング準備") html += `<div style="margin-top:3px"><a href="${GOAL_SHEET_URL}" target="_blank" rel="noopener" data-stop="1" style="font-size:10px;color:var(--cmtg)">📝 目標・進捗をシートに記入 ↗</a></div>`;
    if (!noProg) html += `<div class="prog-row"><input type="range" min="0" max="100" step="1" value="${prog}" data-prog="${key}"><span>${prog}%</span></div>`;
    else if (isMtg) html += `<div class="mtg-check${isDone?" on":""}">${isDone?"✓ 完了":"クリックで完了"}</div>`;
    else if (b.buf) html += `<div class="mtg-check">＋ クリックでタスク配置</div>`;
    if (b.spot) html += `<div style="margin-top:4px"><button data-rmspot="${ds}|${b.spotId}" style="font-size:9px;background:none;border:none;color:var(--text3);cursor:pointer">× 削除</button></div>`;
    html += `</div></div>`;
    body.insertAdjacentHTML("beforeend", html);
  });
}

function renderTaskList() {
  const el = $("#tasks-list");
  const ps = (data.projects||[]).filter((p)=>p.status!=="done"&&p.status!=="canceled");
  if (!ps.length){ el.innerHTML=`<div class="no-tasks">案件なし（🔄でシートから取り込み）</div>`; return; }
  const color = (c)=>({ "2ch":"#E8441C",pop:"#C2407A",sma:"#0E8F68",ops:"#7A7672" })[c]||"#888";
  // 提出種別で色を変える（和也＝ピンク / Slack＝パープル）
  const sideColor = (p)=>{ if(p.cat==="pop"){ if(/和也/.test(p.title)) return "#C2407A"; if(/Slack/.test(p.title)) return "#5046C8"; } return color(p.cat); };
  const sideBg = (p)=>{ if(p.cat==="pop"){ if(/和也/.test(p.title)) return "#FCE0EC"; if(/Slack/.test(p.title)) return "#E7E3FB"; } return "transparent"; };
  el.innerHTML = ps.map((p)=>{
    const c = classifyProj(p);
    const tag = c ? (c.type==="self"?esc(c.ball.checkpoint.label):c.type==="chase"?`${c.member?.name||""}に確認`:`${c.member?.name||""}待ち`) : "";
    return `<div class="task-row" style="border-left:4px solid ${sideColor(p)};background:${sideBg(p)}">
      <div class="task-info"><div class="task-name">${esc(p.title)}</div>
      <div class="task-dates">${p.due_at?fmt(new Date(p.due_at)):"—"} ・ ${esc(tag)}</div></div></div>`;
  }).join("");
}

// ════ 操作 ════
function persist(){ save(data).then((r)=>{ if(r.error) toast("⚠ 同期失敗"); }); }
let toastT;
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove("show"),3000); }

function setProgress(key,val){
  data.progress = data.progress||{}; data.done = data.done||{};
  data.progress[key]=parseInt(val); if(parseInt(val)>=100) data.done[key]=true;
  saveLocal(data); renderDay(selectedDate);
}
function toggleDone(key){
  data.done=data.done||{}; data.progress=data.progress||{};
  data.done[key]=!data.done[key]; if(data.done[key]) data.progress[key]=100;
  saveLocal(data); renderDay(selectedDate);
}
function setQuotaTarget(cat){
  const ds=selectedDate||fmt(now()); const cur=todayTargets(ds)[cat];
  const v=prompt(`${cat==="2ch"?"りゅうとん":"スマホ"}の目標本数（${ds}）`, cur); if(v===null) return;
  const n=parseInt(v); if(isNaN(n)) return;
  data.quota_target=data.quota_target||{}; data.quota_target[ds]=data.quota_target[ds]||{}; data.quota_target[ds][cat]=n;
  saveLocal(data); renderDayMeta(ds);
}

// ---- スプレッドシート同期 ----
const slug=(s)=>String(s||"").replace(/[^\w぀-ヿ一-鿿]/g,"").slice(0,12)||"x";
// 編集者名を表示用に整える（_CW / _請求書 / _1(5) 等の管理サフィックスを除去）
const cleanName=(s)=>String(s||"").replace(/[_＿](CW|請求書).*$/,"").replace(/[_＿]?\d+\(\d+\).*$/,"").replace(/[_＿]\d+$/,"").trim()||String(s||"");
function parseDue(s){ if(!s)return null; s=String(s).trim(); let m;
  if((m=s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)))return iso(m[1],m[2],m[3]);
  if((m=s.match(/(\d{1,2})月(\d{1,2})日/)))return iso(2026,m[1],m[2]);
  if((m=s.match(/(\d{1,2})\/(\d{1,2})/)))return iso(2026,m[1],m[2]);
  const dt=new Date(s); if(!isNaN(dt.getTime())) return iso(dt.getFullYear(),dt.getMonth()+1,dt.getDate());
  return null; }
const iso=(y,mo,d)=>`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}T18:00:00+09:00`;
function mergeSheet(payload){
  if(!payload||!Array.isArray(payload.projects))return 0;
  const have=new Set(data.members.map((m)=>m.id));
  // 名簿・予算行（状況も納期も無い未着手行）を除外
  const rows=payload.projects.filter((sp)=>!(sp.state==="not_started" && !sp.due));
  const projs=rows.map((sp)=>{
    const nm=cleanName(sp.editor);
    const isR=sp.ball==="ryuto"; const mid=isR?"ryuto":"ed-"+slug(nm);
    if(!isR&&!have.has(mid)){ data.members.push({id:mid,name:nm,pace_per_day:1.5}); have.add(mid); }
    if(sp.title) sp={...sp,title:sp.title.replace(/（.*）/,`（${nm}）`)};
    const due=parseDue(sp.due); const created=due?new Date(new Date(due).getTime()-6*864e5).toISOString():new Date().toISOString();
    const key=isR?"fix":"edit";
    return { id:sp.id,cat:sp.cat,title:sp.title,status:sp.state==="done"?"done":"active",created_at:created,due_at:due,
      is_new_inflow:false,is_interrupt:false,source:{sheet:true},
      assignments:[{id:sp.id+"-a",member_id:mid,request:sp.checkpoint||"編集",
        checkpoints:[{key,label:sp.checkpoint||"編集",state:sp.state,source:"sheet",confirmed_at:sp.state==="done"?new Date().toISOString():null}]}] };
  });
  data.projects=(data.projects||[]).filter((p)=>!p.source||!p.source.sheet).concat(projs);
  return projs.length;
}
async function syncSheet(silent){
  const url=loadSheetUrl(); if(!url){ if(!silent) toast("設定でスプレッドシートURLを登録してください"); return; }
  try{ const p=await fetchSheetProgress(url); const n=mergeSheet(p); saveLocal(data); renderAll(); if(!silent) toast(`シートから ${n} 件反映`); }
  catch(e){ if(!silent) toast("同期失敗: "+e.message); }
}

// ---- スポット / 私用 ----
function addSpot(){
  const date=$("#sp-date").value,time=$("#sp-time").value,dur=parseFloat($("#sp-dur").value)||1,cat=$("#sp-cat").value,title=$("#sp-title").value.trim();
  if(!date||!title){ toast("日付とタイトルを入力"); return; }
  const [h,m]=time.split(":").map(Number); const em=h*60+m+dur*60; const end=`${String(Math.floor(em/60)).padStart(2,"0")}:${String(em%60).padStart(2,"0")}`;
  const sid=Date.now()%100000;
  data.spots=data.spots||{}; data.spots[date]=data.spots[date]||[]; data.spots[date].push({id:sid,cat,label:title,t:time,end,dur});
  // その日を編集済み（dayPlan）なら、そこにも差し込む
  if(data.dayPlan?.[date]){ data.dayPlan[date].push({t:time,end,cat,label:title,detail:"スポット追加",spot:true,spotId:sid}); data.dayPlan[date].sort((a,b)=>timeToMin(a.t)-timeToMin(b.t)); }
  saveLocal(data); $("#dlg-spot").close(); selectedDate=date; renderAll(); toast("スポットを追加");
}
// カレンダーの撮影日メモ（自分のタスクではないが関連情報）
function addNote(){
  const text=prompt("カレンダーに残すメモ（例: TC#57 撮影日 / 素材受領 → 編集者へ渡す）"); if(!text) return;
  const date=prompt("日付 (YYYY-MM-DD)", selectedDate||fmt(now())); if(!date) return;
  data.notes=data.notes||{}; data.notes[date]=data.notes[date]||[]; data.notes[date].push(text);
  saveLocal(data); selectedDate=date; renderAll(); toast("メモを追加");
}

function addEvent(){
  const label=prompt("私用の内容（例: 病院 / 家族）"); if(!label) return;
  const date=prompt("日付 (YYYY-MM-DD)", fmt(now())); if(!date) return;
  const h=parseFloat(prompt("何時間ぶん？","2"));
  data.events=data.events||[]; data.events.push({id:"e"+(Date.now()%100000),date,hours:isNaN(h)?1:h,label:label.startsWith("私用")?label:"私用（"+label+"）",type:"private"});
  saveLocal(data); renderAll(); toast("私用を追加");
}

// ---- Discord形式でコピー（【午前】【午後】・完了は取り消し線）----
function copyDayText(ds){
  const blocks = dayBlocks(ds).filter((b)=>!b.lunch && !b.buf); // 昼食・空バッファは除外（タスク配置済みは buf:false で残る）
  const am=[], pm=[];
  blocks.forEach((b)=>{
    const done = (data.done||{})[blockKey(ds,b.label,b.t)];
    const line = `${b.t} ${b.label}`;
    (timeToMin(b.t) < 720 ? am : pm).push(done ? `~~${line}~~` : line);
  });
  return `【午前】\n${am.join("\n")}\n\n【午後】\n${pm.join("\n")}`;
}
function copyDay(ds){
  const text = copyDayText(ds);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(()=>toast("コピーしました（Discordに貼り付け）")).catch(()=>prompt("コピーしてください", text));
  } else { prompt("コピーしてください", text); }
}

// ---- 貼り付け反映（「時刻 内容」の行をその日の時間割に）----
function inferCat(label){
  if (/ミーティング準備|進捗シート|CW|朝まとめ|まとめ|スカウト|言語化|日報/.test(label)) return "ops";
  if (/MTG|ミーティング|智哉|ともや|和也|カズヤ|会議|1on1/.test(label)) return "mtg";
  if (/スマホ|由美子/.test(label)) return "sma";
  if (/Popteen|ポップ|TC#?\d|墓コス|ドッキリ|ワサビ|美容vlog|同じ色|6文字|風船|数字当て|修正/.test(label)) return "pop";
  if (/2ch|2ｃｈ|りゅうとん|りゅうとん|シナリオ|台本|企画|編集FB/.test(label)) return "2ch";
  return "ops";
}
function parsePlan(text){
  const items=[];
  text.split("\n").forEach((l)=>{
    const m=l.trim().match(/^(\d{1,2})[:：](\d{2})\s*(.+)$/);
    if(!m) return;
    items.push({ min:+m[1]*60+ +m[2], t:`${+m[1]}:${m[2]}`, label:m[3].trim() });
  });
  items.sort((a,b)=>a.min-b.min);
  return items.map((it,i)=>{
    const endMin = i<items.length-1 ? items[i+1].min : Math.min(it.min+90,1440);
    const end = `${Math.floor(endMin/60)}:${String(endMin%60).padStart(2,"0")}`;
    return { t:it.t, end, cat:inferCat(it.label), label:it.label, detail:"" };
  });
}
function dayPlainLines(ds){ return dayBlocks(ds).filter((b)=>!b.lunch&&!b.buf).map((b)=>`${b.t} ${b.label}`).join("\n"); }
function openImport(){ $("#imp-date").textContent=fmtDisp(selectedDate); $("#imp-text").value=dayPlainLines(selectedDate); $("#dlg-import").showModal(); }
function importPlan(){
  const blocks=parsePlan($("#imp-text").value);
  if(!blocks.length){ toast("「時刻 内容」の行がありません"); return; }
  data.dayPlan=data.dayPlan||{}; data.dayPlan[selectedDate]=blocks;
  saveLocal(data); $("#dlg-import").close(); renderDay(selectedDate); toast("予定を反映しました");
}
function resetDayPlan(){
  if(data.dayPlan) delete data.dayPlan[selectedDate];
  saveLocal(data); $("#dlg-import").close(); $("#dlg-shift").close(); renderDay(selectedDate); toast("既定の時間割に戻しました");
}

// ---- 始業時間に合わせて自動リスケジュール（残り時間に圧縮して詰め込む）----
const minToT=(m)=>`${Math.floor(m/60)}:${String(Math.round(m)%60).padStart(2,"0")}`;
// その日の予定を [startMin, endMin] に圧縮配置。MTG/スポットは時刻固定、昼食は時間維持、作業ブロックは比例圧縮。
function reschedule(ds, startMin, endMin){
  const base = dayBlocks(ds);
  const isPinned = (b)=> b.cat==="mtg" || b.spot;                       // 相手がいる→時刻固定
  const isDrop   = (b)=> b.buf===true && !b.spot && b.cat==="ops";      // 空バッファ/早朝/夜は捨てて窓にする
  // 固定枠（窓内に重なるものだけ・窓でクリップ）
  const pinned = base.filter(isPinned)
    .map((b)=>({...b, s:timeToMin(b.t), e:timeToMin(b.end)}))
    .filter((p)=> p.e>startMin && p.s<endMin)
    .map((p)=>({...p, s:Math.max(p.s,startMin), e:Math.min(p.e,endMin)}))
    .sort((a,b)=>a.s-b.s);
  // 動かせる作業（元の順）。lunch は圧縮しない（comp:false）
  const movable = base.filter((b)=>!isPinned(b) && !isDrop(b))
    .map((b)=>({...b, dur:Math.max(15, timeToMin(b.end)-timeToMin(b.t)), comp:!b.lunch}));
  // 固定枠を除いた空き区間
  const segs=[]; let c=startMin;
  pinned.forEach((p)=>{ if(p.s>c) segs.push([c,p.s]); c=Math.max(c,p.e); });
  if(c<endMin) segs.push([c,endMin]);
  const totalFree = segs.reduce((a,[s,e])=>a+(e-s),0);
  const fixedDur  = movable.filter((m)=>!m.comp).reduce((a,m)=>a+m.dur,0);
  const compDur   = movable.filter((m)=> m.comp).reduce((a,m)=>a+m.dur,0);
  let scale = compDur>0 ? Math.min(1,(totalFree-fixedDur)/compDur) : 1;
  if(!(scale>0)) scale=0.1;
  movable.forEach((m)=>{ m.fit = m.comp ? Math.max(15, Math.round(m.dur*scale)) : m.dur; });
  // 空き区間へ順番に流し込む（固定枠をまたぐ作業は「（続き）」で分割）
  const out=[]; let si=0; let cur = segs.length ? segs[0][0] : startMin;
  movable.forEach((m)=>{
    let remaining=m.fit, first=true;
    while(remaining>0 && si<segs.length){
      if(cur>=segs[si][1]){ si++; if(si<segs.length) cur=segs[si][0]; continue; }
      const take=Math.min(segs[si][1]-cur, remaining);
      out.push({t:minToT(cur), end:minToT(cur+take), cat:m.cat, label:first?m.label:m.label+"（続き）", detail:m.detail||"", ...(m.lunch?{lunch:true}:{})});
      cur+=take; remaining-=take; first=false;
      if(remaining>0){ si++; if(si<segs.length) cur=segs[si][0]; }
    }
    if(remaining>0){ // 窓に収まらない分は終業後に延長
      out.push({t:minToT(cur), end:minToT(cur+remaining), cat:m.cat, label:first?m.label:m.label+"（続き）", detail:m.detail||"", ...(m.lunch?{lunch:true}:{})});
      cur+=remaining;
    }
  });
  pinned.forEach((p)=> out.push({t:minToT(p.s), end:minToT(p.e), cat:p.cat, label:p.label, detail:p.detail||"", ...(p.spot?{spot:true,spotId:p.spotId}:{})}));
  out.sort((a,b)=>timeToMin(a.t)-timeToMin(b.t));
  // 時刻が連続する同一タスクの分割を結合（端数スリバー対策。MTGをまたぐ分割は時刻が非連続なので残る）
  const baseLabel=(s)=>s.replace(/（続き）$/,""); const merged=[];
  out.forEach((b)=>{ const last=merged[merged.length-1];
    if(last && !last.spot && !b.spot && last.cat===b.cat && timeToMin(last.end)===timeToMin(b.t) && baseLabel(last.label)===baseLabel(b.label)){
      last.end=b.end; last.label=baseLabel(last.label);
    } else merged.push({...b});
  });
  return merged;
}
function shiftBounds(){
  const sm=timeToMin($("#shift-start").value||"11:00");
  const em=$("#shift-night").checked ? 1440 : timeToMin($("#shift-end").value||"20:00");
  return { sm, em: Math.max(sm+30, em) };
}
function shiftPreview(){
  const {sm,em}=shiftBounds();
  const base=dayBlocks(selectedDate);
  const isPinned=(b)=>b.cat==="mtg"||b.spot, isDrop=(b)=>b.buf===true&&!b.spot&&b.cat==="ops";
  const work=base.filter((b)=>!isPinned(b)&&!isDrop(b));
  const workH=work.reduce((a,b)=>a+Math.max(15,timeToMin(b.end)-timeToMin(b.t)),0)/60;
  const pinH=base.filter(isPinned).filter((b)=>timeToMin(b.end)>sm&&timeToMin(b.t)<em)
    .reduce((a,b)=>a+(Math.min(timeToMin(b.end),em)-Math.max(timeToMin(b.t),sm)),0)/60;
  const freeH=Math.max(0,(em-sm)/60-pinH);
  const ratio=workH>0?Math.min(100,Math.round(freeH/workH*100)):100;
  const over=workH>freeH;
  $("#shift-preview").innerHTML=`残り作業枠 <b>${round1(freeH)}h</b>${pinH>0?`（MTG等 ${round1(pinH)}h除く）`:""} に 予定 <b>${round1(workH)}h</b>`
    +` → <b style="color:${over?'var(--danger)':'var(--ok)'}">${over?`⚠ ${ratio}%に圧縮`:`✓ そのまま入る`}</b>`
    +`<br><span style="color:var(--text3)">${minToT(sm)}〜${minToT(em)}・作業${work.length}枠を詰め込み（MTG/スポットは固定）</span>`;
}
function openShift(){
  const dow=new Date(selectedDate+"T00:00:00").getDay();
  $("#shift-date").textContent=fmtDisp(selectedDate);
  if(!$("#shift-start").value) $("#shift-start").value="11:00";
  $("#shift-end").value="20:00"; $("#shift-night").checked=false;
  shiftPreview(); $("#dlg-shift").showModal();
}
function applyShift(andCopy){
  const {sm,em}=shiftBounds();
  const blocks=reschedule(selectedDate, sm, em);
  if(!blocks.length){ toast("詰め込む予定がありません"); return; }
  data.dayPlan=data.dayPlan||{}; data.dayPlan[selectedDate]=blocks;
  saveLocal(data); $("#dlg-shift").close(); renderDay(selectedDate);
  if(andCopy){ copyDay(selectedDate); } else { toast(`${minToT(sm)}始業で詰め込みました`); }
}

// ---- 設定 ----
function openSet(){ const g=loadGhConfig()||{}; $("#set-sheet").value=loadSheetUrl(); $("#set-owner").value=g.owner||""; $("#set-repo").value=g.repo||""; $("#set-branch").value=g.branch||"main"; $("#set-path").value=g.path||"tasks.json"; $("#set-token").value=g.token||""; $("#dlg-set").showModal(); }

// ---- 調整パネル ----
function openAdj(){
  const B=data.config.capacity.businesses;
  $("#adj-ryuton").value=B["2ch"].weekly_target;
  $("#adj-scripth").value=(B["2ch"].phases||[]).find((p)=>p.key==="script")?.h_per_unit ?? 1.0;
  $("#adj-sma").value=B.sma.weekly_target;
  $("#adj-pop").value=B.pop.monthly_target;
  const sd=new Set(data.config.schedule?.smaDays || [2,4]);
  [1,2,3,4,5,6].forEach((d)=>{ const cb=$("#adj-d"+d); if(cb) cb.checked=sd.has(d); });
  adjPreview(); $("#dlg-adj").showModal();
}
function readAdj(){
  return {
    ryuton_weekly: parseFloat($("#adj-ryuton").value)||0,
    script_h: parseFloat($("#adj-scripth").value)||1,
    sma_weekly: parseFloat($("#adj-sma").value)||0,
    pop_monthly: parseFloat($("#adj-pop").value)||0,
    smaDays: [1,2,3,4,5,6].filter((d)=>$("#adj-d"+d)?.checked),
  };
}
function adjPreview(){
  const c=computeCapacity(applyAdj(data.config, readAdj()), now(), data.events||[]);
  if(!c){ $("#adj-preview").textContent=""; return; }
  const over=c.balance<0;
  $("#adj-preview").innerHTML=`必要 <b>${round1(c.demand)}h</b> ／ 使える <b>${round1(c.available)}h</b> → <b style="color:${over?'var(--danger)':'var(--ok)'}">${over?`⚠ ${round1(-c.balance)}h 超過`:`✓ ${round1(c.balance)}h 余裕`}</b><br><span style="color:${c.sundayWork||c.sundayCanRest?'var(--ok)':'var(--danger)'};font-weight:700">${c.sundayWork?'日曜午後もりゅうとん（稼働）':c.sundayCanRest?'日曜午後 休める🎉':'日曜午後 要稼働'}</span>`;
}
function saveAdj(){
  data.config_adj=readAdj();
  data.config=applyAdj(data.config, data.config_adj);
  saveLocal(data); $("#dlg-adj").close(); renderAll(); toast("調整を保存しました");
}

function wire(){
  $("#m-prev").onclick=()=>{ curMonth--; if(curMonth<0){curMonth=11;curYear--;} renderCalendar(); };
  $("#m-next").onclick=()=>{ curMonth++; if(curMonth>11){curMonth=0;curYear++;} renderCalendar(); };
  $("#b-sync").onclick=()=>syncSheet(false);
  $("#b-event").onclick=addEvent;
  $("#b-note").onclick=addNote;
  $("#b-copy").onclick=()=>copyDay(selectedDate);
  $("#b-import").onclick=openImport;
  $("#b-shift").onclick=openShift;
  $("#shift-cancel").onclick=()=>$("#dlg-shift").close();
  $("#shift-apply").onclick=()=>applyShift(false);
  $("#shift-applycopy").onclick=()=>applyShift(true);
  $("#shift-reset").onclick=resetDayPlan;
  $("#dlg-shift").addEventListener("input", shiftPreview);
  $("#imp-cancel").onclick=()=>$("#dlg-import").close();
  $("#imp-apply").onclick=importPlan;
  $("#imp-reset").onclick=resetDayPlan;
  $("#b-spot").onclick=()=>{ $("#sp-date").value=selectedDate||fmt(now()); $("#dlg-spot").showModal(); };
  $("#sp-cancel").onclick=()=>$("#dlg-spot").close();
  $("#sp-add").onclick=addSpot;
  $("#b-set").onclick=openSet;
  $("#b-adj").onclick=openAdj;
  $("#adj-cancel").onclick=()=>$("#dlg-adj").close();
  $("#adj-save").onclick=saveAdj;
  $("#dlg-adj").addEventListener("input", adjPreview);
  $("#set-cancel").onclick=()=>$("#dlg-set").close();
  $("#set-save").onclick=()=>{ saveSheetUrl($("#set-sheet").value.trim());
    saveGhConfig({owner:$("#set-owner").value.trim(),repo:$("#set-repo").value.trim(),branch:$("#set-branch").value.trim()||"main",path:$("#set-path").value.trim()||"tasks.json",token:$("#set-token").value.trim()});
    $("#dlg-set").close(); toast("設定を保存"); persist(); syncSheet(false); };
  $("#set-reset").onclick=async()=>{ if(!confirm("ローカルの変更を破棄して再読込しますか？")) return; resetLocal(); data=await loadData(); renderAll(); toast("再読込しました"); };
  $("#day-meta").addEventListener("click",(e)=>{ const tg=e.target.closest("[data-tgt]"); if(tg) setQuotaTarget(tg.dataset.tgt); });
  $("#day-body").addEventListener("click",(e)=>{
    const rn=e.target.closest("[data-rmnote]");
    if(rn){ const i=+rn.dataset.rmnote; (data.notes[selectedDate]||[]).splice(i,1); if(!data.notes[selectedDate]?.length) delete data.notes[selectedDate]; saveLocal(data); renderAll(); return; }
    if(e.target.closest("[data-stop]")) return; // シートリンク等は完了トグルしない
    const rm=e.target.closest("[data-rmspot]");
    if(rm){ const [ds,id]=rm.dataset.rmspot.split("|"); data.spots[ds]=(data.spots[ds]||[]).filter((s)=>String(s.id)!==id); saveLocal(data); renderAll(); return; }
    const card=e.target.closest("[data-done]"); if(!card || e.target.tagName==="INPUT") return;
    if(card.dataset.buf==="1"){ bufferPick(selectedDate, +card.dataset.idx); return; } // バッファ枠 → タスク配置
    toggleDone(card.dataset.done);
  });
  // ドラッグで入替
  let dragIdx=null;
  $("#day-body").addEventListener("dragstart",(e)=>{ const t=e.target.closest("[data-idx]"); if(t){ dragIdx=+t.dataset.idx; e.dataTransfer.effectAllowed="move"; t.classList.add("dragging"); } });
  $("#day-body").addEventListener("dragend",(e)=>{ const t=e.target.closest(".tblock"); if(t) t.classList.remove("dragging"); });
  $("#day-body").addEventListener("dragover",(e)=>{ if(dragIdx!=null) e.preventDefault(); });
  $("#day-body").addEventListener("drop",(e)=>{ e.preventDefault(); const t=e.target.closest("[data-idx]"); if(t && dragIdx!=null){ swapBlocks(selectedDate, dragIdx, +t.dataset.idx); } dragIdx=null; });
  // 進捗スライダー：その場で背景を塗る（再描画しないのでチラつかない／1%刻み）
  $("#day-body").addEventListener("input",(e)=>{
    const r=e.target.closest("[data-prog]"); if(!r) return;
    const key=r.dataset.prog, val=parseInt(r.value);
    const card=r.closest(".tblock-card");
    if(card){ card.style.background=fillBg(card.dataset.cat||"ops", val); card.classList.toggle("done", val>=100); }
    const span=r.parentElement.querySelector("span"); if(span) span.textContent=val+"%";
    data.progress=data.progress||{}; data.done=data.done||{};
    data.progress[key]=val; data.done[key]=val>=100;
    saveLocal(data); renderDayMeta(selectedDate);
  });
}

(async function init(){
  try{
    data = await loadData();
    data.config = applyAdj(data.config, data.config_adj); // 保存済みの調整を反映
    data.progress=data.progress||{}; data.done=data.done||{}; data.spots=data.spots||{}; data.output_log=data.output_log||{};
    const t=now(); curYear=t.getFullYear(); curMonth=t.getMonth(); selectedDate=fmt(t);
    wire(); renderAll(); syncSheet(true);
  }catch(e){ document.body.innerHTML=`<pre style="padding:2rem;color:#c00">起動エラー: ${e.message}</pre>`; }
})();
