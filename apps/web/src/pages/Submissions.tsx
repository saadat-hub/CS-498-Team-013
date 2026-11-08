import { ArrowUpRight, ChevronDown, Clock3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge,
  Empty,
  ErrorBox,
  Loading,
  PageHeading,
  RequireAccount,
  useApp,
  useData,
} from '../ui';
export default function Submissions() {
  const { user } = useApp(),
    [cursor, setCursor] = useState(''),
    [items, setItems] = useState<any[]>([]);
  const { data, loading, error, refresh } = useData(
    user ? `/submissions?limit=20${cursor ? `&cursor=${cursor}` : ''}` : null,
  );
  useEffect(() => {
    if (data)
      setItems((old) =>
        cursor
          ? [...old.filter((v) => !data.items.some((n: any) => n.id === v.id)), ...data.items]
          : data.items,
      );
  }, [data]);
  if (!user)
    return (
      <RequireAccount
        title="Every attempt tells a story."
        text="Sign in to revisit your submissions and feedback."
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="YOUR PRACTICE HISTORY"
        title="Progress, one attempt at a time."
        text="Revisit your work, reflect on feedback, and see what changed."
      />
      {loading && !cursor ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : !items.length ? (
        <Empty
          icon={<Clock3 />}
          title="Your story is still unwritten"
          text="Complete a challenge to start your practice history."
        >
          <Link to="/challenges" className="btn primary">
            Find a challenge <ArrowUpRight size={15} />
          </Link>
        </Empty>
      ) : (
        <section className="card table-scroll">
          <table>
            <thead>
              <tr>
                <th>CHALLENGE</th>
                <th>RESULT</th>
                <th>TOKENS</th>
                <th>DATE</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/challenge/${s.challengeSlug}?submission=${s.id}`}>
                      <span className="mono muted mini">{s.code}</span>
                      {s.challengeTitle}
                    </Link>
                  </td>
                  <td>
                    <Badge
                      tone={
                        s.result === 'pass' ? 'success' : s.result === 'pending' ? '' : 'warning'
                      }
                    >
                      {s.result}
                    </Badge>
                  </td>
                  <td className="mono">
                    {s.tokenCount} / {s.tokenBudget}
                  </td>
                  <td className="muted">{new Date(s.createdAt).toLocaleString()}</td>
                  <td>
                    <Link
                      aria-label={`View ${s.challengeTitle} feedback`}
                      to={`/challenge/${s.challengeSlug}?submission=${s.id}`}
                    >
                      <ArrowUpRight size={16} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {data?.nextCursor && (
        <button
          className="btn secondary load-more"
          disabled={loading}
          onClick={() => setCursor(data.nextCursor)}
        >
          {loading ? 'Loading…' : 'Load more attempts'}
          <ChevronDown size={15} />
        </button>
      )}
    </>
  );
}
