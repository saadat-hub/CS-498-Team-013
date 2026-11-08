import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  LoaderCircle,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Configuration, type User } from './api';
export const Context = createContext<{
  user: User | null;
  config: Configuration;
  reload: () => Promise<void>;
  notify: (text: string) => void;
}>({
  user: null,
  config: { localDevelopment: false, aiEnabled: false, oauth: { github: false, google: false } },
  reload: async () => {},
  notify: () => {},
});
export function useApp() {
  return useContext(Context);
}
export function useData<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(!!path),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    setData(null);
    if (!path) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, revision]);
  return { data, error, loading, refresh: () => setRevision((n) => n + 1) };
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={23} />
      <span>Getting things ready…</span>
    </div>
  );
}
export function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={20} />
      <div>
        <strong>We couldn’t complete that.</strong>
        <p>{message}</p>
        {retry && (
          <button onClick={retry} className="text-button">
            Try again <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
export function Empty({
  icon = <BookOpen />,
  title,
  text,
  children,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function PageHeading({
  eyebrow,
  title,
  text,
  action,
}: {
  eyebrow: string;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {action}
    </div>
  );
}
export function Brand() {
  return (
    <Link className="brand" to="/">
      <span className="brand-mark">
        <Terminal size={20} />
      </span>
      <span>
        prompt<span className="brand-light">lab</span>
        <span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
export function RequireAccount({
  title = 'Make your progress yours.',
  text = 'Sign in to save your work, earn XP, and pick up where you left off.',
}: {
  title?: string;
  text?: string;
}) {
  return (
    <Empty icon={<ShieldCheck />} title={title} text={text}>
      <Link className="btn primary" to="/signin">
        Sign in to continue <ArrowRight size={16} />
      </Link>
    </Empty>
  );
}
