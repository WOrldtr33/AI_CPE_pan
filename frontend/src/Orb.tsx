import {audioActivity} from './device';
import {useEffect,useRef} from 'react';
import * as THREE from 'three';

export function Orb({active,state,motion}:{active:boolean;state:string;motion:boolean}){
 const mount=useRef<HTMLDivElement>(null),current=useRef({active,state,motion});current.current={active,state,motion};
 useEffect(()=>{const host=mount.current!;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{host.dataset.renderer='css';let frame=0,level=0;const tick=()=>{level+=(Math.max(audioActivity.awake?audioActivity.input:0,audioActivity.output)-level)*.2;host.dataset.audioLevel=level.toFixed(3);host.style.setProperty('--orb-scale',String(current.current.motion?1+level*.12:1));frame=requestAnimationFrame(tick);};tick();return()=>cancelAnimationFrame(frame);}
  host.dataset.renderer='webgl';renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,30);camera.position.z=5.1;
  const group=new THREE.Group();scene.add(group);
  const material=new THREE.ShaderMaterial({transparent:true,uniforms:{time:{value:0},energy:{value:0}},vertexShader:`uniform float time;uniform float energy;varying vec3 n;varying vec3 p;void main(){vec3 pos=position;float w=sin(pos.y*5.+time*.65)*cos(pos.x*4.-time*.4)*sin(pos.z*4.+time*.3);pos+=normal*w*(.07+energy*.05);p=pos;n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);}`,fragmentShader:`uniform float time;uniform float energy;varying vec3 n;varying vec3 p;void main(){float edge=pow(1.-abs(n.z),2.);float bands=.5+.5*sin(p.y*9.+p.x*3.+sin(p.z*5.+time*.3)*1.6+time*.35);vec3 light=vec3(.72,.91,1.);vec3 deep=vec3(.06,.40,.84);vec3 c=mix(light,deep,bands*.65+edge*.3);float shine=pow(max(0.,dot(normalize(n),normalize(vec3(-.6,1.,1.)))),18.);c+=shine*.85;c=mix(c,vec3(.87,.97,1.),edge*.55);gl_FragColor=vec4(c,.88+edge*.12);}`});
  const sphere=new THREE.Mesh(new THREE.IcosahedronGeometry(.94,5),material);group.add(sphere);
  const ringMaterials:THREE.MeshBasicMaterial[]=[];
  for(let i=0;i<3;i++){const mat=new THREE.MeshBasicMaterial({color:i===1?0x8ec7f3:0xffffff,transparent:true,opacity:i===1?.35:.7});ringMaterials.push(mat);const ring=new THREE.Mesh(new THREE.TorusGeometry(1.17+i*.09,.012,8,140),mat);ring.rotation.set(.8+i*.47,.35+i*.7,.3);group.add(ring);}
  const positions=new Float32Array(160*3);for(let i=0;i<160;i++){const a=i*2.39996,r=1.35+((i*37)%101)/100*.6;positions[i*3]=Math.cos(a)*r;positions[i*3+1]=Math.sin(a)*r*.72;positions[i*3+2]=Math.sin(i*9.1)*.65;}
  const particleGeometry=new THREE.BufferGeometry();particleGeometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const dots=new THREE.Points(particleGeometry,new THREE.PointsMaterial({color:0x76b5e8,size:.018,transparent:true,opacity:.55}));scene.add(dots);
  const resize=()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(host);resize();
  let frame=0,last=0,start=performance.now(),level=0;const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const render=(now:number)=>{frame=requestAnimationFrame(render);if(document.hidden||now-last<1000/30)return;last=now;const animate=current.current.motion&&!reduced.matches;const t=animate?(now-start)/1000:0;material.uniforms.time.value=t;const input=audioActivity.awake?audioActivity.input:0;level+=(Math.max(input,audioActivity.output)-level)*.22;
   host.dataset.audioLevel=level.toFixed(3);host.style.setProperty('--audio-level',String(level));
   const target=(current.current.active?1:0)+level*3;material.uniforms.energy.value+=(target-material.uniforms.energy.value)*.06;group.rotation.y=t*.07+Math.sin(t*5)*level*.25;group.rotation.z=Math.sin(t*.15)*.12;group.position.y=animate?Math.sin(t*.65)*.045:0;const scale=1+(animate?level*.12:0)+(current.current.state==='thinking'?Math.sin(t*3)*.035:0);group.scale.setScalar(scale);dots.rotation.z=-t*.025+Math.sin(t*2)*level*.15;dots.scale.setScalar(1+level*.13);renderer.render(scene,camera);};frame=requestAnimationFrame(render);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();scene.traverse(o=>{if('geometry'in o)(o as THREE.Mesh).geometry.dispose();if('material'in o){const m=(o as THREE.Mesh).material;(Array.isArray(m)?m:[m]).forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();};
 },[]);
 return <div className={`orb-canvas ${active?'is-active':''}`} ref={mount}><div className="orb-fallback"><i/><i/><i/></div></div>;
}
