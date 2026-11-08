import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Bug,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Code2,
  Flame,
  LockKeyhole,
  Rocket,
  Sparkles,
  Target,
  Terminal,
  Trophy,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Level } from '../api';
import { Badge, Empty, ErrorBox, Loading, PageHeading, useApp, useData } from '../ui';
export default function Dashboard() {
  const { user, config } = useApp(),
    { data, error, loading, refresh } = useData(user ? '/dashboard' : null),
    levels = useData<{ items: Level[] }>(!user ? '/levels' : null);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} retry={refresh} />;
  const roadmap: any[] = data?.roadmap ?? levels.data?.items.map((l) => ({ ...l, ...l.me })) ?? [];
  const stats = data?.stats,
    firstName = user?.displayName.split(' ')[0];
  const date = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
  const suggested = data?.continue?.challenge ?? data?.nextChallenge;
  const nextSlug = data?.continue?.challenge.slug ?? data?.nextChallenge?.slug ?? 'hello-function';
  return (
    <>
      <PageHeading
        eyebrow={date}
        title={user ? `Welcome back, ${firstName}.` : 'Your next chapter starts here.'}
        text="Small challenges. Clearer thinking. Real progress."
        action={
          <Link className="btn secondary" to="/roadmap">
            View roadmap <ArrowUpRight size={16} />
          </Link>
        }
      />
      <section className="hero-card">
        <div className="hero-content">
          <Badge tone="hero-badge">
            <span className="pulse-dot" /> LEARN BY DOING
          </Badge>
          <h2>
            Better prompts.
            <br />
            Better possibilities.
          </h2>
          <p>
            Turn an idea into a clear set of instructions.
            <br />
            Practice, get feedback, and build with confidence.
          </p>
          <Link className="btn cream" to={`/challenge/${nextSlug}`}>
            {data?.continue || stats?.cleared.count ? 'Continue learning' : 'Start a challenge'}
            <ArrowRight size={17} />
          </Link>
          <span className="hero-footnote">
            {config.catalog?.challenges ?? 0} guided challenges <span>·</span>{' '}
            {config.catalog?.levels ?? 0} learning levels <span>·</span> At your pace
          </span>
        </div>
        <div className="hero-illustration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="floating-chip chip-top">
            <Code2 size={16} /> IDEAS INTO ACTION
          </span>
          <div className="code-card">
            <div className="code-toolbar">
              <span />
              <span />
              <span />
              <em>your-next-idea.prompt</em>
            </div>
            <div className="code-lines">
              <div>
                <i>01</i>
                <span className="code-comment"># A little more specific.</span>
              </div>
              <div>
                <i>02</i>
                <span>
                  <b>Build</b> a Python function
                </span>
              </div>
              <div>
                <i>03</i>
                <span>that reverses a string.</span>
              </div>
              <div>
                <i>04</i>
                <span>
                  Keep it <b>simple.</b>
                </span>
              </div>
              <div>
                <i>05</i>
                <span>
                  Show me <b>why it works.</b>
                  <span className="code-cursor" />
                </span>
              </div>
            </div>
            <div className="code-success">
              <CheckCircle2 size={15} />
              <span>Clarity is a skill. You can practice it.</span>
            </div>
          </div>
          <div className="floating-chip chip-bottom">
            <span className="small-check">
              <Check size={13} />
            </span>{' '}
            A SMALL STEP FORWARD <Sparkles size={14} />
          </div>
        </div>
      </section>
      <section className="stats-grid" aria-label="Learning statistics">
        {[
          {
            icon: Zap,
            label: 'Total experience',
            value: stats?.totalXp ?? 0,
            unit: 'XP',
            detail: stats?.nextRankXp
              ? `${stats.nextRankXp - stats.totalXp} XP to your next rank`
              : 'Your effort adds up',
            color: 'teal',
          },
          {
            icon: Flame,
            label: 'Current streak',
            value: stats?.streak.current ?? 0,
            unit: stats?.streak.current === 1 ? 'day' : 'days',
            detail: stats?.streak.best
              ? `Personal best: ${stats.streak.best} days`
              : 'Start with one challenge today',
            color: 'orange',
          },
          {
            icon: Target,
            label: 'Challenges cleared',
            value: stats?.cleared.count ?? 0,
            unit: `/ ${stats?.cleared.total ?? config.catalog?.challenges ?? 0}`,
            detail: `${Math.round(((stats?.cleared.count ?? 0) / (stats?.cleared.total || config.catalog?.challenges || 1)) * 100)}% of your roadmap complete`,
            color: 'blue',
          },
          {
            icon: Sparkles,
            label: 'Average budget used',
            value: stats?.avgBudgetUsed == null ? '—' : Math.round(stats.avgBudgetUsed * 100),
            unit: stats?.avgBudgetUsed == null ? '' : '%',
            detail: 'On your first passing attempts',
            color: 'purple',
          },
        ].map((s) => (
          <article className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <span className={`stat-icon ${s.color}`}>
                <s.icon size={17} />
              </span>
            </div>
            <div className="stat-value">
              {s.value}
              <small>{s.unit}</small>
            </div>
            <p>{s.detail}</p>
          </article>
        ))}
      </section>
      {data?.daily && (
        <section className="daily-banner">
          <span className="daily-icon">
            <Sparkles size={21} />
          </span>
          <div>
            <div className="overline">A FRESH CHALLENGE, EVERY DAY</div>
            <h3>{data.daily.title}</h3>
          </div>
          <Badge tone={data.daily.doneToday ? 'success' : ''}>
            {data.daily.doneToday ? 'Completed today' : `+${data.daily.bonusXp} bonus XP`}
          </Badge>
          <Link className="text-button" to={`/challenge/${data.daily.challengeSlug}`}>
            {data.daily.doneToday ? 'Practice again' : 'Give it a try'}
            <ArrowRight size={15} />
          </Link>
        </section>
      )}
      <div className="dashboard-columns">
        <section className="card continue-card">
          <div className="section-heading">
            <h2>
              {data?.continue
                ? 'Pick up where you left off'
                : stats?.cleared.count
                  ? 'Your next small step'
                  : 'A good place to begin'}
            </h2>
            <span className="muted mini">YOUR NEXT STEP</span>
          </div>
          <div className="continue-body">
            <span className="challenge-symbol">
              <Braces size={29} />
            </span>
            <div className="continue-copy">
              <div className="overline">
                {suggested?.code ? `CHALLENGE ${suggested.code}` : 'LEVEL 01 · FOUNDATIONS'}
              </div>
              <h3>{suggested?.title ?? 'Hello, function'}</h3>
              <p>
                {suggested?.brief ??
                  'One task. One language. One clear prompt. Learn to ask for exactly what you need.'}
              </p>
              <div className="continue-meta">
                <span>
                  <Clock3 size={13} /> A few focused minutes
                </span>
                <span>
                  <Zap size={13} />
                  {data?.continue?.tokenBudget
                    ? `${data.continue.tokenBudget} token budget`
                    : '50 XP'}
                </span>
              </div>
            </div>
            <Link
              className="round-arrow"
              aria-label="Open next challenge"
              to={`/challenge/${nextSlug}`}
            >
              <ArrowUpRight size={22} />
            </Link>
          </div>
        </section>
        <section className="card activity-card">
          <div className="section-heading">
            <h2>Consistency over intensity</h2>
            <Badge>This week</Badge>
          </div>
          <div className="weekly-summary">
            <strong>
              {data?.weeklyXpTotal ?? 0}
              <small>XP earned</small>
            </strong>
            <span>Every session counts.</span>
          </div>
          <div className="bar-chart" aria-label="XP earned each day">
            {(
              data?.weeklyXp ??
              Array.from({ length: 7 }, (_, i) => {
                const d = new Date();
                d.setDate(d.getDate() - 6 + i);
                return { dow: d.toLocaleDateString('en', { weekday: 'short' }), xp: 0 };
              })
            ).map((d: any, i: number) => (
              <div key={i} className={`bar-column ${i === 6 ? 'today' : ''}`}>
                <div className="bar-track">
                  <div
                    className="bar"
                    style={{
                      height: `${Math.max(4, (100 * d.xp) / Math.max(...(data?.weeklyXp?.map((v: any) => v.xp) ?? [0]), 1))}%`,
                    }}
                    title={`${d.xp} XP`}
                  />
                </div>
                <span>{d.dow.slice(0, 1)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="dashboard-columns">
        <section className="card">
          <div className="section-heading">
            <div>
              <h2>Your learning roadmap</h2>
              <p>From a clear ask to a complete application.</p>
            </div>
            <Link className="text-button" to="/roadmap">
              Explore <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="compact-roadmap">
            {roadmap.map((l, i) => (
              <Link
                to={`/challenges?level=${encodeURIComponent(l.slug ?? ['say-what-you-want', 'add-context-and-limits', 'shape-the-output', 'iterate-and-debug', 'ship-a-full-program'][i])}`}
                key={l.code}
                className="compact-level"
              >
                <span className={`level-number ${l.status === 'done' ? 'done' : ''}`}>
                  {l.status === 'done' ? <Check size={16} /> : l.code}
                </span>
                <div>
                  <strong>{l.name}</strong>
                  <span>
                    {l.clearedCount ?? 0} of {l.challengeCount ?? 4} challenges cleared
                  </span>
                </div>
                <div className="tiny-progress">
                  <span style={{ width: `${l.pct ?? 0}%` }} />
                </div>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>
        <section className="card achievements-card">
          <div className="section-heading">
            <div>
              <h2>Milestones worth keeping</h2>
              <p>Little reminders of how far you’ve come.</p>
            </div>
            <Trophy size={17} />
          </div>
          <div className="achievement-grid">
            {(
              data?.badges ?? [
                { slug: 'first-clear', name: 'First clear', mark: '01' },
                { slug: 'under-budget-5', name: 'Under budget ×5', mark: '≤' },
                { slug: 'json-whisperer', name: 'JSON whisperer', mark: '{ }' },
                { slug: 'bug-hunter', name: 'Bug hunter', mark: 'err' },
                { slug: 'surgeon', name: 'Surgeon', mark: 'Δ' },
                { slug: 'shipper', name: 'Shipper', mark: 'app' },
              ]
            ).map((b: any, i: number) => {
              const Icon = [Zap, Target, Braces, Bug, Code2, Rocket][i % 6];
              return (
                <div
                  key={b.slug}
                  className={`achievement ${b.earned ? 'earned' : ''}`}
                  title={b.earned ? 'Earned' : 'Keep practicing to unlock'}
                >
                  <span>
                    <Icon size={23} />
                    {!b.earned && <LockKeyhole size={10} className="achievement-lock" />}
                  </span>
                  <strong>{b.name}</strong>
                  <small>{b.earned ? 'Earned' : 'To be discovered'}</small>
                </div>
              );
            })}
          </div>
          <div className="achievement-note">
            <Sparkles size={15} />
            <p>
              {data?.badges?.some((b: any) => b.earned)
                ? 'Keep going. There’s more to discover.'
                : 'Your first milestone is just one challenge away.'}
            </p>
          </div>
        </section>
      </div>
      <section className="card">
        <div className="section-heading">
          <div>
            <h2>Recent practice</h2>
            <p>Every attempt is part of the process.</p>
          </div>
          <Link className="text-button" to="/submissions">
            View history <ArrowUpRight size={14} />
          </Link>
        </div>
        {!data?.recentSubmissions?.length ? (
          <Empty
            icon={<Terminal size={24} />}
            title="A fresh start, full of possibility"
            text="Your submissions and feedback will appear here after your first challenge."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>CHALLENGE</th>
                  <th>RESULT</th>
                  <th>TOKENS</th>
                  <th>DATE</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSubmissions.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/challenge/${s.challengeSlug}?submission=${s.id}`}>
                        <span className="muted mini">{s.code}</span> {s.challengeTitle}
                      </Link>
                    </td>
                    <td>
                      <Badge
                        tone={
                          s.result === 'pass' ? 'success' : s.result === 'pending' ? '' : 'warning'
                        }
                      >
                        {s.result === 'pass' && <Check size={11} />} {s.result}
                      </Badge>
                    </td>
                    <td className="mono">
                      {s.tokenCount} <span className="muted">/ {s.tokenBudget}</span>
                    </td>
                    <td className="muted">{new Date(s.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
