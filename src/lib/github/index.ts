export { getFile, putFile, deleteFile, listDir, testConnection } from './client';
export { GitHubError } from './types';
export type {
  GitHubConfig,
  GitHubErrorKind,
  RetryOptions,
  DirEntry,
  RepoPermissions,
  TestConnectionResult,
} from './types';
