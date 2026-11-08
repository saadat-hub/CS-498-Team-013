export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
let csrf = '';
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const write = options.method && !['GET', 'HEAD'].includes(options.method);
  if (write && !csrf) await session();
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(write ? { 'X-CSRF-Token': csrf } : {}),
      ...options.headers,
    },
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    if (data?.error?.code === 'csrf_failed' && retry) {
      await session();
      return api(path, options, false);
    }
    throw new ApiError(
      response.status,
      data?.error?.code ?? 'request_failed',
      data?.error?.message ?? 'Something went wrong. Please try again.',
      data?.error?.details,
    );
  }
  return data as T;
}
export async function session(): Promise<{ user: User | null; csrfToken: string }> {
  const data = await api<{ user: User | null; csrfToken: string }>('/auth/session');
  csrf = data.csrfToken;
  return data;
}
export function mutate<T = any>(method: string, path: string, body?: unknown) {
  return api<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export interface User {
  id: string;
  displayName: string;
  email: string;
  handle: string;
  timezone: string;
  role: string;
  leaderboardOptIn: boolean;
}
export interface Configuration {
  catalog?: { challenges: number; levels: number };
  localDevelopment: boolean;
  aiEnabled: boolean;
  oauth: { github: boolean; google: boolean };
}
export interface Level {
  slug: string;
  code: string;
  name: string;
  blurb: string;
  tip: string;
  challengeCount: number;
  me: { status: string; clearedCount: number; pct: number; locked: boolean };
}
export interface ChallengeSummary {
  slug: string;
  code: string;
  title: string;
  brief?: string;
  tags: string[];
  tokenBudget: number;
  xp: number;
  track?: string;
  me?: { status: string; attempts: number };
}
export interface Draft {
  prompt: string;
  rev: number;
  updatedAt: string;
}
export interface Challenge extends ChallengeSummary {
  version: number;
  hint: string;
  level: { slug: string; code: string; name: string };
  context: Record<string, any>;
  runsModel: boolean;
  checks: {
    key: string;
    type: string;
    phase: string;
    label: string;
    config: any;
    required: boolean;
  }[];
  me: {
    status: string;
    attempts: number;
    draft: Draft | null;
    bestTokenCount: number | null;
    locked: boolean;
  };
  next: { slug: string } | null;
}
export interface Grade {
  prompt: string;
  id: string;
  status: string;
  passed: boolean | null;
  tokenCount: number;
  tokenBudget: number;
  tokenCounter: string;
  xpAwarded: number;
  modelOutput: string | null;
  errorCode: string | null;
  checks: {
    key: string;
    label: string;
    passed: boolean;
    message: string | null;
    details?: { skipped?: boolean };
  }[];
  next: { challengeSlug: string } | null;
}
