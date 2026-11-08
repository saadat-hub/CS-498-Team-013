import { ArrowUpRight, Braces, CheckCircle2, Code2, Search, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type ChallengeSummary, type Level } from '../api';
import { Badge, Empty, ErrorBox, Loading, PageHeading, useData } from '../ui';
function ChallengeTile({ c }: { c: ChallengeSummary }) {
  return (
    <Link className="challenge-tile card" to={`/challenge/${c.slug}`}>
      <div className="tile-top">
        <span className="mono muted">{c.code}</span>
        <span className="tile-arrow">
          <ArrowUpRight size={19} />
        </span>
      </div>
      <div className={`tile-icon ${c.tags.includes('machine-learning') ? 'ml' : ''}`}>
        {c.tags.includes('machine-learning') ? <Sparkles size={23} /> : <Code2 size={23} />}
      </div>
      <Badge tone={c.tags.includes('machine-learning') ? 'lavender' : ''}>
        {c.tags.includes('machine-learning') ? 'Machine learning' : 'Foundations'}
      </Badge>
      <h3>{c.title}</h3>
      {c.brief && <p>{c.brief}</p>}
      <div className="tile-bottom">
        <span>
          <Zap size={14} />
          {c.xp} XP
        </span>
        <span>
          <Braces size={14} />
          {c.tokenBudget} tokens
        </span>
        {c.me?.status === 'cleared' && <CheckCircle2 size={16} className="teal-text" />}
      </div>
    </Link>
  );
}
export default function Challenges() {
  const [params, setParams] = useSearchParams(),
    [track, setTrack] = useState(''),
    [q, setQ] = useState('');
  const level = params.get('level') ?? '',
    levels = useData<{ items: Level[] }>('/levels');
  const path = level ? `/levels/${encodeURIComponent(level)}/challenges` : '/challenges?limit=100';
  const { data, loading, error, refresh } = useData<{
    items: ChallengeSummary[];
    level?: { name: string; tip: string };
  }>(path);
  const items =
    data?.items.filter(
      (c) =>
        (!track ||
          (track === 'ml'
            ? c.tags.includes('machine-learning')
            : !c.tags.includes('machine-learning'))) &&
        `${c.title} ${c.brief ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeading
        eyebrow="PRACTICE WITH PURPOSE"
        title={data?.level?.name ?? 'A little challenge. A lot to learn.'}
        text={
          data?.level?.tip ??
          'Explore programming, debugging, and machine learning. Find your next small win.'
        }
      />
      <div className="filter-bar">
        <div className="tabs" aria-label="Challenge track">
          {[
            ['', 'All challenges'],
            ['foundation', 'Foundations'],
            ['ml', 'Machine learning'],
          ].map(([v, label]) => (
            <button key={v} className={track === v ? 'active' : ''} onClick={() => setTrack(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="filter-controls">
          <select
            aria-label="Filter by level"
            value={level}
            onChange={(e) => setParams(e.target.value ? { level: e.target.value } : {})}
          >
            <option value="">All levels</option>
            {levels.data?.items.map((l) => (
              <option key={l.slug} value={l.slug}>
                {l.code} · {l.name}
              </option>
            ))}
          </select>
          <label className="search-field">
            <Search size={16} />
            <input
              placeholder="Filter challenges…"
              aria-label="Filter challenges"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="results-label">
        {loading ? 'Loading challenges…' : `${items.length} challenges to explore`}
        <span>Progress at your own pace</span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : items.length ? (
        <div className="challenge-grid">
          {items.map((c) => (
            <ChallengeTile key={c.slug} c={c} />
          ))}
        </div>
      ) : (
        <Empty
          icon={<Search />}
          title="No challenges found"
          text="Try a different topic or clear your filters."
        />
      )}
    </>
  );
}
