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
const EVCLS = { "2ch":"ev-2ch", pop:"ev-pop", sma:"ev-sma", mtg:"ev-mtg", ops:"ev-ops" };
const esc = (s) => String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

// ---- 週次ベーススケジュール 7:00-20:00 ----
function baseSchedule(dow) {
  const S = {
    1:[ {t:"7:00",end:"8:00",cat:"ops",label:"朝まとめ",detail:"CW / Discord / SLACK 確認・返信"},
        {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 企画・台本①",detail:"集中2h"},
        {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 企画・台本②",detail:"集中2h"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"2ch",label:"りゅうとん 企画・台本③",detail:"集中2h"},
        {t:"15:00",end:"17:00",cat:"2ch",label:"りゅうとん 編集FB",detail:"全本チェック・修正指示"},
        {t:"17:00",end:"18:30",cat:"pop",label:"Popteen 確認・FB",detail:"素材確認・修正指示"},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"未完・突発対応",buf:true} ],
    2:[ {t:"7:00",end:"8:00",cat:"ops",label:"朝まとめ",detail:"CW / Discord / SLACK"},
        {t:"8:00",end:"10:00",cat:"sma",label:"スマホ① 企画・撮影チェック",detail:"由美子 1本目（週2本）"},
        {t:"10:00",end:"12:00",cat:"sma",label:"スマホ① 台本・サムネ",detail:""},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"14:00",cat:"sma",label:"スマホ① 台本・サムネ続き",detail:""},
        {t:"14:00",end:"15:00",cat:"mtg",label:"智哉さん週次MTG",detail:"毎週固定"},
        {t:"15:00",end:"17:00",cat:"sma",label:"スマホ① やりとり・編集者へ渡し",detail:""},
        {t:"17:00",end:"18:30",cat:"2ch",label:"りゅうとん 台本（巻き取り）",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"未完・突発対応",buf:true} ],
    3:[ {t:"7:00",end:"8:00",cat:"ops",label:"朝まとめ",detail:""},
        {t:"8:00",end:"10:00",cat:"2ch",label:"りゅうとん 企画・台本①",detail:"集中2h"},
        {t:"10:00",end:"12:00",cat:"2ch",label:"りゅうとん 企画・台本②",detail:"集中2h"},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"2ch",label:"りゅうとん 企画・台本③",detail:"集中2h"},
        {t:"15:00",end:"17:00",cat:"2ch",label:"りゅうとん 編集FB",detail:""},
        {t:"17:00",end:"18:30",cat:"pop",label:"Popteen 確認・FB",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"",buf:true} ],
    4:[ {t:"7:00",end:"8:00",cat:"ops",label:"朝まとめ",detail:""},
        {t:"8:00",end:"10:00",cat:"sma",label:"スマホ② 企画・撮影チェック",detail:"由美子 2本目（週2本）"},
        {t:"10:00",end:"12:00",cat:"sma",label:"スマホ② 台本・サムネ",detail:""},
        {t:"12:00",end:"13:00",cat:"ops",label:"昼食・仮眠",lunch:true},
        {t:"13:00",end:"15:00",cat:"sma",label:"スマホ② 台本・サムネ",detail:""},
        {t:"15:00",end:"17:00",cat:"sma",label:"スマホ② やりとり・編集者へ渡し",detail:""},
        {t:"17:00",end:"18:30",cat:"2ch",label:"りゅうとん 編集FB",detail:""},
        {t:"18:30",end:"20:00",cat:"ops",label:"バッファ",detail:"",buf:true} ],
    5:[ {t:"7:00",end:"8:00",cat:"ops",label:"朝まとめ",detail:"週次整理"},
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
    0:[ {t:"7:00",end:"12:00",cat:"2ch",label:"りゅうとん 作業（午前・任意）",detail:"遅れ分のみ"},
        {t:"12:00",end:"20:00",cat:"ops",label:"午後オフ",detail:"日曜午後は原則休み",lunch:true} ],
  };
  const day = S[dow] || [];
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

function renderCapStrip() {
  const c = computeCapacity(data.config, now(), data.events || []);
  if (!c) { $("#cap-strip").innerHTML = ""; return; }
  const o = computeOutput(c, now(), data.output_log || {});
  const over = c.balance < 0;
  // 今日のノルマ（りゅうとん台本）
  const sr = o.rows.find((r) => r.cat === "2ch" && r.key === "script") || { todayActual: 0, todayTarget: 0 };
  let praise = "今日のノルマ、いきましょう💪";
  if (o.todayExtra > 0) praise = `🔥 予定より ${o.todayExtra}本 多い！最高！`;
  else if (o.todayMet) praise = "🎉 今日のノルマ達成！";
  if (o.weekMet) praise = "🏆 週の目標 全達成！";
  $("#cap-strip").innerHTML = `
    <div class="cap-box"><b class="${over?'':''}" style="color:${over?'var(--danger)':'var(--ok)'}">${round1(c.demand)}h</b><small>必要/週</small></div>
    <span class="cap-sep">vs</span>
    <div class="cap-box"><b>${round1(c.available)}h</b><small>使える/週</small></div>
    <span class="cap-bal ${over?'ng':'ok'}">${over?`⚠${round1(-c.balance)}h超過`:`✓${round1(c.balance)}h余裕`}</span>
    <span class="cap-pill ${c.sundayCanRest?'pill-ok':'pill-ng'}">${c.sundayCanRest?'日曜午後 休める':'日曜午後 要稼働'}</span>
    <div class="quota">
      <span style="font-size:11px;color:var(--text3)">今日の台本</span>
      <b>${sr.todayActual}/${sr.todayTarget}</b>
      <button class="qbtn" data-q="-1">−</button><button class="qbtn plus" data-q="1">＋</button>
      <span class="praise ${o.todayExtra>0||o.weekMet?'hot':''}">${praise}</span>
    </div>`;
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
      bar.insertAdjacentHTML("beforeend", `<div class="alert-item alert-warn">⏰ <strong>${esc(p.title)}</strong> あと${diff}日 → 自分が上げる</div>`);
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
    (data.projects||[]).forEach((p) => { if (dueDate(p)===ds && p.status!=="canceled") chips.push({cls:EVCLS[p.cat]||"ev-ops", txt:p.title.replace(/（.*）/,"")}); });
    (data.events||[]).forEach((e) => { if (e.date===ds) chips.push({cls:"ev-priv", txt:"🗓 "+(e.label||"私用")}); });
    (data.spots?.[ds]||[]).forEach((s) => chips.push({cls:"ev-mtg", txt:"▶ "+s.label}));
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

function renderDay(ds) {
  const d = new Date(ds+"T00:00:00"), dow = d.getDay();
  $("#day-title").textContent = fmtDisp(ds);
  $("#day-meta").textContent = ds===fmt(now()) ? "今日" : "";
  const body = $("#day-body"); body.innerHTML = "";

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
      if (c.type==="self"){ doTxt=`自分が上げる（${esc(c.ball.checkpoint.label)}）`; cls="self"; }
      else if (c.type==="chase"){ doTxt=`${esc(c.member?.name||"")} に進捗確認`; cls="chase"; }
      else doTxt=`${esc(c.member?.name||"")} 対応中・待ち`;
      h += `<div class="act-row"><div class="act-dot" style="background:${color}"></div><div><span style="font-weight:500">${esc(p.title)}</span> <span class="act-do ${cls}">→ ${doTxt}</span></div></div>`;
    });
    h += `</div>`;
    body.insertAdjacentHTML("beforeend", h);
  }

  // 時間割
  let blocks = baseSchedule(dow).map((b)=>({...b}));
  (data.spots?.[ds]||[]).forEach((sp)=>blocks.push({t:sp.t,end:sp.end,cat:sp.cat,label:sp.label,detail:"スポット追加",spot:true,spotId:sp.id}));
  blocks.sort((a,b)=>timeToMin(a.t)-timeToMin(b.t));
  if (!blocks.length){ body.insertAdjacentHTML("beforeend",`<div class="empty-day">スケジュールなし</div>`); return; }

  blocks.forEach((b)=>{
    const key = blockKey(ds,b.label,b.t);
    const isDone = (data.done||{})[key] || false;
    const prog = (data.progress||{})[key] ?? (isDone?100:0);
    let tb = TBCLS[b.cat]||"tb-ops"; if (b.lunch) tb="tb-lunch"; if (b.buf) tb="tb-buf";
    const pc = prog>=100?"#1D9E75":prog>=50?"#BA7517":"#E8441C";
    let html = `<div class="tblock"><div class="tblock-time">${b.t}</div><div class="tblock-card ${tb}${isDone?" done":""}" data-done="${key}">`;
    if (b.spot) html += `<div class="spot-badge">スポット</div>`;
    html += `<div class="tblock-name">${esc(b.label)}</div>`;
    if (b.detail) html += `<div class="tblock-detail">${esc(b.detail)}</div>`;
    if (!b.lunch && !b.buf) html += `<div class="prog-wrap"><div class="prog-bar" style="width:${prog}%;background:${pc}"></div></div>
      <div class="prog-row"><input type="range" min="0" max="100" step="10" value="${prog}" data-prog="${key}"><span>${prog}%</span></div>`;
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
  el.innerHTML = ps.map((p)=>{
    const c = classifyProj(p);
    const tag = c ? (c.type==="self"?"自分が上げる":c.type==="chase"?`${c.member?.name||""}に確認`:`${c.member?.name||""}待ち`) : "";
    return `<div class="task-row"><div class="task-dot" style="background:${color(p.cat)}"></div>
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
function bumpQuota(delta){
  const t=fmt(now());
  data.output_log=data.output_log||{}; data.output_log[t]=data.output_log[t]||{}; data.output_log[t]["2ch"]=data.output_log[t]["2ch"]||{};
  data.output_log[t]["2ch"].script = Math.max(0,(data.output_log[t]["2ch"].script||0)+delta);
  saveLocal(data); renderCapStrip();
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
  data.spots=data.spots||{}; data.spots[date]=data.spots[date]||[]; data.spots[date].push({id:Date.now()%100000,cat,label:title,t:time,end,dur});
  saveLocal(data); $("#dlg-spot").close(); selectedDate=date; renderAll(); toast("スポットを追加");
}
function addEvent(){
  const label=prompt("私用の内容（例: 病院 / 家族）"); if(!label) return;
  const date=prompt("日付 (YYYY-MM-DD)", fmt(now())); if(!date) return;
  const h=parseFloat(prompt("何時間ぶん？","2"));
  data.events=data.events||[]; data.events.push({id:"e"+(Date.now()%100000),date,hours:isNaN(h)?1:h,label:label.startsWith("私用")?label:"私用（"+label+"）",type:"private"});
  saveLocal(data); renderAll(); toast("私用を追加");
}

// ---- 設定 ----
function openSet(){ const g=loadGhConfig()||{}; $("#set-sheet").value=loadSheetUrl(); $("#set-owner").value=g.owner||""; $("#set-repo").value=g.repo||""; $("#set-branch").value=g.branch||"main"; $("#set-path").value=g.path||"tasks.json"; $("#set-token").value=g.token||""; $("#dlg-set").showModal(); }

function wire(){
  $("#m-prev").onclick=()=>{ curMonth--; if(curMonth<0){curMonth=11;curYear--;} renderCalendar(); };
  $("#m-next").onclick=()=>{ curMonth++; if(curMonth>11){curMonth=0;curYear++;} renderCalendar(); };
  $("#b-sync").onclick=()=>syncSheet(false);
  $("#b-event").onclick=addEvent;
  $("#b-spot").onclick=()=>{ $("#sp-date").value=selectedDate||fmt(now()); $("#dlg-spot").showModal(); };
  $("#sp-cancel").onclick=()=>$("#dlg-spot").close();
  $("#sp-add").onclick=addSpot;
  $("#b-set").onclick=openSet;
  $("#set-cancel").onclick=()=>$("#dlg-set").close();
  $("#set-save").onclick=()=>{ saveSheetUrl($("#set-sheet").value.trim());
    saveGhConfig({owner:$("#set-owner").value.trim(),repo:$("#set-repo").value.trim(),branch:$("#set-branch").value.trim()||"main",path:$("#set-path").value.trim()||"tasks.json",token:$("#set-token").value.trim()});
    $("#dlg-set").close(); toast("設定を保存"); persist(); syncSheet(false); };
  $("#set-reset").onclick=async()=>{ if(!confirm("ローカルの変更を破棄して再読込しますか？")) return; resetLocal(); data=await loadData(); renderAll(); toast("再読込しました"); };
  $("#cap-strip").addEventListener("click",(e)=>{ const b=e.target.closest("[data-q]"); if(b) bumpQuota(+b.dataset.q); });
  $("#day-body").addEventListener("click",(e)=>{
    const dn=e.target.closest("[data-done]"); if(dn && e.target.tagName!=="INPUT"){ toggleDone(dn.dataset.done); return; }
    const rm=e.target.closest("[data-rmspot]"); if(rm){ const [ds,id]=rm.dataset.rmspot.split("|"); data.spots[ds]=(data.spots[ds]||[]).filter((s)=>String(s.id)!==id); saveLocal(data); renderAll(); }
  });
  $("#day-body").addEventListener("input",(e)=>{ const r=e.target.closest("[data-prog]"); if(r){ r.nextElementSibling.textContent=r.value+"%"; setProgress(r.dataset.prog,r.value); } });
}

(async function init(){
  try{
    data = await loadData();
    data.progress=data.progress||{}; data.done=data.done||{}; data.spots=data.spots||{}; data.output_log=data.output_log||{};
    const t=now(); curYear=t.getFullYear(); curMonth=t.getMonth(); selectedDate=fmt(t);
    wire(); renderAll(); syncSheet(true);
  }catch(e){ document.body.innerHTML=`<pre style="padding:2rem;color:#c00">起動エラー: ${e.message}</pre>`; }
})();
