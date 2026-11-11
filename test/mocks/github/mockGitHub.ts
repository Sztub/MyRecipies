import { http, type HttpHandler } from 'msw';

/**
 * In-memory fake of the GitHub Contents API for one repo/branch.
 *
 *   const gh = createMockGitHub({ token: 'test-token-abc' });
 *   const server = setupServer(...gh.handlers);   // msw/node
 *   gh.seed('keycheck.json', '{}');
 *   gh.injectError({ kind: 'rate-limited', method: 'PUT', times: 1 });
 *
 * For Playwright route mocking, `gh.handle(Request)` is a plain Request -> Response function.
 */

export type MockErrorKind =
  | 'unauthorized'
  | 'token-expired'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'server'
  | 'network';

export interface InjectedError {
  kind: MockErrorKind;
  /** Only match this HTTP method (default: any). */
  method?: string;
  /** Only match when the repo-relative path (or API URL for non-contents calls) contains this. */
  pathIncludes?: string;
  /** How many matching requests to fail; default 1, Infinity = until cleared. */
  times?: number;
  /** Adds a `retry-after` header (seconds) to the injected response. */
  retryAfter?: number;
}

export interface MockRequestLog {
  method: string;
  /** Repo-relative path ('' for the repo root endpoint). Never contains the token. */
  path: string;
  accept: string;
}

export interface MockGitHubOptions {
  owner?: string;
  repo?: string;
  branch?: string;
  /** If set, requests must carry `Bearer <token>`, else 401. */
  token?: string;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
  /** Files larger than this are returned without inline content (like GitHub's 1 MB limit). */
  inlineLimit?: number;
}

const enc = new TextEncoder();

async function blobSha(bytes: Uint8Array): Promise<string> {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s.replace(/\s+/g, ''));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function createMockGitHub(opts: MockGitHubOptions = {}) {
  const owner = opts.owner ?? 'octo';
  const repo = opts.repo ?? 'data';
  const branch = opts.branch ?? 'main';
  const inlineLimit = opts.inlineLimit ?? 1024 * 1024;
  const permissions = opts.permissions ?? { admin: false, push: true, pull: true };
  let token = opts.token;

  const files = new Map<string, { content: Uint8Array; sha: string }>();
  const errors: Array<InjectedError & { left: number }> = [];
  const requests: MockRequestLog[] = [];

  const base = `https://api.github.com/repos/${owner}/${repo}`;

  function takeError(method: string, path: string): InjectedError | null {
    const i = errors.findIndex(
      (e) => (!e.method || e.method.toUpperCase() === method) && (!e.pathIncludes || path.includes(e.pathIncludes)),
    );
    const e = errors[i];
    if (!e) return null;
    e.left -= 1;
    if (e.left <= 0) errors.splice(i, 1);
    return e;
  }

  function errorResponse(kind: MockErrorKind, retryAfter?: number): Response {
    const extra: Record<string, string> = retryAfter === undefined ? {} : { 'retry-after': String(retryAfter) };
    switch (kind) {
      case 'unauthorized':
        return json({ message: 'Bad credentials' }, 401);
      case 'token-expired':
        return json({ message: 'Personal access token expired' }, 401);
      case 'forbidden':
        return json({ message: 'Resource not accessible by personal access token' }, 403);
      case 'not-found':
        return json({ message: 'Not Found' }, 404);
      case 'conflict':
        return json({ message: 'is at a different sha than expected' }, 409);
      case 'rate-limited':
        return json({ message: 'API rate limit exceeded' }, 403, {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
          ...extra,
        });
      case 'server':
        return json({ message: 'Server Error' }, 500, extra);
      case 'network':
        return Response.error();
    }
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const prefix = new URL(base).pathname;
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/^\/+|\/+$/g, '');
    const isContents = rel.startsWith('contents');
    const path = isContents ? rel.slice('contents'.length).replace(/^\/+/, '') : rel;
    const accept = request.headers.get('accept') ?? '';
    requests.push({ method, path, accept });

    const injected = takeError(method, path || url.pathname);
    if (injected) return errorResponse(injected.kind, injected.retryAfter);

    if (token && request.headers.get('authorization') !== `Bearer ${token}`) {
      return errorResponse('unauthorized');
    }

    if (rel === '') return json({ name: repo, full_name: `${owner}/${repo}`, permissions });

    if (!isContents) return json({ message: 'Not Found' }, 404);

    if (url.searchParams.get('ref') && url.searchParams.get('ref') !== branch && method === 'GET') {
      return json({ message: 'No commit found for the ref' }, 404);
    }

    if (method === 'GET') {
      const f = files.get(path);
      if (f) {
        if (accept.includes('vnd.github.raw')) {
          return new Response(f.content as BufferSource, { headers: { 'content-type': 'application/octet-stream' } });
        }
        const big = f.content.length > inlineLimit;
        return json({
          type: 'file',
          name: path.split('/').pop(),
          path,
          sha: f.sha,
          size: f.content.length,
          encoding: big ? 'none' : 'base64',
          content: big ? '' : b64(f.content),
        });
      }
      const dirPrefix = path ? path + '/' : '';
      const children = new Map<string, unknown>();
      for (const [p, file] of files) {
        if (!p.startsWith(dirPrefix)) continue;
        const rest = p.slice(dirPrefix.length);
        const name = rest.split('/')[0] ?? '';
        if (rest.includes('/')) {
          children.set(name, { type: 'dir', name, path: dirPrefix + name, sha: 'tree-' + name, size: 0 });
        } else {
          children.set(name, { type: 'file', name, path: p, sha: file.sha, size: file.content.length });
        }
      }
      if (children.size === 0) return json({ message: 'Not Found' }, 404);
      return json([...children.values()]);
    }

    if (method === 'PUT') {
      const body = (await request.json()) as { message?: string; content?: string; sha?: string; branch?: string };
      if (!body.message || typeof body.content !== 'string') {
        return json({ message: 'Invalid request' }, 422);
      }
      if (body.branch && body.branch !== branch) return json({ message: 'Branch not found' }, 404);
      const existing = files.get(path);
      if (existing && !body.sha) return json({ message: "Invalid request.\n\n\"sha\" wasn't supplied." }, 422);
      if (existing && body.sha !== existing.sha) {
        return json({ message: `${path} does not match ${body.sha}` }, 409);
      }
      if (!existing && body.sha) return json({ message: 'sha supplied but file does not exist' }, 422);
      const content = unb64(body.content);
      const sha = await blobSha(content);
      files.set(path, { content, sha });
      return json({ content: { path, sha, size: content.length }, commit: { message: body.message } }, existing ? 200 : 201);
    }

    if (method === 'DELETE') {
      const body = (await request.json()) as { message?: string; sha?: string; branch?: string };
      if (!body.message || !body.sha) return json({ message: 'Invalid request' }, 422);
      if (body.branch && body.branch !== branch) return json({ message: 'Branch not found' }, 404);
      const existing = files.get(path);
      if (!existing) return json({ message: 'Not Found' }, 404);
      if (body.sha !== existing.sha) return json({ message: `${path} does not match ${body.sha}` }, 409);
      files.delete(path);
      return json({ content: null, commit: { message: body.message } });
    }

    return json({ message: 'Method not allowed' }, 405);
  }

  const handlers: HttpHandler[] = [
    http.all(`${base}`, ({ request }) => handle(request)),
    http.all(`${base}/*`, ({ request }) => handle(request)),
  ];

  return {
    owner,
    repo,
    branch,
    /** MSW handlers: `setupServer(...gh.handlers)`. */
    handlers,
    /** Framework-agnostic handler, e.g. for Playwright `page.route`. */
    handle,
    /** Put a file directly into the fake repo (no auth/error checks). Returns its sha. */
    async seed(path: string, content: Uint8Array | string): Promise<string> {
      const bytes = typeof content === 'string' ? enc.encode(content) : content;
      const sha = await blobSha(bytes);
      files.set(path, { content: bytes, sha });
      return sha;
    },
    /** Raw stored bytes, or undefined. */
    read(path: string): Uint8Array | undefined {
      return files.get(path)?.content;
    },
    readText(path: string): string | undefined {
      const f = files.get(path);
      return f ? new TextDecoder().decode(f.content) : undefined;
    },
    sha(path: string): string | undefined {
      return files.get(path)?.sha;
    },
    paths(): string[] {
      return [...files.keys()].sort();
    },
    /** Device folders under `devices/` – several devices (MSW servers / browser contexts) can share one mock. */
    deviceIds(): string[] {
      const ids = new Set<string>();
      for (const p of files.keys()) {
        const m = /^devices\/([^/]+)\//.exec(p);
        if (m?.[1]) ids.add(m[1]);
      }
      return [...ids].sort();
    },
    remove(path: string): void {
      files.delete(path);
    },
    /** Queue an error for the next matching request(s). */
    injectError(e: InjectedError): void {
      errors.push({ ...e, left: e.times ?? 1 });
    },
    clearErrors(): void {
      errors.length = 0;
    },
    /** Change the accepted token (e.g. simulate revocation) or pass undefined to disable auth. */
    setToken(t: string | undefined): void {
      token = t;
    },
    /** Every request seen so far (method/path/accept only). */
    requests,
    reset(): void {
      files.clear();
      errors.length = 0;
      requests.length = 0;
    },
  };
}

export type MockGitHub = ReturnType<typeof createMockGitHub>;
