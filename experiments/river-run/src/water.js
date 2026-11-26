import * as T from '../vendor/three/three.module.min.js';
import {bank, center, finish} from './course.js';

// The texture tiles at its edges. Mipmaps soften distant ripples toward the horizon.
function currentTexture(random) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 430; i++) {
    const x = random() * 512, y = random() * 512;
    const length = 3 + random() ** 2 * 55, height = 1 + random() * 3;
    ctx.fillStyle = i % 5 ? 'rgba(34,124,141,.16)' : 'rgba(26,80,105,.26)';
    for (const ox of [0,-512]) for (const oy of [0,-512]) {
      ctx.beginPath();
      ctx.moveTo(x+ox, y+oy);
      ctx.quadraticCurveTo(x+ox+length*.5,y+oy-height,x+ox+length,y+oy);
      ctx.quadraticCurveTo(x+ox+length*.35,y+oy+height,x+ox,y+oy);
      ctx.fill();
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

export function addWater(scene, random) {
  const positions = [], colors = [], uv = [], indices = [];
  const tones = [0xbad6af,0x75c3b4,0x479ba3,0x317e90,0x398997,0x65b6ae,0xb8d8b5];
  const bands = [-1,-.91,-.68,-.2,.50,.90,1];
  for (let d=-60; d<=finish+144; d+=2) {
    const row = positions.length / 3;
    for (let i=0; i<bands.length; i++) {
      const f = bands[i], edge = bank(d,Math.sign(f));
      const x = center(d) + Math.abs(f)*(edge-center(d));
      const color = new T.Color(tones[i]).multiplyScalar(1 + .035*Math.sin(d*.21+i));
      positions.push(x,0,-d); colors.push(color.r,color.g,color.b); uv.push(x/13,d/12);
      if (row && i) {
        const a = row+i, b = a-bands.length;
        indices.push(a-1,b-1,b,a-1,b,a);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors,3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  const texture = currentTexture(random);
  const material = new T.MeshBasicMaterial({map:texture, vertexColors:true, side:T.DoubleSide});
  scene.add(new T.Mesh(geometry,material));
  return clock => { texture.offset.y = -clock * .085; };
}

// Sample the stern by distance. The wake stays on the boat's previous path in a turn.
export function addWake(scene) {
  const count = 48, spacing = .25;
  const coords = new Float32Array(count * 6 * 3), indices = [], opacity = [];
  for (let i=0; i<count; i++) {
    const fade = (1-i/(count-1)) ** .75;
    opacity.push(0, fade*.8, 0, 0, fade*.8, 0);
    if (!i) continue;
    for (const offset of [0,3]) {
      const a = i*6+offset, b = a-6;
      indices.push(a,b,b+1,a,b+1,a+1,a+1,b+1,b+2,a+1,b+2,a+2);
    }
  }
  const geometry = new T.BufferGeometry();
  const attribute = new T.BufferAttribute(coords,3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position',attribute);
  geometry.setAttribute('alpha',new T.Float32BufferAttribute(opacity,1));
  geometry.setIndex(indices);
  const material = new T.ShaderMaterial({
    transparent:true, depthWrite:false, side:T.DoubleSide,
    vertexShader:`attribute float alpha; varying float vAlpha;
    void main(){ vAlpha=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`varying float vAlpha;
    void main(){ gl_FragColor=vec4(.73,.93,.84,vAlpha);
      #include <colorspace_fragment>
    }`
  });
  const wake = new T.Mesh(geometry,material);
  wake.frustumCulled = false;
  scene.add(wake);
  const pathX = new Float32Array(count);
  let lastD = -1, lastX = 0, lastSample = 0, head = 0, used = 0;
  return (x,d,speed) => {
    if (lastD < 0 || d < lastD) {
      lastSample = d; head = 0; used = 1; pathX[head] = x;
    } else if (d > lastD) {
      while (lastSample + spacing <= d) {
        lastSample += spacing;
        head = (head+1) % count;
        pathX[head] = T.MathUtils.lerp(lastX,x,(lastSample-lastD)/(d-lastD));
        used = Math.min(count,used+1);
      }
    }
    lastD=d; lastX=x;
    for (let i=0; i<=Math.min(count-1,used); i++) {
      const pastD = i ? lastSample-(i-1)*spacing : d;
      const pastX = i ? pathX[(head-i+1+count)%count] : x;
      const age = d-pastD;
      const spread = .47 + age*(.14+speed*.004);
      const width = .08 + .14*Math.sin(age*.85)**2 + age*.035;
      for (let j=0;j<6;j++) {
        const side = j<3 ? -1 : 1;
        attribute.setXYZ(i*6+j,pastX+side*(spread+(j%3-1)*width),.034,-pastD+1.4);
      }
    }
    geometry.setDrawRange(0,Math.min(count-1,used)*24);
    attribute.needsUpdate=true;
  };
}
