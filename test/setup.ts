import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { resetI18nForTests } from '../src/i18n';

// Component tests are written against the English strings; PL (the app default) is covered in src/i18n.
beforeEach(() => resetI18nForTests('en'));
