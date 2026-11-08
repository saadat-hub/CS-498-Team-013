import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Route as RouteIcon,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Trophy,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { api, type Configuration, mutate, session, type User } from './api';
import Admin from './pages/Admin';
import Challenges from './pages/Challenges';
import Dashboard from './pages/Dashboard';
import Leaderboard from './pages/Leaderboard';
import Library from './pages/Library';
import Roadmap from './pages/Roadmap';
import SearchResults from './pages/SearchResults';
import Settings from './pages/Settings';
import SignIn from './pages/SignIn';
import Workbench from './pages/Workbench';
import Submissions from './pages/Submissions';
import './styles.css';
import { Brand, Context, Empty, ErrorBox, Loading, useApp, useData } from './ui';
function App() {
  const [user, setUser] = useState<User | null>(null),
    [config, setConfig] = useState<Configuration>({
      localDevelopment: false,
      aiEnabled: false,
      oauth: { github: false, google: false },
    }),
    [ready, setReady] = useState(false),
    [failure, setFailure] = useState(''),
    [toast, setToast] = useState('');
  const reload = useCallback(async () => {
    const s = await session();
    setUser(s.user);
  }, []);
  useEffect(() => {
    Promise.all([reload(), api<Configuration>('/config').then(setConfig)])
      .catch((e) => setFailure(e.message))
      .finally(() => setReady(true));
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  if (!ready) return <Loading />;
  if (failure)
    return (
      <main className="standalone">
        <Brand />
        <ErrorBox message={failure} retry={() => location.reload()} />
      </main>
    );
  return (
    <Context.Provider value={{ user, config, reload, notify: setToast }}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="*" element={<Shell />} />
      </Routes>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
const navigation = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/roadmap', label: 'Learning roadmap', icon: RouteIcon },
  { to: '/challenges', label: 'Challenges', icon: Layers },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/library', label: 'Prompt library', icon: BookOpen },
];
function Shell() {
  const { user, config, reload } = useApp(),
    [menu, setMenu] = useState(false),
    [notifications, setNotifications] = useState(false),
    [q, setQ] = useState(''),
    navigate = useNavigate(),
    location = useLocation();
  const notes = useData<{ items: any[] }>(notifications && user ? '/notifications?limit=10' : null);
  useEffect(() => {
    setMenu(false);
    setNotifications(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);
  const title = location.pathname.startsWith('/challenge/')
    ? 'Challenge workbench'
    : (navigation.find((n) => n.to === location.pathname)?.label ??
      (location.pathname === '/settings'
        ? 'Settings'
        : location.pathname === '/search'
          ? 'Search'
          : 'Prompt Lab'));
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? 'open' : ''}`}>
        <Brand />
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          {navigation.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <n.icon size={18} />
              {n.label}
              {n.label === 'Challenges' && (
                <span className="nav-count">{config.catalog?.challenges ?? '—'}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-spark">
            <Sparkles size={17} />
          </span>
          <h4>
            A little practice.
            <br />A better programmer.
          </h4>
          <p>Make room for one good challenge today.</p>
          <Link to="/challenges">
            Find your next challenge <ArrowUpRight size={15} />
          </Link>
        </div>
        <div className="sidebar-bottom">
          <NavLink className="nav-item" to="/settings">
            <SettingsIcon size={18} />
            Settings
          </NavLink>
          {user ? (
            <div className="profile-mini">
              <span className="avatar">
                {user.displayName
                  .split(' ')
                  .map((s) => s[0])
                  .slice(0, 2)
                  .join('')}
              </span>
              <div>
                <strong>{user.displayName}</strong>
                <span>
                  {config.localDevelopment ? 'Local workspace' : 'Your learning workspace'}
                </span>
              </div>
              <button
                aria-label="Sign out"
                title="Sign out"
                onClick={async () => {
                  await mutate('POST', '/auth/logout');
                  await reload();
                  navigate('/signin');
                }}
              >
                <LogOut size={17} />
              </button>
            </div>
          ) : (
            <Link className="btn primary full" to="/signin">
              Start your journey <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          <div className="topbar-right">
            <form
              className="search-field"
              onSubmit={(e) => {
                e.preventDefault();
                if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              <Search size={16} />
              <input
                aria-label="Search challenges"
                placeholder="Search challenges…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <kbd>↵</kbd>
            </form>
            {config.localDevelopment && (
              <span className="local-label">
                <i />
                Local
              </span>
            )}
            <div className="notification-wrap">
              <button
                className={`icon-button ${notifications ? 'selected' : ''}`}
                aria-label="Notifications"
                aria-expanded={notifications}
                onClick={() => setNotifications((v) => !v)}
              >
                <Bell size={19} />
              </button>
              {notifications && (
                <div className="notification-panel">
                  <div className="panel-title">
                    <strong>Notifications</strong>
                    <button
                      aria-label="Close notifications"
                      onClick={() => setNotifications(false)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {!user ? (
                    <p>Sign in to see your notifications.</p>
                  ) : notes.loading ? (
                    <Loading />
                  ) : notes.error ? (
                    <ErrorBox message={notes.error} />
                  ) : !notes.data?.items.length ? (
                    <p>You’re all caught up. Achievements and updates will appear here.</p>
                  ) : (
                    <>
                      {notes.data.items.map((n) => (
                        <div className={`notification ${n.readAt ? '' : 'unread'}`} key={n.id}>
                          <Sparkles size={16} />
                          <div>
                            <strong>
                              {n.kind === 'badge_earned'
                                ? `Badge earned: ${n.payload.name}`
                                : n.kind === 'streak_risk'
                                  ? 'Keep your streak going'
                                  : 'Workspace update'}
                            </strong>
                            <span>{new Date(n.createdAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      ))}
                      <button
                        className="text-button"
                        onClick={async () => {
                          await mutate('POST', '/notifications/read', { all: true });
                          notes.refresh();
                        }}
                      >
                        Mark all as read <Check size={14} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="page">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/challenges" element={<Challenges />} />
            <Route path="/challenge/:slug" element={<Workbench key={location.pathname} />} />
            <Route path="/submissions" element={<Submissions />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/library" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/onboarding" element={<Settings onboarding />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/search" element={<SearchResults />} />
            <Route
              path="*"
              element={
                <Empty
                  title="This page took a wrong turn"
                  text="Let’s get you back to your learning workspace."
                >
                  <Link to="/" className="btn primary">
                    Back to overview
                  </Link>
                </Empty>
              }
            />
          </Routes>
        </main>
        <footer className="footer">
          <span>Build understanding. One challenge at a time.</span>
          <span>
            Prompt Lab <span className="footer-dot">•</span> Made for curious minds
          </span>
        </footer>
      </div>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
