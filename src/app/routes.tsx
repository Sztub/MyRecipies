import { Navigate, type RouteObject } from 'react-router-dom';
import { Layout } from './Layout';
import { Placeholder } from './Placeholder';
import {
  EncryptionSettingsPage,
  GitHubSettingsPage,
  PairingSettingsPage,
  SettingsPage,
} from '../features/settings';
import { BackupSettingsPage } from '../features/backup';
import { CookingPage } from '../features/cooking';
import { SyncPage } from '../features/sync';
import { ManagePage, RecipeDetailPage, RecipeFormPage, RecipeListPage } from '../features/recipes';

export const routes: RouteObject[] = [
  // Full-screen cooking mode lives outside Layout, so it has no header or menu.
  { path: '/recipes/:id/cook', element: <CookingPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <RecipeListPage /> },
      { path: '/recipes/new', element: <RecipeFormPage /> },
      { path: '/recipes/:id', element: <RecipeDetailPage /> },
      { path: '/recipes/:id/edit', element: <RecipeFormPage /> },
      { path: '/manage', element: <ManagePage /> },
      { path: '/sync', element: <SyncPage /> },
      // Backup moved under Settings (#71); the old address still works for bookmarks and links.
      { path: '/backup', element: <Navigate to="/settings/backup" replace /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '/settings/github', element: <GitHubSettingsPage /> },
      { path: '/settings/encryption', element: <EncryptionSettingsPage /> },
      { path: '/settings/backup', element: <BackupSettingsPage /> },
      { path: '/settings/pairing', element: <PairingSettingsPage /> },
      { path: '*', element: <Placeholder title="notfound.title" /> },
    ],
  },
];
