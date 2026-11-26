import {W, H, BAT, R, GOAL_TOP, GOAL_BOTTOM} from './match.js';

const colors = ['#117e73', '#d76032'];
const highlights = ['#83e5bf', '#ffb17c'];

export function renderer(canvas) {
  const ctx = canvas.getContext('2d');
  const base = document.createElement('canvas');
  const g = base.getContext('2d');
  function disk(c,x,y,r,fill,stroke,width=1) {
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2);
    if (fill) { c.fillStyle=fill; c.fill(); }
    if (stroke) { c.strokeStyle=stroke; c.lineWidth=width; c.stroke(); }
  }
  function line(c,x,y,u,v,color,width) {
    c.strokeStyle=color; c.lineWidth=width; c.beginPath(); c.moveTo(x,y); c.lineTo(u,v); c.stroke();
  }
  function printTable() {
    const ratio = Math.min(2, Math.max(1, devicePixelRatio || 1));
    for (const el of [canvas,base]) { el.width=W*ratio; el.height=H*ratio; }
    g.scale(ratio,ratio); ctx.scale(ratio,ratio);
    g.fillStyle='#f3ecd4'; g.fillRect(0,0,W,H);
    g.fillStyle='#c7c4aa';
    for(let x=7;x<W;x+=13) for(let y=7;y<H;y+=13) g.fillRect(x,y,1.25,1.25);
    const cy=H/2;
    line(g,W/2,0,W/2,H,'#b39779',2);
    disk(g,W/2,cy,80,null,'#b39779',2); disk(g,W/2,cy,71,null,'#c9b89a',1);
    g.save(); g.translate(W/2,cy); g.rotate(-0.2); g.fillStyle='#bbac8a';
    g.beginPath(); g.moveTo(5,-31); g.lineTo(-23,5); g.lineTo(-4,5);
    g.lineTo(-12,31); g.lineTo(24,-8); g.lineTo(4,-8); g.closePath(); g.fill(); g.restore();
    for(const side of [0,1]) {
      g.save(); if(side){g.translate(W,0);g.scale(-1,1);}
      g.fillStyle=side?'#e8a17c':'#86bfb0'; g.fillRect(0,GOAL_TOP,14,GOAL_BOTTOM-GOAL_TOP);
      for(let y=GOAL_TOP+4;y<GOAL_BOTTOM-6;y+=12)
        line(g,1,y+7,12,y,'#f3ecd4',2);
      g.strokeStyle=side?'#cb9578':'#80a79a';g.lineWidth=2;
      g.beginPath(); g.arc(0,cy,155,-Math.PI/2,Math.PI/2);g.stroke();
      g.setLineDash([5,8]);g.beginPath();g.arc(0,cy,169,-Math.PI/2,Math.PI/2);g.stroke();g.setLineDash([]);
      for(const y of [100,H-100]) {
        disk(g,268,y,23,null,'#c8bda2',1.8);
        line(g,261,y,275,y,'#b9ab91',1.5);line(g,268,y-7,268,y+7,'#b9ab91',1.5);
      }
      g.restore();
    }
    for(const y of [5,H-5]) for(let x=22;x<W;x+=20)
      line(g,x,y,x,y+(y===5?1:-1)*(x%100===22?9:4),'#a59378',1.5);
  }
  printTable();
  const sparks=[];
  return function paint(m,events,dt,live) {
    ctx.drawImage(base,0,0,W,H);
    for(const b of m.bricks) {
      if(!b.alive) continue;
      ctx.fillStyle='#60594a';ctx.fillRect(b.x+2,b.y+3,b.w,b.h);
      ctx.fillStyle=colors[b.side];ctx.fillRect(b.x,b.y,b.w,b.h);
      ctx.fillStyle=highlights[b.side];ctx.fillRect(b.x+2,b.y+2,3,b.h-5);
      ctx.fillRect(b.x+2,b.y+2,b.w-4,3);
    }
    for(const [side,b] of m.bats.entries()) {
      disk(ctx,b.x+2,b.y+4,BAT+1,'#2e302f47');
      disk(ctx,b.x,b.y,BAT,colors[side],'#243b38',2.4);
      disk(ctx,b.x,b.y-2,BAT-5,null,highlights[side],2);
      disk(ctx,b.x,b.y,14,colors[side],'#233a39',2);
      disk(ctx,b.x,b.y-2,12,highlights[side]); disk(ctx,b.x,b.y-3,8,colors[side]);
    }
    for(const p of m.pucks) {
      if(live && (!p.trail.length || Math.hypot(p.trail.at(-1).x-p.x,p.trail.at(-1).y-p.y)>5)){
        p.trail.push({x:p.x,y:p.y}); if(p.trail.length>6)p.trail.shift();
      }
      for(const [i,t] of p.trail.entries()) disk(ctx,t.x,t.y,3+i*.8,'#253f3926');
      disk(ctx,p.x+1,p.y+2,R,'#24362f60');disk(ctx,p.x,p.y,R,'#172f39','#0e2029',2);
      disk(ctx,p.x,p.y-1,6,null,'#79938e',1.3);
    }
    for(const e of events) if(e.type==='brick'){
      for(let i=0;i<13;i++){
        const a=Math.random()*Math.PI*2,speed=45+Math.random()*170;
        sparks.push({x:e.x,y:e.y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed,
          life:.35+Math.random()*.2, side:e.side});
      }
    }
    for(let i=sparks.length-1;i>=0;i--){
      const s=sparks[i];s.life-=dt;s.x+=s.vx*dt;s.y+=s.vy*dt;
      if(s.life<=0){sparks.splice(i,1);continue;}
      ctx.globalAlpha=Math.min(1,s.life*4);ctx.fillStyle=colors[s.side];ctx.fillRect(s.x,s.y,5,5);
    }
    ctx.globalAlpha=1;
  };
}
