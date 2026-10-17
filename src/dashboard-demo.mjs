// Deterministic demo only. It never modifies device counters or claims real traffic.
export function demoPoint(t, origin) {
  const s=(t-origin)/1000;
  const cycle=s%240;
  const wave=(c,w,h)=>h*Math.exp(-(((cycle-c)/w)**2));
  return {t,down:(Math.max(.1,6+2*Math.sin(s/17)+wave(50,13,19)+wave(140,22,31)+wave(205,10,9)))*125000,up:(Math.max(.05,1.6+.8*Math.sin(s/13)+wave(83,17,6)+wave(155,12,10)))*125000,source:'demo'};
}
export function demoHistory(now=Date.now(),seconds=2700) { const origin=now-seconds*1000;return Array.from({length:seconds+1},(_,i)=>demoPoint(origin+i*1000,origin)); }


