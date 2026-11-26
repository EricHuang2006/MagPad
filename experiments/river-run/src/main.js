import {advance, clamp, finish, newRun, reach} from './course.js';
import {createScene} from './scene.js';
import {MagPad} from './magpad.js';

const el = id => document.getElementById(id);
const pad = new MagPad();
const keys = new Set();
let run = newRun(), phase = 'ready', keyboardX = 0, usingPad = false, working = false;
const step = 1/120;
let accumulator = 0, previous = {...run}, pose = {...run};
let nextHud = 0;
let best;
try { best = Number(localStorage.getItem('alder-narrows-best')); } catch { best = 0; }
function timeLabel(seconds) {
  const tenths = Math.floor(seconds * 10);
  return Math.floor(tenths / 600) + ':' + String(Math.floor(tenths / 10) % 60).padStart(2, '0') + '.' + tenths % 10;
}
const trackable = () => !usingPad || pad.tracking(performance.now());
function status(message) {
  if (el('status').textContent !== message) el('status').textContent = message;
}

function panel(next, title, message, action) {
  phase = next; nextHud = 0;
  el('panel').hidden = false;
  el('title').textContent = title;
  el('message').textContent = message;
  el('launch').firstChild.textContent = action + ' ';
  el('pause').hidden = true;
}

function pause(message = 'Resume when you’re ready to head downstream.') {
  keys.clear();
  if (phase === 'running') panel('paused','Run paused',message,'Resume');
}

function launch() {
  if (!trackable() || phase === 'running') return;
  if (phase !== 'paused') run = newRun();
  keyboardX = run.lateral;
  Object.assign(previous,run); accumulator = 0; last = performance.now();
  keys.clear();
  phase = 'running'; nextHud = 0;
  el('launch').blur();
  el('panel').hidden = true;
  el('pause').hidden = false;
}

function end(result) {
  if (result === 'crash') {
    panel(result,'Ran aground', 'You hit a rock at ' + Math.floor(run.d) + ' m. Steer earlier or pull back to slow down.', 'Try again');
  } else {
    if (!best || run.time < best) {
      best = run.time;
      try { localStorage.setItem('alder-narrows-best', String(best)); } catch { /* Session best still works. */ }
    }
    panel(result,'Finish line!', 'Your time ' + timeLabel(run.time) + ' · Best ' + timeLabel(best), 'Race again');
  }
}

function inputMode(board) {
  usingPad = board;
  keys.clear(); keyboardX = run.lateral;
  el('connect').textContent = board ? 'Disconnect' : 'Connect MagPad';
  el('baseline').hidden = !board;
  el('baseline').disabled = board && pad.seenToken === null;
  el('launch').disabled = !trackable();
  el('source').lastChild.textContent = board ? ' MagPad USB' : ' Keyboard';
  el('mode').textContent = board ? 'Magnet controls' : 'Keyboard controls';
  if (board) el('instructions').textContent = 'Slide left / right to steer · Push forward for speed';
  else el('instructions').innerHTML = '<kbd>←</kbd><kbd>→</kbd> Steer &nbsp; <kbd>↑</kbd><kbd>↓</kbd> Speed';
}

el('connect').onclick = async () => {
  if (working) return;
  pause();
  working = true; el('connect').disabled = true;
  try {
    if (usingPad) {
      await pad.close(); inputMode(false); status('Keyboard ready.');
    } else {
      await pad.connect(); inputMode(true);
    }
  } catch (error) {
    status(error.name === 'NotFoundError' ? 'Port selection canceled.' : 'Connection failed. ' + error.message);
  } finally {
    working = false; el('connect').disabled = false;
  }
};
el('baseline').onclick = async () => {
  pause('Background measurement paused the run. Return the magnet to the pad to resume.');
  try { await pad.measure(); } catch (error) { pad.status = 'Background command failed. ' + error.message; }
};
el('launch').onclick = launch;
el('pause').onclick = () => pause();
if (!('serial' in navigator)) {
  el('connect').disabled = true;
  status('Keyboard ready. Open in desktop Chrome or Chromium for MagPad USB.');
}
if (best > 0) el('message').textContent += ' Best ' + timeLabel(best) + '.';

const arrows = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { pause(); return; }
  if (phase === 'running' && !usingPad && arrows.includes(event.code)) {
    event.preventDefault(); keys.add(event.code);
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => pause());
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

let draw;
try { draw = createScene(el('river')); }
catch (error) {
  panel('error','Graphics unavailable','Enable WebGL 2 or hardware acceleration in your browser, then reload.','Launch boat');
  el('launch').hidden = true; console.error(error);
}
let last = performance.now();
function frame(now) {
  const dt = Math.max(0,(now-last)/1000); last = now;
  if (usingPad && !pad.port && !working) {
    pause('The board disconnected. Reconnect it or resume using the arrow keys.');
    inputMode(false); status('MagPad disconnected. Keyboard ready.');
  }
  if (usingPad) {
    el('baseline').disabled = pad.seenToken === null || working;
    if (!trackable()) pause('Tracking paused. Check the controller status below, then resume.');
    const stale = pad.state === 3 && !pad.tracking(now);
    status(stale ? 'Waiting for fresh positions from the board.' : pad.status);
  }
  el('launch').disabled = !trackable();
  if (phase === 'running') {
    // Use small physics steps even if a render frame misses its deadline.
    accumulator += Math.min(dt,.25);
    const steering = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    const throttle = usingPad ? pad.y/30 : Number(keys.has('ArrowUp'))-Number(keys.has('ArrowDown'));
    while (accumulator >= step && phase === 'running') {
      Object.assign(previous,run);
      keyboardX = clamp(keyboardX + steering*14*step,-reach,reach);
      const target = usingPad ? reach*pad.x/30 : keyboardX;
      const result = advance(run,step,target,throttle);
      accumulator -= step;
      if (result !== 'running') end(result);
    }
  }
  const alpha = phase==='running' ? accumulator/step : 1;
  for (const key of ['d','lateral','turn','speed']) {
    pose[key]=previous[key]+(run[key]-previous[key])*alpha;
  }
  if (now>=nextHud) {
    el('distance').textContent = String(Math.floor(run.d)).padStart(3,'0');
    el('speed').textContent = phase==='ready' ? '0' : Math.round(run.speed);
    el('timer').textContent = timeLabel(run.time);
    el('progress').style.width = (100*run.d/finish)+'%';
    nextHud = phase==='running' ? now+85 : Infinity;
  }
  draw(pose,now/1000,dt);
  requestAnimationFrame(frame);
}
if (draw) requestAnimationFrame(frame);
