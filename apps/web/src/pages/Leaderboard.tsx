import { ArrowUpRight, ShieldCheck, Trophy } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Empty, ErrorBox, Loading, PageHeading, useApp, useData } from '../ui';
export default function Leaderboard() {
  const [scope, setScope] = useState('week'),
    { data, loading, error, refresh } = useData(`/leaderboard?scope=${scope}&limit=50`),
    { user } = useApp();
  return (
    <>
      <PageHeading
        eyebrow="A LITTLE FRIENDLY MOMENTUM"
        title="Learning is better together."
        text="Celebrate consistent practice. Your only real competition is yesterday’s you."
      />
      <div className="filter-bar">
        <div className="tabs">
          <button className={scope === 'week' ? 'active' : ''} onClick={() => setScope('week')}>
            This week
          </button>
          <button
            className={scope === 'alltime' ? 'active' : ''}
            onClick={() => setScope('alltime')}
          >
            All time
          </button>
        </div>
        <span className="muted mini">Weekly rankings reset Monday · UTC</span>
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : (
        <section className="card">
          <div className="section-heading">
            <h2>{scope === 'week' ? 'This week’s curious minds' : 'The practice adds up'}</h2>
            <Trophy size={20} />
          </div>
          {!data?.top.length ? (
            <Empty
              icon={<Trophy />}
              title="The leaderboard is ready for its first learner"
              text="Pass a challenge to earn XP. Verified learners who choose to participate appear here."
            />
          ) : (
            <div className="table-scroll">
              <table className="leaderboard-table">
                <thead>
                  <tr>
                    <th>RANK</th>
                    <th>LEARNER</th>
                    <th>EXPERIENCE</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((r: any) => (
                    <tr key={r.userId} className={r.userId === user?.id ? 'your-row' : ''}>
                      <td>
                        <span className={`rank rank-${r.rank}`}>
                          {r.rank <= 3 ? <Trophy size={17} /> : r.rank}
                        </span>
                      </td>
                      <td>
                        <span className="table-person">
                          <span className="avatar">
                            {r.displayName
                              .split(' ')
                              .map((s: string) => s[0])
                              .slice(0, 2)
                              .join('')}
                          </span>
                          <strong>{r.displayName}</strong>
                          {r.userId === user?.id && <Badge>You</Badge>}
                        </span>
                      </td>
                      <td className="mono">
                        {r.xp.toLocaleString()} <small>XP</small>
                      </td>
                      <td>
                        <span className="muted mini">
                          Keep growing <ArrowUpRight size={13} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data?.me && !data.top.some((r: any) => r.userId === user?.id) && (
            <div className="your-rank">
              <strong>Your position: #{data.me.rank}</strong>
              <span>{data.me.xp} XP</span>
            </div>
          )}
        </section>
      )}
      <div className="callout">
        <ShieldCheck size={20} />
        <div>
          <strong>Your progress, your choice.</strong>
          <p>
            You can change your leaderboard visibility in{' '}
            <Link to="/settings">account settings</Link>. Your email is never displayed.
          </p>
        </div>
      </div>
    </>
  );
}
