import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Code2 as Github,
  LoaderCircle,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { mutate } from '../api';
import { Badge, Brand, ErrorBox, useApp } from '../ui';
export default function SignIn() {
  const { user, config, reload } = useApp(),
    [email, setEmail] = useState(''),
    [sent, setSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [params] = useSearchParams(),
    navigate = useNavigate();
  const raw = params.get('next') ?? '/',
    next = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);
  return (
    <div className="signin-page">
      <section className="signin-story">
        <Brand />
        <div>
          <div className="eyebrow">A SPACE TO THINK, BUILD & GROW</div>
          <h1>
            Great work starts
            <br />
            with a better
            <br />
            <em>question.</em>
          </h1>
          <p>
            Practice the art of clear instructions.
            <br />
            Build programs you understand.
            <br />
            Keep your curiosity close.
          </p>
          <div className="signin-points">
            <span>
              <CheckCircle2 size={16} />
              {config.catalog?.challenges ?? 0} thoughtfully designed challenges
            </span>
            <span>
              <CheckCircle2 size={16} />
              Feedback that helps you improve
            </span>
            <span>
              <CheckCircle2 size={16} />
              Progress you can make your own
            </span>
          </div>
        </div>
        <span className="signin-foot">One focused session at a time.</span>
      </section>
      <section className="signin-form-wrap">
        <Link className="back-link" to="/">
          <ArrowLeft size={15} />
          Back to the workspace
        </Link>
        <div className="signin-form">
          <span className="signin-icon">
            <Terminal size={26} />
          </span>
          <h2>{sent ? 'Your next step is in your inbox.' : 'Welcome to Prompt Lab.'}</h2>
          <p>
            {sent
              ? 'If delivery is available, your sign-in link is on its way. It expires in 15 minutes.'
              : 'A little practice today. A little more confidence tomorrow.'}
          </p>
          {error && <ErrorBox message={error} />}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await mutate('POST', '/auth/magic-link', { email });
                setSent(true);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
            <button className="btn primary full" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}{' '}
              {sent ? 'Send another sign-in link' : 'Continue with email'}
            </button>
          </form>
          {(config.oauth.github || config.oauth.google) && (
            <>
              <div className="or-divider">
                <span>or continue with</span>
              </div>
              <div className="oauth-buttons">
                {config.oauth.github && (
                  <a className="btn secondary" href="/api/v1/auth/oauth/github">
                    <Github size={17} />
                    GitHub
                  </a>
                )}
                {config.oauth.google && (
                  <a className="btn secondary" href="/api/v1/auth/oauth/google">
                    Google <ArrowUpRight size={15} />
                  </a>
                )}
              </div>
            </>
          )}
          {config.localDevelopment && (
            <div className="local-signin">
              <Badge>Local development</Badge>
              <p>Try the app on this computer. Your learning history is stored locally.</p>
              <button
                className="btn secondary full"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await mutate('POST', '/auth/local');
                    await reload();
                    navigate(next);
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Terminal size={16} />
                Start local session <ArrowRight size={16} />
              </button>
              <span className="field-help">
                Email links are printed in the local server console.
              </span>
            </div>
          )}
          <div className="signin-trust">
            <ShieldCheck size={14} />
            No password to remember. Just a secure sign-in link.
          </div>
        </div>
      </section>
    </div>
  );
}
