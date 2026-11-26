// World units are metres. Travel increases downstream, while the camera looks along -Z.
export const finish = 600;
export const reach = 8;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const center = d => 3.8 * Math.sin(d / 35) + 2.3 * Math.sin(d / 19);
export const bank = (d, side) => center(d) + side * (11.8 + 0.7 * Math.sin(d / 7 + side));

// Fixed gates make timed runs comparable. Every pair leaves a boat-width route.
const layouts = [[0], [-5, 3], [4], [-2, 6], [-6], [-4, 2], [0, 6], [-6, 1]];
export const rocks = [];
for (let i = 0, d = 34; d < finish - 10; i++, d += 17 + (i % 4)) {
  for (const [j, offset] of layouts[i % layouts.length].entries()) {
    rocks.push({d, x: center(d) + offset, r: 1.15 + ((i + j) % 3) * 0.13});
  }
}

export function newRun() {
  return {d: 0, lateral: 0, speed: 9, time: 0, turn: 0};
}

export function advance(run, dt, lateralTarget, throttle) {
  // Exact critically damped spring for a held target. Reversing input preserves hull velocity.
  const target = clamp(lateralTarget, -reach, reach);
  const offset = run.lateral - target;
  const response = 25;
  const decay = Math.exp(-response * dt);
  const impulse = (run.turn + response * offset) * dt;
  run.lateral = target + (offset + impulse) * decay;
  run.turn = (run.turn - response * impulse) * decay;
  run.speed += (10 + 6 * clamp(throttle, -1, 1) - run.speed) * (1 - Math.exp(-3 * dt));
  run.d = Math.min(finish, run.d + run.speed * dt);
  run.time += dt;
  const worldX = center(run.d) + run.lateral;
  for (const rock of rocks) {
    if (Math.abs(run.d - rock.d) > 3) continue;
    // Ellipse approximates the longer hull along the direction of travel.
    if (((worldX - rock.x) / (rock.r + 0.65)) ** 2 +
        ((run.d - rock.d) / (rock.r + 1.35)) ** 2 < 1) return 'crash';
  }
  return run.d >= finish ? 'finish' : 'running';
}
