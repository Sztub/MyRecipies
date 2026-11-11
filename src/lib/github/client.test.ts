import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { deleteFile, getFile, listDir, putFile, testConnection } from './client';
import { GitHubError, type GitHubConfig, type GitHubErrorKind } from './types';
import { createMockGitHub } from '../../../test/mocks/github';

const TOKEN = 'test-token-abc123';
const gh = createMockGitHub({ token: TOKEN });
const server = setupServer(...gh.handlers);
// Retries are off here so the error-mapping tests see the first failure; the retry suite opts back in.
const cfg: GitHubConfig = { owner: gh.owner, repo: gh.repo, branch: gh.branch, token: TOKEN, retry: false };
const text = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => gh.reset());

async function kindOf(p: Promise<unknown>): Promise<GitHubErrorKind | 'resolved'> {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubError);
    return (e as GitHubError).kind;
  }
}

describe('putFile / getFile', () => {
  it('creates, reads back and updates a file', async () => {
    const { sha } = await putFile(cfg, 'a/b.txt', text('hello'), 'create');
    expect(gh.sha('a/b.txt')).toBe(sha);
    const got = await getFile(cfg, 'a/b.txt');
    expect(got && str(got.content)).toBe('hello');
    expect(got?.sha).toBe(sha);

    const upd = await putFile(cfg, 'a/b.txt', text('v2'), 'update', sha);
    expect(upd.sha).not.toBe(sha);
    expect(gh.readText('a/b.txt')).toBe('v2');
  });

  it('round-trips binary data including all byte values', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    await putFile(cfg, 'bin.enc', bytes, 'bin');
    expect((await getFile(cfg, 'bin.enc'))?.content).toEqual(bytes);
  });

  it('returns null for a missing file', async () => {
    expect(await getFile(cfg, 'nope.txt')).toBeNull();
  });

  it('reads files over 1 MB through the raw media type', async () => {
    const big = new Uint8Array(1024 * 1024 + 10).map((_, i) => i % 251);
    await gh.seed('big.enc', big);
    const got = await getFile(cfg, 'big.enc');
    expect(got?.content).toEqual(big);
    expect(got?.sha).toBe(gh.sha('big.enc'));
    expect(gh.requests.some((r) => r.accept.includes('vnd.github.raw'))).toBe(true);
  });

  it('reads an empty file', async () => {
    await gh.seed('empty', new Uint8Array(0));
    expect((await getFile(cfg, 'empty'))?.content.length).toBe(0);
  });

  it('conflicts when updating without or with a stale sha', async () => {
    const { sha } = await putFile(cfg, 'f', text('1'), 'm');
    expect(await kindOf(putFile(cfg, 'f', text('2'), 'm'))).toBe('conflict');
    await putFile(cfg, 'f', text('2'), 'm', sha);
    expect(await kindOf(putFile(cfg, 'f', text('3'), 'm', sha))).toBe('conflict');
  });

  it('honours basePath', async () => {
    const c = { ...cfg, basePath: 'backup/' };
    await putFile(c, '/x/y.txt', text('z'), 'm');
    expect(gh.paths()).toEqual(['backup/x/y.txt']);
    expect(str((await getFile(c, 'x/y.txt'))!.content)).toBe('z');
  });

  it('encodes unusual path characters', async () => {
    await putFile(cfg, 'dev ices/2024-01-01T10:00:00Z.enc', text('t'), 'm');
    expect(gh.paths()).toEqual(['dev ices/2024-01-01T10:00:00Z.enc']);
  });

  it('sends the token only in the Authorization header', async () => {
    await putFile(cfg, 'f', text('1'), 'm');
    expect(JSON.stringify(gh.requests)).not.toContain(TOKEN);
  });
});

describe('listDir', () => {
  it('lists files and sub-directories', async () => {
    await gh.seed('d/one.enc', 'a');
    await gh.seed('d/two.enc', 'bb');
    await gh.seed('d/sub/three.enc', 'c');
    const list = await listDir(cfg, 'd');
    expect(list.map((e) => e.name).sort()).toEqual(['one.enc', 'sub', 'two.enc']);
    const two = list.find((e) => e.name === 'two.enc')!;
    expect(two).toMatchObject({ path: 'd/two.enc', size: 2, sha: gh.sha('d/two.enc'), type: 'file' });
  });

  it('returns [] for a missing directory', async () => {
    expect(await listDir(cfg, 'missing')).toEqual([]);
  });

  it('returns paths relative to basePath', async () => {
    const c = { ...cfg, basePath: 'root' };
    await gh.seed('root/d/f.enc', 'x');
    expect((await listDir(c, 'd'))[0]?.path).toBe('d/f.enc');
  });

  it('throws when the path is a file', async () => {
    await gh.seed('f', 'x');
    expect(await kindOf(listDir(cfg, 'f'))).toBe('unknown');
  });
});

describe('testConnection', () => {
  it('returns permissions on success', async () => {
    const r = await testConnection(cfg);
    expect(r).toEqual({ ok: true, permissions: { admin: false, push: true, pull: true } });
  });

  it('reports a bad token as unauthorized', async () => {
    const r = await testConnection({ ...cfg, token: 'test-token-wrong' });
    expect(r.ok === false && r.error.kind).toBe('unauthorized');
  });

  it('reports an unknown repo as not-found', async () => {
    gh.injectError({ kind: 'not-found' });
    const r = await testConnection(cfg);
    expect(r.ok === false && r.error.kind).toBe('not-found');
  });

  it('never throws on network failure', async () => {
    gh.injectError({ kind: 'network' });
    const r = await testConnection(cfg);
    expect(r.ok === false && r.error.kind).toBe('network');
  });
});

describe('error mapping', () => {
  const cases: Array<[GitHubErrorKind, number | undefined]> = [
    ['unauthorized', 401],
    ['token-expired', 401],
    ['forbidden', 403],
    ['not-found', 404],
    ['conflict', 409],
    ['rate-limited', 403],
    ['network', undefined],
    ['unknown', 500],
  ];

  for (const [kind, status] of cases) {
    it(`maps ${kind}`, async () => {
      gh.injectError({ kind: kind === 'unknown' ? 'server' : kind, method: 'PUT' });
      let err: unknown;
      try {
        await putFile(cfg, 'f', text('x'), 'm');
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(GitHubError);
      expect((err as GitHubError).kind).toBe(kind);
      expect((err as GitHubError).status).toBe(status);
      expect((err as GitHubError).message).not.toContain(TOKEN);
    });
  }

  it('getFile surfaces non-404 errors', async () => {
    gh.injectError({ kind: 'forbidden', method: 'GET' });
    expect(await kindOf(getFile(cfg, 'f'))).toBe('forbidden');
  });

  it('listDir surfaces errors', async () => {
    gh.injectError({ kind: 'rate-limited' });
    expect(await kindOf(listDir(cfg, 'd'))).toBe('rate-limited');
  });

  it('exposes retryAfter for rate limits', async () => {
    gh.injectError({ kind: 'rate-limited' });
    const err = await putFile(cfg, 'f', text('x'), 'm').catch((e: unknown) => e as GitHubError);
    expect((err as GitHubError).retryAfter).toBeGreaterThan(0);
  });

  it('maps 422 to conflict', async () => {
    await gh.seed('f', 'x');
    const err = await putFile(cfg, 'f', text('y'), 'm').catch((e: unknown) => e as GitHubError);
    expect((err as GitHubError).status).toBe(422);
    expect((err as GitHubError).kind).toBe('conflict');
  });

  it('403 without rate-limit headers is forbidden, not rate-limited', async () => {
    gh.injectError({ kind: 'forbidden' });
    expect(await kindOf(getFile(cfg, 'f'))).toBe('forbidden');
  });
});

describe('mock helpers', () => {
  it('injectError honours times and pathIncludes', async () => {
    gh.injectError({ kind: 'server', times: 2, pathIncludes: 'flaky' });
    expect(await kindOf(getFile(cfg, 'ok'))).toBe('resolved');
    expect(await kindOf(getFile(cfg, 'flaky'))).toBe('unknown');
    expect(await kindOf(getFile(cfg, 'flaky'))).toBe('unknown');
    expect(await kindOf(getFile(cfg, 'flaky'))).toBe('resolved');
  });

  it('setToken simulates revocation', async () => {
    gh.setToken('test-token-rotated');
    expect(await kindOf(getFile(cfg, 'f'))).toBe('unauthorized');
    gh.setToken(TOKEN);
  });
});

describe('deleteFile', () => {
  it('deletes a file with its sha', async () => {
    const { sha } = await putFile(cfg, 'd/x.txt', text('x'), 'create');
    await deleteFile(cfg, 'd/x.txt', sha, 'remove');
    expect(gh.paths()).not.toContain('d/x.txt');
    expect(await getFile(cfg, 'd/x.txt')).toBeNull();
  });

  it('conflicts on a stale sha and keeps the file', async () => {
    await putFile(cfg, 'd/y.txt', text('y'), 'create');
    expect(await kindOf(deleteFile(cfg, 'd/y.txt', 'stale', 'remove'))).toBe('conflict');
    expect(gh.paths()).toContain('d/y.txt');
  });

  it('reports a missing file as not-found', async () => {
    expect(await kindOf(deleteFile(cfg, 'nope.txt', 'abc', 'remove'))).toBe('not-found');
  });

  it('honours basePath', async () => {
    const based = { ...cfg, basePath: 'data' };
    const { sha } = await putFile(based, 'f.txt', text('f'), 'create');
    expect(gh.paths()).toContain('data/f.txt');
    await deleteFile(based, 'f.txt', sha, 'remove');
    expect(gh.paths()).not.toContain('data/f.txt');
  });
});

describe('retry / backoff', () => {
  const fast: GitHubConfig = { ...cfg, retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 5 } };
  const attempts = (method: string) => gh.requests.filter((r) => r.method === method).length;

  it.each(['rate-limited', 'server', 'network'] as const)('retries %s and then succeeds', async (kind) => {
    await gh.seed('r.txt', 'ok');
    gh.injectError({ kind, method: 'GET', times: 2 });
    const got = await getFile(fast, 'r.txt');
    expect(got && str(got.content)).toBe('ok');
    expect(attempts('GET')).toBe(3);
  });

  it('retries writes and deletes too', async () => {
    gh.injectError({ kind: 'server', method: 'PUT', times: 1 });
    const { sha } = await putFile(fast, 'w.txt', text('w'), 'create');
    expect(attempts('PUT')).toBe(2);
    gh.injectError({ kind: 'rate-limited', method: 'DELETE', times: 1 });
    await deleteFile(fast, 'w.txt', sha, 'remove');
    expect(attempts('DELETE')).toBe(2);
    expect(gh.paths()).not.toContain('w.txt');
  });

  it('a PUT that landed but answered 5xx is a success, not a conflict, on the retry', async () => {
    // First PUT is applied by "GitHub" but the client sees a 502; the retry then hits a sha conflict.
    let first = true;
    server.use(
      http.put(/\/contents\//, async ({ request }) => {
        const res = await gh.handle(request);
        if (first && res.ok) {
          first = false;
          return new Response('bad gateway', { status: 502 });
        }
        return res;
      }),
    );
    await gh.seed('u.txt', 'old');
    const before = gh.sha('u.txt');
    const { sha } = await putFile(fast, 'u.txt', text('new'), 'update', before);
    expect(gh.readText('u.txt')).toBe('new');
    expect(sha).toBe(gh.sha('u.txt'));
    expect(attempts('PUT')).toBe(2);
  });

  it('a real conflict (someone else wrote other content) still throws', async () => {
    await gh.seed('c2.txt', 'theirs');
    expect(await kindOf(putFile(fast, 'c2.txt', text('mine'), 'create'))).toBe('conflict');
    expect(gh.readText('c2.txt')).toBe('theirs');
  });

  it('retries listDir', async () => {
    await gh.seed('l/a.txt', 'a');
    gh.injectError({ kind: 'server', method: 'GET', times: 1 });
    expect(await listDir(fast, 'l')).toHaveLength(1);
  });

  it.each(['rate-limited', 'server', 'network'] as const)('gives up on persistent %s after maxRetries', async (kind) => {
    gh.injectError({ kind, method: 'GET', times: Infinity });
    const expected = kind === 'server' ? 'unknown' : kind;
    expect(await kindOf(getFile(fast, 'x.txt'))).toBe(expected);
    expect(attempts('GET')).toBe(4);
  });

  it.each(['unauthorized', 'token-expired', 'forbidden', 'not-found', 'conflict'] as const)(
    'does not retry %s',
    async (kind) => {
      gh.injectError({ kind, method: 'GET', times: 5 });
      await kindOf(listDir(fast, 'x'));
      expect(attempts('GET')).toBe(1);
    },
  );

  it('does not retry a plain 404 or stale-sha conflict', async () => {
    expect(await getFile(fast, 'missing.txt')).toBeNull();
    await gh.seed('c.txt', 'c');
    expect(await kindOf(putFile(fast, 'c.txt', text('c2'), 'u', 'stale'))).toBe('conflict');
    expect(attempts('PUT')).toBe(1);
  });

  it('retry: false disables retries', async () => {
    gh.injectError({ kind: 'server', method: 'GET', times: 1 });
    expect(await kindOf(getFile({ ...cfg, retry: false }, 'x.txt'))).toBe('unknown');
    expect(attempts('GET')).toBe(1);
  });

  it('honours retry-after, capped by maxDelayMs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      await gh.seed('h.txt', 'h');
      gh.injectError({ kind: 'rate-limited', method: 'GET', times: 1, retryAfter: 120 });
      const c: GitHubConfig = { ...cfg, retry: { baseDelayMs: 1, maxDelayMs: 2000, jitter: false } };
      let done = false;
      const p = getFile(c, 'h.txt').then((r) => ((done = true), r));
      await vi.advanceTimersByTimeAsync(1999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await p).not.toBeNull();
      expect(attempts('GET')).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('testConnection does not retry', async () => {
    gh.injectError({ kind: 'server', times: 1 });
    const r = await testConnection(cfg);
    expect(r.ok).toBe(false);
    expect(gh.requests).toHaveLength(1);
  });
});
