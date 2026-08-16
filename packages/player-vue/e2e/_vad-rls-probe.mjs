import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
const SB='https://swfvymspfxmnfhevgdkg.supabase.co'
const ANON='sb_publishable_qtEtXRcEOkvapw99x5suww_SuCXYmvg'
const key=readFileSync(homedir()+'/.ssi-sentinel.env','utf8').match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim()
const svc=createClient(SB,key)
const anon=createClient(SB,ANON,{auth:{persistSession:false,autoRefreshToken:false}})
const {data:link}=await svc.auth.admin.generateLink({type:'magiclink',email:'thomas.cassidy+admin001@gmail.com'})
const {data:v}=await anon.auth.verifyOtp({type:'email',token_hash:link.properties.hashed_token})
const as=createClient(SB,ANON,{global:{headers:{Authorization:`Bearer ${v.session.access_token}`}}})
// a learner known to have prosody
const {data:sample}=await svc.from('player_events').select('user_id').eq('event_type','cycle_prosody').limit(1)
const lid=sample[0].user_id
console.log('probe learner', lid)
for(const [label,client] of [['service',svc],['admin',as]]){
  const a=await client.from('player_events').select('id',{count:'exact',head:true}).eq('event_type','cycle_prosody').eq('user_id',lid)
  const b=await client.from('learner_lego_metrics').select('lego_id',{count:'exact',head:true}).eq('learner_id',lid)
  console.log(label,'prosody',a.count,a.error?.message||'', '| metrics',b.count,b.error?.message||'')
}
