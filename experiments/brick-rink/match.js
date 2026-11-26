// Distances are rink units. All velocities are rink units per second.
export const W = 1000, H = 520, R = 10, BAT = 29;
export const GOAL_TOP = 116, GOAL_BOTTOM = H - GOAL_TOP;
export const STEP = 1 / 240;
const PUCK_PACE = 0.75;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function targetOnSide(x, y, side) {
  const left = side === 0;
  return {
    x: clamp(x, left ? 35 : W / 2 + BAT, left ? W / 2 - BAT : W - 35),
    y: clamp(y, BAT + 2, H - BAT - 2)
  };
}

function paddle(x) { return {x, y: H / 2, vx: 0, vy: 0}; }

function wall() {
  const bricks = [];
  for (const side of [0, 1]) {
    for (let i = 0; i < 6; i++) {
      bricks.push({x: side ? W - 44 : 27, y: GOAL_TOP + 48 * i + 2,
        w: 17, h: 44, side, alive: true});
    }
  }
  return bricks;
}

export function match() {
  const m = {time: 90, score: [0, 0], bricks: wall(), bats: [paddle(190), paddle(810)],
    pucks: [], overtime: false, winner: null, serve: 0, message: '', events: []};
  faceoff(m, Math.random() < 0.5 ? -1 : 1, 'Face-off');
  return m;
}

function faceoff(m, dir, message) {
  m.serve = 1.25;
  m.message = message;
  const vx = dir * 330 * PUCK_PACE;
  const vy = (Math.random() < 0.5 ? -1 : 1) * (85 + Math.random() * 90) * PUCK_PACE;
  m.pucks = [{x: W / 2, y: H / 2, vx, vy, trail: []}];
  if (m.overtime) {
    m.pucks[0].y -= 56;
    m.pucks.push({x: W / 2, y: H / 2 + 56, vx: -vx, vy: -vy, trail: []});
  }
}

function moveBat(b, dest, speed, dt) {
  const dx = dest.x - b.x, dy = dest.y - b.y;
  const ratio = Math.min(1, speed * dt / (Math.hypot(dx, dy) || 1));
  b.vx = dx * ratio / dt;
  b.vy = dy * ratio / dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}

function opponent(m) {
  const b = m.bats[1];
  const p = m.pucks.reduce((a, c) => c.x > a.x ? c : a);
  // Get behind the puck before striking. A small aiming offset leaves bank shots open.
  if (p.x > W / 2 + 8 && !m.serve) {
    const behind = p.x > b.x + 4;
    const gap = m.bricks.filter(k => !k.side && !k.alive);
    const aim = gap.length ? gap.reduce((a,c) =>
      Math.abs(c.y + 22 - p.y) < Math.abs(a.y + 22 - p.y) ? c : a).y + 22 : H / 2;
    const slope = (p.y - aim) / Math.max(120, p.x);
    return targetOnSide(p.x + (behind ? 58 : -16),
      p.y + (behind ? (b.y > p.y ? 48 : -48) : -16 * slope), 1);
  }
  return targetOnSide(W - 146, H / 2 + (p.y - H / 2) * 0.50, 1);
}

function bounceBat(p, b, side, m) {
  const dx = p.x - b.x, dy = p.y - b.y, d = Math.hypot(dx, dy);
  if (d >= BAT + R) return;
  const nx = d ? dx / d : (side ? -1 : 1), ny = d ? dy / d : 0;
  p.x = b.x + nx * (BAT + R + 0.05);
  p.y = b.y + ny * (BAT + R + 0.05);
  const approach = (p.vx - b.vx * PUCK_PACE) * nx + (p.vy - b.vy * PUCK_PACE) * ny;
  if (approach >= 0) return;
  p.vx -= 1.87 * approach * nx;
  p.vy -= 1.87 * approach * ny;
  const speed = Math.hypot(p.vx, p.vy);
  const scale = Math.min(1, 1120 * PUCK_PACE / (speed || 1));
  p.vx *= scale; p.vy *= scale;
  if (approach < -65) m.events.push({type: 'hit', x: p.x, y: p.y, side});
}

function bounceBrick(p, b, m) {
  const dx = p.x - clamp(p.x, b.x, b.x+b.w), dy = p.y - clamp(p.y, b.y, b.y+b.h);
  const distance = Math.hypot(dx, dy);
  if (distance >= R) return false;
  const nx = distance ? dx / distance : b.side ? -1 : 1;
  const ny = distance ? dy / distance : 0;
  p.x += nx * (R - distance + 0.05); p.y += ny * (R - distance + 0.05);
  const inward = p.vx * nx + p.vy * ny;
  if (inward < 0) { p.vx -= 2 * inward * nx; p.vy -= 2 * inward * ny; }
  b.alive = false;
  m.events.push({type: 'brick', x: b.x + b.w/2, y: b.y + b.h/2, side: b.side});
  return true;
}

function goal(m, side) {
  m.score[side]++;
  m.events.push({type: 'goal', side});
  if (m.overtime) m.winner = side;
  else faceoff(m, side === 0 ? 1 : -1, side === 0 ? 'You scored!' : 'CPU scored');
}

export function step(m, dest, dt) {
  if (m.winner !== null) return;
  moveBat(m.bats[0], targetOnSide(dest.x, dest.y, 0), 1850, dt);
  moveBat(m.bats[1], opponent(m), 520, dt);
  if (m.serve > 0) { m.serve = Math.max(0, m.serve - dt); return; }
  if (!m.overtime && (m.time = Math.max(0, m.time - dt)) === 0) {
    if (m.score[0] !== m.score[1]) m.winner = m.score[0] > m.score[1] ? 0 : 1;
    else {
      m.overtime = true;
      for (const b of m.bricks) b.alive = false;
      faceoff(m, 1, 'Sudden death');
    }
    return;
  }
  for (const p of m.pucks) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    for (const [i, b] of m.bats.entries()) bounceBat(p, b, i, m);
    for (const b of m.bricks) if (b.alive && bounceBrick(p, b, m)) break;
    if (p.y < R) { p.y = R; p.vy = Math.abs(p.vy); }
    if (p.y > H-R) { p.y = H-R; p.vy = -Math.abs(p.vy); }
    if (p.y < GOAL_TOP+R || p.y > GOAL_BOTTOM-R) {
      if (p.x < R) { p.x = R; p.vx = Math.abs(p.vx); }
      if (p.x > W-R) { p.x = W-R; p.vx = -Math.abs(p.vx); }
    }
    if (p.x < -R || p.x > W+R) { goal(m, p.x < 0 ? 1 : 0); return; }
  }
}
