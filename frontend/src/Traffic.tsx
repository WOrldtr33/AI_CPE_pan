import {useEffect,useRef,useState} from 'react';
import type {Point} from './api';
import {Icon} from './Icon';
export const speed=(v:number)=>v*8/1e6>=1?`${(v*8/1e6).toFixed(1)} Mb/s`:`${(v*8/1000).toFixed(0)} Kb/s`;
const time=(t:number)=>new Date(t).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
function path(points:{x:number;y:number;t:number}[]){let d='';for(let i=0;i<points.length;i++){const p=points[i],a=points[i-1];if(!a||p.t-a.t>30000)d+=`M${p.x},${p.y}`;else{const mid=(a.x+p.x)/2;d+=`C${mid},${a.y} ${mid},${p.y} ${p.x},${p.y}`;}}return d;}
export function Traffic({points,demo,onDemo}:{points:Point[];demo:boolean;onDemo:(v:boolean)=>void}){
 const host=useRef<HTMLDivElement>(null),[span,setSpan]=useState(300000),[end,setEnd]=useState<number|null>(null),[hover,setHover]=useState<number|null>(null);
 const pointers=useRef(new Map<number,number>()),drag=useRef<{x:number;end:number;span:number;distance?:number}|null>(null);
 const latest=points.at(-1)?.t||Date.now(),first=points[0]?.t||latest-300000,maxSpan=Math.max(15000,latest-first),actualSpan=Math.min(span,maxSpan),finish=Math.min(latest,Math.max(first+actualSpan,end??latest)),begin=finish-actualSpan;
 const selected=points.filter(p=>p.t>=begin&&p.t<=finish),stride=Math.max(1,Math.floor(selected.length/600)),visible=selected.filter((_,i)=>i%stride===0||i===selected.length-1);
 const max=Math.max(125000,...visible.map(p=>Math.max(p.down,p.up)))*1.2,W=1000,H=210,top=12,bottom=190;
 const x=(t:number)=>(t-begin)/actualSpan*W,y=(n:number)=>bottom-n/max*(bottom-top);
 const down=path(visible.map(p=>({x:x(p.t),y:y(p.down),t:p.t}))),up=path(visible.map(p=>({x:x(p.t),y:y(p.up),t:p.t})));
 const target=hover===null?finish:begin+hover*actualSpan,mark=selected.reduce<Point|undefined>((best,p)=>!best||Math.abs(p.t-target)<Math.abs(best.t-target)?p:best,undefined);
 const zoom=(factor:number,ratio=.5)=>{const next=Math.max(15000,Math.min(maxSpan,actualSpan*factor));const anchor=begin+ratio*actualSpan;setSpan(next);setEnd(Math.min(latest,Math.max(first+next,anchor+(1-ratio)*next)));};
 useEffect(()=>{const el=host.current!;const wheel=(e:WheelEvent)=>{e.preventDefault();zoom(Math.exp(e.deltaY*.002),(e.clientX-el.getBoundingClientRect().left)/el.clientWidth);};el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);});
 const volume=selected.reduce((sum,p,i)=>{const prev=selected[i-1];return prev&&p.t-prev.t<30000?sum+(p.down+p.up+prev.down+prev.up)/2*(p.t-prev.t)/1000:sum;},0);
 return <section className="traffic-panel" aria-label="流量时域图">
  <div className="section-heading"><div><h2>流量统计</h2></div><button className={`data-pill ${demo?'demo':'live'}`} onClick={()=>onDemo(!demo)} title="切换真实采集与演示流量"><span/>{demo?'演示流量':'真实采集'}<Icon name="chevron" size={13}/></button></div>
  <div className="traffic-tools"><div className="chart-legend"><span><i className="down-dot"/>下载</span><span><i className="up-dot"/>上传</span></div><div className="time-presets">{[[60000,'1 分钟'],[300000,'5 分钟'],[900000,'15 分钟'],[maxSpan,'全部历史']].map(([v,label],i)=><button style={{width:65+i*16,background:`rgba(126,174,210,${.12+i*.055})`}} key={label} className={Math.abs(actualSpan-Number(v))<1000?'selected':''} onClick={()=>{setSpan(Number(v));setEnd(null);}}>{label}</button>)}</div></div>
  <div ref={host} className={`chart-area ${drag.current?'dragging':''}`} tabIndex={0} role="application" aria-label="流量图：滚轮缩放，左右拖动查看历史，方向键移动，加减键缩放"
   onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,e.clientX);const xs=[...pointers.current.values()];drag.current={x:e.clientX,end:finish,span:actualSpan,...(xs.length===2?{distance:Math.abs(xs[0]-xs[1])}: {})};}}
   onPointerMove={e=>{const r=e.currentTarget.getBoundingClientRect();setHover(Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)));if(!pointers.current.has(e.pointerId)||!drag.current)return;pointers.current.set(e.pointerId,e.clientX);const xs=[...pointers.current.values()];if(xs.length===2&&drag.current.distance){const next=Math.min(maxSpan,Math.max(15000,drag.current.span*drag.current.distance/Math.max(10,Math.abs(xs[0]-xs[1]))));setSpan(next);}else setEnd(Math.max(first+actualSpan,Math.min(latest,drag.current.end-(e.clientX-drag.current.x)/r.width*actualSpan)));}}
   onPointerUp={e=>{pointers.current.delete(e.pointerId);drag.current=null;}} onPointerCancel={()=>{pointers.current.clear();drag.current=null;}} onPointerLeave={()=>{if(!pointers.current.size)setHover(null);}} onDoubleClick={()=>setEnd(null)}
   onKeyDown={e=>{if(e.key==='+'||e.key==='=')zoom(.7);if(e.key==='-')zoom(1.4);if(e.key==='ArrowLeft')setEnd(Math.max(first+actualSpan,finish-actualSpan*.2));if(e.key==='ArrowRight')setEnd(Math.min(latest,finish+actualSpan*.2));}}>
   <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="down-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#4d9bed" stopOpacity=".19"/><stop offset="1" stopColor="#71b3fa" stopOpacity="0"/></linearGradient><linearGradient id="up-fill" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#edb169" stopOpacity=".14"/><stop offset="1" stopColor="#edb169" stopOpacity="0"/></linearGradient></defs>
    {[0,.25,.5,.75,1].map(n=><line key={n} x1="0" x2={W} y1={y(max*n)} y2={y(max*n)} stroke="#dbe8f2" strokeDasharray="3 7" strokeWidth="1"/>)}
    {visible.length>1&&<><path d={`${down}L${x(visible.at(-1)!.t)},${bottom}L${x(visible[0].t)},${bottom}Z`} fill="url(#down-fill)"/><path d={`${up}L${x(visible.at(-1)!.t)},${bottom}L${x(visible[0].t)},${bottom}Z`} fill="url(#up-fill)"/></>}
    <path d={down} fill="none" stroke="#4e96df" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/><path d={up} fill="none" stroke="#e6aa62" strokeWidth="2.3" vectorEffect="non-scaling-stroke"/>
    {mark&&<><line x1={x(mark.t)} x2={x(mark.t)} y1="5" y2={bottom} stroke="#9eb9d0" strokeDasharray="3 5"/><circle cx={x(mark.t)} cy={y(mark.down)} r="4" fill="#509be8" stroke="white" strokeWidth="2"/><circle cx={x(mark.t)} cy={y(mark.up)} r="4" fill="#e6aa62" stroke="white" strokeWidth="2"/></>}
   </svg>
   <span className="axis-unit">Mb/s</span><span className="axis-max">{(max*8/1e6).toFixed(0)}</span><span className="axis-zero">0</span>
   <div className="flow-marker"><small>{hover===null?'此刻流量':time(mark?.t||finish)}</small><span className="download"><Icon name="down" size={13}/>{speed(mark?.down||0)}</span><span className="upload"><Icon name="up" size={13}/>{speed(mark?.up||0)}</span></div>
   {!visible.length&&<div className="chart-empty">尚无流量样本<button onClick={()=>onDemo(true)}>查看演示流量</button></div>}
  </div>
  <div className="time-axis">{[0,.25,.5,.75,1].map(r=><span key={r}>{time(begin+actualSpan*r)}</span>)}</div>
  <div className="chart-footer"><span>区间流量 <strong>{(volume/1e6).toFixed(1)} MB</strong></span></div>
 </section>;
}
