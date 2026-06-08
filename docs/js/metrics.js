// metrics.js — 集計と健全度%の算出（純粋関数のみ）

const DAY = 24 * 60 * 60 * 1000;
const EPS = 1e-6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 工程の完了判定
export const isDone = (cp) => cp.state === "done";
export const isOpen = (cp) => cp.state === "not_started" || cp.state === "in_progress";
// na（不要）は分母から除外
const countable = (cps) => cps.filter((c) => c.state !== "na");

// 案件の全工程をフラットに
function allCheckpoints(project) {
  return project.assignments.flatMap((a) => a.checkpoints);
}

// 案件単位の完了率（0〜1）
export function projectDoneRatio(project) {
  const cps = countable(allCheckpoints(project));
  if (cps.length === 0) return 0;
  return cps.filter(isDone).length / cps.length;
}

// 担当者×案件の完了率（assignment 単位）
export function assignmentDoneRatio(assignment) {
  const cps = countable(assignment.checkpoints);
  if (cps.length === 0) return 0;
  return cps.filter(isDone).length / cps.length;
}

/**
 * 健全度%（実績 + 納期までの残時間 + 進行ペースの合成）
 * @param {object} ctx { doneRatio, createdAt, dueAt, remaining, pace, now, weights }
 */
export function healthPct(ctx) {
  const { doneRatio, createdAt, dueAt, remaining, now } = ctx;
  const pace = Math.max(ctx.pace || 0, EPS);
  const w = ctx.weights || { done: 0.6, slack: 0.4 };

  const span = Math.max(new Date(dueAt) - new Date(createdAt), EPS);
  const etaMs = (remaining / pace) * DAY; // 残工程をそのペースで消化する予測時間
  const predictedFinish = now.getTime() + etaMs;
  const slackRatio = clamp((new Date(dueAt).getTime() - predictedFinish) / span, -1, 1);

  const score = w.done * doneRatio + w.slack * (0.5 + slackRatio / 2);
  return {
    pct: Math.round(100 * clamp(score, 0, 1)),
    slackRatio,
    band: slackRatio >= 0 ? "ok" : slackRatio > -0.4 ? "warn" : "danger",
  };
}

// 案件×担当者ごとの健全度
export function assignmentHealth(project, assignment, members, config, now) {
  const cps = countable(assignment.checkpoints);
  const remaining = cps.filter(isOpen).length;
  const member = members.find((m) => m.id === assignment.member_id);
  const pace = (member && member.pace_per_day) || (config.default_pace_per_day ?? 1.5);
  return healthPct({
    doneRatio: assignmentDoneRatio(assignment),
    createdAt: project.created_at,
    dueAt: project.due_at,
    remaining,
    pace,
    now,
    weights: config.health_weights,
  });
}

// ---- 期間フィルタ（日/週/月） ----
function rangeFor(span, now) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  if (span === "day") {
    end.setDate(end.getDate() + 1);
  } else if (span === "week") {
    const dow = (start.getDay() + 6) % 7; // 月曜起点
    start.setDate(start.getDate() - dow);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 7);
  } else {
    start.setDate(1);
    end.setTime(start.getTime());
    end.setMonth(end.getMonth() + 1);
  }
  return { start, end };
}

const inRange = (dateStr, r) => {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= r.start && d < r.end;
};

// 期間内に「関係する」案件（締切 or 作成が範囲内、active/on_hold）
export function projectsInSpan(projects, span, now) {
  const r = rangeFor(span, now);
  return projects.filter((p) => {
    if (p.status === "canceled") return false;
    return inRange(p.due_at, r) || inRange(p.created_at, r) || (span === "day" && p.status === "active");
  });
}

// ---- ダッシュボード上部メトリクス ----
export function summaryMetrics(data, span, now) {
  const r = rangeFor(span, now);
  const active = data.projects.filter((p) => p.status === "active" || p.status === "on_hold");

  // 消化率（工程ベース・期間内案件）
  const scoped = projectsInSpan(data.projects, span, now);
  const cps = scoped.flatMap(allCheckpoints).filter((c) => c.state !== "na");
  const doneCount = cps.filter(isDone).length;
  const consumeRate = cps.length ? Math.round((100 * doneCount) / cps.length) : 0;

  // 新規流入
  const inflow = data.projects.filter((p) => p.is_new_inflow && inRange(p.created_at, r)).length;

  // FB待ち（誰待ち）件数＝openなcheckpointを持つactive案件
  let waiting = 0;
  active.forEach((p) => {
    if (p.status !== "active") return;
    if (allCheckpoints(p).some(isOpen)) waiting++;
  });

  // 締切逼迫
  const today = new Date(now); today.setHours(23, 59, 59, 999);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  let dueToday = 0, overdue = 0;
  active.forEach((p) => {
    if (p.status !== "active" || !p.due_at) return;
    const d = new Date(p.due_at);
    if (d < now) overdue++;
    else if (d <= today) dueToday++;
  });

  return {
    consumeRate, doneCount, totalCp: cps.length,
    inflow, waiting,
    dueToday, overdue,
    interrupts: active.filter((p) => p.is_interrupt && p.status === "active").length,
  };
}

// ---- 担当者別ボード ----
export function memberBoard(data, now) {
  return data.members.map((m) => {
    const items = [];
    data.projects.forEach((p) => {
      if (p.status === "canceled" || p.status === "done") return;
      p.assignments.forEach((a) => {
        if (a.member_id !== m.id) return;
        const open = countable(a.checkpoints).filter(isOpen).length;
        const total = countable(a.checkpoints).length;
        items.push({
          project: p, assignment: a,
          open, total,
          done: total - open,
          health: assignmentHealth(p, a, data.members, data.config, now),
        });
      });
    });
    const totalCp = items.reduce((s, i) => s + i.total, 0);
    const doneCp = items.reduce((s, i) => s + i.done, 0);
    return {
      member: m,
      items,
      waitingCount: items.filter((i) => i.open > 0).length,
      avgHealth: items.length ? Math.round(items.reduce((s, i) => s + i.health.pct, 0) / items.length) : 100,
      progressRate: totalCp ? Math.round((100 * doneCp) / totalCp) : 100,
    };
  }).filter((mb) => mb.items.length > 0);
}

// ---- ボールの所在（次に動くべき工程と担当者）----
export function ballHolder(project) {
  for (const a of project.assignments) {
    const open = a.checkpoints.find(isOpen);
    if (open) return { member_id: a.member_id, assignment: a, checkpoint: open };
  }
  return null;
}

const catRule = (config, cat) =>
  (config.cat_rules && config.cat_rules[cat]) || { warn_slack: 0, priority: 9, label: cat };

/**
 * 今日のアクション：自分が上げる / 進捗確認すべき / 待ち（放置OK） に分類
 */
export function actionItems(data, now) {
  const me = data.config.me || "ryuto";
  const items = [];
  data.projects.forEach((p) => {
    if (p.status !== "active") return; // 保留/中止/完了は除外
    const ball = ballHolder(p);
    if (!ball) return;
    const rule = catRule(data.config, p.cat);
    const health = assignmentHealth(p, ball.assignment, data.members, data.config, now);
    const overdue = p.due_at ? new Date(p.due_at) < now : false;
    const behind = overdue || health.slackRatio < rule.warn_slack;
    const member = data.members.find((m) => m.id === ball.member_id);

    let type;
    if (ball.member_id === me) type = "self";       // 自分にボール → 上げる
    else if (behind) type = "chase";                // ワーカーが遅延 → 進捗確認
    else type = "waiting";                          // ワーカー対応中・予定通り → 放置OK

    const days = p.due_at ? Math.ceil((new Date(p.due_at) - now) / DAY) : null;
    items.push({
      project: p, ball, member, health, type, overdue, behind,
      doneRatio: assignmentDoneRatio(ball.assignment),
      daysToDue: days, priority: rule.priority, catLabel: rule.label,
    });
  });

  // 優先度: chase(遅延きつい順) → self(遅延きつい順) → waiting。同条件はカテゴリ優先度
  const order = { chase: 0, self: 1, waiting: 2 };
  items.sort((a, b) =>
    order[a.type] - order[b.type] ||
    a.health.slackRatio - b.health.slackRatio ||
    a.priority - b.priority);

  return {
    chase: items.filter((i) => i.type === "chase"),
    self: items.filter((i) => i.type === "self"),
    waiting: items.filter((i) => i.type === "waiting"),
  };
}

export const helpers = { projectDoneRatio, allCheckpoints, rangeFor };
