import { Bookmark, BookOpen, ChevronDown, Copy, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { mutate } from '../api';
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
export default function Library() {
  const { user, notify } = useApp(),
    [q, setQ] = useState(''),
    [form, setForm] = useState(false),
    [title, setTitle] = useState(''),
    [prompt, setPrompt] = useState(''),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(''),
    [deleting, setDeleting] = useState(''),
    [cursor, setCursor] = useState(''),
    [items, setItems] = useState<any[]>([]);
  const { data, loading, error, refresh } = useData(
    user
      ? `/library?limit=20&q=${encodeURIComponent(q)}${cursor ? `&cursor=${cursor}` : ''}`
      : null,
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
        title="Keep your best ideas close."
        text="Build a personal collection of useful prompts and unlocked examples."
      />
    );
  return (
    <>
      <PageHeading
        eyebrow="YOUR PERSONAL COLLECTION"
        title="Good prompts are worth keeping."
        text="Save what works. Revisit an idea. Make it even better."
        action={
          <button className="btn primary" onClick={() => setForm((v) => !v)}>
            <Plus size={16} />
            Save a prompt
          </button>
        }
      />
      {form && (
        <form
          className="card library-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFailure('');
            try {
              await mutate('POST', '/library', { title, prompt });
              setForm(false);
              setTitle('');
              setPrompt('');
              setCursor('');
              refresh();
              notify('Prompt saved');
            } catch (e) {
              setFailure((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="section-heading">
            <h2>A place for that idea</h2>
            <button type="button" aria-label="Close form" onClick={() => setForm(false)}>
              <X size={18} />
            </button>
          </div>
          <label>
            Title
            <input
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Give your prompt a memorable name"
            />
          </label>
          <label>
            Prompt
            <textarea
              required
              maxLength={20000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What would you like to keep?"
              rows={5}
            />
          </label>
          {failure && <ErrorBox message={failure} />}
          <button className="btn primary" disabled={busy || !prompt.trim()}>
            Save prompt <Bookmark size={15} />
          </button>
        </form>
      )}
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search saved prompts"
            placeholder="Search your library…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor('');
            }}
          />
        </label>
        <span className="muted mini">Personal prompts & unlocked examples</span>
      </div>
      {loading && !cursor ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} retry={refresh} />
      ) : !items.length ? (
        <Empty
          icon={<Bookmark />}
          title="Your collection starts with one good idea"
          text="Save a prompt here, or keep a successful submission directly from the challenge workbench."
        />
      ) : (
        <div className="library-grid">
          {items.map((p) => (
            <article className="card library-item" key={p.id}>
              <div className="tile-top">
                <Badge tone={p.kind === 'example' ? 'lavender' : ''}>
                  {p.kind === 'example' ? 'Curated example' : 'Your collection'}
                </Badge>
                <div className="inline-actions">
                  <button
                    title="Copy prompt"
                    aria-label={`Copy ${p.title}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(p.prompt);
                        notify('Copied to clipboard');
                      } catch {
                        notify('Clipboard unavailable. Select and copy the prompt text.');
                      }
                    }}
                  >
                    <Copy size={16} />
                  </button>
                  {p.kind === 'saved' && (
                    <button aria-label={`Delete ${p.title}`} onClick={() => setDeleting(p.id)}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              <h3>{p.title}</h3>
              <pre>{p.prompt}</pre>
              {deleting === p.id && (
                <div className="delete-confirm">
                  <p>Delete this saved prompt?</p>
                  <button
                    className="btn danger small"
                    onClick={async () => {
                      try {
                        await mutate('DELETE', `/library/${p.id}`);
                        setItems((old) => old.filter((v) => v.id !== p.id));
                        notify('Prompt deleted');
                      } catch (e) {
                        notify((e as Error).message);
                      }
                      setDeleting('');
                    }}
                  >
                    Delete
                  </button>
                  <button className="btn ghost small" onClick={() => setDeleting('')}>
                    Keep it
                  </button>
                </div>
              )}
              <div className="library-meta">
                <BookOpen size={13} />
                {p.kind === 'saved'
                  ? new Date(p.createdAt).toLocaleDateString()
                  : 'Unlocked through practice'}
              </div>
            </article>
          ))}
        </div>
      )}
      {data?.nextCursor && (
        <button
          className="btn secondary load-more"
          disabled={loading}
          onClick={() => setCursor(data.nextCursor)}
        >
          {loading ? 'Loading…' : 'Load more prompts'}
          <ChevronDown size={15} />
        </button>
      )}
    </>
  );
}
