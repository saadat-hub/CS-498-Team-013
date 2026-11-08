import { ArrowRight, ArrowUpRight, Check, Download, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, mutate } from '../api';
import { ErrorBox, PageHeading, RequireAccount, useApp } from '../ui';
export default function Settings({ onboarding = false }: { onboarding?: boolean }) {
  const { user, reload, notify } = useApp(),
    navigate = useNavigate(),
    [name, setName] = useState(user?.displayName ?? ''),
    [handle, setHandle] = useState(user?.handle ?? ''),
    [zone, setZone] = useState(user?.timezone ?? 'UTC'),
    [visible, setVisible] = useState(user?.leaderboardOptIn ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deleteConfirm, setDeleteConfirm] = useState(''),
    [deleting, setDeleting] = useState(false);
  if (!user) return <RequireAccount />;
  return (
    <>
      <PageHeading
        eyebrow="MAKE YOURSELF AT HOME"
        title={onboarding ? 'A few details, then you’re off.' : 'Your learning workspace.'}
        text="A little about you, and how you want to show up."
      />
      <div className="settings-grid">
        <form
          className="card settings-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await mutate('PATCH', '/me', {
                displayName: name,
                handle,
                timezone: zone,
                leaderboardOptIn: visible,
              });
              await reload();
              notify('Settings saved');
              if (onboarding) navigate('/');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="section-heading">
            <h2>Your profile</h2>
            <span className="avatar large">{name[0] ?? 'L'}</span>
          </div>
          <label>
            Display name
            <input
              aria-label="Display name"
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <span className="field-help">How other learners see you on the leaderboard.</span>
          </label>
          <label>
            Handle
            <div className="input-prefix">
              <span>@</span>
              <input
                aria-label="Handle"
                required
                pattern="[a-z0-9_]{3,20}"
                minLength={3}
                maxLength={20}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
            </div>
            <span className="field-help">3–20 lowercase letters, numbers, or underscores.</span>
          </label>
          <label>
            Email
            <input aria-label="Email" value={user.email} readOnly className="readonly" />
            <span className="field-help">Your sign-in email. It is never displayed publicly.</span>
          </label>
          <label>
            Timezone
            <select aria-label="Timezone" value={zone} onChange={(e) => setZone(e.target.value)}>
              {Array.from(new Set(['UTC', zone, ...Intl.supportedValuesOf('timeZone')])).map(
                (z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ),
              )}
            </select>
            <span className="field-help">
              Your streak and activity chart follow your local day.
            </span>
          </label>
          <div className="setting-toggle">
            <div>
              <strong>Join the leaderboard</strong>
              <p>Show your display name and XP to other learners.</p>
            </div>
            <input
              type="checkbox"
              aria-label="Join the leaderboard"
              checked={visible}
              onChange={(e) => setVisible(e.target.checked)}
            />
          </div>
          {error && <ErrorBox message={error} />}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
            <Check size={16} />
          </button>
        </form>
        <div>
          <section className="card settings-aside">
            <ShieldCheck size={25} className="teal-text" />
            <h2>Your data belongs to you.</h2>
            <p>
              Download your profile, drafts, submissions, and learning history whenever you need
              them.
            </p>
            <button
              className="btn secondary"
              onClick={async () => {
                try {
                  const data = await api('/me/export');
                  const url = URL.createObjectURL(
                    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'prompt-lab-data.json';
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            >
              <Download size={15} />
              Export my data
            </button>
          </section>
          <section className="card settings-aside danger-zone">
            <h3>Close your account</h3>
            <p>
              You’ll be signed out immediately. Your account and learning history will be
              permanently removed after 30 days.
            </p>
            {deleting ? (
              <>
                <label>
                  Type DELETE to confirm
                  <input
                    aria-label="Type DELETE to confirm"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                  />
                </label>
                <div className="inline-actions">
                  <button
                    className="btn danger small"
                    disabled={deleteConfirm !== 'DELETE' || busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await mutate('DELETE', '/me');
                        await reload();
                        navigate('/');
                        notify('Account scheduled for deletion');
                      } catch (e) {
                        notify((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Delete account
                  </button>
                  <button className="btn ghost small" onClick={() => setDeleting(false)}>
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <button className="text-button danger-text" onClick={() => setDeleting(true)}>
                Delete my account <ArrowRight size={14} />
              </button>
            )}
          </section>
          {user.role !== 'learner' && (
            <Link className="btn secondary" to="/admin">
              Content & administration <ArrowUpRight size={15} />
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
