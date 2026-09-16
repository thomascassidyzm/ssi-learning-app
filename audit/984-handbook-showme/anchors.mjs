import fs from 'fs'; import path from 'path'
const SRC='packages/player-vue/src'
const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory())w(p); else if(/\.(vue|ts)$/.test(e.name))files.push(p)}})(SRC)
const anchorFiles={}
for(const f of files){const s=fs.readFileSync(f,'utf8'); for(const m of s.matchAll(/data-(?:walk|intel)="([^"]+)"/g)){ if(m[1].includes('{'))continue; (anchorFiles[m[1]] ||= new Set()).add(f)}
  for(const m of s.matchAll(/:data-(?:walk|intel)="`([^`]+)`"/g)){ (anchorFiles['DYN:'+m[1]] ||= new Set()).add(f)}}
const pack=JSON.parse(fs.readFileSync(SRC+'/walkthrough/pack.json','utf8'))
const out=[]
for(const w of pack.walks){
  for(const [i,s] of w.steps.entries()){
    const fs_=anchorFiles[s.anchor]
    out.push({walk:w.id, route:w.place.route, kinds:(w.place.kinds||[]).join('|'), personas:w.personas.join('|'), step:i+1, anchor:s.anchor, defined: fs_?[...fs_].map(x=>x.replace(SRC+'/','')).join(' ; '):'*** NOT FOUND IN SOURCE ***'})
  }
}
fs.writeFileSync(process.env.CS_SCRATCH+'/anchor-map.json', JSON.stringify(out,null,1))
const missing=out.filter(o=>o.defined.startsWith('***'))
console.log('walk steps total', out.length, '| anchors not found in source:', missing.length)
for(const m of missing) console.log('  MISSING', m.walk, 'step'+m.step, m.anchor, '(route '+m.route+')')
