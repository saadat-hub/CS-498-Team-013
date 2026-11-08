import { createHash, randomBytes } from 'node:crypto';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export function canonicalJson(value: unknown): string {
  const ordered = (v: any): any =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, ordered(v[k])]),
          )
        : v;
  return JSON.stringify(ordered(value));
}
export const token = () => randomBytes(32).toString('base64url');
export const camel = (o: any): any =>
  Array.isArray(o)
    ? o.map(camel)
    : o instanceof Date
      ? o.toISOString()
      : o && typeof o === 'object'
        ? Object.fromEntries(
            Object.entries(o).map(([k, v]) => [
              k.replace(/_([a-z])/g, (_, x) => x.toUpperCase()),
              camel(v),
            ]),
          )
        : o;
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = {},
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string, details?: unknown): never => {
  throw new AppError(status, code, message, details);
};
