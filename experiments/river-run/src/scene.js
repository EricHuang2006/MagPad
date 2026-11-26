import * as T from '../vendor/three/three.module.min.js';
import {bank, center, finish, rocks} from './course.js';
import {addWater, addWake} from './water.js';
import {addBridge, addLandings, addSkyline, landings} from './scenery.js';

function mesh(geometry, color) {
  return new T.Mesh(geometry, new T.MeshStandardMaterial({color, flatShading: true, roughness: 0.85}));
}

function box(parent, size, at, color) {
  const part = mesh(new T.BoxGeometry(...size), color);
  part.position.set(...at);
  parent.add(part);
  return part;
}

// Cross-sections give the launch its tapered bow, flared sides and painted waterline.
function launch() {
  const boat = new T.Group();
  const stations = [[1.5,.64], [1.0,.78], [-.55,.76], [-1.25,.55], [-1.95,.035]];
  function skin(low, high, lowWidth, highWidth, color) {
    const coords = [];
    for (let i = 1; i < stations.length; i++) {
      const [z,w] = stations[i-1], [zz,ww] = stations[i];
      for (const s of [-1,1]) {
        const a = [s*w*lowWidth,low,z], b = [s*ww*lowWidth,low,zz];
        const c = [s*ww*highWidth,high,zz], d = [s*w*highWidth,high,z];
        coords.push(...a,...b,...c,...a,...c,...d);
      }
      if (high === .59) coords.push(-w,high,z,w,high,z,ww,high,zz,-w,high,z,ww,high,zz,-ww,high,zz);
    }
    const [z,w] = stations[0];
    coords.push(-w*lowWidth,low,z,w*lowWidth,low,z,w*highWidth,high,z,
      -w*lowWidth,low,z,w*highWidth,high,z,-w*highWidth,high,z);
    const g = new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(coords,3));
    g.computeVertexNormals();
    const m = mesh(g,color);
    m.material.side = T.DoubleSide;
    boat.add(m);
  }
  skin(-.1,.18,.67,.85,0x243f46);
  skin(.18,.42,.85,.95,0xe5572c);
  skin(.42,.59,.95,1,0xffe3ab);
  box(boat,[1.22,.07,1.38],[0,.60,.24],0xa85029);
  box(boat,[.98,.24,.72],[0,.70,.18],0x394544);
  box(boat,[1.05,.28,.20],[0,.82,.53],0xdd9661);
  const skipper = mesh(new T.CapsuleGeometry(.17,.17,2,7),0xfa7138);
  skipper.position.set(-.16,.94,.09); boat.add(skipper);
  const head = mesh(new T.SphereGeometry(.14,8,6),0xc58d65);
  head.position.set(-.16,1.22,.08); boat.add(head);
  const cap = mesh(new T.SphereGeometry(.15,8,6,0,Math.PI*2,0,Math.PI/2),0xffedbd);
  cap.position.set(-.16,1.25,.08); boat.add(cap);
  box(boat,[.26,.035,.19],[-.16,1.26,-.02],0xffedbd);
  const shield = box(boat,[1.12,.4,.08],[0,.82,-.40],0x71bec6);
  shield.rotation.x = -.26;
  box(boat,[1.13,.055,.08],[0,1.01,-.45],0xfff0c4);
  box(boat,[.20,.04,.63],[0,.625,-1.05],0xe76836);
  box(boat,[.35,.39,.36],[0,.44,1.58],0x344b48);
  // Teak slats, cockpit rails and the cowling remain visible from the chase camera.
  for (const side of [-1,1]) {
    box(boat,[.05,.06,1.80],[side*.64,.64,.37],0xd4a56b);
    const post=box(boat,[.035,.40,.05],[side*.54,.82,-.40],0xffe2a4);
    post.rotation.x=-.26;
    box(boat,[.22,.05,.08],[side*.52,.64,1.14],0xd6c7a0);
  }
  for (let i=-2;i<=2;i++)
    box(boat,[.022,.012,.65],[i*.105,.612,1.02],0x865937);
  box(boat,[.45,.24,.44],[0,.68,1.57],0x344d55);
  box(boat,[.456,.042,.445],[0,.69,1.57],0xfbb878);
  const ring=mesh(new T.TorusGeometry(.16,.052,6,16),0xe57942);
  ring.rotation.x=Math.PI/2; ring.position.set(.35,.64,.98); boat.add(ring);
  return boat;
}

export function createScene(canvas) {
  const renderer = new T.WebGLRenderer({canvas, antialias:true, alpha:true});
  renderer.setClearColor(0,0);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
  const scene = new T.Scene();
  scene.fog = new T.FogExp2(0xc8d5b6,.014);
  scene.add(new T.HemisphereLight(0xfff0d2,0x97b5a4,1.8));
  const light = new T.DirectionalLight(0xffe3ae,2.1);
  light.position.set(-35,50,-30);
  scene.add(light);
  const camera = new T.PerspectiveCamera(56,1,.1,240);
  const boat = launch();
  scene.add(boat);
  const shadow=new T.Mesh(new T.CircleGeometry(1,32),
    new T.MeshBasicMaterial({color:0x214e55,transparent:true,opacity:.25,depthWrite:false}));
  shadow.rotation.x=-Math.PI/2;
  shadow.scale.set(.85,1.82,1); scene.add(shadow);

  let seed = 741;
  function rand() {
    seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  // Batch repeated scenery into a handful of draw calls.
  function instances(geometry, entries, unlit=false) {
    const material = unlit ? new T.MeshBasicMaterial() : new T.MeshStandardMaterial({flatShading:true});
    // Cull sections behind the camera and beyond the visible reach of the river.
    const sections = new Map();
    for (const entry of entries) {
      const section = Math.floor(-entry[2]/64);
      if (!sections.has(section)) sections.set(section,[]);
      sections.get(section).push(entry);
    }
    const temp = new T.Object3D(), color = new T.Color();
    for (const section of sections.values()) {
      const batch = new T.InstancedMesh(geometry,material,section.length);
      section.forEach(([x,y,z,sx,sy,sz,angle,tint],i) => {
        temp.position.set(x,y,z); temp.rotation.y = angle; temp.scale.set(sx,sy,sz);
        temp.updateMatrix(); batch.setMatrixAt(i,temp.matrix);
        batch.setColorAt(i,color.setHex(tint));
      });
      batch.computeBoundingSphere();
      scene.add(batch);
    }
  }

  const water = addWater(scene,rand);
  const trunks=[], crowns=[], foam=[], stones=[], pebbles=[], leaves=[], reeds=[];
  const ground=[], colors=[];
  const sandColors=[0xdab37d,0xdeb981,0xdcb580], grassColors=[0x80a06e,0x7e9d6c,0x83a16e];
  const triangle=(a,b,c,tint)=>{
    ground.push(...a,...b,...c);
    const col=new T.Color(tint);
    for(let k=0;k<3;k++) colors.push(col.r,col.g,col.b);
  };
  for(const side of [-1,1]) {
    for(let d=-30;d<finish+110;d+=3){
      const rows=[d,d+3].map(s=>{
        const edge=bank(s,side);
        return [[edge,-.06,-s],[edge+side*2.2,.75,-s],
          [edge+side*10,1.7+Math.sin(s/11)*.6,-s],[edge+side*55,5,-s]];
      });
      for(let j=0;j<3;j++) {
        const tones=j===0?sandColors:grassColors;
        triangle(rows[0][j],rows[0][j+1],rows[1][j],tones[Math.floor(rand()*3)]);
        triangle(rows[0][j+1],rows[1][j+1],rows[1][j],tones[Math.floor(rand()*3)]);
      }
      const edge=bank(d,side);
      const landing=landings.some(site=>site.side===side && Math.abs(d-site.d)<5);
      const offset=(landing ? 11 : 3)+rand()*16;
      const x=edge+side*offset, h=2.4+rand()**1.4*6;
      const base=1+Math.min(1,offset/10)*(.65+Math.sin(d/11)*.6);
      trunks.push([x,base+h*.20,-d,.14+h*.012,h*.55,.14+h*.012,0,0x694c36]);
      if(rand()<.17) {
        for (let j=0;j<3;j++) leaves.push([x+Math.cos(j*2)*h*.13,base+h*(.53+.14*j),
          -d+Math.sin(j*2)*h*.12,h*.25,h*.30,h*.23,rand()*6,[0xc5ad58,0xe2b866,0xd2bb67][j]]);
      } else {
        for(let j=0;j<3;j++) crowns.push([x,base+h*(.39+j*.22),-d,
          h*(.31-j*.061),h*(.64-j*.09),h*(.31-j*.061),j*.7,
          [0x345d50,0x497964,0x699079][j]]);
      }
      if (!landing) {
        const size=.16+rand()**2*.78;
        pebbles.push([edge+side*.16,size*.15,-d,size*1.3,size*.65,size,rand()*6,0x999986]);
        for(let j=0;j<5;j++) {
          const tuft=.26+rand()*.43;
          reeds.push([edge+side*(.25+rand()*.7),.1+tuft*.43,-d+rand()-.5,
            .085,tuft,.07,rand()*5,rand()<.5 ? 0xb0a85c : 0x808f52]);
        }
      }
    }
  }
  const landGeo=new T.BufferGeometry();
  landGeo.setAttribute('position',new T.Float32BufferAttribute(ground,3));
  landGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  landGeo.computeVertexNormals();
  scene.add(new T.Mesh(landGeo,new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide})));
  instances(new T.CylinderGeometry(.7,1,1,5),trunks);
  instances(new T.ConeGeometry(1,1,7),crowns);
  instances(new T.IcosahedronGeometry(1,0),leaves);
  instances(new T.DodecahedronGeometry(1),pebbles);
  instances(new T.ConeGeometry(1,1,3),reeds);

  for(const rock of rocks) {
    for(const side of [-1,1]) {
      foam.push([rock.x + side*rock.r*.84,.027,-rock.d+.22,.16,1,rock.r*1.6,side*.19,0xb2d7bf]);
    }
    stones.push([rock.x,.12,-rock.d,rock.r,rock.r*.90,rock.r,rand()*6,0x5d6669]);
  }
  instances(new T.DodecahedronGeometry(1),stones);
  instances(new T.BoxGeometry(1,.01,1),foam,true);
  // A striped arch marks the actual finish plane.
  for(const s of [-1,1]) {
    const x=center(finish)+s*9;
    box(scene,[.28,6,.28],[x,3,-finish],0xa95532);
  }
  for(let j=0;j<16;j++) for(let k=0;k<2;k++)
    box(scene,[1.13,.52,.14],[center(finish)-9+(j+.5)*18/16,5.5+k*.52,-finish],
      (j+k)%2?0x28504c:0xffdea0);

  const skyline = addSkyline(scene,rand);
  addLandings(scene);
  addBridge(scene,finish/2);
  const wake = addWake(scene);
  let width=0, height=0, aimX=0, followX=0, bankAngle=0, previousD=-1;
  // Lower only the 3D resolution after sustained slow frames; keep text at native resolution.
  const maxRatio=Math.min(devicePixelRatio,1.7);
  let ratio=maxRatio, frameTime=1/60, sampleTime=0;
  return function render(run,clock,dt) {
    const mid=center(run.d), x=mid+run.lateral;
    const targetFollow=mid+run.lateral*.48, targetAim=center(run.d+10)+run.lateral*.38;
    const reset=previousD<0 || run.d<previousD;
    previousD=run.d;
    const blend=reset ? 1 : -Math.expm1(-dt*7);
    followX+=(targetFollow-followX)*blend;
    aimX+=(targetAim-aimX)*blend;
    bankAngle+=(Math.atan(run.turn*.026)-bankAngle)*(reset ? 1 : -Math.expm1(-dt*12));

    if (dt>0 && dt<.25) {
      frameTime+=(dt-frameTime)*-Math.expm1(-dt);
      sampleTime+=dt;
      if (sampleTime>2) {
        const next=frameTime>.026 ? Math.max(.75,ratio-.15) :
          frameTime<.018 ? Math.min(maxRatio,ratio+.10) : ratio;
        if(next!==ratio) { ratio=next; renderer.setPixelRatio(ratio); }
        sampleTime=0;
      }
    }
    if(canvas.clientWidth!==width || canvas.clientHeight!==height) {
      width=canvas.clientWidth; height=canvas.clientHeight;
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
    }
    boat.position.set(x,.035+Math.sin(clock*3)*.022,-run.d);
    boat.rotation.set(Math.sin(clock*2.6)*.012,-bankAngle,-bankAngle*.7);
    shadow.position.set(x+.11,.012,-run.d+.09);
    shadow.rotation.z=bankAngle;
    water(clock); wake(x,run.d,run.speed);
    camera.position.set(followX,4.65,8.4-run.d);
    camera.lookAt(aimX,1.50,-run.d-7);
    skyline(mid,run.d);
    renderer.render(scene,camera);
  };
}
