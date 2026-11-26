import * as T from '../vendor/three/three.module.min.js';
import {bank} from './course.js';

// Paint the distant ridges once. Each face shares its ridge endpoints with its neighbour.
export function addSkyline(scene, random) {
  const sky = document.createElement('canvas');
  sky.width=2048; sky.height=640;
  const ctx=sky.getContext('2d'), w=sky.width, h=sky.height;
  const skyColor=ctx.createLinearGradient(0,0,0,h);
  for (const [stop,color] of [[0,'#7baebb'],[.45,'#bcd4cc'],[.78,'#f7dba9'],[1,'#c9d9c2']])
    skyColor.addColorStop(stop,color);
  ctx.fillStyle=skyColor;ctx.fillRect(0,0,w,h);
  const sunX=w*.57, sunY=276;
  const glow=ctx.createRadialGradient(sunX,sunY,10,sunX,sunY,118);
  glow.addColorStop(0,'rgba(255,219,150,.65)');glow.addColorStop(1,'rgba(255,222,160,0)');
  ctx.fillStyle=glow;ctx.fillRect(sunX-118,sunY-118,236,236);
  ctx.fillStyle='#ffe9b4';ctx.beginPath();ctx.ellipse(sunX,sunY,12,25,0,0,Math.PI*2);ctx.fill();
  for(let i=0;i<65;i++) {
    const x=random()*w,y=95+random()*225,size=15+random()*75;
    ctx.fillStyle='rgba(255,242,208,.35)';
    ctx.beginPath();ctx.ellipse(x,y,size,1+random()*3,0,0,2*Math.PI);ctx.fill();
  }
  function polygon(points,fill){
    ctx.fillStyle=fill;ctx.beginPath();
    for(const [x,y] of points) ctx.lineTo(x,y);
    ctx.closePath();ctx.fill();
  }
  for(let layer=0;layer<3;layer++) {
    const floor=510+layer*40, points=[];
    for(let x=-70;x<=w+100;x+=18+random()*23){
      const envelope=.5+.5*Math.cos(x/(72+layer*19)+layer*2.7);
      const y=floor-55-(28+layer*4)*random()-envelope*(130-layer*32);
      points.push([x,y]);
    }
    const light=['#bccbc5','#a4b9b1','#95afa2'][layer];
    const shade=['#a7bcbc','#91adab','#85a299'][layer];
    polygon([...points,[w+100,h],[-70,h]],light);
    for(let i=1;i<points.length-1;i++) {
      const [x,y]=points[i], [nx,ny]=points[i+1];
      const spur=[x+5+(nx-x)*.55,ny+12+random()*23];
      const foot=[x+24+random()*47,floor+12];
      if(ny>y) {
        polygon([[x,y],[nx,ny],foot,spur],shade);
        if(layer===1 && y<395) {
          polygon([[x,y],[nx,ny],[nx-8,ny+11],[x+12,y+12],[x+8,y+29]],'#d5d9c5');
          polygon([[x,y],[x+8,y+29],[x-4,y+14],[x-15,y+21]],'#f0e5c9');
        }
      }
    }
  }
  const texture=new T.CanvasTexture(sky);
  texture.colorSpace=T.SRGBColorSpace;
  const backdrop=new T.Mesh(new T.PlaneGeometry(640,96),
    new T.MeshBasicMaterial({map:texture,fog:false,depthWrite:false}));
  backdrop.renderOrder=-10;
  scene.add(backdrop);
  return (x,d)=>backdrop.position.set(x,38,-154-d);
}

export const landings = [{d:18,side:1},{d:182,side:-1},{d:405,side:1}];

// Boathouses sit above the high-water line. The short docks stay outside the racing lanes.
export function addLandings(scene) {
  const materials = new Map();
  const cube = new T.BoxGeometry(1,1,1);
  function part(group,geometry,color,x,y,z,sx,sy,sz) {
    if (!materials.has(color)) materials.set(color,new T.MeshStandardMaterial({color,roughness:.91}));
    const m=new T.Mesh(geometry,materials.get(color));
    m.scale.set(sx,sy,sz);m.position.set(x,y,z);group.add(m);return m;
  }
  for (const {d,side} of landings) {
    const group=new T.Group();
    group.position.set(bank(d,side)+side*2.8,0,-d);
    group.rotation.y=side===1 ? Math.PI/2 : -Math.PI/2;
    const box=(x,y,z,w,h,l,c)=>part(group,cube,c,x,y,z,w,h,l);
    for (const x of [-2.15,2.15]) for (const z of [-2,1.4])
      box(x,.60,z,.28,1.55,.28,0x5a463c);
    box(0,1.30,0,5.4,.24,4.3,0xb8895b);
    box(0,2.8,.25,4.5,2.85,3.25,0xb25037);
    const roofShape=new T.Shape();
    roofShape.moveTo(-2.7,0);roofShape.lineTo(0,1.37);roofShape.lineTo(2.7,0);roofShape.closePath();
    const roof=new T.ExtrudeGeometry(roofShape,{depth:4.1,bevelEnabled:false});
    part(group,roof,0x384f4d,0,4.20,-1.8,1,1,1);
    for (const x of [-1.55,1.55]) {
      box(x,2.96,-1.40,.89,1.22,.14,0xffe6ba);
      box(x,2.96,-1.49,.65,.96,.08,0x395d61);
      box(x,2.96,-1.54,.06,1,.04,0xffe6ba);
    }
    box(0,2.48,-1.43,1.02,2.24,.14,0x654a3a);
    box(-1.43,5.05,.80,.47,1.65,.52,0x785f55);
    box(-1.43,5.91,.80,.59,.15,.62,0x514e49);
    for (const sideWall of [-1,1]) {
      for (const z of [-.62,.84]) {
        box(sideWall*2.27,3,z,.10,.94,.81,0xffe6ba);
        box(sideWall*2.33,3,z,.06,.75,.63,0x47717a);
      }
      box(sideWall*2.27,1.59,.25,.12,.12,3.28,0xa57e5d);
    }
    for(let i=0;i<12;i++) box(-.7,.62,-2-i*.29,1.55,.14,.27,0xc0966d);
    for(const z of [-3,-5]) box(-1.48,.55,z,.17,1.25,.17,0x74634d);
    box(1.38,1.69,-1.95,.1,.53,.1,0x7b6351);
    const ring=part(group,new T.TorusGeometry(.26,.09,6,16),0xff934d,1.38,1.96,-2.04,1,1,1);
    ring.rotation.y=.16;
    scene.add(group);
  }
}

// A timber footbridge spans the course halfway through the run. Its piers sit on land.
export function addBridge(scene,d) {
  const group=new T.Group();
  const wood=new T.MeshStandardMaterial({color:0x965f40,roughness:.9});
  const timber=new T.BoxGeometry(1,1,1);
  const up=new T.Vector3(0,1,0);
  function beam(ax,ay,az,bx,by,bz,width,depth=width) {
    const delta=new T.Vector3(bx-ax,by-ay,bz-az);
    const m=new T.Mesh(timber,wood);
    m.scale.set(width,delta.length(),depth);
    m.quaternion.setFromUnitVectors(up,delta.normalize());
    m.position.set((ax+bx)/2,(ay+by)/2,(az+bz)/2);
    group.add(m);
  }
  const left=bank(d,-1)-1,right=bank(d,1)+1;
  for (const z of [-1,1]) {
    beam(left,6.4,z,right,6.4,z,.32,.35);
    beam(left,8.2,z,right,8.2,z,.19);
    for(let i=0;i<10;i++) {
      const x=left+(right-left)*i/10, nx=left+(right-left)*(i+1)/10;
      beam(x,6.4,z,nx,8.2,z,.13);
      beam(nx,8.2,z,nx,6.4,z,.13);
    }
    for(const x of [left,right]) beam(x,0,z,x,8.2,z,.42);
  }
  beam(left,6.48,0,right,6.48,0,.19,2.28);
  group.position.z=-d;scene.add(group);
}
