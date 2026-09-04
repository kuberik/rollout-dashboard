// analyze.mjs — read pair.json files and report landmarks (identified by their TEXT,
// not by DOM position) that exist in BOTH the loading and loaded states and MOVED.
import fs from 'node:fs'; import path from 'node:path';
const base='/tmp/claude-1000/loadaudit/pairs';
for (const tag of process.argv.slice(2)) {
  const f=path.join(base,tag,'pair.json'); if(!fs.existsSync(f)) continue;
  const d=JSON.parse(fs.readFileSync(f));
  const key=b=>(b.txt||'').trim();
  const idx=(bs)=>{const m=new Map(); for(const b of bs){const k=key(b); if(!k||k.length<2) continue; if(!m.has(k)) m.set(k,b);} return m;};
  const A=idx(d.skel.blocks), B=idx(d.loaded.blocks);
  const moved=[];
  for(const [k,b] of B){ const a=A.get(k); if(a && (Math.abs(a.y-b.y)>=4 || Math.abs(a.x-b.x)>=4 || Math.abs(a.w-b.w)>=8 || Math.abs(a.h-b.h)>=4)) moved.push({k,a,b,dy:b.y-a.y,dx:b.x-a.x,dw:b.w-a.w,dh:b.h-a.h}); }
  moved.sort((u,v)=>Math.abs(v.dy)-Math.abs(u.dy));
  console.log('\n#### '+tag+'   navs='+d.navsDuring+'  skelPulses='+d.skel.pulses.length+' spinners='+d.skel.spinners+'  loadingText='+d.skel.txt);
  if(!moved.length) console.log('   (no shared landmark moved)');
  for(const m of moved.slice(0,10)) console.log('   dy='+(m.dy>0?'+':'')+String(m.dy).padStart(5)+' dx='+(m.dx>0?'+':'')+String(m.dx).padStart(4)+' dh='+(m.dh>0?'+':'')+String(m.dh).padStart(5)+'  y '+m.a.y+'->'+m.b.y+'   "'+m.k.slice(0,44)+'"');
  // placeholder extent vs real content extent
  const pl=d.skel.pulses; const c=d.loaded.cards;
  if(pl.length){ const py0=Math.min(...pl.map(x=>x.y)), py1=Math.max(...pl.map(x=>x.y+x.h));
    const cy0=c.length?Math.min(...c.map(x=>x.y)):0, cy1=c.length?Math.max(...c.map(x=>x.y+x.h)):0;
    console.log('   placeholder band y'+py0+'..'+py1+' ('+(py1-py0)+'px, widths '+[...new Set(pl.map(x=>x.w))].join('/')+')  vs real content y'+cy0+'..'+cy1+' ('+(cy1-cy0)+'px, widths '+[...new Set(c.map(x=>x.w))].slice(0,5).join('/')+')');
  }
}
