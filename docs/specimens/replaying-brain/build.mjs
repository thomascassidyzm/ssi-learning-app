// Replaying brain, specimen v2 — step 2: one self-contained HTML page from data.json.
// Output: packages/player-vue/public/docs/specimens/replaying-brain/index.html, which staging
// serves as a static file at /docs/specimens/replaying-brain/. Everything the page does happens
// in the browser from the embedded data; no network, no pupil, no name.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const D = JSON.parse(readFileSync(join(here, 'data.json')))
const OUT = join(here, '../../../packages/player-vue/public/docs/specimens/replaying-brain/index.html')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const fmt = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const T = D.tally
const classSpanDays = Math.round((new Date(D.sittings.at(-1) + 'T00:00:00Z') - new Date(D.sittings[0] + 'T00:00:00Z')) / 864e5) + 1
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(D.className)}'s brain on Welsh, replayed</title>
<style>
:root{--ink:#26357a;--ink2:#5b6cc7;--dim:#e4dfd8;--paper:#fbfaf8;--text:#2a2723;--mute:#6b6459}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--text);font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)}
main{max-width:1080px;margin:0 auto;padding:16px 14px 60px}h1{font-size:21px;margin:0 0 2px}.sub{color:var(--mute);margin:0 0 12px;font-size:14px}
.note{font-size:13px;color:#4f483f;background:#f1ede7;padding:10px 12px;border-radius:8px;margin:10px 0}
.transport{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 6px}.transport button{font:inherit;font-size:16px;min-width:40px;height:40px;border:1px solid #d6d0c7;background:#fff;border-radius:8px;color:var(--text)}.transport button.play{background:var(--ink);color:#fff;border-color:var(--ink);min-width:56px}
.transport input[type=range]{flex:1 1 180px;min-width:140px;accent-color:var(--ink)}.transport .spd{font-size:12px;color:var(--mute)}
.where{font-size:14px;color:var(--text);margin:0 0 8px;min-height:1.5em}.where b{color:var(--ink)}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:10px 0 14px}.stat{background:#fff;border:1px solid #e9e4dc;border-radius:10px;padding:8px 10px}.stat .l{font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:.04em}.stat .v{font-size:20px;font-weight:600;line-height:1.2;color:var(--ink)}.stat .d{font-size:12px;color:var(--mute);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.grid{display:grid;grid-template-columns:1fr;gap:18px}@media(min-width:900px){.grid{grid-template-columns:3fr 2fr}}
svg{width:100%;height:auto;display:block;background:var(--paper)}
.legend{font-size:12px;color:var(--mute);margin:4px 0 0}.legend i{display:inline-block;width:14px;height:8px;border-radius:2px;vertical-align:middle;margin:0 4px 0 10px}
h2{font-size:16px;margin:0 0 6px}.cap{font-size:13px;color:var(--mute);margin:6px 0 0}
table{border-collapse:collapse;width:100%;font-size:14px}td{padding:5px 6px;border-top:1px solid #efeae2;vertical-align:top}td.n{text-align:right;white-space:nowrap;color:var(--ink);font-weight:600;width:6.5em;font-size:12px}td.k{color:var(--mute);font-size:13px}.bar{height:5px;background:var(--ink);border-radius:3px;margin-top:3px;opacity:.75}tr.new td{background:#eef0fa}
.gaps{font-size:13px;color:#4f483f}.gaps li{margin:4px 0}
</style></head><body><main>
<h1>${esc(D.className)}'s brain on Welsh, replayed</h1>
<p class="sub">${esc(D.school)} · ${esc(D.course)} · the class is the unit; no pupil is behind any of this</p>
<p class="note"><b>What is real.</b> Every dot, line and count comes from the class's own play log: ${T.hearings} hearings in ${T.total} cycles across ${D.sittings.length} sittings, ${fmt(D.sittings[0])} to ${fmt(D.sittings.at(-1))}. Each cycle plays the Welsh twice (two voices), so a hearing is not a cycle. A line joins two chunks only when they were said inside the same phrase in one of those cycles, and thickens each time that happens again. <b>What is thin.</b> This class's own record runs ${classSpanDays} days: ${D.sittings.length} sittings, ${D.classPhraseCount} distinct phrases, ${D.legos.length ? 'sentence ' + Math.max(...D.events.map(e => D.legos[e.lego]?.seed || 0)) : ''} reached of ${D.seedsTotal}. Nothing here is padded. Full account of the data at the foot of the page.</p>
<div class="transport" role="group" aria-label="replay">
<button id="restart" title="Restart">⟲</button><button id="prevSit" title="Previous sitting">◀</button><button id="play" class="play" title="Play or pause">▶</button><button id="nextSit" title="Next sitting">▶|</button>
<input id="scrub" type="range" min="0" max="${D.events.length}" value="0" step="1" aria-label="position in time">
<label class="spd">speed <select id="speed"><option value="1">1×</option><option value="2" selected>2×</option><option value="4">4×</option></select></label>
</div>
<p class="where" id="where"></p>
<div class="stats" id="stats"></div>
<div class="grid">
<section><h2>The brain</h2><div id="brain"></div>
<p class="legend"><i style="background:var(--ink)"></i>${esc(D.className)}<i style="background:var(--dim)"></i>not yet reached</p>
<p class="cap">Chunks stand on one line in the order the course introduces them, so how far right the ink reaches is how far into the course the class is. The first ${D.legos.length} of ${D.legosTotal} chunks are shown. A dot lights when the class has heard that chunk; it grows with repetition. An arc joins two chunks that were said together inside one phrase, and thickens with every repeat.</p></section>
<section><h2>Phrases practised</h2><p class="cap" style="margin:0 0 6px">In course order, counts as at the scrubber. The highlighted row is the phrase just played.</p><div id="freq"></div></section>
</div>
<section style="margin-top:22px"><h2>Where this data comes from, and what is missing</h2><ul class="gaps">
<li><b>Source.</b> The learner app's own play log, one row per audio played, for the class account of ${esc(D.className)}. A cycle counts once the class heard the Welsh target, so ${D.knownOnly - T.total} cycles where only the English prompt played before a pause or skip are not counted. Of the ${T.total} counted: ${T.intro} chunk introductions, ${T.debut} chunk debuts, ${T.build} build phrases, ${T.use} use phrases.</li>
<li><b>The lines are rebuilt, not read.</b> The app has a co-firing table for exactly this picture, but for every class in every school it is empty: a class plays under a class account whose identity is not the teacher's, and the table's own security rule refuses the write, silently. The pupils' accounts are untouched by class play. So each arc here is derived the way the app itself derives co-firing, from the chunks that make up the phrase that was actually played, taken from the play log cycle by cycle with its real timestamp. No arc is drawn from course structure alone: a phrase never played draws nothing.</li>
<li><b>Why ${esc(D.className)}.</b> Ranked class by class, estate-wide, over every real school's play log (target1 audio plays, this course, demo and test schools excluded): ${D.topClassesEstate.map(c => `${esc(c.className)} at ${esc(c.school)} (${c.cycles})`).join(', ')}. ${esc(D.className)} is the single busiest real class in the estate, so it is shown; its own school, ${esc(D.school)}, has ${D.schoolClasses} classes between them ${D.schoolCycles + T.total} heard cycles, ${fmt(D.schoolFirst)} to ${fmt(D.schoolLast)}.</li>
<li><b>Stepping.</b> The scrubber moves cycle by cycle inside a sitting, and the sitting buttons jump between sittings. Weeks are not offered because ${esc(D.className)}'s own record spans ${classSpanDays} days (${fmt(D.sittings[0])} to ${fmt(D.sittings.at(-1))}); it's the wider school, ${fmt(D.schoolFirst)} to ${fmt(D.schoolLast)}, that runs to weeks.</li>
<li><b>Pulled</b> ${D.pulledAt} from the live database. A static snapshot: it does not refresh.</li>
</ul></section>
</main>
<script>
const D=${JSON.stringify(D)};
const INK='#26357a',DIM='#e4dfd8',PAPER='#fbfaf8';
const N=D.legos.length,E=D.events;
const lg=(n,m)=>Math.log1p(n)/Math.log1p(Math.max(m,1));
// --- state at step k: the first k class cycles applied. Class only — no cohort/school layer.
function stateAt(k){
  const node=new Array(N).fill(0),edge=new Map(),ph=new Map();let reach=0,plays=0,hearings=0,last=null;
  for(let i=0;i<k;i++){const e=E[i];const h=e.hearings==null?2:e.hearings;plays++;hearings+=h;last=e;for(const f of e.fires){if(f<N)node[f]+=h;reach=Math.max(reach,D.legos[f]?D.legos[f].seed:0)}
    if(e.phrase)ph.set(e.phrase,(ph.get(e.phrase)||0)+h);
    const fs=e.fires.filter(f=>f<N).sort((a,b)=>a-b);for(let a=0;a<fs.length;a++)for(let b=a+1;b<fs.length;b++){const key=fs[a]+'|'+fs[b];edge.set(key,(edge.get(key)||0)+h)}}
  return{node,edge,ph,reach,plays,hearings,last};
}
// --- the brain: arc diagram, the class alone, in ink
// Arc width/opacity is on an ABSOLUTE scale, fixed for the whole replay, not
// renormalised against the busiest pair seen so far — so a pair that keeps recurring
// visibly thickens as the replay goes on, rather than holding steady because it was
// already the max at cycle 10 and stays the max at cycle 20.
const edgeWidth=n=>Math.min(0.8+1.1*Math.sqrt(n),6),edgeOpacity=n=>Math.min(0.32+0.14*Math.sqrt(n),0.95);
function brain(S){
  const W=560,L=22,R=22,Y=170,H=300,X=i=>L+i*(W-L-R)/(N-1);
  let g='';
  for(const[k,n]of[...S.edge].sort((p,q)=>p[1]-q[1])){const[a,b]=k.split('|').map(Number),x1=X(a),x2=X(b),r=(x2-x1)/2;g+='<path d="M'+x1+' '+Y+' A'+r+' '+(r*.9)+' 0 0 1 '+x2+' '+Y+'" fill="none" stroke="'+INK+'" stroke-opacity="'+edgeOpacity(n).toFixed(2)+'" stroke-width="'+edgeWidth(n).toFixed(2)+'"/>'}
  g+='<line x1="'+X(0)+'" y1="'+Y+'" x2="'+X(N-1)+'" y2="'+Y+'" stroke="'+DIM+'" stroke-width="3"/>';
  const nmax=Math.max(1,...S.node);let lastSeed=0;
  D.legos.forEach((l,i)=>{const n=S.node[i],x=X(i);
    if(l.seed!==lastSeed){lastSeed=l.seed;g+='<text x="'+x+'" y="'+(Y+16)+'" font-size="9" fill="#a39b90" text-anchor="middle">'+l.seed+'</text>'}
    g+='<circle cx="'+x+'" cy="'+Y+'" r="'+(n?(3.5+4*lg(n,nmax)).toFixed(1):2.4)+'" fill="'+(n?INK:DIM)+'" stroke="'+(n?PAPER:'#c9c2b8')+'" stroke-width="1"/>';
    g+='<text transform="translate('+x+' '+(Y+26)+') rotate(58)" font-size="12" fill="'+(n?'#2a2723':'#c4bdb2')+'" font-weight="'+(n?600:400)+'">'+esc(l.t)+'</text>'});
  const last=S.last;if(last&&last.fires.length){const fs=last.fires.filter(f=>f<N);const cx=fs.reduce((s,f)=>s+X(f),0)/fs.length;g+='<text x="'+cx.toFixed(1)+'" y="34" font-size="13" fill="'+INK+'" text-anchor="middle">'+esc(last.phrase?D.phrases[last.phrase].t:D.legos[last.lego].t)+'</text><text x="'+cx.toFixed(1)+'" y="50" font-size="12" fill="#6b6459" text-anchor="middle">'+esc(last.phrase?D.phrases[last.phrase].k:D.legos[last.lego].k)+'</text>'}
  return'<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="arc diagram of chunks and co-fired phrases">'+g+'</svg>';
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
const orderKey=id=>{const p=D.phrases[id];return p.lego*1000+(p.role==='use'?500:0)+p.pos};
function freq(S){const ids=[...S.ph.keys()].sort((a,b)=>orderKey(a)-orderKey(b));if(!ids.length)return'<p class="cap">Nothing practised yet at this point.</p>';const m=Math.max(...S.ph.values());const lastId=S.last&&S.last.phrase;
  return'<table>'+ids.map(id=>{const p=D.phrases[id],n=S.ph.get(id);return'<tr'+(id===lastId?' class="new"':'')+'><td><div>'+esc(p.t)+'</div><div class="k">'+esc(p.k)+'</div><div class="bar" style="width:'+(8+92*n/m).toFixed(0)+'%"></div></td><td class="n">heard '+n+' time'+(n===1?'':'s')+'</td></tr>'}).join('')+'</table>'}
// Final totals for the whole record — not tied to the scrubber. No comparison, no cohort.
function statsFinal(){
  const S=stateAt(E.length);const seed=D.seeds[S.reach];
  const tile=(l,v,d)=>'<div class="stat"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="d">'+esc(d||'')+'</div></div>';
  return tile('Final position',S.reach?'sentence '+S.reach:'—',seed?seed.k:'')+tile('In-app minutes',D.totalMinutes,'across '+D.sittings.length+' sittings')+tile('Phrases played',S.ph.size+' distinct','')+tile('Chunks introduced',D.introducedCount,'');
}
function fmt(t){return new Date(t).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
// --- transport (the Zenjin idiom: one interval, rebuilt on speed change, stops itself at the end)
let step=0,playing=false,timer=null;const $=id=>document.getElementById(id);
function render(){const S=stateAt(step);$('brain').innerHTML=brain(S);$('freq').innerHTML=freq(S);$('scrub').value=step;
  const e=S.last;$('where').innerHTML=e?('Sitting <b>'+(e.s+1)+'</b> of '+D.sittings.length+', '+fmt(e.t)+' · cycle <b>'+step+'</b> of '+E.length+' · '+({intro:'introducing',debut:'debut of',build:'building',use:'using'}[e.kind]||'playing')+' <b>'+esc(e.phrase?D.phrases[e.phrase].t:D.legos[e.lego].t)+'</b>'):'Before the first sitting. Press play.';
  $('play').textContent=playing?'❚❚':'▶'}
function setStep(k){step=Math.max(0,Math.min(E.length,k));if(step>=E.length)stop();render()}
function tick(){if(step>=E.length){stop();render();return}step++;render()}
function start(){if(playing)return;if(step>=E.length)step=0;playing=true;timer=setInterval(tick,420/Number($('speed').value));render()}
function stop(){playing=false;if(timer)clearInterval(timer);timer=null}
$('play').onclick=()=>playing?(stop(),render()):start();
$('restart').onclick=()=>{stop();setStep(0)};
$('speed').onchange=()=>{if(playing){stop();start()}};
$('scrub').oninput=ev=>{stop();setStep(Number(ev.target.value))};
const sitEnd=s=>{let k=0;for(let i=0;i<E.length;i++)if(E[i].s<=s)k=i+1;return k};
$('nextSit').onclick=()=>{stop();const cur=step?E[step-1].s:-1;setStep(sitEnd(cur+1))};
$('prevSit').onclick=()=>{stop();const cur=step?E[step-1].s:0;const k=sitEnd(cur-1);setStep(step===sitEnd(cur)?k:sitEnd(cur-1)>=step?0:k)};
document.addEventListener('keydown',ev=>{if(ev.key===' '){ev.preventDefault();$('play').click()}else if(ev.key==='ArrowRight'){stop();setStep(step+1)}else if(ev.key==='ArrowLeft'){stop();setStep(step-1)}});
$('stats').innerHTML=statsFinal();
render();
</script></body></html>`
writeFileSync(OUT, html)
console.log('wrote', OUT, html.length, 'bytes')
