/* SSi Schools — shared chrome and atoms.
   Exposes components and hooks on window for screen scripts. */

const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;

/* ─── role + density hooks (localStorage-backed) ─── */

function useRole() {
  const [role, setRole] = useState(() => {
    try { return localStorage.getItem('ssi-schools-role') || 'teacher'; } catch { return 'teacher'; }
  });
  const change = useCallback((r) => {
    setRole(r);
    try { localStorage.setItem('ssi-schools-role', r); } catch {}
  }, []);
  return [role, change];
}

function useDensity() {
  const [density, setDensity] = useState(() => {
    try { return localStorage.getItem('ssi-schools-density') || 'compact'; } catch { return 'compact'; }
  });
  const change = useCallback((d) => {
    setDensity(d);
    try { localStorage.setItem('ssi-schools-density', d); } catch {}
  }, []);
  return [density, change];
}

function currentUserForRole(role) {
  if (role === 'admin') return window.SSI_ADMIN;
  if (role === 'govt')  return window.SSI_GOVT;
  return window.SSI_TEACHER;
}

const NAV_FOR_ROLE = {
  teacher: [
    { label:'Dashboard', href:'dashboard.html' },
    { label:'Students',  href:'students.html' },
    { label:'Analytics', href:'analytics.html' },
  ],
  admin: [
    { label:'Dashboard', href:'dashboard.html' },
    { label:'Classes',   href:'classes.html' },
    { label:'Students',  href:'students.html' },
    { label:'Teachers',  href:'teachers.html' },
    { label:'Analytics', href:'analytics.html' },
    { label:'Settings',  href:'settings.html' },
  ],
  govt: [
    { label:'Schools',   href:'schools-list.html' },
    { label:'Analytics', href:'analytics.html' },
  ],
};

const ROLE_LABEL = { teacher:'Teacher', admin:'School Admin', govt:'Govt Admin' };

/* ─── atoms ─── */

function BeltDot({ belt, size = 14, ring = false }) {
  return (
    <span style={{
      display:'inline-block', width:size, height:size, borderRadius:'50%',
      background: `var(--schools-belt-${belt})`,
      boxShadow: ring ? `inset 0 0 0 1.5px rgba(0,0,0,.15)` : 'inset 0 0 0 1px rgba(0,0,0,.1)',
      verticalAlign:'middle', flex:'none',
    }}/>
  );
}

function BeltStrip({ dist }) {
  const total = Object.values(dist).reduce((a,b)=>a+b, 0);
  return (
    <div style={{display:'flex', width:'100%', height:6, borderRadius:3, overflow:'hidden', background:'rgba(0,0,0,.05)'}}>
      {Object.entries(dist).map(([belt, n]) => (
        <div key={belt} style={{ width:`${(n/total)*100}%`, background:`var(--schools-belt-${belt})` }}/>
      ))}
    </div>
  );
}

function Spark({ data, color='var(--schools-red)', w=88, h=24 }) {
  const max = Math.max(...data, 1);
  const step = w / (data.length-1);
  const pts = data.map((v,i) => `${i*step},${h - (v/max)*h}`).join(' ');
  const fillPts = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{display:'block'}}>
      <polygon points={fillPts} fill={color} opacity="0.12"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function Journey({ done, total, color='var(--schools-red)', label='Course Journey' }) {
  const pct = (done/total)*100;
  return (
    <div style={{width:'100%'}}>
      <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--schools-fg-2)', marginBottom:4}}>
        <span>{label}</span><span>{done}/{total}</span>
      </div>
      <div style={{height:6, borderRadius:3, background:'rgba(0,0,0,.05)', overflow:'hidden'}}>
        <div style={{height:'100%', width:`${pct}%`, background: color}}/>
      </div>
    </div>
  );
}

function Bench({ data }) {
  const max = Math.max(data.class, data.school, data.course) * 1.1;
  const row = (label, v, color) => (
    <div style={{display:'flex', alignItems:'center', gap:8, fontSize:11, color:'var(--schools-fg-2)', marginBottom:3}}>
      <span style={{width:42}}>{label}</span>
      <div style={{flex:1, height:5, background:'rgba(0,0,0,.05)', borderRadius:2.5, overflow:'hidden'}}>
        <div style={{height:'100%', width:`${(v/max)*100}%`, background: color}}/>
      </div>
      <span style={{width:28, textAlign:'right', color:'var(--schools-fg)'}}>{v}m</span>
    </div>
  );
  return (
    <div>
      {row('Class', data.class, 'var(--schools-red)')}
      {row('School', data.school, 'rgba(15,18,18,.35)')}
      {row('Global', data.course, 'rgba(15,18,18,.18)')}
    </div>
  );
}

function HealthDot({ health }) {
  const map = {
    'excellent': '#1F8A5B',
    'good': '#3768c4',
    'needs-attention': '#c66a1c',
    'inactive': '#999',
  };
  return <span style={{display:'inline-block', width:8, height:8, borderRadius:'50%', background:map[health]||'#999'}}/>;
}

/* ─── chrome ─── */

function Logo({ size=22 }) {
  return (
    <a href="index.html" style={{display:'flex', alignItems:'center', gap:8, textDecoration:'none', color:'inherit'}}>
      <div style={{
        width:size, height:size, borderRadius:5, background:'var(--schools-red)',
        color:'#fff', display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--font-display)', fontWeight:400, fontSize:size*0.7, lineHeight:1,
      }}>S</div>
      <div style={{fontFamily:'var(--font-display)', fontSize:size*0.8, lineHeight:1}}>
        SaySomethingin <span style={{opacity:.5}}>·</span> <span style={{color:'var(--schools-red)'}}>Schools</span>
      </div>
    </a>
  );
}

function NavTabs({ active, role }) {
  const tabs = NAV_FOR_ROLE[role] || NAV_FOR_ROLE.teacher;
  return (
    <nav style={{display:'flex', gap:4, alignItems:'center'}}>
      {tabs.map(t => {
        const a = t.label === active;
        return (
          <a key={t.label} href={t.href} style={{
            padding:'8px 14px', fontSize:13.5, fontWeight:500, textDecoration:'none',
            color: a ? '#fff' : 'var(--schools-fg)',
            background: a ? 'var(--schools-red)' : 'transparent',
            borderRadius: 6,
          }}>{t.label}</a>
        );
      })}
    </nav>
  );
}

function DensityToggle({ value, onChange }) {
  const opts = [
    { id:'compact',  label:'Compact'  },
    { id:'detailed', label:'Detailed' },
  ];
  return (
    <div role="radiogroup" aria-label="Display density" style={{
      display:'inline-flex', background:'#f3f1ec', borderRadius:7, padding:3, gap:2,
      border:'1px solid var(--schools-border)',
    }}>
      {opts.map(o => {
        const a = o.id === value;
        return (
          <button key={o.id} onClick={()=>onChange(o.id)} style={{
            padding:'5px 10px 6px', border:'none', cursor:'pointer', borderRadius:5,
            background: a ? '#fff' : 'transparent',
            color: a ? 'var(--schools-fg)' : 'var(--schools-fg-2)',
            boxShadow: a ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
            fontWeight: a ? 600 : 500, fontSize:12, fontFamily:'var(--font-body)',
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

function RoleSwitcher({ role, onChange, user }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, []);
  const roleColor = { teacher:'#1F8A5B', admin:'#3768c4', govt:'#900600' }[role];
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        display:'inline-flex', alignItems:'center', gap:10, padding:'5px 8px 5px 5px',
        border:'1px solid var(--schools-border)', background:'#fff', borderRadius:30,
        cursor:'pointer', fontFamily:'var(--font-body)',
      }}>
        <span style={{
          width:30, height:30, borderRadius:'50%', background:roleColor, color:'#fff',
          display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:600,
        }}>{user.initials}</span>
        <span style={{display:'flex', flexDirection:'column', alignItems:'flex-start', lineHeight:1.2, gap:1, minWidth:0, maxWidth:120}}>
          <span style={{fontSize:12.5, fontWeight:600, color:'var(--schools-fg)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'100%'}}>{user.name}</span>
          <span style={{fontSize:10.5, color:'var(--schools-fg-2)', whiteSpace:'nowrap'}}>{ROLE_LABEL[role]}</span>
        </span>
        <span style={{fontSize:10, color:'var(--schools-fg-3)', marginRight:4}}>▾</span>
      </button>
      {open && (
        <div style={{
          position:'absolute', right:0, top:'calc(100% + 6px)', width:260, zIndex:50,
          background:'#fff', border:'1px solid var(--schools-border)', borderRadius:10,
          boxShadow:'0 12px 32px -8px rgba(0,0,0,.2)', overflow:'hidden',
        }}>
          <div style={{padding:'10px 12px 8px', fontSize:10.5, fontWeight:600, letterSpacing:'.08em',
            textTransform:'uppercase', color:'var(--schools-fg-3)', borderBottom:'1px solid var(--schools-border)'}}>
            Acting as
          </div>
          {[
            { id:'teacher', user:window.SSI_TEACHER, color:'#1F8A5B', desc:'Teacher · classroom view' },
            { id:'admin',   user:window.SSI_ADMIN,   color:'#3768c4', desc:'School-wide controls' },
            { id:'govt',    user:window.SSI_GOVT,    color:'#900600', desc:'Cross-school programme view' },
          ].map(o => {
            const a = o.id === role;
            return (
              <button key={o.id} onClick={()=>{ onChange(o.id); setOpen(false);
                // route to the role's default landing
                const dest = o.id === 'govt' ? 'schools-list.html' : 'dashboard.html';
                if (!location.pathname.endsWith(dest)) location.href = dest;
              }} style={{
                width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px',
                background: a ? '#f6f5f1' : '#fff', border:'none', cursor:'pointer', textAlign:'left',
                borderBottom:'1px solid var(--schools-border)',
              }}>
                <span style={{
                  width:28, height:28, borderRadius:'50%', background:o.color, color:'#fff',
                  display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600,
                }}>{o.user.initials}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontSize:13, fontWeight:600, color:'var(--schools-fg)'}}>{o.user.name}</div>
                  <div style={{fontSize:11, color:'var(--schools-fg-2)'}}>{o.desc}</div>
                </div>
                {a && <span style={{color:'var(--schools-red)', fontSize:14}}>●</span>}
              </button>
            );
          })}
          <a href="login.html" style={{
            display:'block', padding:'10px 12px', fontSize:12, color:'var(--schools-fg-2)',
            textDecoration:'none', textAlign:'center',
          }}>Sign out</a>
        </div>
      )}
    </div>
  );
}

function TopBar({ active, role, onRoleChange, density, onDensityChange, user }) {
  return (
    <header style={{
      height:54, display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'0 24px', background:'#fff', borderBottom:'1px solid var(--schools-border)', flex:'none',
    }}>
      <div style={{display:'flex', alignItems:'center', gap:32}}>
        <Logo/>
        <NavTabs active={active} role={role}/>
      </div>
      <div style={{display:'flex', alignItems:'center', gap:12}}>
        {density && onDensityChange && (
          <>
            <DensityToggle value={density} onChange={onDensityChange}/>
            <div style={{width:1, height:24, background:'var(--schools-border)'}}/>
          </>
        )}
        <span style={{fontSize:12.5, color:'var(--schools-fg-2)'}}>{user.school}</span>
        <RoleSwitcher role={role} onChange={onRoleChange} user={user}/>
      </div>
    </header>
  );
}

/* ─── greeting for dashboard ─── */

function Greeting({ dense=false, name, lines, action }) {
  return (
    <div style={{display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:24, marginBottom: dense ? 16 : 22}}>
      <div style={{maxWidth: dense ? 800 : 640}}>
        <div style={{
          fontSize: dense ? 11 : 13, color:'var(--schools-fg-2)',
          letterSpacing:'.08em', textTransform:'uppercase',
          marginBottom: dense ? 4 : 6, fontWeight:600,
        }}>
          Wednesday · 12 May
        </div>
        <h1 className="arsenal" style={{
          fontSize: dense ? 30 : 46, lineHeight:1.05, letterSpacing:'-0.01em', margin:0,
        }}>
          {name}
        </h1>
        {lines && (
          <p style={{
            fontSize: dense ? 13.5 : 16,
            color:'var(--schools-fg-2)',
            maxWidth: dense ? 800 : 580,
            lineHeight:1.5, marginTop: dense ? 4 : 10, margin: dense ? '4px 0 0' : '10px 0 0',
          }}>
            {lines}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

/* ─── Stage: scales 1366×768 to fit viewport, no chrome of its own ─── */

function Stage({ children, bg='#e8e5dd' }) {
  const W = 1366, H = 768;
  const ref = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const calc = () => {
      const el = ref.current; if (!el) return;
      const padX = 32, padY = 32;
      setScale(Math.min((el.clientWidth-padX)/W, (el.clientHeight-padY)/H, 1));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return (
    <div ref={ref} style={{
      minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
      padding:'16px', background:bg, overflow:'auto',
    }}>
      <div style={{width:W*scale, height:H*scale, position:'relative'}}>
        <div style={{
          position:'absolute', top:0, left:0, width:W, height:H,
          transform:`scale(${scale})`, transformOrigin:'top left',
          boxShadow:'0 24px 60px -20px rgba(0,0,0,.25), 0 8px 24px -8px rgba(0,0,0,.15)',
          background:'#fff', borderRadius:8, overflow:'hidden',
          display:'flex', flexDirection:'column',
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─── ScreenShell: Stage + TopBar with role/density wiring ─── */

function ScreenShell({ active, children, withDensity=false, bg }) {
  const [role, setRole] = useRole();
  const [density, setDensity] = useDensity();
  const user = currentUserForRole(role);
  return (
    <Stage bg={bg}>
      <TopBar
        active={active}
        role={role} onRoleChange={setRole}
        density={withDensity ? density : null}
        onDensityChange={withDensity ? setDensity : null}
        user={user}
      />
      {typeof children === 'function' ? children({ role, density, user }) : children}
    </Stage>
  );
}

/* ─── shared button styles via class ─── */
const BTN_PRIMARY = 'btn-play';
const BTN_GHOST = 'btn-ghost';

Object.assign(window, {
  useRole, useDensity, currentUserForRole, NAV_FOR_ROLE, ROLE_LABEL,
  BeltDot, BeltStrip, Spark, Journey, Bench, HealthDot,
  Logo, NavTabs, DensityToggle, RoleSwitcher, TopBar, Greeting,
  Stage, ScreenShell,
});
