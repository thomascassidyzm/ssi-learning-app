// Class stats design exploration — static, tappable specimens of the class's
// Overview and Insights pages in two shapes, built from the replaying-brain
// specimen's real class data (docs/specimens/replaying-brain/data.json).
//
// Output: packages/player-vue/public/docs/specimens/class-stats/**, served by
// the app as static files at /docs/specimens/class-stats/. Nothing here runs
// in the app; every page is self-contained HTML with the data embedded.
//
//   node docs/specimens/class-stats/build.mjs
//
// Shapes:
//   A — Overview as today; the brain becomes a section of Insights.
//   B — the brain IS the Course journey card on Overview; Insights stays the
//       comparison lens and loses its one-class journey line.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const D = JSON.parse(readFileSync(join(here, '../replaying-brain/data.json')))
const OUT = join(here, '../../../packages/player-vue/public/docs/specimens/class-stats')
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

// ---------------------------------------------------------------- the numbers
// This week is Mon 14 Sep to now; last week is Mon 7 to Sun 13. Minutes are
// the class's own total spread over its cycles — data.json carries the total,
// not per-sitting minutes. The school average is the school's cycles in the
// same week over its classes; a specimen figure, marked as such on the card.
const WEEK_START = '2026-09-14'
const minPerCycle = D.totalMinutes / D.events.length
const inWeek = (t, start, end) => t >= start && (!end || t < end)
const evThis = D.events.filter(e => inWeek(e.t, WEEK_START))
const evLast = D.events.filter(e => inWeek(e.t, '2026-09-07', WEEK_START))
const schoolThis = D.schoolEvents.filter(e => inWeek(e.t, WEEK_START)).length + evThis.length
const schoolLast = D.schoolEvents.filter(e => inWeek(e.t, '2026-09-07', WEEK_START)).length + evLast.length
const r0 = n => Math.round(n)
const week = {
  minutes: r0(evThis.length * minPerCycle),
  lastMinutes: r0(evLast.length * minPerCycle),
  phrases: new Set(evThis.filter(e => e.phrase).map(e => e.phrase)).size,
  newPhrases: evThis.filter(e => e.kind === 'intro').length,
  lastNewPhrases: evLast.filter(e => e.kind === 'intro').length,
  schoolAvg: r0(schoolThis * minPerCycle / D.schoolClasses),
  schoolAvgLast: r0(schoolLast * minPerCycle / D.schoolClasses),
  schoolAvgNew: r0((D.schoolEvents.filter(e => inWeek(e.t, WEEK_START) && e.kind === 'intro').length + evThis.filter(e => e.kind === 'intro').length) / D.schoolClasses),
  sittings: new Set(evThis.map(e => e.s)).size,
  lastPractised: D.events.at(-1).t,
}
const journeyDone = Math.max(...D.events.flatMap(e => e.fires)) + 1
const seedReached = Math.max(...D.events.map(e => D.legos[e.lego]?.seed || 0))
const BELTS = [['White', 0], ['Yellow', 8], ['Orange', 20], ['Green', 40], ['Blue', 80], ['Purple', 150], ['Brown', 280], ['Black', 400]]
let beltIdx = BELTS.length - 1; while (beltIdx > 0 && seedReached < BELTS[beltIdx][1]) beltIdx--
const belt = BELTS[beltIdx][0], nextBelt = BELTS[beltIdx + 1]
const hear = evs => { const m = new Map(); for (const e of evs) if (e.phrase) m.set(e.phrase, (m.get(e.phrase) || 0) + (e.hearings ?? 2)); return [...m].map(([id, n]) => ({ ...D.phrases[id], n })).sort((a, b) => b.n - a.n) }
const phrasesThisWeek = hear(evThis)
const distinctAll = new Set(D.events.filter(e => e.phrase).map(e => e.phrase)).size
const fmtDay = d => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const ago = t => { const h = Math.round((Date.parse('2026-09-17T15:30:00Z') - Date.parse(t)) / 36e5); return h < 36 ? `${h} hours ago` : `${Math.round(h / 24)} days ago` }
// Twelve weeks of bars, newest last: the class started on 8 Sep, so ten are empty.
const bars = { entity: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, week.lastMinutes, week.minutes], cohort: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, week.schoolAvgLast, week.schoolAvg] }

// ---------------------------------------------------------------- the style
// Every value below is lifted from the live dashboard: schools-design.css,
// schools-tokens.css, NodeHomeView.vue, NodeMapRail.vue, LensTabs.vue and
// WeekNumbersCard.vue. Ink for "this class" is the same blue the Insights
// card and its bars already use for the entity, so the brain reads as the
// same class the numbers describe.
const CSS = `
:root{--font-display:'Arsenal',Georgia,'Times New Roman',serif;--font-body:'Open Sans','Trebuchet MS',system-ui,Arial,sans-serif;--font-mono:'JetBrains Mono','SF Mono',Consolas,monospace;
--schools-bg:#f6f5f1;--schools-page-backdrop:#e8e5dd;--schools-card:#fff;--schools-border:rgba(15,18,18,.10);--schools-fg:#0F1212;--schools-fg-2:#555;--schools-fg-3:#6b6b6b;--schools-red:#DB1E17;--schools-red-deep:#900600;
--ink-primary:#2C2622;--ink-secondary:#4A4440;--ink-muted:#8A8078;--tone-green:74,222,128;--tone-green-ink:21,128,61;--tone-red:219,30,23;--rc-entity:96,165,250;--rc-entity-ink:37,99,235;
--shadow-sm:0 1px 2px rgba(73,3,0,.06),0 1px 1px rgba(73,3,0,.04);--radius-lg:12px;--radius-md:8px;--belt-white:#f4f3ef;--belt-yellow:#f7d24a}
*{box-sizing:border-box}html{background:var(--schools-page-backdrop)}
body{margin:0;background:var(--schools-bg);color:var(--schools-fg);font:14px/1.5 var(--font-body);-webkit-font-smoothing:antialiased;max-width:1180px;margin:0 auto;min-height:100vh}
a{color:inherit}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:calc(54px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) max(16px,env(safe-area-inset-right,0px)) 0 max(16px,env(safe-area-inset-left,0px));background:#D9D6D2;border-bottom:1px solid rgba(15,18,18,.08);position:sticky;top:0;z-index:5}
.topbar a{text-decoration:none;font-size:13px;font-weight:600;color:var(--ink-primary)}.topbar .brand{font-family:var(--font-display);font-size:17px;letter-spacing:-.01em}.topbar .brand b{color:var(--schools-red);font-weight:400}
.spec-tag{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted);display:inline-flex;gap:8px;align-items:center}
.spec-tag a{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:4px 8px;border:1px solid rgba(44,38,34,.18);border-radius:999px;background:#fff;color:var(--ink-secondary)}
.page{padding:16px 16px calc(60px + env(safe-area-inset-bottom,0px))}
.node-layout{display:grid;grid-template-columns:minmax(220px,290px) minmax(0,1fr);gap:20px;align-items:start}
@media(max-width:900px){.node-layout{grid-template-columns:1fr}}
.schools-card{background:var(--schools-card);border:1px solid var(--schools-border);border-radius:var(--radius-lg);box-shadow:var(--shadow-sm)}
.schools-kicker{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--schools-fg-3)}
.kicker-red{font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--schools-red);font-weight:500}
.rail-col{padding:16px}.main-col{display:flex;flex-direction:column;gap:20px;min-width:0}
.map-rail{display:flex;flex-direction:column;gap:8px}.rail-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.rail-row{padding-left:calc(var(--depth,0)*14px)}.rail-row+.rail-row{margin-top:2px}
.rail-link,.rail-here,.rail-toggle{display:flex;align-items:baseline;gap:8px;width:100%;padding:6px 10px;border:none;background:none;font:inherit;text-align:left;border-radius:var(--radius-md);min-width:0;text-decoration:none}
.rail-link{color:var(--schools-fg-2);cursor:default}.rail-name{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rail-label{font-size:12px;color:var(--schools-fg-3);flex-shrink:0}
.is-here .rail-here{background:rgba(var(--tone-red),.07);border-left:3px solid var(--schools-red);border-radius:0 var(--radius-md) var(--radius-md) 0}
.rail-lens{display:flex;gap:8px;padding:2px 10px 4px 13px;font-size:12px;color:var(--schools-fg-2);font-weight:500}.rail-lens a{color:var(--schools-fg-3);font-weight:400;text-decoration:none}
.rail-toggle{cursor:pointer;color:var(--schools-fg-3);font-size:12px;padding:4px 10px}
.identity{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.identity-name{font-family:var(--font-display);font-size:clamp(26px,3.4vw,38px);font-weight:400;line-height:1.05;letter-spacing:-.015em;color:var(--ink-primary);margin:6px 0 8px}
.state-badge{font-size:12px;font-weight:500;padding:2px 10px;border-radius:999px;background:rgba(var(--tone-green),.12);color:rgb(var(--tone-green-ink))}
.identity-sub{margin:8px 0 0;font-size:14px;color:var(--schools-fg-2)}
.verbs{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn-play{display:inline-flex;align-items:center;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;border-radius:var(--radius-lg);border:1px solid transparent;background:var(--schools-red);color:#fff;text-decoration:none}
.btn-ghost{display:inline-flex;align-items:center;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;border-radius:var(--radius-lg);background:rgba(44,38,34,.06);color:var(--schools-fg);text-decoration:none}
.lens-tabs{display:inline-flex;border:1px solid rgba(44,38,34,.15);border-radius:9px;overflow:hidden;background:#fff}
.lens-tab{padding:9px 14px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-secondary);text-decoration:none;white-space:nowrap}
.lens-tab+.lens-tab{border-left:1px solid rgba(44,38,34,.12)}.lens-tab.active{background:rgba(var(--rc-entity),.14);color:rgb(var(--rc-entity-ink))}
@media(max-width:720px){.lens-tabs{width:100%}.lens-tab{flex:1 1 0;text-align:center}}
.stats-updated{display:flex;justify-content:flex-end;font-family:var(--font-mono);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);margin-bottom:-12px}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px}
.stat-card{display:flex;flex-direction:column;gap:2px;padding:16px}.stat-value{font-size:clamp(22px,2.6vw,30px);font-weight:600;color:var(--ink-primary);line-height:1.1;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.stat-word{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--schools-fg-3)}
.class-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
.class-card{display:flex;flex-direction:column;gap:12px;padding:16px;min-width:0}.class-card.wide{grid-column:1/-1}
.class-card-note{margin:0;font-size:14px;color:var(--schools-fg-2);line-height:1.5}
.headline{margin:0;font-size:28px;font-weight:700;color:#222;line-height:1.1;font-family:var(--font-mono)}.headline .unit{font-size:14px;font-weight:500;color:var(--schools-fg-2);font-family:var(--font-body)}
table.ph{border-collapse:collapse;width:100%;font-size:14px}table.ph th{text-align:left;font-family:var(--font-mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);padding:4px 6px 6px;border-bottom:1px solid rgba(44,38,34,.14);font-weight:500}
table.ph td{padding:6px;border-bottom:1px solid rgba(44,38,34,.08);vertical-align:top}table.ph td.n{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;white-space:nowrap}table.ph tr.hide{display:none}
.show-all{background:none;border:none;padding:0;font:inherit;font-size:13px;color:var(--schools-fg-3);text-decoration:underline;cursor:pointer;align-self:flex-start}
.journey-head{display:flex;justify-content:space-between;font-size:11px;color:var(--schools-fg-2);margin-bottom:4px}.journey-track{height:6px;border-radius:3px;background:rgba(0,0,0,.05);overflow:hidden}.journey-fill{height:100%;background:var(--belt-yellow)}
.ask{font-size:12px;color:var(--schools-fg-3);text-decoration:underline;margin:0}
.section{padding:16px;display:flex;flex-direction:column;gap:12px}
.section .kicker-red{display:block}
details.more{padding:0}details.more summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:12px;padding:14px 16px;align-items:baseline}details.more summary::-webkit-details-marker{display:none}
.more-title{font-family:var(--font-display);font-size:17px;color:var(--ink-primary)}.more-sub{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-muted);text-align:right}
details.more>div{padding:0 16px 16px}
.nre-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.chips{display:inline-flex;border:1px solid rgba(44,38,34,.15);border-radius:9px;overflow:hidden;background:#fff}.chip{padding:9px 14px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-secondary);background:none;border:none;cursor:pointer}.chip+.chip{border-left:1px solid rgba(44,38,34,.12)}.chip.active{background:rgba(var(--rc-entity),.14);color:rgb(var(--rc-entity-ink))}
.field{display:flex;flex-direction:column;gap:3px}.field-label{font-family:var(--font-mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted)}.select{padding:8px 32px 8px 12px;border:1px solid rgba(44,38,34,.18);border-radius:8px;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238A8078'/%3E%3C/svg%3E") no-repeat right 12px center;font:inherit;font-size:13px}
.wk{display:flex;flex-direction:column;gap:12px}.wk-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.wk-window{margin:0;font-family:var(--font-display);font-size:19px;color:var(--ink-primary)}.wk-range{margin:0;font-family:var(--font-mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted)}.wk-why{margin-left:auto;font-family:var(--font-mono);font-size:11px;color:var(--ink-muted);text-decoration:underline}
.wk-table{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) minmax(0,1fr);column-gap:10px}.wk-cell{min-width:0;padding:7px 0;border-bottom:1px solid rgba(44,38,34,.08)}.wk-h .wk-cell{padding-top:0;border-bottom:1px solid rgba(44,38,34,.14)}.wk-last .wk-cell{border-bottom:none}
.wk-col{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-muted)}.wk-col.ent{color:rgb(var(--rc-entity-ink))}.wk-lab{font-family:var(--font-mono);font-size:10.5px;letter-spacing:.06em;color:var(--ink-muted);align-self:end}
.wk-num{text-align:right;font-variant-numeric:tabular-nums}.wk-big{font-family:var(--font-display);font-size:24px;line-height:1.1;color:var(--ink-primary)}.wk-big.ent{color:rgb(var(--rc-entity-ink))}.wk-small{font-family:var(--font-mono);font-size:14px;color:var(--ink-secondary)}
.wk-trend-label{margin:0;font-family:var(--font-mono);font-size:9.5px;letter-spacing:.06em;color:var(--ink-muted)}.wb{display:block;width:100%;height:auto;overflow:visible}.wb-bar{fill:rgba(var(--rc-entity-ink),.4)}.wb-bar.now{fill:rgba(var(--rc-entity-ink),.95)}.wb-normal{fill:none;stroke:rgba(44,38,34,.24);stroke-width:1.5;vector-effect:non-scaling-stroke}
.wk-denom,.wk-note{margin:0;font-size:12px;color:var(--ink-muted)}.wk-alltime{margin:4px 0 0;padding-top:10px;border-top:1px dashed rgba(44,38,34,.14);font-family:var(--font-mono);font-size:11.5px;line-height:1.5;color:var(--ink-secondary)}
/* the brain, in the dashboard's own ink */
.brain svg{width:100%;height:auto;display:block}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.strip .stat-card{padding:10px 12px;background:var(--schools-bg);border:1px solid rgba(44,38,34,.08);border-radius:10px;box-shadow:none}.strip .stat-value{font-size:18px;color:rgb(var(--rc-entity-ink))}.strip .stat-d{font-size:12px;color:var(--ink-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.transport{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.transport button{font:inherit;font-size:16px;min-width:40px;height:40px;border:1px solid rgba(44,38,34,.18);background:#fff;border-radius:8px;color:var(--ink-primary);cursor:pointer}.transport button.play{background:rgb(var(--rc-entity-ink));color:#fff;border-color:transparent;min-width:56px}
.transport input[type=range]{flex:1 1 160px;min-width:120px;accent-color:rgb(var(--rc-entity-ink))}.transport .spd{font-family:var(--font-mono);font-size:11px;color:var(--ink-muted)}
.where{font-size:14px;margin:0;min-height:1.5em;color:var(--ink-secondary)}.where b{color:rgb(var(--rc-entity-ink))}
.cap{font-size:13px;color:var(--ink-muted);margin:0;line-height:1.5}
.replay{display:flex;flex-direction:column;gap:12px}.replay[hidden]{display:none}
.replay-btn{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;font:inherit;font-size:14px;font-weight:600;border-radius:var(--radius-lg);border:1px solid rgba(44,38,34,.15);background:#fff;color:var(--ink-primary);cursor:pointer;align-self:flex-start}
.replay-btn[aria-expanded=true]{background:rgba(var(--rc-entity),.14);color:rgb(var(--rc-entity-ink));border-color:transparent}
.bar5{height:5px;background:rgb(var(--rc-entity-ink));border-radius:3px;margin-top:3px;opacity:.6}tr.now td{background:rgba(var(--rc-entity),.10)}
.spec-note{font-size:12px;color:var(--ink-muted);border-top:1px dashed rgba(44,38,34,.14);padding-top:8px;margin:0}
/* index */
.hero{padding:20px 16px 8px}.hero h1{font-family:var(--font-display);font-weight:400;font-size:clamp(26px,5vw,36px);margin:0 0 6px;letter-spacing:-.015em;color:var(--ink-primary)}.hero p{margin:0;color:var(--schools-fg-2);max-width:60ch}
.opt{padding:16px;display:flex;flex-direction:column;gap:12px}.opt h2{font-family:var(--font-display);font-weight:400;font-size:22px;margin:0;color:var(--ink-primary)}.opt p{margin:0;font-size:14px;color:var(--schools-fg-2);line-height:1.5}
.row{cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:10px 16px;align-items:center;padding:12px 14px;border:1px solid var(--schools-border);border-radius:10px;background:var(--schools-bg);text-decoration:none;color:inherit}
.row .nm{font-weight:600;font-size:15px}.row .meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--schools-fg-2)}.row .meta b{color:var(--ink-primary);font-family:var(--font-mono);font-weight:500}.row .lens-tabs{grid-column:1/-1}
@media(min-width:720px){.row{grid-template-columns:1fr auto auto}.row .lens-tabs{grid-column:auto}}
.belt{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--belt-white);border:1px solid rgba(44,38,34,.25);vertical-align:-1px;margin-right:6px}
.rec{font-family:var(--font-mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:3px 9px;border-radius:999px;background:rgba(var(--tone-green),.14);color:rgb(var(--tone-green-ink));align-self:flex-start}
`
const FONTS = `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" media="print" onload="this.media='all'" href="https://fonts.googleapis.com/css2?family=Arsenal:wght@400;700&family=Open+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">`

// ---------------------------------------------------------------- the brain
// Ported from the replaying-brain specimen; same state model, same arc-on-a-
// line, recoloured to the dashboard's entity ink and the card's white paper.
const BRAIN_JS = `
const D=DATA;const N=D.legos.length,E=D.events;const INK='rgb(37,99,235)',DIM='#e4dfd8',PAPER='#ffffff';
const lg=(n,m)=>Math.log1p(n)/Math.log1p(Math.max(m,1));
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')}
function stateAt(k){const node=new Array(N).fill(0),edge=new Map(),ph=new Map();let reach=0,last=null;
  for(let i=0;i<k;i++){const e=E[i];const h=e.hearings==null?2:e.hearings;last=e;for(const f of e.fires){if(f<N)node[f]+=h;reach=Math.max(reach,D.legos[f]?D.legos[f].seed:0)}
    if(e.phrase)ph.set(e.phrase,(ph.get(e.phrase)||0)+h);
    const fs=e.fires.filter(f=>f<N).sort((a,b)=>a-b);for(let a=0;a<fs.length;a++)for(let b=a+1;b<fs.length;b++){const key=fs[a]+'|'+fs[b];edge.set(key,(edge.get(key)||0)+h)}}
  return{node,edge,ph,reach,last}}
const edgeWidth=n=>Math.min(0.8+1.1*Math.sqrt(n),6),edgeOpacity=n=>Math.min(0.32+0.14*Math.sqrt(n),0.95);
function brain(S,caption){const W=560,L=22,R=22,Y=150,H=280,X=i=>L+i*(W-L-R)/(N-1);let g='';
  for(const[k,n]of[...S.edge].sort((p,q)=>p[1]-q[1])){const[a,b]=k.split('|').map(Number),x1=X(a),x2=X(b),r=(x2-x1)/2;g+='<path d="M'+x1+' '+Y+' A'+r+' '+(r*.9)+' 0 0 1 '+x2+' '+Y+'" fill="none" stroke="'+INK+'" stroke-opacity="'+edgeOpacity(n).toFixed(2)+'" stroke-width="'+edgeWidth(n).toFixed(2)+'"/>'}
  g+='<line x1="'+X(0)+'" y1="'+Y+'" x2="'+X(N-1)+'" y2="'+Y+'" stroke="'+DIM+'" stroke-width="3"/>';
  const nmax=Math.max(1,...S.node);
  D.legos.forEach((l,i)=>{const n=S.node[i],x=X(i);g+='<circle cx="'+x+'" cy="'+Y+'" r="'+(n?(3.5+4*lg(n,nmax)).toFixed(1):2.4)+'" fill="'+(n?INK:DIM)+'" stroke="'+(n?PAPER:'#c9c2b8')+'" stroke-width="1"/>';
    g+='<text transform="translate('+x+' '+(Y+26)+') rotate(58)" font-size="12" fill="'+(n?'#2C2622':'#c4bdb2')+'" font-weight="'+(n?600:400)+'">'+esc(l.t)+'</text>'});
  const last=S.last;if(caption&&last&&last.fires.length){const fs=last.fires.filter(f=>f<N);const cx=fs.reduce((s,f)=>s+X(f),0)/fs.length;g+='<text x="'+cx.toFixed(1)+'" y="30" font-size="13" fill="'+INK+'" text-anchor="middle">'+esc(last.phrase?D.phrases[last.phrase].t:D.legos[last.lego].t)+'</text><text x="'+cx.toFixed(1)+'" y="46" font-size="12" fill="#8A8078" text-anchor="middle">'+esc(last.phrase?D.phrases[last.phrase].k:D.legos[last.lego].k)+'</text>'}
  return'<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="the chunks the class has met, joined where they were said together">'+g+'</svg>'}
const orderKey=id=>{const p=D.phrases[id];return p.lego*1000+(p.role==='use'?500:0)+p.pos};
function freq(S){const ids=[...S.ph.keys()].sort((a,b)=>orderKey(a)-orderKey(b));if(!ids.length)return'<p class="cap">Nothing practised yet at this point.</p>';const m=Math.max(...S.ph.values());const lastId=S.last&&S.last.phrase;
  return'<table class="ph">'+ids.map(id=>{const p=D.phrases[id],n=S.ph.get(id);return'<tr'+(id===lastId?' class="now"':'')+'><td><div>'+esc(p.t)+'</div><div class="cap">'+esc(p.k)+'</div><div class="bar5" style="width:'+(8+92*n/m).toFixed(0)+'%"></div></td><td class="n">heard '+n+' time'+(n===1?'':'s')+'</td></tr>'}).join('')+'</table>'}
function fmt(t){return new Date(t).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
const $=id=>document.getElementById(id);
let step=E.length,playing=false,timer=null;
function render(){const S=stateAt(step);$('brain').innerHTML=brain(S,step<E.length);if($('freq'))$('freq').innerHTML=freq(S);if($('scrub'))$('scrub').value=step;
  const e=S.last;if($('where'))$('where').innerHTML=e?('Sitting <b>'+(e.s+1)+'</b> of '+D.sittings.length+', '+fmt(e.t)+' · cycle <b>'+step+'</b> of '+E.length+' · '+({intro:'introducing',debut:'debut of',build:'building',use:'using'}[e.kind]||'playing')+' <b>'+esc(e.phrase?D.phrases[e.phrase].t:D.legos[e.lego].t)+'</b>'):'Before the first sitting. Press play.';
  if($('play'))$('play').textContent=playing?'❚❚':'▶'}
function setStep(k){step=Math.max(0,Math.min(E.length,k));if(step>=E.length)stop();render()}
function tick(){if(step>=E.length){stop();render();return}step++;render()}
function start(){if(playing)return;if(step>=E.length)step=0;playing=true;timer=setInterval(tick,420/Number($('speed').value));render()}
function stop(){playing=false;if(timer)clearInterval(timer);timer=null}
const sitEnd=s=>{let k=0;for(let i=0;i<E.length;i++)if(E[i].s<=s)k=i+1;return k};
function wireTransport(){$('play').onclick=()=>playing?(stop(),render()):start();$('restart').onclick=()=>{stop();setStep(0)};$('speed').onchange=()=>{if(playing){stop();start()}};
  $('scrub').oninput=ev=>{stop();setStep(Number(ev.target.value))};
  $('nextSit').onclick=()=>{stop();const cur=step?E[step-1].s:-1;setStep(sitEnd(cur+1))};
  $('prevSit').onclick=()=>{stop();const cur=step?E[step-1].s:0;setStep(step===sitEnd(cur)?sitEnd(cur-1):sitEnd(cur-1)>=step?0:sitEnd(cur-1))}}
render();
`
const TRANSPORT = `<div class="transport" role="group" aria-label="replay">
<button id="restart" title="Restart">⟲</button><button id="prevSit" title="Previous sitting">◀</button><button id="play" class="play" title="Play or pause">▶</button><button id="nextSit" title="Next sitting">▶|</button>
<input id="scrub" type="range" min="0" max="${D.events.length}" value="${D.events.length}" step="1" aria-label="position in time">
<label class="spd">speed <select id="speed"><option value="1">1×</option><option value="2" selected>2×</option><option value="4">4×</option></select></label></div>
<p class="where" id="where"></p>`
const STRIP = `<div class="strip">
<div class="stat-card"><span class="stat-word">Final position</span><span class="stat-value">sentence ${seedReached}</span><span class="stat-d">${esc(D.seeds[seedReached].k)}</span></div>
<div class="stat-card"><span class="stat-word">In-app minutes</span><span class="stat-value">${D.totalMinutes}</span><span class="stat-d">across ${D.sittings.length} sittings</span></div>
<div class="stat-card"><span class="stat-word">Phrases played</span><span class="stat-value">${distinctAll} distinct</span><span class="stat-d">&nbsp;</span></div>
<div class="stat-card"><span class="stat-word">Phrases introduced</span><span class="stat-value">${D.introducedCount}</span><span class="stat-d">&nbsp;</span></div></div>`
const BRAIN_CAP = `<p class="cap">Chunks stand on one line in the order the course introduces them, so how far right the ink reaches is how far into the course the class is. A dot lights when the class has met that chunk; it grows with repetition. An arc joins two chunks the class has said together inside one phrase, and thickens with every repeat.</p>`

// ---------------------------------------------------------------- chrome
const railHtml = (lens, opt) => `<aside class="rail-col schools-card"><nav class="map-rail" aria-label="Organisation map">
<span class="kicker-red">Where you are</span><ol class="rail-list">
<li class="rail-row" style="--depth:0"><span class="rail-link"><span class="rail-name">${esc(D.school)}</span><span class="rail-label">school</span></span></li>
<li class="rail-row is-here" style="--depth:1" aria-current="page"><span class="rail-here"><span class="rail-name">${esc(D.className)}</span><span class="rail-label">you're here</span></span></li>
<li class="rail-row" style="--depth:1"><span class="rail-lens">${lens === 'overview' ? `Overview <a href="insights.html">· Insights</a>` : `Insights <a href="overview.html">· Overview</a>`}</span></li>
<li class="rail-row" style="--depth:1"><span class="rail-toggle">▸ ${D.schoolClasses - 1} others at this level</span></li>
</ol></nav></aside>`

const lensTabs = (lens) => `<nav class="lens-tabs" role="tablist" aria-label="Overview or insights"><a class="lens-tab${lens === 'overview' ? ' active' : ''}" href="overview.html" role="tab">Overview</a><a class="lens-tab${lens === 'insights' ? ' active' : ''}" href="insights.html" role="tab">Insights</a></nav>`

const topbar = (opt, page) => `<header class="topbar"><a href="../index.html">← My classes</a><span class="spec-tag">Option ${opt} <a href="../${opt === 'A' ? 'b' : 'a'}/${page}.html" title="The same page in the other option">see ${opt === 'A' ? 'B' : 'A'}</a></span></header>`

const identity = (lens) => `<header class="identity"><div>
<span class="kicker-red">${lens === 'overview' ? 'Class' : 'Class · Insights'}</span>
<h1 class="identity-name">${esc(D.className)}</h1>
${lens === 'overview' ? `<div><span class="state-badge">Practising</span></div>` : `<p class="identity-sub">${esc(D.school)} · ${esc(D.course)}</p>`}
</div><div class="verbs">${lens === 'overview' ? `<a class="btn-play" href="#">&#9654; Play as class</a><a class="btn-ghost" href="#manage">Manage class</a>` : ''}${lensTabs(lens)}</div></header>`

const shell = (opt, page, lens, title, main, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title>${FONTS}<style>${CSS}</style></head><body>
${topbar(opt, page)}<div class="page"><div class="node-layout">${railHtml(lens, opt)}<div class="main-col">${identity(lens)}${main}</div></div></div>
${script ? `<script>const DATA=${JSON.stringify(D)};${script}</script>` : ''}</body></html>`

// ---------------------------------------------------------------- pieces
const phraseTable = (rows, id) => `<table class="ph" id="${id}"><thead><tr><th>Prompt</th><th>Phrase</th><th style="text-align:right">Heard</th></tr></thead><tbody>${rows.map((p, i) => `<tr${i >= 3 ? ' class="hide"' : ''}><td>${esc(p.k)}</td><td>${esc(p.t)}</td><td class="n">${p.n} times</td></tr>`).join('')}</tbody></table>${rows.length > 3 ? `<button class="show-all" onclick="const t=document.getElementById('${id}');const o=t.classList.toggle('open');t.querySelectorAll('tr.hide').forEach(r=>r.style.display=o?'table-row':'');this.textContent=o?'Show fewer':'Show all ${rows.length}'">Show all ${rows.length}</button>` : ''}`

const statsRow = `<div class="stats-updated">Updated 15:31</div><div class="stats-row">
<div class="stat-card schools-card"><span class="stat-value">${week.phrases}</span><span class="stat-word">Phrases practised this week</span></div>
<div class="stat-card schools-card"><span class="stat-value">${week.minutes}</span><span class="stat-word">Minutes played as class this week</span></div>
<div class="stat-card schools-card"><span class="stat-value">${journeyDone}/${D.legosTotal}</span><span class="stat-word">Phrases travelled together</span></div>
<div class="stat-card schools-card"><span class="stat-value">2</span><span class="stat-word">Teachers</span></div></div>`

const practiceCard = `<div class="schools-card class-card"><span class="kicker-red">Class practice</span>
<p class="headline">${week.phrases}<span class="unit"> phrases practised this week</span></p>
<p class="class-card-note">Last practised together ${ago(week.lastPractised)}. ${week.minutes} minutes in the app together this week, pauses included.</p>
${phraseTable(phrasesThisWeek, 'ph-week')}<p class="ask">Does this look wrong?</p></div>`

const journeyBarCard = `<div class="schools-card class-card"><span class="kicker-red">Course journey</span>
<div><div class="journey-head"><span>Course journey</span><span>${journeyDone}/${D.legosTotal}</span></div><div class="journey-track"><div class="journey-fill" style="width:${(100 * journeyDone / D.legosTotal).toFixed(1)}%"></div></div></div>
<p class="class-card-note">The class has travelled ${journeyDone} of ${D.legosTotal} phrases together.<br>${nextBelt ? `${nextBelt[1] - seedReached} more to ${nextBelt[0]} belt.` : 'Reached Black belt.'}</p></div>`

const brainJourneyCard = `<div class="schools-card class-card wide"><span class="kicker-red">Course journey</span>
<div class="brain" id="brain"></div>${BRAIN_CAP}${STRIP}
<button class="replay-btn" id="replayToggle" aria-expanded="false" aria-controls="replay">▶ Replay how it grew</button>
<div id="replay" class="replay" hidden>${TRANSPORT}<span class="kicker-red">Phrases practised</span><p class="cap">In course order, counts as at the scrubber. The highlighted row is the phrase just played.</p><div id="freq"></div></div>
<p class="spec-note">Specimen: the brain is drawn from ${D.className}'s own play log, ${D.tally.hearings} hearings across ${D.sittings.length} sittings. Same data, same rules as the replaying-brain page.</p></div>`

const studentsNote = `<section class="schools-card section"><span class="kicker-red">Students on their own accounts</span><p class="class-card-note">No pupil in this class has signed in on their own account, so this section is not shown on the live page. It is here only so the shape of the page is complete.</p></section>`
const manage = `<section class="schools-card section" id="manage"><span class="kicker-red">Manage class</span><p class="class-card-note">Roster, teachers, join link and code, rename, delete. Unchanged from today's page and not drawn in this specimen.</p></section>`

const weekCard = (opt) => `<div class="schools-card section">
<div class="nre-bar"><div class="chips"><button class="chip active" type="button">This week</button><button class="chip" type="button">Last week</button></div>
<label class="field"><span class="field-label">Compare to</span><select class="select"><option>${esc(D.school)}</option><option>All schools on this course</option></select></label></div>
<div class="wk"><header class="wk-head"><p class="wk-window">This week</p><p class="wk-range">Mon 14 Sep to now</p><span class="wk-why">why?</span></header>
<div class="wk-table"><div class="wk-h" style="display:contents"><span class="wk-cell"></span><span class="wk-cell wk-col ent">${esc(D.className)}</span><span class="wk-cell wk-col">School average</span></div>
<span class="wk-cell wk-lab">Play as class</span><span class="wk-cell wk-num wk-small">${week.minutes} min</span><span class="wk-cell wk-num wk-small">${week.schoolAvg} min</span>
<span class="wk-cell wk-lab">Students on their own</span><span class="wk-cell wk-num wk-small">0 min</span><span class="wk-cell wk-num wk-small">0 min</span>
<span class="wk-cell wk-lab">Total learning time</span><span class="wk-cell wk-num wk-big ent">${week.minutes} min</span><span class="wk-cell wk-num wk-big">${week.schoolAvg} min</span>
<div class="wk-last" style="display:contents"><span class="wk-cell wk-lab">New phrases</span><span class="wk-cell wk-num wk-small">${week.newPhrases}</span><span class="wk-cell wk-num wk-small">${week.schoolAvgNew}</span></div></div>
<div><p class="wk-trend-label">Last 12 weeks</p>${weekBarsSvg()}</div>
<p class="wk-denom">Average over the ${D.schoolClasses} classes at ${esc(D.school)} that have started this course, this one included.</p>
<p class="wk-alltime">Since ${fmtDay(D.sittings[0])} · ${Math.round(D.totalMinutes)} min practised · ${journeyDone} phrases reached</p>
<p class="spec-note">Specimen: the class column is real; the school average is the school's cycles this week over its classes, at this class's minutes per cycle.</p></div></div>`

function weekBarsSvg() {
  const W = 300, H = 46, n = 12, slot = W / n, max = Math.max(1, ...bars.entity, ...bars.cohort)
  const y = v => H - 4 - (v / max) * (H - 8)
  let s = ''
  bars.entity.forEach((v, i) => { s += `<rect class="wb-bar${i === n - 1 ? ' now' : ''}" x="${(i * slot + slot / 2 - slot * .32).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(slot * .64).toFixed(1)}" height="${(H - 4 - y(v)).toFixed(1)}"/>` })
  const path = bars.cohort.map((v, i) => `${i ? 'L' : 'M'}${(i * slot + slot / 2).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return `<svg class="wb" viewBox="0 0 ${W} ${H}" role="img" aria-label="Total learning time, last twelve weeks, this class over the average">${s}<path class="wb-normal" d="${path}"/></svg>`
}

const moreJourney = `<details class="schools-card more"><summary><span class="more-title">More about this level</span><span class="more-sub">how far through the course, and where they stop</span></summary><div><p class="class-card-note">The journey question, answered in a sentence with its funnel underneath. On a class of one account the funnel is one step: the class is at sentence ${seedReached} of ${D.seedsTotal}.</p></div></details>`
const voicePause = `<details class="schools-card more"><summary><span class="more-title">Voice &amp; pause</span><span class="more-sub">what the microphone is giving us</span></summary><div><p class="class-card-note">Uptake first, then how the pause is settling and how they sound. Unchanged from today's page and not drawn in this specimen.</p></div></details>`

const brainInsightsSection = `<section class="schools-card section" id="brain-section"><span class="kicker-red">How the class's brain grew</span>
${TRANSPORT}<div class="brain" id="brain"></div>${BRAIN_CAP}${STRIP}
<span class="kicker-red">Phrases practised</span><p class="cap">In course order, counts as at the scrubber. The highlighted row is the phrase just played.</p><div id="freq"></div>
<p class="spec-note">Specimen: drawn from ${D.className}'s own play log, ${D.tally.hearings} hearings across ${D.sittings.length} sittings. Same data, same rules as the replaying-brain page.</p></section>`

// ---------------------------------------------------------------- pages
mkdirSync(join(OUT, 'a'), { recursive: true }); mkdirSync(join(OUT, 'b'), { recursive: true })
const w = (p, s) => { writeFileSync(join(OUT, p), s); console.log('wrote', p, s.length) }

// Option A: Overview exactly as today; the brain is a section of Insights.
w('a/overview.html', shell('A', 'overview', 'overview', `${D.className} · Overview · A`, `${statsRow}<div class="class-cards">${practiceCard}${journeyBarCard}</div>${studentsNote}${manage}`))
w('a/insights.html', shell('A', 'insights', 'insights', `${D.className} · Insights · A`, `${weekCard('A')}${brainInsightsSection}${moreJourney}${voicePause}`, BRAIN_JS + 'wireTransport();'))

// Option B: the brain IS the Course journey card on Overview; Insights stays
// the comparison lens, and the one-class journey line goes.
w('b/overview.html', shell('B', 'overview', 'overview', `${D.className} · Overview · B`, `${statsRow}<div class="class-cards">${practiceCard}${brainJourneyCard}</div>${studentsNote}${manage}`,
  BRAIN_JS + `const tg=$('replayToggle'),rp=$('replay');tg.onclick=()=>{const open=rp.hidden;rp.hidden=!open;tg.setAttribute('aria-expanded',String(open));tg.textContent=open?'Close the replay':'▶ Replay how it grew';if(open){wireTransport();setStep(0);start()}else{stop();setStep(E.length)}};`))
w('b/insights.html', shell('B', 'insights', 'insights', `${D.className} · Insights · B`, `${weekCard('B')}${voicePause}`))

// The index: where a teacher starts — the class row on My classes — and the
// two shapes to tap through.
const row = (opt) => `<div class="row" role="link" tabindex="0" onclick="location.href='${opt}/overview.html'"><span><span class="nm"><span class="belt"></span>${esc(D.className)}</span><span class="meta"><span>Journey <b>${journeyDone} / ${D.legosTotal}</b></span><span>Played as class <b>${week.minutes} min</b></span><span>Phrases <b>${week.phrases}</b></span></span></span>
<svg width="80" height="20" viewBox="0 0 80 20" aria-hidden="true"><polyline points="2,18 14,14 26,18 38,18 50,6 62,18 74,4" fill="none" stroke="rgb(37,99,235)" stroke-width="1.5"/></svg>
<nav class="lens-tabs" onclick="event.stopPropagation()"><a class="lens-tab active" href="${opt}/overview.html">Overview</a><a class="lens-tab" href="${opt}/insights.html">Insights</a></nav></div>`

w('index.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Class stats: two shapes</title>${FONTS}<style>${CSS}</style></head><body>
<header class="topbar"><span class="brand">SSi <b>Schools</b> · specimen</span><span class="spec-tag">class stats</span></header>
<div class="hero"><h1>Where does the brain live?</h1><p>Two shapes of the class statistics area, on ${esc(D.className)}'s real play log. Each row below is the class row from My classes; tap it, or the pair, and then move between Overview and Insights as a teacher would. Every page has a <b>see A / see B</b> switch top right.</p></div>
<div class="page" style="display:flex;flex-direction:column;gap:16px;padding-top:8px">
<section class="schools-card opt"><h2>A · Overview as today, brain inside Insights</h2><p>Overview keeps its four numbers, the practice card and the journey bar. Insights keeps the week card and gains the brain as a section under it, replay and all, above More about this level and Voice &amp; pause.</p>${row('a')}</section>
<section class="schools-card opt"><span class="rec">Recommended</span><h2>B · The brain is the course journey</h2><p>Overview's Course journey card becomes the brain at its latest frame, with the four totals under it and one button to replay how it grew. Insights stays the comparison lens, week card and voice only. Nothing new to navigate to; one card stops being a bar and starts being the class.</p>${row('b')}</section>
<section class="schools-card opt"><h2>The brain on its own page</h2><p>The replaying-brain specimen this exploration grew from, unchanged.</p><a class="btn-ghost" href="../replaying-brain/">Open the replaying brain</a></section>
</div></body></html>`)
