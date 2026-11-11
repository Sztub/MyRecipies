export interface GitHubConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
  /** Optional folder inside the repo; every path passed to the client is relative to it. */
  basePath?: string;
  /** Retry behaviour for rate limits, network failures and 5xx. `false` disables retries. */
  retry?: RetryOptions | false;
}

export interface RetryOptions {
  /** Retries after the first attempt (default 3). */
  maxRetries?: number;
  /** First backoff delay in ms; doubles each retry (default 500). */
  baseDelayMs?: number;
  /** Upper bound for any single wait, including server-provided ones (default 10 000). */
  maxDelayMs?: number;
  /** Randomise each wait between 50 % and 100 % of its value (default true). */
  jitter?: boolean;
}

export type GitHubErrorKind =
  | 'unauthorized'
  | 'token-expired'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'network'
  | 'unknown';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  /** HTTP status, absent for network failures. */
  readonly status?: number;
  /** Seconds until the rate limit resets, when GitHub told us. */
  readonly retryAfter?: number;

  constructor(kind: GitHubErrorKind, message: string, opts: { status?: number; retryAfter?: number } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfter !== undefined) this.retryAfter = opts.retryAfter;
  }
}

export interface RepoPermissions {
  admin?: boolean;
  push?: boolean;
  pull?: boolean;
  [key: string]: boolean | undefined;
}

export interface DirEntry {
  name: string;
  /** Relative to `cfg.basePath`, so it can be passed straight back to getFile. */
  path: string;
  sha: string;
  size: number;
  /** Additive to the contract: 'file' | 'dir' | other GitHub types. */
  type: string;
}

export type TestConnectionResult =
  | { ok: true; permissions: RepoPermissions }
  | { ok: false; error: GitHubError };
