import { useEffect, useState, useSyncExternalStore } from 'react'
import { BrowserRouter, Link, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Bell, CalendarDays, ChevronRight, CircleUserRound,
  FileText, LayoutDashboard, Menu, Newspaper, Search, ShieldCheck,
  Trophy, Upload, Users, X
} from 'lucide-react'
import './App.css'

const API = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'
const SESSION_KEYS = ['nca_admin_token', 'nca_player_token', 'nca_member_token']
const SESSION_EVENT = 'nca-session-change'

function clearSessionTokens() {
  SESSION_KEYS.forEach(key => localStorage.removeItem(key))
  window.dispatchEvent(new Event(SESSION_EVENT))
}

function saveSessionToken(key, token) {
  SESSION_KEYS.forEach(sessionKey => localStorage.removeItem(sessionKey))
  localStorage.setItem(key, token)
  window.dispatchEvent(new Event(SESSION_EVENT))
}

function getSessionRole() {
  return localStorage.getItem('nca_admin_token')
    ? 'admin'
    : localStorage.getItem('nca_player_token')
      ? 'player'
      : localStorage.getItem('nca_member_token')
        ? 'member'
        : ''
}

function subscribeToSession(listener) {
  window.addEventListener(SESSION_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(SESSION_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

async function api(path, options) {
  const headers = new Headers(options?.headers || {})
  const playerToken = localStorage.getItem('nca_player_token')
  const memberToken = localStorage.getItem('nca_member_token')
  const adminToken = localStorage.getItem('nca_admin_token')
  const token = path.startsWith('/api/player/')
    ? playerToken
    : path.startsWith('/api/member/')
      ? memberToken
      : adminToken || memberToken || playerToken
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(`${API}${path}`, { ...options, headers })
  if (!response.ok) {
    const body = await response.text()
    let message = body
    try {
      const payload = JSON.parse(body)
      message = payload.detail || payload.message || body
    } catch {}
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return response.json()
}

function Logo({ compact = false }) {
  const [logoUrl, setLogoUrl] = useState('')
  useEffect(() => {
    api('/api/media/assets').then(data => setLogoUrl(data.logo?.[0] || '')).catch(() => {})
  }, [])
  return (
    <Link className="brand" to="/" aria-label="NCA home">
      <span className="brand-mark">{logoUrl ? <img src={`${API}${logoUrl}`} alt="NCA logo" /> : <Trophy size={compact ? 19 : 23} />}</span>
      {!compact && (
        <span>
          <strong>NOTUNPARA</strong>
          <small>CRICKET ASSOCIATION</small>
        </span>
      )}
    </Link>
  )
}

function Header() {
  const [open, setOpen] = useState(false)
  const accountRole = useSyncExternalStore(subscribeToSession, getSessionRole, getSessionRole)
  const navigate = useNavigate()
  const signOut = () => {
    clearSessionTokens()
    navigate('/login')
  }
  const nav = [
    ['Home', '/'], ['Players', '/players'], ['Rankings', '/rankings'],
    ['Matches', '/matches'], ['Statistics', '/statistics'], ['Reports', '/reports'],
    ['Rules', '/rules'], ['About', '/about']
  ]
  return (
    <header className="topbar">
      <div className="nav-shell">
        <Logo />
        <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
          {open ? <X /> : <Menu />}
        </button>
        <nav className={open ? 'nav-links open' : 'nav-links'}>
          {nav.map(([label, path]) => <Link key={path} to={path} onClick={() => setOpen(false)}>{label}</Link>)}
        </nav>
        <div className="login-actions">{accountRole ? <><Link className="player-login-link" to={accountRole === 'admin' ? '/admin' : accountRole === 'player' ? '/player/account' : '/account'}>{accountRole === 'admin' ? 'Dashboard' : 'My account'}</Link><button className="header-signout" onClick={signOut}>Sign out</button></> : <><Link className="player-login-link" to="/login">Sign in</Link><Link className="register-button" to="/register">Create account</Link><Link className="admin-button" to="/admin/login"><ShieldCheck size={17} /> Admin</Link></>}</div>
      </div>
    </header>
  )
}

function Stat({ icon: Icon, value, label }) {
  return (
    <div className="stat-card">
      <span className="stat-icon"><Icon size={21} /></span>
      <div><strong>{value}</strong><small>{label}</small></div>
    </div>
  )
}

function EmptyCard({ title, children }) {
  return <div className="empty-card"><h3>{title}</h3><p>{children}</p></div>
}

function HomePage() {
  const [dashboard, setDashboard] = useState(null)
  const [players, setPlayers] = useState([])
  const [matches, setMatches] = useState([])
  const [coverUrl, setCoverUrl] = useState('')
  useEffect(() => {
    api('/api/dashboard').then(setDashboard).catch(() => {})
    api('/api/players').then(setPlayers).catch(() => {})
    api('/api/matches').then(setMatches).catch(() => {})
    api('/api/media/assets').then(data => setCoverUrl(data.covers?.[0] || '')).catch(() => {})
  }, [])
  return (
    <main>
      <section className="hero" style={coverUrl ? {backgroundImage:`linear-gradient(rgba(16,24,42,.86),rgba(16,24,42,.92)),url(${API}${coverUrl})`,backgroundSize:'cover',backgroundPosition:'center'} : undefined}>
        <div className="hero-pattern" />
        <div className="hero-content">
          <div className="eyebrow"><span /> NOTUNPARA CRICKET ASSOCIATION</div>
          <h1>Where talent meets<br /><em>discipline.</em></h1>
          <p>The official digital home for NCA players, matches, rankings and cricketing progress.</p>
          <div className="hero-actions">
            <Link className="primary-button" to="/matches">Match Centre <ChevronRight size={18} /></Link>
            <Link className="secondary-button" to="/players">Explore Players</Link>
          </div>
        </div>
        <div className="hero-emblem">
          <div className="emblem-ring"><Trophy size={74} /></div>
          <span>NCA</span>
        </div>
      </section>

      <section className="stat-grid page-shell">
        <Stat icon={Users} value={dashboard?.total_players ?? '—'} label="Registered players" />
        <Stat icon={Activity} value={dashboard?.matches_played ?? '—'} label="Matches played" />
        <Stat icon={Trophy} value={dashboard?.total_runs ?? '—'} label="Association runs" />
        <Stat icon={ShieldCheck} value={dashboard?.total_wickets ?? '—'} label="Wickets taken" />
      </section>

      <section className="content-grid page-shell">
        <div>
          <SectionHeading title="Latest rankings" action="/rankings" />
          {players.length ? (
            <div className="ranking-list">
              {players.slice(0, 5).map((p, i) => (
                <Link to={`/players/${p.id}`} className="ranking-row" key={p.id}>
                  <span className="rank-number">{i + 1}</span>
                  <span className="avatar">{p.name.slice(0, 1)}</span>
                  <span className="row-name"><strong>{p.name}</strong><small>{p.role}</small></span>
                  <span className="row-value"><strong>{p.ranking_points}</strong><small>PTS</small></span>
                </Link>
              ))}
            </div>
          ) : <EmptyCard title="No rankings yet">Verified match statistics will appear here after an approved scorecard.</EmptyCard>}
        </div>
        <div>
          <SectionHeading title="Match centre" action="/matches" />
          {matches.length ? (
            <div className="match-stack">
              {matches.slice(0, 3).map(m => (
                <div className="match-card" key={m.id}>
                  <div className="match-status">{m.status}</div>
                  <strong>{m.title}</strong>
                  <small>{new Date(m.match_date).toLocaleDateString()} • {m.venue || 'Venue TBA'}</small>
                  {m.result && <p>{m.result}</p>}
                </div>
              ))}
            </div>
          ) : <EmptyCard title="No matches published">Upcoming and completed matches managed from the admin dashboard will appear here.</EmptyCard>}
        </div>
      </section>
    </main>
  )
}

function SectionHeading({ title, action }) {
  return <div className="section-heading"><h2>{title}</h2>{action && <Link to={action}>View all <ChevronRight size={16} /></Link>}</div>
}

function PlayersPage() {
  const [players, setPlayers] = useState([])
  const [search, setSearch] = useState('')
  useEffect(() => { api('/api/players').then(setPlayers).catch(() => {}) }, [])
  const shown = players.filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <Page title="Player directory" kicker="THE NCA SQUAD">
      <div className="toolbar">
        <label className="search-box"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search players" /></label>
      </div>
      {shown.length ? <div className="player-grid">{shown.map(p => <PlayerCard key={p.id} p={p} />)}</div> :
        <EmptyCard title="No players registered">The administrator can add players from the NCA dashboard.</EmptyCard>}
    </Page>
  )
}

function PlayerCard({ p }) {
  return (
    <Link className="player-card" to={`/players/${p.id}`}>
      <div className="player-photo">{p.photo_url ? <img src={`${API}${p.photo_url}`} alt={p.name} /> : <CircleUserRound size={68} />}<span>{p.jersey_number ? `#${p.jersey_number}` : p.role}</span></div>
      <div className="player-info"><strong>{p.name}</strong><small>{p.role}</small><div><span>{p.matches} MAT</span><span>{p.runs} RUNS</span><span>{p.wickets} WKTS</span></div></div>
    </Link>
  )
}

function RankingsPage() {
  const [players, setPlayers] = useState([])
  const [history, setHistory] = useState([])
  useEffect(() => {
    api('/api/rankings').then(setPlayers).catch(() => {})
    api('/api/rankings/history').then(setHistory).catch(() => {})
  }, [])
  return (
    <Page title="NCA Player Rankings" kicker="PERFORMANCE TABLE">
      {players.length ? <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Matches</th><th>Runs</th><th>High</th><th>Avg</th><th>SR</th><th>Wickets</th><th>BBI</th><th>Economy</th><th>Points</th></tr></thead><tbody>{players.map(p => <tr key={p.id}><td><b>{p.rank}</b></td><td><span className="ranking-player"><span className="ranking-avatar">{p.photo_url?<img src={`${API}${p.photo_url}`} alt=""/>:p.name.slice(0,1)}</span>{p.name}</span></td><td>{p.matches}</td><td>{p.runs}</td><td>{p.high_score}</td><td>{p.batting_average}</td><td>{p.strike_rate}</td><td>{p.wickets}</td><td>{p.best_bowling || '—'}</td><td>{p.economy}</td><td><b>{p.ranking_points}</b></td></tr>)}</tbody></table></div> :
        <EmptyCard title="No ranking records">Rankings are recalculated after verified scorecards are approved.</EmptyCard>}
      {players.length > 0 && <div className="ranking-explainer"><h3>How NCA points are calculated</h3><p>Points balance runs per match, batting average, strike rate, wickets per match and bowling economy. Per-match rates and capped components limit the advantage of playing more matches. Each reviewed scorecard updates career data and ranking points after admin approval.</p><div className="ranking-weight-row"><span>Runs per match <b>30 pts</b></span><span>Batting average <b>15 pts</b></span><span>Strike rate <b>10 pts</b></span><span>Wickets per match <b>25 pts</b></span><span>Bowling economy <b>10 pts</b></span></div></div>}
      <section className="ranking-explainer ranking-history">
        <h3>Ranking history</h3>
        {history.length ? history.map(snapshot => (
          <details key={snapshot.id}>
            <summary>{new Date(snapshot.created_at).toLocaleString()}</summary>
            <div className="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Points</th></tr></thead><tbody>
              {snapshot.entries.map(entry => <tr key={entry.player_id}><td>{entry.rank}</td><td>{entry.player_name}</td><td>{entry.points}</td></tr>)}
            </tbody></table></div>
          </details>
        )) : <p>Ranking snapshots will be recorded whenever an administrator approves a scorecard.</p>}
      </section>
    </Page>
  )
}

function MatchesPage() {
  const [matches, setMatches] = useState([])
  useEffect(() => { api('/api/matches').then(setMatches).catch(() => {}) }, [])
  return <Page title="Match Centre" kicker="LATEST & UPCOMING"><div className="match-page-grid">{matches.map(m => <div className="match-card large" key={m.id}><span className={`status ${m.status}`}>{m.status}</span><h3>{m.title}</h3><p>{new Date(m.match_date).toLocaleString()}</p><small>{m.venue || 'Venue TBA'}</small>{m.result && <strong className="result">{m.result}</strong>}</div>)}
    {!matches.length && <EmptyCard title="No matches scheduled">Match fixtures and results will be published here.</EmptyCard>}</div></Page>
}

function ReportsPage() {
  const [reports, setReports] = useState([])
  useEffect(() => { api('/api/reports').then(setReports).catch(() => {}) }, [])
  return <Page title="Daily Reports" kicker="ASSOCIATION UPDATES">{reports.length ? <div className="article-grid">{reports.map(r => <article key={r.id}><span>{new Date(r.published_at).toLocaleDateString()}</span><h3>{r.title}</h3><p>{r.body}</p></article>)}</div> : <EmptyCard title="No daily reports">New reports published by the administrator will appear here.</EmptyCard>}</Page>
}

function RulesPage() {
  const [rules, setRules] = useState([])
  useEffect(() => { api('/api/rules').then(setRules).catch(() => {}) }, [])
  return <Page title="Rules & Regulations" kicker="OFFICIAL RULEBOOK">{rules.length ? <div className="rules-list">{rules.map(r => <details key={r.id}><summary>{r.category} — {r.title}</summary><p>{r.body}</p></details>)}</div> : <EmptyCard title="Rulebook pending publication">Official association categories and policies will appear here.</EmptyCard>}</Page>
}

function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState([])
  useEffect(() => { api('/api/announcements').then(setAnnouncements).catch(() => {}) }, [])
  return <Page title="News & Announcements" kicker="OFFICIAL NCA UPDATES">{announcements.length ? <div className="article-grid">{announcements.map(a => <article key={a.id}><span>{new Date(a.published_at).toLocaleDateString()}</span><h3>{a.title}</h3><p>{a.body}</p></article>)}</div> : <EmptyCard title="No announcements">Published announcements will appear here.</EmptyCard>}</Page>
}

function StatisticsPage() {
  return <Page title="Statistics & Analytics" kicker="ASSOCIATION INSIGHTS"><div className="analytics-grid"><EmptyCard title="Batting analytics">Career and match-by-match batting trends require verified scorecards.</EmptyCard><EmptyCard title="Bowling analytics">Bowling averages, economy and strike-rate trends will appear after approval.</EmptyCard><EmptyCard title="Player comparison">Compare NCA players once their verified statistics are available.</EmptyCard></div></Page>
}

function AboutPage() {
  return <Page title="About NCA" kicker="NOTUNPARA CRICKET ASSOCIATION"><div className="about-copy"><h2>Discipline • Unity • Excellence</h2><p>Notunpara Cricket Association is a community cricket platform dedicated to organised fixtures, transparent player records and accurate performance analysis.</p></div></Page>
}

function Page({ title, kicker, children }) {
  return <main className="inner-page"><div className="page-head"><div className="page-shell"><span>{kicker}</span><h1>{title}</h1></div></div><div className="page-shell page-body">{children}</div></main>
}

function LoginPage({ role }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const admin = role === 'admin'
  const player = role === 'player'
  const accountKey = admin ? 'nca_admin_token' : player ? 'nca_player_token' : 'nca_member_token'
  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = await api(`/api/auth/${role}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      saveSessionToken(accountKey, result.access_token)
      navigate(admin ? '/admin' : player ? '/player/account' : location.state?.from || '/')
    } catch {
      setError('Sign-in failed. Check your credentials and try again.')
    } finally {
      setLoading(false)
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <Logo />
        <span className="login-kicker">{admin ? 'OWNER-ONLY ACCESS' : player ? 'DEDICATED PLAYER PORTAL' : 'NCA MEMBER PORTAL'}</span>
        <h1>{admin ? 'Administrator sign in' : player ? 'Player sign in' : 'Member sign in'}</h1>
        <p>{admin ? 'Administrator accounts are created privately by the site owner. There is no public admin registration.' : player ? 'Use the player account created for you by an NCA administrator.' : 'Sign in to your NCA member account. Email verification and email-based password recovery are disabled.'}</p>
        <form onSubmit={submit}>
          <label>{admin ? 'Email address' : 'Username'}
            <input required autoComplete="username" type={admin ? 'email' : 'text'} value={username} onChange={e => setUsername(e.target.value)} />
          </label>
          <label>Password
            <input required autoComplete={admin ? 'current-password' : 'current-password'} type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {!admin && !player && <div className="signup-prompt"><span>New to the NCA community?</span><Link to="/register">Create your account</Link></div>}
        {!admin && !player && <Link className="login-switch" to="/player/login">Dedicated player sign in</Link>}
        {player && <Link className="login-switch" to="/login">Member sign in or create an account</Link>}
        {!admin && <Link className="login-switch" to="/admin/login">Administrator sign in</Link>}
        {admin && <Link className="login-switch" to="/login">Member sign in</Link>}
      </section>
    </main>
  )
}

function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', username: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [created, setCreated] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) {
      setError('The passwords do not match.')
      return
    }
    try {
      await api('/api/auth/member/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, username: form.username, email: form.email, password: form.password }),
      })
      setCreated(true)
    } catch (err) {
      if (err.status === 503 && err.message.startsWith('Account created,')) setCreated(true)
      setError(err.status === 409 ? 'That username or email is already registered.' : err.status === 503 ? err.message : 'Account creation failed. Check your details and try again.')
    }
  }
  return (
    <main className="login-page">
      <section className="login-card">
        <Logo />
        <span className="login-kicker">JOIN THE NCA COMMUNITY</span>
        <h1>{created ? 'Account created' : 'Create your account'}</h1>
        <p>{created ? 'Your account is ready. Sign in to continue.' : 'Create a member account. It cannot grant administrator or player access.'}</p>
        {created ? <button className="primary-button" onClick={() => navigate('/login')}>Continue to sign in</button> : <form onSubmit={submit}>
          <label>Full name<input required maxLength="120" autoComplete="name" value={form.name} onChange={e => setForm({...form,name:e.target.value})}/></label>
          <label>Username<input required maxLength="120" autoComplete="username" value={form.username} onChange={e => setForm({...form,username:e.target.value})}/></label>
          <label>Email address (optional)<input type="email" maxLength="254" autoComplete="email" value={form.email} onChange={e => setForm({...form,email:e.target.value})}/></label>
          <label>Password (12–72 characters)<input required minLength="12" maxLength="72" autoComplete="new-password" type="password" value={form.password} onChange={e => setForm({...form,password:e.target.value})}/></label>
          <label>Confirm password<input required minLength="12" maxLength="72" autoComplete="new-password" type="password" value={form.confirm} onChange={e => setForm({...form,confirm:e.target.value})}/></label>
          <small>Email is optional and is not used for verification or password recovery.</small>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button">Create account</button>
        </form>}
        {!created && <Link className="login-back" to="/login">Already have an account? Sign in</Link>}
      </section>
    </main>
  )
}

function MemberAccountPage() {
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  useEffect(() => {
    if (!localStorage.getItem('nca_member_token')) {
      navigate('/login')
      return
    }
    api('/api/member/me').then(setMember).catch(() => {
      clearSessionTokens()
      navigate('/login')
    })
  }, [navigate])
  return <Page title="Member account" kicker="NCA COMMUNITY">{member ? <div className="account-panel"><div className="account-heading"><div className="account-avatar"><CircleUserRound size={56}/></div><div><h2>Welcome, {member.name}</h2><p>@{member.username} · Member since {new Date(member.created_at).toLocaleDateString()}</p></div><button className="secondary-dark" onClick={()=>{clearSessionTokens();navigate('/login')}}>Sign out</button></div><p className="member-readonly-note">Your member account lets you browse NCA pages. Player and administrator permissions are managed separately.</p></div>:<EmptyCard title="Loading member account">Please wait while we load your account.</EmptyCard>}</Page>
}

function RequireSession() {
  const navigate = useNavigate()
  const location = useLocation()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    api('/api/auth/me').then(() => {
      if (active) setReady(true)
    }).catch(() => {
      if (active) navigate('/login', { replace: true, state: { from: location.pathname } })
    })
    return () => { active = false }
  }, [location.pathname, navigate])
  if (!ready) return <main className="login-page"><p>Checking your account…</p></main>
  return <Outlet />
}

function PlayerAccountPage() {
  const navigate = useNavigate()
  const [player, setPlayer] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!localStorage.getItem('nca_player_token')) {
      navigate('/player/login')
      return
    }
    api('/api/player/me').then(setPlayer).catch(() => {
      clearSessionTokens()
      setError('Your player session has expired. Please sign in again.')
      navigate('/player/login')
    })
  }, [navigate])
  return (
    <Page title="Player portal" kicker="DEDICATED PLAYER ACCOUNT">
      {player ? <div className="player-account">
        <div className="account-heading"><div className="account-avatar">{player.photo_url ? <img src={`${API}${player.photo_url}`} alt="" /> : <CircleUserRound size={56} />}</div><div><h2>{player.name}</h2><p>{player.player_code} · {player.role}</p></div><button className="secondary-dark" onClick={() => { clearSessionTokens(); navigate('/player/login') }}>Sign out</button></div>
        <div className="account-stats"><Stat icon={CalendarDays} value={player.matches} label="Matches"/><Stat icon={Activity} value={player.runs} label="Runs"/><Stat icon={Trophy} value={player.wickets} label="Wickets"/><Stat icon={BarChart3} value={player.ranking_points} label="Ranking points"/></div>
        <div className="account-panel"><h3>Career performance</h3><div className="account-metrics"><span>High score <b>{player.high_score}</b></span><span>Batting average <b>{player.batting_average}</b></span><span>Strike rate <b>{player.strike_rate}</b></span><span>Bowling average <b>{player.bowling_average}</b></span><span>Economy <b>{player.economy}</b></span></div></div>
      </div> : <EmptyCard title={error || 'Loading player account'}>Your verified career record and ranking will show here.</EmptyCard>}
    </Page>
  )
}

function AdminPage() {
  const navigate = useNavigate()
  const [authReady, setAuthReady] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [players, setPlayers] = useState([])
  const [matches, setMatches] = useState([])
  const [scorecards, setScorecards] = useState([])
  const [reports, setReports] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [rules, setRules] = useState([])
  const [tab, setTab] = useState('overview')
  const [scoreStatus, setScoreStatus] = useState('')
  const [playerForm, setPlayerForm] = useState({ name: '', player_code: '', role: 'Player', jersey_number: '', batting_style: '', bowling_style: '', photo_url: '', username: '', password: '' })
  const [editingPlayerId, setEditingPlayerId] = useState(null)
  const [matchForm, setMatchForm] = useState({ title: '', match_date: '', venue: '', status: 'upcoming', result: '' })
  const [editingMatchId, setEditingMatchId] = useState(null)
  const [reportForm, setReportForm] = useState({ title: '', body: '' })
  const [editingReportId, setEditingReportId] = useState(null)
  const [announcementForm, setAnnouncementForm] = useState({ title: '', body: '' })
  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null)
  const [ruleForm, setRuleForm] = useState({ category: 'General association rules', title: '', body: '' })
  const [editingRuleId, setEditingRuleId] = useState(null)
  const [adminMessage, setAdminMessage] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState('')
  const [assetStatus, setAssetStatus] = useState('')
  const [reviewingScorecard, setReviewingScorecard] = useState(null)
  const [scoreReview, setScoreReview] = useState({
    match_id: '', title: '', match_date: '', venue: '', result: '', batting: [], bowling: [],
  })
  const [accountPlayerId, setAccountPlayerId] = useState(null)
  const [accountForm, setAccountForm] = useState({ username: '', password: '' })
  const [accountMessage, setAccountMessage] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('nca_admin_token')
    if (!token) {
      navigate('/admin/login')
      return
    }
    api('/api/auth/me').then((identity) => {
      if (identity.role !== 'admin') throw new Error('Administrator access required')
      setAuthReady(true)
    }).catch(() => {
      clearSessionTokens()
      navigate('/admin/login')
    })
    api('/api/dashboard').then(setDashboard).catch(() => {})
    api('/api/players').then(setPlayers).catch(() => {})
    api('/api/matches').then(setMatches).catch(() => {})
    api('/api/scorecards').then(setScorecards).catch(() => {})
    api('/api/reports').then(setReports).catch(() => {})
    api('/api/announcements').then(setAnnouncements).catch(() => {})
    api('/api/rules').then(setRules).catch(() => {})
  }, [navigate])

  const downloadDataExport = async () => {
    setAdminMessage('Preparing Excel data backup…')
    try {
      const token = localStorage.getItem('nca_admin_token')
      const response = await fetch(`${API}/api/admin/export.xlsx`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        const body = await response.text()
        let message = body
        try {
          message = JSON.parse(body).detail || body
        } catch {}
        throw new Error(message)
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'nca_data_export.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setAdminMessage('Excel backup downloaded and saved on the backend.')
    } catch (err) {
      setAdminMessage(`Excel backup failed: ${err.message}`)
    }
  }

  const savePlayer = async (e) => {
    e.preventDefault()
    const body = {
      ...playerForm,
      jersey_number: playerForm.jersey_number ? Number(playerForm.jersey_number) : null,
    }
    try {
      await api(editingPlayerId ? `/api/players/${editingPlayerId}` : '/api/players', {
        method: editingPlayerId ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body),
      })
      setEditingPlayerId(null)
      setPlayerForm({ name: '', player_code: '', role: 'Player', jersey_number: '', batting_style: '', bowling_style: '', photo_url: '', username: '', password: '' })
      setPlayers(await api('/api/players'))
      setAdminMessage(editingPlayerId ? 'Player profile updated.' : 'Player created.')
    } catch (err) {
      setAdminMessage(`Player save failed: ${err.message}`)
    }
  }

  const editPlayer = (player) => {
    setEditingPlayerId(player.id)
    setPlayerForm({
      name: player.name,
      player_code: player.player_code,
      role: player.role,
      jersey_number: player.jersey_number || '',
      batting_style: player.batting_style || '',
      bowling_style: player.bowling_style || '',
      photo_url: player.photo_url || '',
      username: '',
      password: '',
    })
    setAdminMessage('')
  }

  const removePlayer = async (id) => {
    await api(`/api/players/${id}`, { method: 'DELETE' })
    setPlayers(await api('/api/players'))
  }

  const savePlayerAccount = async (e) => {
    e.preventDefault()
    try {
      await api(`/api/players/${accountPlayerId}/account`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(accountForm),
      })
      setAccountMessage('Player login credentials saved.')
      setAccountPlayerId(null)
      setAccountForm({ username: '', password: '' })
      setPlayers(await api('/api/players'))
    } catch (err) {
      setAccountMessage(`Could not save credentials: ${err.message}`)
    }
  }

  const saveMatch = async (e) => {
    e.preventDefault()
    try {
      const body = {...matchForm, match_date: new Date(matchForm.match_date).toISOString()}
      await api(editingMatchId ? `/api/matches/${editingMatchId}` : '/api/matches', {
        method: editingMatchId ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body),
      })
      setEditingMatchId(null)
      setMatchForm({ title: '', match_date: '', venue: '', status: 'upcoming', result: '' })
      setMatches(await api('/api/matches'))
      setAdminMessage('Match saved.')
    } catch (err) {
      setAdminMessage(`Match save failed: ${err.message}`)
    }
  }

  const editMatch = (match) => {
    setEditingMatchId(match.id)
    setMatchForm({...match, match_date: match.match_date.slice(0, 16)})
  }

  const removeMatch = async (id) => {
    await api(`/api/matches/${id}`, { method: 'DELETE' })
    setMatches(await api('/api/matches'))
  }

  const saveReport = async (e) => {
    e.preventDefault()
    try {
      await api(editingReportId ? `/api/reports/${editingReportId}` : '/api/reports', {
        method: editingReportId ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(reportForm),
      })
      setEditingReportId(null)
      setReportForm({ title: '', body: '' })
      setReports(await api('/api/reports'))
      setAdminMessage('Daily report saved.')
    } catch (err) {
      setAdminMessage(`Report save failed: ${err.message}`)
    }
  }

  const removeReport = async (id) => {
    await api(`/api/reports/${id}`, { method: 'DELETE' })
    setReports(await api('/api/reports'))
  }

  const saveAnnouncement = async (e) => {
    e.preventDefault()
    try {
      await api(editingAnnouncementId ? `/api/announcements/${editingAnnouncementId}` : '/api/announcements', {
        method: editingAnnouncementId ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(announcementForm),
      })
      setEditingAnnouncementId(null)
      setAnnouncementForm({ title: '', body: '' })
      setAnnouncements(await api('/api/announcements'))
      setAdminMessage('Announcement saved.')
    } catch (err) {
      setAdminMessage(`Announcement save failed: ${err.message}`)
    }
  }

  const removeAnnouncement = async (id) => {
    await api(`/api/announcements/${id}`, { method: 'DELETE' })
    setAnnouncements(await api('/api/announcements'))
  }

  const saveRule = async (e) => {
    e.preventDefault()
    try {
      await api(editingRuleId ? `/api/rules/${editingRuleId}` : '/api/rules', {
        method: editingRuleId ? 'PUT' : 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(ruleForm),
      })
      setEditingRuleId(null)
      setRuleForm({ category: 'General association rules', title: '', body: '' })
      setRules(await api('/api/rules'))
      setAdminMessage('Rule saved.')
    } catch (err) {
      setAdminMessage(`Rule save failed: ${err.message}`)
    }
  }

  const removeRule = async (id) => {
    await api(`/api/rules/${id}`, { method: 'DELETE' })
    setRules(await api('/api/rules'))
  }

  const uploadScorecards = async (files) => {
    if (!files?.length) return
    const form = new FormData()
    if (files.length === 1) {
      form.append('file', files[0])
      setScoreStatus('Processing PDF…')
      try {
        const result = await api('/api/scorecards/upload', { method: 'POST', body: form })
        setScoreStatus(`Uploaded ${result.filename}. Pending verification (ID ${result.id}); extraction: ${result.extraction_status}.`)
      } catch (err) {
        setScoreStatus(err.message.includes('409') ? 'This scorecard has already been uploaded.' : 'Upload failed. Please select a valid PDF.')
      }
    } else {
      Array.from(files).forEach(file => form.append('files', file))
      setScoreStatus(`Processing ${files.length} PDFs…`)
      try {
        const result = await api('/api/scorecards/upload-multiple', { method: 'POST', body: form })
        const successCount = result.uploads.filter(item => item.success).length
        setScoreStatus(`Processed ${result.uploads.length} PDFs: ${successCount} uploaded, ${result.uploads.length - successCount} rejected or duplicated.`)
      } catch {
        setScoreStatus('Bulk upload failed. Please retry.')
      }
    }
    setScorecards(await api('/api/scorecards'))
  }

  const beginScorecardReview = (scorecard) => {
    const extracted = scorecard.review_data || {}
    setReviewingScorecard(scorecard.id)
    setScoreReview({
      match_id: '',
      title: '',
      match_date: '',
      venue: '',
      result: '',
      batting: extracted.batting || [],
      bowling: extracted.bowling || [],
    })
  }

  const updateReviewRow = (kind, index, field, value) => {
    setScoreReview(current => ({
      ...current,
      [kind]: current[kind].map((row, i) => i === index ? { ...row, [field]: field === 'player_id' ? Number(value) : Number(value) } : row),
    }))
  }

  const approveScorecard = async (e) => {
    e.preventDefault()
    try {
      await api(`/api/scorecards/${reviewingScorecard}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...scoreReview,
          match_id: scoreReview.match_id ? Number(scoreReview.match_id) : null,
          match_date: scoreReview.match_date ? new Date(scoreReview.match_date).toISOString() : null,
        }),
      })
      setReviewingScorecard(null)
      setScoreReview({ match_id: '', title: '', match_date: '', venue: '', result: '', batting: [], bowling: [] })
      setScorecards(await api('/api/scorecards'))
      setPlayers(await api('/api/players'))
      setDashboard(await api('/api/dashboard'))
      setScoreStatus('Scorecard approved. Player statistics and rankings have been recalculated.')
    } catch (err) {
      setScoreStatus(`Could not approve scorecard: ${err.message}`)
    }
  }

  const deleteScorecard = async (id) => {
    try {
      await api(`/api/scorecards/${id}`, { method: 'DELETE' })
      setScorecards(await api('/api/scorecards'))
    } catch {
      setScoreStatus('Approved scorecards cannot be deleted.')
    }
  }

  const uploadImage = async (e, category) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    if (category === 'players' && selectedPlayer) form.append('player_id', selectedPlayer)
    setAssetStatus('Uploading image…')
    try {
      const result = await api(`/api/images/upload?category=${encodeURIComponent(category)}${category === 'players' && selectedPlayer ? `&player_id=${selectedPlayer}` : ''}`, { method: 'POST', body: form })
      setAssetStatus(`Uploaded ${result.url}`)
      if (category === 'players') setPlayers(await api('/api/players'))
    } catch {
      setAssetStatus('Image upload failed.')
    }
  }

  if (!authReady) return <main className="login-page"><p>Checking administrator access…</p></main>

  return (
    <main className="admin-layout">
      <aside className="admin-sidebar">
        <Logo />
        <nav>
          {[
            ['overview','Overview',LayoutDashboard], ['players','Players',Users], ['matches','Matches',CalendarDays],
            ['scorecards','Scorecards',Upload], ['reports','Reports',FileText], ['announcements','Announcements',Newspaper],
            ['rules','Rules',ShieldCheck], ['media','Photos & Logo',Activity]
          ].map(([id,label,Icon]) => <button className={tab === id ? 'active' : ''} onClick={() => setTab(id)} key={id}><Icon size={18}/>{label}</button>)}
        </nav>
        <button className="logout" onClick={() => { clearSessionTokens(); navigate('/admin/login') }}><X size={17}/> Sign out</button>
      </aside>
      <section className="admin-main">
        <div className="admin-top"><div><small>ADMINISTRATION</small><h1>{tab[0].toUpperCase() + tab.slice(1)}</h1></div><Bell size={20}/></div>
        {adminMessage && <p className="upload-status">{adminMessage}</p>}
        {tab === 'overview' && <>
          <div className="admin-stats"><Stat icon={Users} value={dashboard?.total_players ?? 0} label="Players"/><Stat icon={CalendarDays} value={dashboard?.matches_played ?? 0} label="Matches"/><Stat icon={Trophy} value={dashboard?.total_runs ?? 0} label="Runs"/><Stat icon={ShieldCheck} value={dashboard?.total_wickets ?? 0} label="Wickets"/></div>
          <div className="admin-panel">
            <h3>Excel data backup</h3>
            <p>Export database tables to an Excel workbook. Password hashes and email action tokens are excluded; uploaded PDFs and images remain in the uploads folder.</p>
            <button type="button" className="primary-button" onClick={downloadDataExport}>Download Excel backup</button>
          </div>
          <div className="admin-grid"><div className="admin-panel"><h3>Recent activity</h3><EmptyCard title="Activity log">Administrative actions are recorded in the database.</EmptyCard></div><div className="admin-panel"><h3>Top rank</h3><div className="top-rank"><Trophy/><strong>{dashboard?.top_ranked || 'No ranking yet'}</strong></div></div></div>
        </>}
        {tab === 'players' && <>
          <div className="admin-panel">
            <h3>{editingPlayerId ? 'Edit player profile' : 'Add player'}</h3>
            <form className="content-form" onSubmit={savePlayer}>
              <input required placeholder="Full name" value={playerForm.name} onChange={e => setPlayerForm({...playerForm,name:e.target.value})}/>
              <input required placeholder="Player code" value={playerForm.player_code} onChange={e => setPlayerForm({...playerForm,player_code:e.target.value})}/>
              <select value={playerForm.role} onChange={e => setPlayerForm({...playerForm,role:e.target.value})}><option>Player</option><option>Batsman</option><option>Bowler</option><option>All-rounder</option><option>Wicketkeeper</option></select>
              <input type="number" min="0" placeholder="Jersey number" value={playerForm.jersey_number} onChange={e => setPlayerForm({...playerForm,jersey_number:e.target.value})}/>
              <input placeholder="Batting style" value={playerForm.batting_style} onChange={e => setPlayerForm({...playerForm,batting_style:e.target.value})}/>
              <input placeholder="Bowling style" value={playerForm.bowling_style} onChange={e => setPlayerForm({...playerForm,bowling_style:e.target.value})}/>
              <input placeholder="Photo URL (or use Photos & Logo)" value={playerForm.photo_url} onChange={e => setPlayerForm({...playerForm,photo_url:e.target.value})}/>
              {!editingPlayerId && <input placeholder="Player login username (optional)" value={playerForm.username} onChange={e => setPlayerForm({...playerForm,username:e.target.value})}/>}
              {!editingPlayerId && <input type="password" placeholder="Temporary password (12+ characters)" value={playerForm.password} onChange={e => setPlayerForm({...playerForm,password:e.target.value})}/>}
              <button className="primary-button">{editingPlayerId ? 'Save player' : 'Add player'}</button>
              {editingPlayerId && <button type="button" className="cancel-button" onClick={() => {setEditingPlayerId(null);setPlayerForm({name:'',player_code:'',role:'Player',jersey_number:'',batting_style:'',bowling_style:'',photo_url:'',username:'',password:''})}}>Cancel edit</button>}
            </form>
            {!editingPlayerId && <small>Enter both login fields to create the player's dedicated portal account.</small>}
          </div>
          <div className="admin-panel">
            <h3>Registered players</h3>
            {accountMessage&&<p className="upload-status">{accountMessage}</p>}
            {players.map(p => <div className="admin-row player-admin-row" key={p.id}><span>{p.name}</span><small>{p.player_code} · {p.has_login?'login enabled':'no login'}</small><button onClick={()=>editPlayer(p)}>Edit profile</button><button onClick={()=>{setAccountPlayerId(p.id);setAccountForm({username:'',password:''});setAccountMessage('')}}>{p.has_login?'Reset login':'Create login'}</button><button className="text-danger" onClick={() => removePlayer(p.id)}>Delete</button></div>)}
            {accountPlayerId&&<form className="content-form account-creation-form" onSubmit={savePlayerAccount}><h4>Create/reset player credentials</h4><input required placeholder="Player username" value={accountForm.username} onChange={e=>setAccountForm({...accountForm,username:e.target.value})}/><input required type="password" minLength="12" placeholder="New password (12+ characters)" value={accountForm.password} onChange={e=>setAccountForm({...accountForm,password:e.target.value})}/><button className="primary-button">Save credentials</button><button type="button" className="cancel-button" onClick={()=>setAccountPlayerId(null)}>Cancel</button></form>}
          </div>
        </>}
        {tab === 'scorecards' && <><div className="admin-panel upload-panel"><Upload size={34}/><h3>Upload and verify scorecards</h3><p>Select one PDF or multiple PDFs. The extractor suggests stats where it recognizes player names and common scorecard columns. Verify every value before approval.</p><input type="file" accept="application/pdf,.pdf" multiple onChange={e => uploadScorecards(Array.from(e.target.files || []))}/>{scoreStatus&&<p className="upload-status">{scoreStatus}</p>}</div><div className="admin-panel"><h3>Uploaded scorecards</h3>{scorecards.map(s => <div className="admin-row scorecard-row" key={s.id}><div><strong>{s.filename}</strong><small>{s.status} · {s.extraction_status}</small></div><div><a className="small-link" href={`${API}${s.download_url}`} target="_blank" rel="noreferrer">Preview PDF</a>{s.status !== 'approved' && <button onClick={() => beginScorecardReview(s)}>Review & approve</button>}<button className="text-danger" onClick={() => deleteScorecard(s.id)}>Delete</button></div></div>)}</div>{reviewingScorecard && <div className="admin-panel"><h3>Review extracted scorecard</h3><details className="extracted-text"><summary>Show extracted PDF text</summary><pre>{scorecards.find(s => s.id === reviewingScorecard)?.extracted_text || 'No text could be extracted from this PDF.'}</pre></details><form className="content-form score-review-form" onSubmit={approveScorecard}><select value={scoreReview.match_id} onChange={e => setScoreReview({...scoreReview,match_id:e.target.value,title:'',match_date:''})}><option value="">Create new match</option>{matches.filter(m => !scorecards.some(s => s.status === 'approved' && s.id !== reviewingScorecard && s.match_id === m.id)).map(m => <option value={m.id} key={m.id}>{m.title} — {new Date(m.match_date).toLocaleDateString()}</option>)}</select>{!scoreReview.match_id && <><input required placeholder="Match title" value={scoreReview.title} onChange={e => setScoreReview({...scoreReview,title:e.target.value})}/><input required type="datetime-local" value={scoreReview.match_date} onChange={e => setScoreReview({...scoreReview,match_date:e.target.value})}/></>}<input placeholder="Venue" value={scoreReview.venue} onChange={e => setScoreReview({...scoreReview,venue:e.target.value})}/><input placeholder="Match result" value={scoreReview.result} onChange={e => setScoreReview({...scoreReview,result:e.target.value})}/><div className="review-stat-section"><div className="review-section-head"><strong>Batting — {scoreReview.batting.length} extracted rows</strong><button type="button" onClick={() => setScoreReview({...scoreReview,batting:[...scoreReview.batting,{player_id:'',runs:0,balls:0,fours:0,sixes:0}]})}>Add batter</button></div>{scoreReview.batting.map((row,i)=><div className="review-stat-row" key={`bat-${i}`}><select required value={row.player_id} onChange={e=>updateReviewRow('batting',i,'player_id',e.target.value)}><option value="">Choose player</option>{players.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>{['runs','balls','fours','sixes'].map(field=><label key={field}>{field}<input type="number" min="0" value={row[field]} onChange={e=>updateReviewRow('batting',i,field,e.target.value)}/></label>)}<button type="button" className="text-danger" onClick={()=>setScoreReview({...scoreReview,batting:scoreReview.batting.filter((_,index)=>index!==i)})}>Remove</button></div>)}</div><div className="review-stat-section"><div className="review-section-head"><strong>Bowling — {scoreReview.bowling.length} extracted rows</strong><button type="button" onClick={() => setScoreReview({...scoreReview,bowling:[...scoreReview.bowling,{player_id:'',wickets:0,runs_conceded:0,overs:0}]})}>Add bowler</button></div>{scoreReview.bowling.map((row,i)=><div className="review-stat-row" key={`bowl-${i}`}><select required value={row.player_id} onChange={e=>updateReviewRow('bowling',i,'player_id',e.target.value)}><option value="">Choose player</option>{players.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select>{[['wickets','wickets'],['runs_conceded','runs conceded'],['overs','overs']].map(([field,label])=><label key={field}>{label}<input type="number" min="0" step="0.1" value={row[field]} onChange={e=>updateReviewRow('bowling',i,field,e.target.value)}/></label>)}<button type="button" className="text-danger" onClick={()=>setScoreReview({...scoreReview,bowling:scoreReview.bowling.filter((_,index)=>index!==i)})}>Remove</button></div>)}</div><div className="review-actions"><button type="button" className="cancel-button" onClick={() => setReviewingScorecard(null)}>Cancel</button><button className="primary-button" type="submit">Approve & update rankings</button></div></form></div>}</>}
        {tab === 'matches' && <>
          <div className="admin-panel"><h3>{editingMatchId ? 'Edit match or fixture' : 'Add match or fixture'}</h3>
            <form className="content-form" onSubmit={saveMatch}>
              <input required placeholder="Match title" value={matchForm.title} onChange={e => setMatchForm({...matchForm,title:e.target.value})}/>
              <input required type="datetime-local" value={matchForm.match_date} onChange={e => setMatchForm({...matchForm,match_date:e.target.value})}/>
              <input placeholder="Venue" value={matchForm.venue} onChange={e => setMatchForm({...matchForm,venue:e.target.value})}/>
              <select value={matchForm.status} onChange={e => setMatchForm({...matchForm,status:e.target.value})}><option>upcoming</option><option>live</option><option>completed</option><option>postponed</option><option>cancelled</option></select>
              <input placeholder="Result" value={matchForm.result || ''} onChange={e => setMatchForm({...matchForm,result:e.target.value})}/>
              <button className="primary-button">{editingMatchId ? 'Save match' : 'Publish match'}</button>
              {editingMatchId && <button type="button" className="cancel-button" onClick={() => {setEditingMatchId(null);setMatchForm({title:'',match_date:'',venue:'',status:'upcoming',result:''})}}>Cancel edit</button>}
            </form>
          </div>
          <div className="admin-panel"><h3>Manage matches</h3>{matches.map(m => <div className="admin-row" key={m.id}><span><strong>{m.title}</strong><small> • {m.status}</small></span><button onClick={() => editMatch(m)}>Edit</button><button className="text-danger" onClick={() => removeMatch(m.id)}>Delete</button></div>)}</div>
        </>}
        {tab === 'reports' && <>
          <div className="admin-panel"><h3>{editingReportId ? 'Edit daily report' : 'Publish daily report'}</h3>
            <form className="content-form" onSubmit={saveReport}>
              <input required placeholder="Report title" value={reportForm.title} onChange={e => setReportForm({...reportForm,title:e.target.value})}/>
              <textarea required placeholder="Report details" value={reportForm.body} onChange={e => setReportForm({...reportForm,body:e.target.value})}/>
              <button className="primary-button">{editingReportId ? 'Save report' : 'Publish report'}</button>
              {editingReportId && <button type="button" className="cancel-button" onClick={() => {setEditingReportId(null);setReportForm({title:'',body:''})}}>Cancel edit</button>}
            </form>
          </div>
          <div className="admin-panel"><h3>Existing reports</h3>{reports.map(r => <div className="admin-row" key={r.id}><span>{r.title}</span><button onClick={() => {setEditingReportId(r.id);setReportForm({title:r.title,body:r.body})}}>Edit</button><button className="text-danger" onClick={() => removeReport(r.id)}>Delete</button></div>)}</div>
        </>}
        {tab === 'announcements' && <>
          <div className="admin-panel"><h3>{editingAnnouncementId ? 'Edit announcement' : 'Publish announcement'}</h3>
            <form className="content-form" onSubmit={saveAnnouncement}>
              <input required placeholder="Announcement title" value={announcementForm.title} onChange={e => setAnnouncementForm({...announcementForm,title:e.target.value})}/>
              <textarea required placeholder="Announcement details" value={announcementForm.body} onChange={e => setAnnouncementForm({...announcementForm,body:e.target.value})}/>
              <button className="primary-button">{editingAnnouncementId ? 'Save announcement' : 'Publish announcement'}</button>
              {editingAnnouncementId && <button type="button" className="cancel-button" onClick={() => {setEditingAnnouncementId(null);setAnnouncementForm({title:'',body:''})}}>Cancel edit</button>}
            </form>
          </div>
          <div className="admin-panel"><h3>Existing announcements</h3>{announcements.map(a => <div className="admin-row" key={a.id}><span>{a.title}</span><button onClick={() => {setEditingAnnouncementId(a.id);setAnnouncementForm({title:a.title,body:a.body})}}>Edit</button><button className="text-danger" onClick={() => removeAnnouncement(a.id)}>Delete</button></div>)}</div>
        </>}
        {tab === 'rules' && <>
          <div className="admin-panel"><h3>{editingRuleId ? 'Edit rule' : 'Add rule'}</h3>
            <form className="content-form" onSubmit={saveRule}>
              <select value={ruleForm.category} onChange={e => setRuleForm({...ruleForm,category:e.target.value})}><option>General association rules</option><option>Player responsibilities</option><option>Match regulations</option><option>Tournament rules</option><option>Captain selection rules</option><option>Disciplinary rules</option><option>Management policies</option><option>Code of conduct</option></select>
              <input required placeholder="Rule title" value={ruleForm.title} onChange={e => setRuleForm({...ruleForm,title:e.target.value})}/>
              <textarea required placeholder="Rule description" value={ruleForm.body} onChange={e => setRuleForm({...ruleForm,body:e.target.value})}/>
              <button className="primary-button">{editingRuleId ? 'Save rule' : 'Publish rule'}</button>
              {editingRuleId && <button type="button" className="cancel-button" onClick={() => {setEditingRuleId(null);setRuleForm({category:'General association rules',title:'',body:''})}}>Cancel edit</button>}
            </form>
          </div>
          <div className="admin-panel"><h3>Existing rules</h3>{rules.map(r => <div className="admin-row" key={r.id}><span>{r.category}: {r.title}</span><button onClick={() => {setEditingRuleId(r.id);setRuleForm({category:r.category,title:r.title,body:r.body})}}>Edit</button><button className="text-danger" onClick={() => removeRule(r.id)}>Delete</button></div>)}</div>
        </>}
        {tab === 'media' && <><div className="admin-panel"><h3>Player photos</h3><select value={selectedPlayer} onChange={e => setSelectedPlayer(e.target.value)}><option value="">Select a player</option>{players.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => uploadImage(e,'players')}/></div><div className="admin-grid"><div className="admin-panel"><h3>Cover photos</h3><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => uploadImage(e,'covers')}/></div><div className="admin-panel"><h3>Official logo</h3><input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => uploadImage(e,'logo')}/></div></div>{assetStatus&&<p className="upload-status">{assetStatus}</p>}</>}
      </section>
    </main>
  )
}

function App() {
  const location = window.location.pathname
  const admin = location.startsWith('/admin')
  return (
    <BrowserRouter>
      {!admin && <Header />}
      <Routes>
        <Route path="/login" element={<LoginPage role="member" />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/player/login" element={<LoginPage role="player" />} />
        <Route path="/admin/login" element={<LoginPage role="admin" />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route element={<RequireSession />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/players/:id" element={<PlayersPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/matches" element={<MatchesPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/leaderboards" element={<StatisticsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/announcements" element={<AnnouncementsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/account" element={<MemberAccountPage />} />
          <Route path="/player/account" element={<PlayerAccountPage />} />
        </Route>
      </Routes>
      {!admin && <Footer />}
    </BrowserRouter>
  )
}

function Footer() {
  return <footer className="footer"><div className="page-shell"><div><Logo/><p>Notunpara Cricket Association</p></div><div><h4>Explore</h4><Link to="/players">Players</Link><Link to="/matches">Matches</Link><Link to="/rankings">Rankings</Link></div><div><h4>Association</h4><Link to="/rules">Rules</Link><Link to="/reports">Daily Reports</Link><Link to="/about">About NCA</Link></div><div><h4>Contact</h4><p>Official NCA Ground</p><Link to="/admin">Administrator login</Link></div></div><div className="footer-bottom page-shell"><span>© 2026 Notunpara Cricket Association</span><span>Discipline • Unity • Excellence</span></div></footer>
}

export default App
