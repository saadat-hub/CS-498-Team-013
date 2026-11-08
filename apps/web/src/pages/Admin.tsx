import { RotateCcw, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { mutate } from '../api';
import { Badge, ErrorBox, Loading, PageHeading, RequireAccount, useApp, useData } from '../ui';
export default function Admin() {
  const { user, notify } = useApp(),
    [tab, setTab] = useState('content'),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [testPrompt, setTestPrompt] = useState(''),
    [verdict, setVerdict] = useState<any>(null),
    [adjustUser, setAdjustUser] = useState(''),
    [amount, setAmount] = useState(''),
    [note, setNote] = useState('');
  const allowed = user && ['admin', 'author'].includes(user.role);
  const content = useData(allowed ? '/admin/challenges' : null),
    users = useData(
      allowed && user.role === 'admin' && tab === 'users' ? '/admin/users?limit=100' : null,
    ),
    metrics = useData(
      allowed && user.role === 'admin' && tab === 'metrics' ? '/admin/metrics' : null,
    );
  if (!allowed)
    return (
      <RequireAccount
        title="This area is for your content team."
        text="An author or administrator account is required to manage the learning workspace."
      />
    );
  const action = async (id: string, path: string, body?: unknown) => {
    setBusy(id);
    setError('');
    try {
      const result = await mutate('POST', path, body);
      content.refresh();
      users.refresh();
      notify('Operation completed');
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="CONTENT & OPERATIONS"
        title="Keep the learning experience thoughtful."
        text="Review content, validate grading, and manage the workspace."
        action={
          <button
            className="btn secondary"
            disabled={!!busy}
            onClick={() => action('sync', '/admin/content/sync')}
          >
            Sync deployed content <RotateCcw size={15} />
          </button>
        }
      />
      <div className="filter-bar">
        <div className="tabs">
          {['content', ...(user.role === 'admin' ? ['users', 'metrics'] : [])].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorBox message={error} />}
      {tab === 'content' && (
        <>
          {content.loading ? (
            <Loading />
          ) : content.error ? (
            <ErrorBox message={content.error} />
          ) : (
            <section className="card table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>CHALLENGE</th>
                    <th>VERSION</th>
                    <th>STATUS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {content.data?.items.map((c: any) => (
                    <tr key={c.slug}>
                      <td>
                        <strong>{c.title}</strong>
                        <p className="mini muted">{c.slug}</p>
                      </td>
                      <td className="mono">v{c.version}</td>
                      <td>
                        <Badge tone={c.published ? 'success' : ''}>
                          {c.published ? 'Published' : 'Hidden'}
                        </Badge>
                      </td>
                      <td>
                        <div className="inline-actions">
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelected(c.slug);
                              setVerdict(null);
                            }}
                          >
                            Test grading
                          </button>
                          <button
                            className="text-button"
                            disabled={!!busy}
                            onClick={() =>
                              action(
                                c.slug,
                                `/admin/challenges/${c.slug}/${c.published ? 'unpublish' : 'publish'}`,
                              )
                            }
                          >
                            {c.published ? 'Unpublish' : 'Publish'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {selected && (
            <form
              className="card library-form"
              style={{ marginTop: 24 }}
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await action('dry-run', `/admin/challenges/${selected}/dry-run`, {
                  prompt: testPrompt,
                });
                if (r) setVerdict(r);
              }}
            >
              <div className="section-heading">
                <h2>Test: {selected}</h2>
                <button
                  type="button"
                  aria-label="Close grading test"
                  onClick={() => setSelected('')}
                >
                  <X size={16} />
                </button>
              </div>
              <label>
                Prompt
                <textarea
                  required
                  maxLength={20000}
                  rows={6}
                  value={testPrompt}
                  onChange={(e) => setTestPrompt(e.target.value)}
                />
              </label>
              <p className="mini muted">
                Dry runs do not create submissions or award XP. AI calls still count toward the
                budget.
              </p>
              <button className="btn primary" disabled={!!busy || !testPrompt.trim()}>
                Evaluate <Sparkles size={15} />
              </button>
              {verdict && <pre style={{ marginTop: 20 }}>{JSON.stringify(verdict, null, 2)}</pre>}
            </form>
          )}
        </>
      )}
      {tab === 'users' &&
        (users.loading ? (
          <Loading />
        ) : users.error ? (
          <ErrorBox message={users.error} />
        ) : (
          <>
            <section className="card table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>LEARNER</th>
                    <th>ROLE</th>
                    <th>STATUS</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data?.items.map((u: any) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.displayName}</strong>
                        <p className="mini muted">@{u.handle}</p>
                      </td>
                      <td>{u.role}</td>
                      <td>{u.bannedAt ? 'Banned' : 'Active'}</td>
                      <td>
                        <div className="inline-actions">
                          <button
                            disabled={!!busy || u.id === user.id}
                            className="text-button"
                            onClick={() =>
                              action(u.id, `/admin/users/${u.id}/${u.bannedAt ? 'unban' : 'ban'}`)
                            }
                          >
                            {u.bannedAt ? 'Unban' : 'Ban'}
                          </button>
                          <button className="text-button" onClick={() => setAdjustUser(u.id)}>
                            Adjust XP
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {adjustUser && (
              <form
                className="card library-form"
                style={{ marginTop: 20 }}
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await action('xp', `/admin/users/${adjustUser}/xp`, {
                      amount: Number(amount),
                      note,
                    })
                  ) {
                    setAdjustUser('');
                    setAmount('');
                    setNote('');
                  }
                }}
              >
                <div className="section-heading">
                  <h2>Adjust learner XP</h2>
                </div>
                <label>
                  Amount (negative values subtract)
                  <input
                    type="number"
                    required
                    min={-10000}
                    max={10000}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label>
                  Reason
                  <input
                    required
                    maxLength={500}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button className="btn primary" disabled={!!busy}>
                  Record adjustment
                </button>
                <button type="button" className="btn ghost" onClick={() => setAdjustUser('')}>
                  Cancel
                </button>
              </form>
            )}
          </>
        ))}
      {tab === 'metrics' &&
        (metrics.loading ? (
          <Loading />
        ) : metrics.error ? (
          <ErrorBox message={metrics.error} />
        ) : (
          <section className="card settings-aside">
            <div className="section-heading">
              <h2>Workspace metrics</h2>
              <button
                className="text-button"
                disabled={!!busy}
                onClick={() => action('rebuild', '/admin/leaderboard/rebuild')}
              >
                Rebuild leaderboard <RotateCcw size={14} />
              </button>
            </div>
            <p>Activity, pass rates, and provider costs from durable records.</p>
            <pre>{JSON.stringify(metrics.data, null, 2)}</pre>
          </section>
        ))}
    </>
  );
}
