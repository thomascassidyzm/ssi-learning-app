import json,sys,glob,os
def load(p):
    try: return json.load(open(p))
    except Exception: return []
def verdict(r):
    if not r.get('entryVisibleInScope'): return 'not in "Just what I can do"'
    if r.get('clips') and not r.get('showMeButtonPresent'): return 'SHOW-ME MISSING (clip exists)'
    if not r.get('clips'): sm='no clip (prose only, by design)'
    else: sm=None
    if r.get('showMeButtonPresent'):
        if not r.get('walkActiveAfterShowMe'): return 'SHOW-ME STARTED NOTHING at '+str(r.get('urlAfterShowMe','?')).replace('https://staging.saysomethingin.app','')
        steps=r.get('steps') or []
        floated=[s for s in steps if 'idx' in s and (s.get('ringCount',0)==0 or not s.get('anchored',{}).get('exists'))]
        done=any(s.get('done') for s in steps)
        off=[s for s in steps if 'idx' in s and s.get('anchored',{}).get('exists') and not s['anchored'].get('inViewport')]
        bits=[]
        if floated: bits.append('%d/%d steps FLOATED'%(len(floated),len([s for s in steps if 'idx' in s])))
        if off: bits.append('%d steps off-screen'%len(off))
        if not done: bits.append('did not reach terminal')
        return 'clean' if not bits else '; '.join(bits)
    return sm or 'no Show me'
def goverdict(r):
    if not r.get('gotoLinkPresent'): return 'NO Take-me-there link'
    u=str(r.get('urlAfterGoto','')).replace('https://staging.saysomethingin.app','')
    h=str(r.get('gotoHref',''))
    if h and not u.startswith(h.split('?')[0]): return 'REDIRECTED: %s -> %s'%(h,u)
    if r.get('anchorExistsAfterGoto') is False: return 'landed %s but anchor %s NOT on the page'%(u,r.get('anchor'))
    return 'clean (%s)'%u
for p in sorted(glob.glob('audit/984-handbook-showme/results/*.json')):
    d=load(p)
    if not d: continue
    print('\n## %s — %d entries measured'%(os.path.basename(p),len(d)))
    print('| entry | Show me | Take me there |')
    print('|---|---|---|')
    for r in d: print('| %s | %s | %s |'%(r['id'],verdict(r),goverdict(r)))
