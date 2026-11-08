import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  ExternalLink,
  Lightbulb,
  LoaderCircle,
  RotateCcw,
  Route as RouteIcon,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { estimate, instant } from '../../../../packages/grading/src/instant';
import { api, ApiError, type Challenge, type Grade, mutate } from '../api';
import { Badge, ErrorBox, Loading, useApp, useData } from '../ui';
export default function Workbench() {
  const { slug = '' } = useParams(),
    { user, config, notify } = useApp(),
    [params] = useSearchParams();
  const {
    data: c,
    loading,
    error,
    refresh,
  } = useData<Challenge>(`/challenges/${encodeURIComponent(slug)}`);
  const [prompt, setPrompt] = useState(''),
    [saved, setSaved] = useState(''),
    [saveError, setSaveError] = useState(''),
    [conflict, setConflict] = useState<any>(null),
    [hint, setHint] = useState(false),
    [busy, setBusy] = useState(false),
    [grade, setGrade] = useState<Grade | null>(null),
    [gradeError, setGradeError] = useState(''),
    [exact, setExact] = useState<{ text: string; count: number; counter: string } | null>(null),
    [counting, setCounting] = useState(false);
  const rev = useRef(0),
    lastSaved = useRef(''),
    saveQueue = useRef(Promise.resolve()),
    mounted = useRef(true),
    key = useRef<{ prompt: string; id: string } | null>(null),
    editor = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (c) {
      const p = c.me.draft?.prompt ?? '';
      setPrompt(p);
      lastSaved.current = p;
      rev.current = c.me.draft?.rev ?? 0;
      setSaved(c.me.draft ? 'Draft saved' : '');
    }
  }, [c]);
  const saveDraft = useCallback(
    (text: string) => {
      if (!user || !c || conflict) return;
      saveQueue.current = saveQueue.current.then(async () => {
        if (text === lastSaved.current) return;
        if (mounted.current) {
          setSaved('Saving…');
          setSaveError('');
        }
        try {
          const d = await mutate('PUT', `/drafts/${slug}`, { prompt: text, rev: rev.current });
          rev.current = d.rev;
          lastSaved.current = text;
          if (mounted.current) setSaved('Draft saved');
        } catch (e) {
          if (mounted.current) {
            setSaved('Not saved');
            setSaveError((e as Error).message);
            if (e instanceof ApiError && e.code === 'draft_conflict') setConflict(e.details.draft);
          }
        }
      });
    },
    [c, user, slug, conflict],
  );
  useEffect(() => {
    const t = setTimeout(() => saveDraft(prompt), 800);
    return () => clearTimeout(t);
  }, [prompt, saveDraft]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (user && prompt !== lastSaved.current) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [prompt, user]);
  useEffect(() => {
    if (params.get('submission'))
      api<Grade>(`/submissions/${params.get('submission')}`)
        .then(setGrade)
        .catch((e) => setGradeError(e.message));
  }, [params]);
  useEffect(() => {
    if (!grade || !['queued', 'grading'].includes(grade.status)) return;
    let active = true,
      timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 240000;
    const poll = async () => {
      try {
        const s = await api<Grade>(`/submissions/${grade.id}`);
        if (!active) return;
        setGrade(s);
        if (['queued', 'grading'].includes(s.status)) {
          if (Date.now() > deadline) {
            setGradeError(
              'Grading is taking longer than expected. Your attempt is saved; refresh to check it again.',
            );
            return;
          }
          timer = setTimeout(poll, 1500);
        }
      } catch (e) {
        if (active) setGradeError((e as Error).message);
      }
    };
    timer = setTimeout(poll, 900);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [grade?.id, grade?.status]);
  const submit = async () => {
    if (!user || !c || !prompt.trim() || busy) return;
    setBusy(true);
    setGradeError('');
    if (!key.current || key.current.prompt !== prompt || grade?.status === 'error')
      key.current = { prompt, id: crypto.randomUUID() };
    try {
      saveDraft(prompt);
      const result = await mutate<Grade>('POST', '/submissions', {
        challengeSlug: slug,
        prompt,
        idempotencyKey: key.current.id,
      });
      setGrade(result);
    } catch (e) {
      setGradeError((e as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  if (loading) return <Loading />;
  if (error || !c) return <ErrorBox message={error || 'Challenge not found'} retry={refresh} />;
  const tokenCount = exact?.text === prompt ? exact.count : estimate(prompt),
    isExact = exact?.text === prompt && exact.counter.startsWith('anthropic:');
  const live = c.checks
    .filter((k) => k.phase === 'instant')
    .map((k) => {
      try {
        return { ...k, ...instant({ ...k, weight: 1 }, prompt, tokenCount, c.tokenBudget) };
      } catch {
        return { ...k, passed: false, serverOnly: true };
      }
    });
  const waiting = busy || (!!grade && ['queued', 'grading'].includes(grade.status)),
    needsAi = c.checks.some((k) => k.phase === 'model') && !config.aiEnabled;
  return (
    <>
      <Link className="back-link" to={`/challenges?level=${c.level.slug}`}>
        <ArrowLeft size={15} />
        Back to {c.level.name}
      </Link>
      <div className="workbench-heading">
        <div>
          <div className="eyebrow">
            LEVEL {c.level.code} <span>/</span> CHALLENGE {c.code}
          </div>
          <h1>{c.title}</h1>
          <div className="challenge-badges">
            <Badge>
              {c.tags.includes('machine-learning') ? 'Machine learning' : 'Foundations'}
            </Badge>
            <span>
              <Zap size={14} />
              {c.xp} XP
            </span>
            <span>
              <Braces size={14} />
              {c.tokenBudget} token budget
            </span>
            {c.me.status === 'cleared' && (
              <Badge tone="success">
                <Check size={12} />
                Cleared
              </Badge>
            )}
          </div>
        </div>
        <Link className="btn secondary" to="/roadmap">
          Your roadmap <RouteIcon size={15} />
        </Link>
      </div>
      <div className="workbench-grid">
        <section className="brief-column">
          <article className="card brief-card">
            <div className="overline">
              <Target size={15} /> THE CHALLENGE
            </div>
            <h2>Make your intent clear.</h2>
            <p className="brief-text">{c.brief}</p>
            {c.context.instructions && (
              <p className="context-instruction">{c.context.instructions}</p>
            )}
            <div className="brief-divider" />
            <h3>What we’re checking</h3>
            <div className="check-list">
              {c.checks.map((k) => {
                const l = live.find((v) => v.key === k.key);
                return (
                  <div className={`check-item ${prompt && l?.passed ? 'passed' : ''}`} key={k.key}>
                    {prompt && l?.passed ? (
                      <CheckCircle2 size={17} />
                    ) : k.phase === 'model' ? (
                      <Sparkles size={17} />
                    ) : (
                      <Circle size={17} />
                    )}
                    <div>
                      <strong>{k.label}</strong>
                      <span>
                        {k.phase === 'model'
                          ? 'Evaluated after submission'
                          : 'Live feedback as you type'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              className={`hint-toggle ${hint ? 'expanded' : ''}`}
              aria-expanded={hint}
              onClick={() => setHint((h) => !h)}
            >
              <Lightbulb size={17} />
              <span>A nudge in the right direction</span>
              <ChevronDown size={15} />
            </button>
            {hint && <div className="hint-content">{c.hint}</div>}
          </article>
          {Object.keys(c.context).length > 0 && (
            <article className="card context-card">
              <h3>Challenge context</h3>
              {Object.entries(c.context)
                .filter(
                  ([k]) =>
                    ![
                      'references',
                      'instructions',
                      'learning_objectives',
                      'track',
                      'submission_mode',
                      'evaluation_mode',
                    ].includes(k),
                )
                .map(([k, v]) => (
                  <details key={k}>
                    <summary>{k.replaceAll('_', ' ')}</summary>
                    {typeof v === 'string' && !v.includes('\n') ? (
                      <p>{v}</p>
                    ) : (
                      <pre>{typeof v === 'string' ? v : JSON.stringify(v, null, 2)}</pre>
                    )}
                  </details>
                ))}
              {c.context.references?.length > 0 && (
                <div className="references">
                  <h4>Read the source</h4>
                  {c.context.references.map((r: any) => (
                    <a href={r.url} target="_blank" rel="noreferrer" key={r.url}>
                      {r.title}
                      <ExternalLink size={13} />
                    </a>
                  ))}
                </div>
              )}
            </article>
          )}
          <div className="workbench-tip">
            <ShieldCheck size={19} />
            <p>
              AI feedback is a guide. Read the result, question assumptions, and verify the code
              yourself.
            </p>
          </div>
        </section>
        <div className="editor-column">
          <section className="card editor-card">
            <div className="editor-heading">
              <div>
                <Terminal size={17} />
                <strong>Your workspace</strong>
              </div>
              <span className="mini muted">
                {c.context.submission_mode === 'code-and-research-notes'
                  ? 'PROMPT, CODE & NOTES'
                  : 'PROMPT EDITOR'}
              </span>
            </div>
            <div className="editor-wrap">
              <div className="editor-gutter" aria-hidden="true">
                {Array.from({ length: Math.max(10, prompt.split('\n').length) }, (_, i) => (
                  <span key={i}>{String(i + 1).padStart(2, '0')}</span>
                ))}
              </div>
              <textarea
                ref={editor}
                aria-label="Your prompt"
                spellCheck={false}
                maxLength={20000}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setGrade(null);
                }}
                onBlur={() => saveDraft(prompt)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    void submit();
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const el = e.currentTarget,
                      pos = el.selectionStart;
                    setPrompt(prompt.slice(0, pos) + '  ' + prompt.slice(el.selectionEnd));
                    requestAnimationFrame(() => {
                      el.selectionStart = el.selectionEnd = pos + 2;
                    });
                  }
                }}
                placeholder={
                  c.context.submission_mode
                    ? '# Your implementation, tests, and research notes…\n\nBe specific. Reference the supplied evidence.'
                    : '# Start with a clear request…\n\nDescribe what you want to build, the language,\nand what a good result looks like.'
                }
              />
            </div>
            <div className="editor-status">
              <span>
                {user ? (
                  <>
                    <span className={`status-dot ${saveError ? 'bad' : ''}`} />
                    {saved || 'Autosave is on'}
                  </>
                ) : (
                  'Sign in to save your draft'
                )}
              </span>
              <span>{prompt.length.toLocaleString()} / 20,000 characters</span>
            </div>
            {saveError && (
              <div className="inline-warning" role="alert">
                {saveError}
                {conflict && (
                  <button
                    className="text-button"
                    onClick={() => {
                      setPrompt(conflict.prompt);
                      lastSaved.current = conflict.prompt;
                      rev.current = conflict.rev;
                      setConflict(null);
                      setSaveError('');
                      setSaved('Server draft loaded');
                    }}
                  >
                    Load saved version
                  </button>
                )}
              </div>
            )}
            <div className="token-section">
              <div>
                <span className={tokenCount > c.tokenBudget ? 'danger-text' : ''}>
                  <strong>
                    {isExact ? '' : '~'}
                    {tokenCount}
                  </strong>{' '}
                  / {c.tokenBudget} tokens
                </span>
                <button
                  className="text-button mini"
                  disabled={!user || counting || !prompt.trim()}
                  onClick={async () => {
                    setCounting(true);
                    try {
                      const r = await mutate('POST', '/tokens/count', { text: prompt });
                      setExact({ text: prompt, count: r.count, counter: r.counter });
                    } catch (e) {
                      notify((e as Error).message);
                    } finally {
                      setCounting(false);
                    }
                  }}
                >
                  {counting ? 'Counting…' : isExact ? 'Provider count' : 'Check count'}
                  <RotateCcw size={11} />
                </button>
              </div>
              <div
                className={`progress-track token-progress ${tokenCount > c.tokenBudget ? 'over' : ''}`}
              >
                <span style={{ width: `${Math.min(100, (tokenCount / c.tokenBudget) * 100)}%` }} />
              </div>
              <p>
                {isExact
                  ? 'Counted by the configured AI provider.'
                  : 'Live estimate: approximately four characters per token. Server counts are recorded with each submission.'}
              </p>
            </div>
            <div className="editor-actions">
              <button
                className="btn ghost"
                disabled={!prompt || waiting}
                onClick={async () => {
                  setPrompt('');
                  setGrade(null);
                  lastSaved.current = '';
                  if (user) {
                    try {
                      await saveQueue.current;
                      await mutate('DELETE', `/drafts/${slug}`);
                      rev.current = 0;
                      lastSaved.current = '';
                      setSaved('Draft cleared');
                    } catch (e) {
                      setSaveError((e as Error).message);
                    }
                  }
                  editor.current?.focus();
                }}
              >
                <RotateCcw size={14} />
                Clear
              </button>
              {user ? (
                <button
                  className="btn primary"
                  disabled={!prompt.trim() || waiting || c.me.locked}
                  onClick={submit}
                >
                  {waiting ? <LoaderCircle size={16} className="spin" /> : <Send size={15} />}{' '}
                  {waiting ? 'Evaluating…' : 'Submit for feedback'}
                  <kbd>⌘ ↵</kbd>
                </button>
              ) : (
                <Link
                  className="btn primary"
                  to={`/signin?next=${encodeURIComponent(`/challenge/${slug}`)}`}
                >
                  Sign in to submit <ArrowRight size={16} />
                </Link>
              )}
            </div>
          </section>
          {needsAi && (
            <div className="callout compact">
              <Sparkles size={18} />
              <p>
                This challenge uses AI evaluation. You can explore and save a draft now. Configure
                the provider for grading, or{' '}
                <Link to="/challenges?level=say-what-you-want">practice the foundations</Link>.
              </p>
            </div>
          )}
          {gradeError && <ErrorBox message={gradeError} />}
          <section
            className={`card result-card ${grade?.status === 'passed' ? 'result-passed' : ''}`}
            aria-live="polite"
          >
            <div className="section-heading">
              <h2>Your feedback</h2>
              {grade?.status === 'passed' && (
                <Badge tone="success">
                  <Check size={12} />
                  Passed
                </Badge>
              )}
            </div>
            {!grade ? (
              <div className="result-placeholder">
                <span>
                  <Sparkles size={23} />
                </span>
                <h3>Good ideas get better with feedback.</h3>
                <p>Submit your work to see how it meets each requirement.</p>
              </div>
            ) : waiting ? (
              <div className="result-placeholder">
                <LoaderCircle className="spin" size={25} />
                <h3>Looking at the details…</h3>
                <p>Your submission is saved. You can leave this page and come back.</p>
              </div>
            ) : grade.status === 'error' ? (
              <ErrorBox message="Evaluation could not finish. Your attempt is saved and has not earned or lost XP. Try submitting again." />
            ) : (
              <>
                <div className="result-summary">
                  <span className={grade.passed ? 'result-check success' : 'result-check warning'}>
                    {grade.passed ? <CheckCircle2 size={25} /> : <Lightbulb size={25} />}
                  </span>
                  <div>
                    <h3>
                      {grade.passed
                        ? 'Clear thinking. Well done.'
                        : 'A little refinement goes a long way.'}
                    </h3>
                    <p>
                      {grade.passed
                        ? `${grade.xpAwarded ? `+${grade.xpAwarded} XP earned. ` : 'You’ve already earned XP for this challenge. '}Keep building on what you know.`
                        : 'Use the checks below to improve your next attempt.'}
                    </p>
                  </div>
                </div>
                <div className="grade-checks">
                  {grade.checks.map((k) => (
                    <div
                      key={k.key}
                      className={k.details?.skipped ? 'muted' : k.passed ? 'passed' : 'failed'}
                    >
                      {k.details?.skipped ? (
                        <Clock3 size={17} />
                      ) : k.passed ? (
                        <CheckCircle2 size={17} />
                      ) : (
                        <X size={17} />
                      )}
                      <div>
                        <strong>{k.label}</strong>
                        {k.message && <p>{k.message}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="result-meta">
                  <span>
                    {grade.tokenCount} / {grade.tokenBudget} tokens
                  </span>
                  <span>
                    {grade.tokenCounter.startsWith('estimate')
                      ? 'Estimated count'
                      : 'Provider count'}
                  </span>
                </div>
                <details className="model-output">
                  <summary>See your submitted prompt</summary>
                  <pre>{grade.prompt}</pre>
                </details>
                {grade.modelOutput && (
                  <details className="model-output">
                    <summary>See the model’s response</summary>
                    <pre>{grade.modelOutput}</pre>
                  </details>
                )}
                <div className="result-actions">
                  <button
                    className="btn secondary"
                    onClick={async () => {
                      try {
                        await mutate('POST', '/library', {
                          title: c.title,
                          prompt,
                          tags: c.tags,
                          submissionId: grade.id,
                        });
                        notify('Saved to your prompt library');
                      } catch (e) {
                        notify((e as Error).message);
                      }
                    }}
                  >
                    <Bookmark size={15} />
                    Save to library
                  </button>
                  {grade.passed && grade.next && (
                    <Link className="btn primary" to={`/challenge/${grade.next.challengeSlug}`}>
                      Next challenge <ArrowRight size={15} />
                    </Link>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
