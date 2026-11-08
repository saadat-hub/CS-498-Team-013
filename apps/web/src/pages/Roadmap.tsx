import { ArrowRight, Braces, Bug, Layers, Lightbulb, Rocket, Terminal } from 'lucide-react';
import { Link } from 'react-router-dom';
import { type Level } from '../api';
import { Badge, ErrorBox, Loading, PageHeading, useData } from '../ui';
const levelIcons = [Terminal, Layers, Braces, Bug, Rocket];
export default function Roadmap() {
  const { data, loading, error, refresh } = useData<{ items: Level[] }>('/levels');
  return (
    <>
      <PageHeading
        eyebrow="A PATH, NOT A RACE"
        title="Build your understanding."
        text="Five levels to turn clearer thinking into better programs. Start anywhere."
      />
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        <div className="roadmap-list">
          {data?.items.map((l, i) => {
            const Icon = levelIcons[i];
            return (
              <article className="roadmap-card card" key={l.slug}>
                <div className={`roadmap-emblem tone-${i}`}>
                  <Icon size={30} />
                  <span>0{i + 1}</span>
                </div>
                <div className="roadmap-description">
                  <div className="overline">
                    LEVEL {l.code}{' '}
                    <Badge tone={l.me.status === 'done' ? 'success' : ''}>
                      {l.me.locked
                        ? 'Locked'
                        : l.me.status === 'done'
                          ? 'Completed'
                          : 'Open to explore'}
                    </Badge>
                  </div>
                  <h2>{l.name}</h2>
                  <p>{l.blurb}</p>
                  <blockquote>“{l.tip}”</blockquote>
                  <div className="progress-line">
                    <div className="progress-track">
                      <span style={{ width: `${l.me.pct}%` }} />
                    </div>
                    <span>
                      {l.me.clearedCount} / {l.challengeCount} cleared
                    </span>
                  </div>
                </div>
                <Link to={`/challenges?level=${l.slug}`} className="btn secondary">
                  Explore level <ArrowRight size={15} />
                </Link>
              </article>
            );
          })}
        </div>
      )}
      <div className="callout">
        <Lightbulb size={21} />
        <div>
          <strong>Follow your curiosity.</strong>
          <p>
            Levels are open by default. Start with a foundation, revisit a skill, or jump into a
            topic that interests you.
          </p>
        </div>
      </div>
    </>
  );
}
