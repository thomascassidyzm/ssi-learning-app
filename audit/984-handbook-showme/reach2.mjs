import fs from 'fs'; import path from 'path'
const SRC='packages/player-vue/src'
const SHELL=['containers/SchoolsContainer.vue','containers/AdminContainer.vue','App.vue'];
const ROOT={dashboard:['views/schools/DashboardView.vue','views/schools/TeacherDashboard.vue'],teachers:['views/schools/TeachersView.vue'],students:['views/schools/StudentsView.vue'],classes:['views/schools/TeacherDashboard.vue'],'class-detail':['views/schools/ClassDetail.vue'],settings:['views/schools/SettingsView.vue'],setup:['views/schools/SetupView.vue'],'schools-list':['views/schools/SchoolsView.vue'],analytics:['insight/TeacherInsightsView.vue'],upgrade:['views/schools/UpgradeView.vue'],inbox:['views/schools/InboxView.vue'],'admin-invites':['views/admin/AdminInvites.vue'],intel:['intel/QuestionPage.vue'],'node-home':['views/admin/NodeHomeView.vue'],'node-insights':['views/admin/NodeInsightsView.vue'],'player-settings':['components/SettingsScreen.vue'],library:['components/BrowseScreen.vue','views/me/ProfileView.vue']}
const imp=(file)=>{const s=fs.readFileSync(file,'utf8'); const out=new Set()
  for(const m of s.matchAll(/['"](@\/[^'"]+|\.\.?\/[^'"]+)['"]/g)){let p=m[1].startsWith('@/')?path.join(SRC,m[1].slice(2)):path.join(path.dirname(file),m[1])
    for(const c of [p,p+'.vue',p+'.ts',p+'/index.ts']) if(fs.existsSync(c)&&fs.statSync(c).isFile()){out.add(c);break}}
  return out}
const closure=(roots)=>{const seen=new Set(roots.map(r=>path.join(SRC,r))); const q=[...seen]
  while(q.length){const f=q.pop(); if(!fs.existsSync(f))continue; for(const d of imp(f)) if(!seen.has(d)&&/\.(vue|ts)$/.test(d)){seen.add(d);q.push(d)}} return seen}
const cl={}; for(const k in ROOT) cl[k]=closure([...ROOT[k],...SHELL])
const anchorFiles={}; const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory())w(p); else if(/\.vue$/.test(e.name))files.push(p)}})(SRC)
for(const f of files){const s=fs.readFileSync(f,'utf8'); for(const m of s.matchAll(/data-(?:walk|intel)="([^"{]+)"/g)) (anchorFiles[m[1]] ||= new Set()).add(f)}
const pack=JSON.parse(fs.readFileSync(SRC+'/walkthrough/pack.json','utf8'))
const bad=[]
for(const w of pack.walks) for(const [i,s] of w.steps.entries()){
  const defs=[...(anchorFiles[s.anchor]||[])]; const c=cl[w.place.route]
  if(!c){bad.push([w.id,i+1,s.anchor,'route '+w.place.route+' has no known root']);continue}
  if(!defs.length){bad.push([w.id,i+1,s.anchor,'anchor not in any .vue']);continue}
  if(!defs.some(d=>c.has(d))) bad.push([w.id,i+1,s.anchor,'defined only in '+defs.map(d=>d.replace(SRC+'/','')).join(',')+' — NOT reachable from '+w.place.route])
}
console.log('steps whose anchor is not reachable from the walk\'s own place:',bad.length)
for(const b of bad) console.log(' ',b[0],'step'+b[1],b[2],'::',b[3])
