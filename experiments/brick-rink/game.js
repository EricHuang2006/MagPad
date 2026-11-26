import {W,H,BAT,STEP,match,step,targetOnSide} from './match.js';
import {MagPad} from '../river-run/src/magpad.js';
import {renderer} from './paint.js';

const el = id => document.getElementById(id);
const canvas = document.querySelector('canvas');
const draw = renderer(canvas);
const pad = new MagPad();
let game = match(), mode = 'ready', usingPad = false, busy = false;
let dest = {...game.bats[0]}, last = performance.now(), carry = 0;
const keys = new Set();

function show(id,value) {
  if (el(id).textContent !== value) el(id).textContent = value;
}

function pause(reason='Take a breather. The match clock is paused.') {
  if (mode !== 'play') return;
  mode = 'paused'; keys.clear(); carry = 0;
  show('title','Time out'); show('hint',reason); show('play','Resume');
  sync(performance.now());
}

function sync(now) {
  el('overlay').hidden = mode === 'play';
  el('play').disabled = busy || (usingPad && !pad.tracking(now));
  el('pause').disabled = mode !== 'play';
  show('home',String(game.score[0]).padStart(2,'0'));
  show('away',String(game.score[1]).padStart(2,'0'));
  const sec = Math.ceil(game.time);
  show('time',game.overtime ? 'OT' : Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'));
  show('period',game.overtime ? 'Sudden death' : 'Match clock');
  el('call').hidden = mode !== 'play' || game.serve <= 0;
  if (!el('call').hidden) show('call', game.message);
  show('input',usingPad ? 'MagPad USB' : 'Pointer / arrow keys');
  show('connect', usingPad ? 'Disconnect' : 'Connect MagPad');
  el('connect').disabled = busy || !navigator.serial;
  el('measure').hidden = !usingPad;
  el('measure').disabled = busy || pad.seenToken === null;
  if (usingPad) show('status',pad.state === 3 && !pad.tracking(now)
    ? 'Tracking interrupted. Check the board and magnet.' : pad.status);
}

el('play').onclick = () => {
  if (busy || (usingPad && !pad.tracking(performance.now()))) return;
  if (mode === 'finished') { game = match(); dest = {...game.bats[0]}; }
  mode = 'play'; carry = 0; last = performance.now();
  sync(last);
};
el('pause').onclick = () => pause();
el('connect').onclick = async () => {
  if (busy) return;
  pause(); busy = true; sync(performance.now());
  try {
    if (usingPad) {
      await pad.close(); usingPad = false; show('status','MagPad disconnected. Pointer and arrow keys are ready.');
    } else {
      await pad.connect(); usingPad = true;
    }
  } catch (err) {
    show('status',err.name === 'NotFoundError' ? 'No port selected. Pointer and arrow keys are ready.' : 'USB connection failed. '+err.message);
  } finally { busy = false; sync(performance.now()); }
};
el('measure').onclick = async () => {
  if (!usingPad || busy) return;
  pause('Measuring background. Resume when the magnet is tracking.'); busy = true;
  try { await pad.measure(); } catch(err) { pad.status = 'Background measurement failed. '+err.message; }
  finally { busy = false; sync(performance.now()); }
};
if (!navigator.serial) show('status','For USB, open this game in desktop Chromium. Pointer and arrow keys are ready.');

function point(e) {
  if (usingPad || mode !== 'play') return;
  const r=canvas.getBoundingClientRect();
  dest=targetOnSide((e.clientX-r.left)/r.width*W,(e.clientY-r.top)/r.height*H,0);
}
canvas.onpointerdown = e => {canvas.setPointerCapture(e.pointerId); point(e);};
canvas.onpointermove = point;
window.addEventListener('keydown', e => {
  if (e.key==='Escape') {pause();return;}
  if (!usingPad && mode==='play' && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
    e.preventDefault();keys.add(e.key);
  }
});
window.addEventListener('keyup',e=>keys.delete(e.key));
window.addEventListener('blur',()=>pause());
document.addEventListener('visibilitychange',()=>{if(document.hidden) pause();});

function tick(now) {
  const dt=Math.min(.05,Math.max(0,(now-last)/1000)); last=now;
  if (usingPad && !busy && !pad.port) {
    pause('USB disconnected. Resume with the pointer or reconnect the board.');
    usingPad=false; show('status','USB disconnected. Pointer and arrow keys are ready.');
    dest={...game.bats[0]};
  }
  if (usingPad && !pad.tracking(now)) pause('Tracking paused. Restore the magnet signal, then resume.');
  if (mode==='play') {
    if (usingPad) {
      const x=35 + (pad.x/30+1)/2*(W/2-BAT-35);
      const y=BAT+2 + (1-pad.y/30)/2*(H-2*(BAT+2));
      dest=targetOnSide(x,y,0);
    } else if(keys.size) {
      const dx=Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft'));
      const dy=Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));
      const travel=810*dt/(Math.hypot(dx,dy)||1);
      dest=targetOnSide(dest.x+dx*travel,dest.y+dy*travel,0);
    }
    carry+=dt;
    while(carry>=STEP){step(game,dest,STEP);carry-=STEP;}
    if(game.winner!==null){
      mode='finished';keys.clear();show('title',game.winner===0?'You win!':'CPU wins');
      show('hint',(game.overtime?'Sudden death':'Full time')+' · '+game.score.join(' – '));
      show('play','Play again');
    }
  }
  draw(game,game.events.splice(0),dt,mode==='play');sync(now);requestAnimationFrame(tick);
}
sync(last);requestAnimationFrame(tick);
