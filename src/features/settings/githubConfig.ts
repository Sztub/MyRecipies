import { z } from 'zod';
import { settings } from '../../db';
import type { GitHubConfig } from '../../lib/github';
import type { Envelope } from '../../lib/crypto';
import { openWithDeviceKey, sealWithDeviceKey } from '../../lib/crypto/deviceKey';

export interface GitHubForm {
  owner: string;
  repo: string;
  branch: string;
  basePath: string;
  token: string;
}

export type GitHubFormField = keyof GitHubForm;
export type GitHubFormErrors = Partial<Record<GitHubFormField, 'required' | 'invalid'>>;

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

export function validateGitHubForm(form: GitHubForm): GitHubFormErrors {
  const errors: GitHubFormErrors = {};
  const owner = form.owner.trim();
  const repo = form.repo.trim();
  const branch = form.branch.trim();
  const basePath = form.basePath.trim();
  if (!owner) errors.owner = 'required';
  else if (!NAME_RE.test(owner)) errors.owner = 'invalid';
  if (!repo) errors.repo = 'required';
  else if (!NAME_RE.test(repo)) errors.repo = 'invalid';
  if (!branch) errors.branch = 'required';
  else if (/\s|\.\.|^\/|\/$/.test(branch)) errors.branch = 'invalid';
  if (basePath && (/^\/|\/$|\.\.|\\/.test(basePath) || /\/\//.test(basePath))) errors.basePath = 'invalid';
  if (!form.token.trim()) errors.token = 'required';
  else if (/\s/.test(form.token.trim())) errors.token = 'invalid';
  return errors;
}

export function formToConfig(form: GitHubForm): GitHubConfig {
  const basePath = form.basePath.trim();
  return {
    owner: form.owner.trim(),
    repo: form.repo.trim(),
    branch: form.branch.trim(),
    token: form.token.trim(),
    ...(basePath ? { basePath } : {}),
  };
}

// ---- Token at rest (T23) ----
// The token is stored under the `githubToken` setting as `TOKEN_PREFIX + JSON(Envelope)`, encrypted
// with the per-device key (src/lib/crypto/deviceKey.ts), which is independent of the passphrase key.
// A plain value from before T23 is re-encrypted (and so overwritten) the first time it is read.

/** Marks an encrypted token. GitHub tokens never contain ':', so this can't clash with a plain token. */
export const TOKEN_PREFIX = 'dk1:';
const TOKEN_AAD = 'recipes/github-token/v1';

async function saveToken(token: string): Promise<void> {
  if (!token) {
    await settings.set('githubToken', '');
    return;
  }
  const env = await sealWithDeviceKey(token, TOKEN_AAD);
  await settings.set('githubToken', TOKEN_PREFIX + JSON.stringify(env));
}

/** Returns the decrypted token ('' if none or unreadable), migrating a legacy plain value. */
async function loadToken(): Promise<string> {
  const stored = await settings.get('githubToken');
  if (!stored) return '';
  if (!stored.startsWith(TOKEN_PREFIX)) {
    // Legacy plain value: overwrite it with the encrypted form. If that fails (no Web Crypto),
    // keep working with the plain value and retry on the next load.
    await saveToken(stored).catch(() => undefined);
    return stored;
  }
  try {
    return await openWithDeviceKey(JSON.parse(stored.slice(TOKEN_PREFIX.length)) as Envelope, TOKEN_AAD);
  } catch {
    // Device key gone or value corrupted: never hand out the ciphertext as a token; ask again instead.
    return '';
  }
}

export async function loadGitHubForm(): Promise<GitHubForm> {
  const [owner, repo, branch, basePath, token] = await Promise.all([
    settings.get('githubOwner'),
    settings.get('githubRepo'),
    settings.get('githubBranch'),
    settings.get('githubBasePath'),
    loadToken(),
  ]);
  return {
    owner: owner ?? '',
    repo: repo ?? '',
    branch: branch ?? 'main',
    basePath: basePath ?? '',
    token: token ?? '',
  };
}

export async function saveGitHubForm(form: GitHubForm): Promise<void> {
  const c = formToConfig(form);
  await settings.set('githubOwner', c.owner);
  await settings.set('githubRepo', c.repo);
  await settings.set('githubBranch', c.branch);
  await settings.set('githubBasePath', c.basePath ?? '');
  await saveToken(c.token);
}

/** Saved GitHub config for backup/restore (T09), or null if not (fully) configured. */
export async function getGitHubConfig(): Promise<GitHubConfig | null> {
  const form = await loadGitHubForm();
  if (Object.keys(validateGitHubForm(form)).length > 0) return null;
  return formToConfig(form);
}

// ---- Plain-text config export/import (never contains the token) ----

const configFileSchema = z.object({
  format: z.literal('recipes-settings'),
  version: z.literal(1),
  github: z
    .object({
      owner: z.string().default(''),
      repo: z.string().default(''),
      branch: z.string().default('main'),
      basePath: z.string().default(''),
    })
    .optional(),
  deviceName: z.string().max(100).optional(),
  theme: z.string().min(1).optional(),
  colorMode: z.enum(['system', 'light', 'dark']).optional(),
  /** UI language (#32). Optional so older files still parse. */
  language: z.enum(['pl', 'en']).optional(),
});

export type ConfigFile = z.infer<typeof configFileSchema>;

export function buildConfigFile(input: {
  form: GitHubForm;
  deviceName: string;
  theme: string;
  colorMode: 'system' | 'light' | 'dark';
  language?: 'pl' | 'en';
}): string {
  const { owner, repo, branch, basePath } = input.form; // token is deliberately not copied
  const file: ConfigFile = {
    format: 'recipes-settings',
    version: 1,
    github: { owner, repo, branch, basePath },
    deviceName: input.deviceName,
    theme: input.theme,
    colorMode: input.colorMode,
    ...(input.language ? { language: input.language } : {}),
  };
  return JSON.stringify(file, null, 2);
}

/** Returns the parsed config, or null if the text is not a valid settings file. */
export function parseConfigFile(text: string): ConfigFile | null {
  try {
    const parsed = configFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
