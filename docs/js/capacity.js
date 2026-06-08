// capacity.js — 週/月の必要時間を逆算し、日次プランと過不足を出す（純粋関数）
// 事業は phases（企画/台本/やりとり等）に分割可。FB・予備バッファも合算する。

const DAYS = [
  { key: "mon", label: "月" }, { key: "tue", label: "火" }, { key: "wed", label: "水" },
  { key: "thu", label: "木" }, { key: "fri", label: "金" }, { key: "sat", label: "土" },
  { key: "sun", label: "日" },
];

// 事業ごとの週あたり必要時間（工程分割対応）
function businessWeekly(b, wpm) {
  const unitsW = b.weekly_target != null ? b.weekly_target : (b.monthly_target || 0) / wpm;
  const phases = (b.phases || []).map((p) => ({
    key: p.key, label: p.label, h_per_unit: p.h_per_unit,
    units: unitsW, h: unitsW * p.h_per_unit,
  }));
  const selfH = phases.reduce((s, p) => s + p.h, 0);

  let fbH = 0;
  if (b.weekly_deliveries != null && b.fb_min_per_delivery != null)
    fbH = (b.weekly_deliveries * b.fb_min_per_delivery) / 60;
  else if (b.fb_min_per_unit != null)
    fbH = (unitsW * b.fb_min_per_unit) / 60;
  else if (b.fb_h_per_unit != null)
    fbH = unitsW * b.fb_h_per_unit;

  const bufferH = (b.monthly_buffer_h || 0) / wpm;
  return {
    label: b.label, unit: b.unit || "本", unitsW, phases,
    selfH, fbH, bufferH, totalH: selfH + fbH + bufferH,
  };
}

// 今週（月曜起点）の各曜日の日付
function weekDates(now) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7;
  const mon = new Date(d); mon.setDate(d.getDate() - dow);
  return DAYS.map((day, i) => {
    const dt = new Date(mon); dt.setDate(mon.getDate() + i);
    const ymd = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    return { ...day, date: ymd };
  });
}

function eventHours(ev) {
  if (ev.hours != null) return ev.hours;
  if (ev.start && ev.end) {
    const [sh, sm] = ev.start.split(":").map(Number);
    const [eh, em] = ev.end.split(":").map(Number);
    return Math.max(0, (eh * 60 + em - sh * 60 - sm) / 60);
  }
  return 0;
}

export function computeCapacity(config, now = new Date(), events = []) {
  const cap = config.capacity;
  if (!cap) return null;
  const wpm = cap.weeks_per_month || 4.33;

  const businesses = Object.entries(cap.businesses).map(([cat, b]) => ({ cat, ...businessWeekly(b, wpm) }));
  const bizTotal = businesses.reduce((s, b) => s + b.totalH, 0);

  const oh = cap.overhead_h || {};
  const overhead = (oh.morning_roundup_per_day || 0) * 7 + (oh.weekly_mtg || 0) + (oh.monthly_extra || 0) / wpm;

  const demand = bizTotal + overhead;

  const a = cap.available_h || {};
  const sunAm = a.sun_am || 0, sunPm = a.sun_pm || 0;

  // 今週の各曜日に私用イベントの時間を割り当てて、稼働可能時間から差し引く
  const week = weekDates(now);
  const evByDate = {};
  let privateH = 0;
  const privateList = [];
  (events || []).forEach((ev) => {
    const h = eventHours(ev);
    evByDate[ev.date] = (evByDate[ev.date] || 0) + h;
  });
  week.forEach((d) => {
    const h = evByDate[d.date] || 0;
    if (h > 0) { privateH += h; privateList.push({ ...d, hours: h }); }
  });
  const evH = (key) => {
    const d = week.find((w) => w.key === key);
    return d ? (evByDate[d.date] || 0) : 0;
  };

  // 曜日ごとの素の稼働可能（私用控除後）
  const baseDay = (key) => Math.max(0, (a[key] || 0) - evH(key));
  const weekdaysSat = ["mon", "tue", "wed", "thu", "fri", "sat"].reduce((s, k) => s + baseDay(k), 0);
  const sunEv = evH("sun");
  const sunRest = Math.max(0, sunAm - sunEv);            // 午後休む前提の日曜稼働
  const sunFull = Math.max(0, sunAm + sunPm - sunEv);   // 午後も働く前提

  const availFull = weekdaysSat + sunFull;
  const availRestSun = weekdaysSat + sunRest;

  // sunday_pm_off:false = 日曜午後も稼働する方針（りゅうとんに充てる）
  const wantRest = cap.sunday_pm_off !== false;
  const sundayCanRest = wantRest && demand <= availRestSun;
  const sundayWork = !wantRest;                          // 方針として日曜も働く
  const available = (sundayCanRest) ? availRestSun : availFull;
  const balance = available - demand;

  // 日次プラン（使える時間に比例配分）。自分の制作工程は本数で表示。
  const usePm = !sundayCanRest;
  const perDay = week.map((d) => {
    let avail;
    if (d.key === "sun") avail = usePm ? sunFull : sunRest;
    else avail = baseDay(d.key);
    return { ...d, avail, privateH: evByDate[d.date] || 0 };
  });
  const totalAvail = perDay.reduce((s, d) => s + d.avail, 0) || 1;

  // 日次に出す「自分の制作工程」＝primaryに指定 or 工程を持つ全事業の各phase
  const selfBiz = businesses.filter((b) => b.phases.length > 0);
  const dailyPlan = perDay.map((d) => {
    const share = d.avail / totalAvail;
    const load = demand * share;
    // 各事業・各工程の本数目安
    const phaseUnits = selfBiz.map((b) => ({
      cat: b.cat, label: b.label,
      phases: b.phases.map((p) => ({ key: p.key, label: p.label, units: p.units * share })),
    }));
    return {
      key: d.key, label: d.label, date: d.date, avail: d.avail, load,
      phaseUnits, balance: d.avail - load, privateH: d.privateH,
      isRest: d.key === "sun" && sundayCanRest,
    };
  });

  return {
    businesses, bizTotal, overhead, demand,
    availFull, availRestSun, available, balance, sundayCanRest, sundayWork,
    selfBiz, dailyPlan, privateH, privateList,
  };
}

export const round1 = (n) => Math.round(n * 10) / 10;

const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * 実績 vs 目標（自分の制作工程ごと）。outputLog = { 'YYYY-MM-DD': { cat: { phaseKey: n } } }
 * c = computeCapacity の戻り値
 */
export function computeOutput(c, now, outputLog = {}) {
  const todayYmd = ymdOf(new Date(now));
  const today = c.dailyPlan.find((d) => d.date === todayYmd);
  const rows = [];

  c.selfBiz.forEach((b) => {
    b.phases.forEach((p) => {
      const weekTarget = Math.round(p.units); // p.units は週合計
      let weekActual = 0;
      c.dailyPlan.forEach((d) => { weekActual += (outputLog[d.date]?.[b.cat]?.[p.key]) || 0; });
      const todayActual = (outputLog[todayYmd]?.[b.cat]?.[p.key]) || 0;
      const tp = today?.phaseUnits.find((x) => x.cat === b.cat)?.phases.find((y) => y.key === p.key);
      const todayTarget = today && !today.isRest ? Math.round(tp?.units || 0) : 0;
      rows.push({
        cat: b.cat, biz: b.label, key: p.key, label: p.label,
        weekTarget, weekActual, todayTarget, todayActual,
      });
    });
  });

  const todayMet = rows.every((r) => r.todayActual >= r.todayTarget);
  const todayOver = rows.some((r) => r.todayActual > r.todayTarget);
  const weekMet = rows.every((r) => r.weekActual >= r.weekTarget);
  const todayExtra = rows.reduce((s, r) => s + Math.max(0, r.todayActual - r.todayTarget), 0);

  return { rows, todayYmd, todayMet, todayOver, weekMet, todayExtra };
}
