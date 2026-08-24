import subprocess,sys,os,array,math
PROXY="https://saysomethingin.app/api/audio/"
def feats(buf):
    r=subprocess.run(['ffmpeg','-v','error','-i','pipe:0','-ac','1','-ar','16000','-f','f32le','-'],input=buf,capture_output=True)
    x=array.array('f'); x.frombytes(r.stdout)
    sr=16000; win=320; n=len(x)//win
    if n<5: return None
    e=[]
    for w in range(n):
        s=0.0; b=w*win
        for i in range(b,b+win): s+=x[i]*x[i]
        e.append(math.sqrt(s/win)+1e-12)
    pk=max(e); db=[20*math.log10(v/pk) for v in e]
    tail=0
    for i in range(n-1,-1,-1):
        if db[i]<-40: tail+=1
        else: break
    ls=n-tail-1
    if ls<1: return None
    fin=db[ls]
    a=max(0,ls-4)
    slope=(db[ls]-db[a])/max(1,(ls-a))
    return (round(len(x)/sr*1000), tail*20, round(fin,1), round(slope,2))
out=sys.stdout
for line in sys.stdin:
    key=line.strip()
    if not key: continue
    try:
        c=subprocess.run(['curl','-s','-f','--max-time','25',PROXY+key],capture_output=True)
        if c.returncode!=0 or len(c.stdout)<200: out.write(key+"\tFETCHFAIL\n"); out.flush(); continue
        f=feats(c.stdout)
        if not f: out.write(key+"\tDECODEFAIL\n"); out.flush(); continue
        out.write("%s\t%d\t%d\t%s\t%s\n"%(key,f[0],f[1],f[2],f[3])); out.flush()
    except Exception as ex:
        out.write(key+"\tERR\n"); out.flush()
