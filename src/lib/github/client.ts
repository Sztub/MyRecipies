import { base64ToBytes, bytesToBase64 } from './base64';
import {
  GitHubError,
  type DirEntry,
  type GitHubConfig,
  type RepoPermissions,
  type RetryOptions,
  type TestConnectionResult,
} from './types';

const API = 'https://api.github.com';
const JSON_ACCEPT = 'application/vnd.github+json';
const RAW_ACCEPT = 'application/vnd.github.raw';
/** Above this size the JSON response has no inline content; fetch raw instead. */
const INLINE_LIMIT = 1024 * 1024;

function headers(cfg: GitHubConfig, accept: string, json = false): Record<string, string> {
  const h: Record<string, string> = {
    Accept: accept,
    Authorization: `Bearer ${cfg.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

function segments(p: string | undefined): string[] {
  return (p ?? '').split('/').filter(Boolean);
}

function fullPath(cfg: GitHubConfig, path: string): string {
  return [...segments(cfg.basePath), ...segments(path)].join('/');
}

function stripBase(cfg: GitHubConfig, path: string): string {
  const base = segments(cfg.basePath).join('/');
  return base && path.startsWith(base + '/') ? path.slice(base.length + 1) : path;
}

function repoUrl(cfg: GitHubConfig): string {
  return `${API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

function contentsUrl(cfg: GitHubConfig, path: string): string {
  const p = fullPath(cfg, path).split('/').map(encodeURIComponent).join('/');
  return `${repoUrl(cfg)}/contents/${p}`;
}

const DEFAULT_RETRY: Required<RetryOptions> = { maxRetries: 3, baseDelayMs: 500, maxDelayMs: 10_000, jitter: true };

function retryDelay(o: Required<RetryOptions>, attempt: number, retryAfterSec?: number): number {
  const exp = o.baseDelayMs * 2 ** attempt;
  // Honour the server's hint (retry-after / x-ratelimit-reset) when given, but never wait longer than the cap.
  const raw = retryAfterSec !== undefined ? retryAfterSec * 1000 : exp;
  const capped = Math.min(raw, o.maxDelayMs);
  return o.jitter ? capped * (0.5 + Math.random() * 0.5) : capped;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fetch with retry for network errors, 5xx and rate limits. 4xx auth/not-found/conflict are returned
 * immediately for the caller to map. After the retries are used up the last outcome is surfaced as usual.
 */
async function request(cfg: GitHubConfig, url: string, init: RequestInit): Promise<Response> {
  // Under Vitest (MODE === 'test') retries are off unless a test passes `cfg.retry`, so suites in other
  // modules that inject persistent errors don't wait through real backoff delays.
  const disabled = cfg.retry === false || (cfg.retry === undefined && import.meta.env.MODE === 'test');
  const o = disabled ? null : { ...DEFAULT_RETRY, ...cfg.retry };
  for (let attempt = 0; ; attempt++) {
    const canRetry = o !== null && attempt < o.maxRetries;
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      if (!canRetry) {
        // Deliberately drop the underlying error so nothing request-related leaks.
        throw new GitHubError('network', 'Network request to GitHub failed');
      }
      await sleep(retryDelay(o, attempt));
      continue;
    }
    if (res.ok || !canRetry || (res.status < 500 && res.status !== 403 && res.status !== 429)) return res;
    const err = await toGitHubError(res.clone());
    if (err.kind !== 'rate-limited' && res.status < 500) return res;
    await sleep(retryDelay(o, attempt, err.kind === 'rate-limited' ? err.retryAfter : undefined));
  }
}

async function messageOf(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
      return body.message;
    }
  } catch {
    /* body not JSON */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function toGitHubError(res: Response): Promise<GitHubError> {
  const message = await messageOf(res);
  const status = res.status;
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = Number(res.headers.get('x-ratelimit-reset'));
  const retryHeader = Number(res.headers.get('retry-after'));
  let retryAfter: number | undefined;
  if (Number.isFinite(retryHeader) && retryHeader > 0) retryAfter = retryHeader;
  else if (Number.isFinite(reset) && reset > 0) retryAfter = Math.max(0, reset - Math.floor(Date.now() / 1000));
  const rl = retryAfter === undefined ? { status } : { status, retryAfter };

  switch (status) {
    case 401:
      return new GitHubError(/expired/i.test(message) ? 'token-expired' : 'unauthorized', message, { status });
    case 403:
      return remaining === '0' || /rate limit/i.test(message)
        ? new GitHubError('rate-limited', message, rl)
        : new GitHubError('forbidden', message, { status });
    case 429:
      return new GitHubError('rate-limited', message, rl);
    case 404:
      return new GitHubError('not-found', message, { status });
    case 409:
    case 422:
      return new GitHubError('conflict', message, { status });
    default:
      return new GitHubError('unknown', message, { status });
  }
}

interface FileJson {
  type?: string;
  sha?: string;
  size?: number;
  content?: string;
  encoding?: string;
}

/** Returns null when the file does not exist. */
export async function getFile(
  cfg: GitHubConfig,
  path: string,
): Promise<{ content: Uint8Array; sha: string } | null> {
  const url = `${contentsUrl(cfg, path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await request(cfg, url, { headers: headers(cfg, JSON_ACCEPT) });
  if (res.status === 404) return null;
  if (!res.ok) throw await toGitHubError(res);
  const json = (await res.json()) as FileJson | FileJson[];
  if (Array.isArray(json) || json.type !== 'file' || typeof json.sha !== 'string') {
    throw new GitHubError('unknown', 'Path is not a file', { status: res.status });
  }
  const sha = json.sha;
  if (json.size === 0) return { content: new Uint8Array(0), sha };
  if (
    json.encoding === 'base64' &&
    typeof json.content === 'string' &&
    json.content !== '' &&
    (json.size ?? 0) <= INLINE_LIMIT
  ) {
    return { content: base64ToBytes(json.content), sha };
  }
  const raw = await request(cfg, url, { headers: headers(cfg, RAW_ACCEPT) });
  if (raw.status === 404) return null;
  if (!raw.ok) throw await toGitHubError(raw);
  return { content: new Uint8Array(await raw.arrayBuffer()), sha };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Creates or updates a file. Pass the current `sha` to update; omit to create. A conflict is not an error
 * when the file already holds exactly `content` (e.g. our own earlier attempt went through).
 */
export async function putFile(
  cfg: GitHubConfig,
  path: string,
  content: Uint8Array,
  message: string,
  sha?: string,
): Promise<{ sha: string }> {
  const body: Record<string, string> = {
    message,
    content: bytesToBase64(content),
    branch: cfg.branch,
  };
  if (sha) body.sha = sha;
  const res = await request(cfg, contentsUrl(cfg, path), {
    method: 'PUT',
    headers: headers(cfg, JSON_ACCEPT, true),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await toGitHubError(res);
    // A PUT can land on GitHub and still answer 5xx / drop the connection; the automatic retry then gets a
    // sha conflict. If the file now holds exactly what we sent, the write did happen – report success.
    if (err.kind === 'conflict') {
      const current = await getFile(cfg, path).catch(() => null);
      if (current && sameBytes(current.content, content)) return { sha: current.sha };
    }
    throw err;
  }
  const json = (await res.json()) as { content?: { sha?: string } };
  const newSha = json.content?.sha;
  if (typeof newSha !== 'string') {
    throw new GitHubError('unknown', 'Unexpected response from GitHub', { status: res.status });
  }
  return { sha: newSha };
}

/** Deletes a file; `sha` must be the file's current blob sha. */
export async function deleteFile(cfg: GitHubConfig, path: string, sha: string, message: string): Promise<void> {
  const res = await request(cfg, contentsUrl(cfg, path), {
    method: 'DELETE',
    headers: headers(cfg, JSON_ACCEPT, true),
    body: JSON.stringify({ message, sha, branch: cfg.branch }),
  });
  if (!res.ok) throw await toGitHubError(res);
}

/** Lists a directory; a missing directory yields []. */
export async function listDir(cfg: GitHubConfig, path: string): Promise<DirEntry[]> {
  const url = `${contentsUrl(cfg, path)}?ref=${encodeURIComponent(cfg.branch)}`;
  const res = await request(cfg, url, { headers: headers(cfg, JSON_ACCEPT) });
  if (res.status === 404) return [];
  if (!res.ok) throw await toGitHubError(res);
  const json = (await res.json()) as unknown;
  if (!Array.isArray(json)) throw new GitHubError('unknown', 'Path is not a directory', { status: res.status });
  return (json as DirEntry[]).map((e) => ({
    name: e.name,
    path: stripBase(cfg, e.path),
    sha: e.sha,
    size: e.size,
    type: e.type,
  }));
}

/** Never throws; failures come back as `{ ok: false, error }`. */
export async function testConnection(cfg: GitHubConfig): Promise<TestConnectionResult> {
  try {
    const res = await request({ ...cfg, retry: false }, repoUrl(cfg), { headers: headers(cfg, JSON_ACCEPT) });
    if (!res.ok) return { ok: false, error: await toGitHubError(res) };
    const json = (await res.json()) as { permissions?: RepoPermissions };
    return { ok: true, permissions: json.permissions ?? {} };
  } catch (e) {
    return { ok: false, error: e instanceof GitHubError ? e : new GitHubError('unknown', 'Unexpected error') };
  }
}
