import json, os, urllib.request, collections

URL=os.environ['SUPABASE_URL']; KEY=os.environ['SUPABASE_SERVICE_KEY']
def q(path):
    out=[]; offset=0
    while True:
        req=urllib.request.Request(f"{URL}/rest/v1/{path}&limit=1000&offset={offset}",
            headers={"apikey":KEY,"Authorization":f"Bearer {KEY}"})
        batch=json.load(urllib.request.urlopen(req))
        out+=batch
        if len(batch)<1000: return out
        offset+=1000

state=q("learner_pod_state?select=learner_id,course_code,sentence_id,exposures,updated_at&order=course_code")
print("total learner_pod_state rows:", len(state))
courses=sorted(set(r['course_code'] for r in state))
print("courses with pod state:", len(courses))

pods=q("listening_pods?select=id,course_code,slug,visibility&order=course_code")
served={}
for c in courses:
    rows=[p for p in pods if p['course_code']==c]
    live=[p for p in rows if p['visibility']=='live' and p['slug'] in ('pod-1','pod-0')]
    # servedPod rule: pod-1 first, else pod-0 (anon sees only live)
    slug=None
    for want in ('pod-1','pod-0'):
        if any(p['slug']==want for p in live): slug=want; break
    served[c]=slug

orphans=[]
per_course=collections.Counter()
for c in courses:
    slug=served[c]
    ids=set()
    if slug:
        rows=q(f"listening_pod_sentences?select=id&pod_id=eq.{c}:{slug}")
        ids={r['id'] for r in rows}
    for r in state:
        if r['course_code']!=c: continue
        base=r['sentence_id'].split(':s')[0] if ':s' in r['sentence_id'].split(':',3)[-1] else r['sentence_id']
        # sentence_id is either full id or full id + ':sN'
        sid=r['sentence_id']
        core=sid.rsplit(':s',1)[0] if sid.rsplit(':s',1)[-1].isdigit() else sid
        if core not in ids:
            orphans.append(r); per_course[c]+=1
print("\nSERVED SLUGS:", {c:s for c,s in served.items()})
print("\nORPHANS (row's sentence not in served pod):", len(orphans))
for c,n in per_course.most_common(): print(f"  {c}: {n}")
learners=set((r['learner_id'],r['course_code']) for r in orphans)
print("distinct (learner,course) stranded:", len(learners))
with open(os.environ['CS_SCRATCH']+'/orphans.json','w') as f: json.dump(orphans,f,indent=1)
