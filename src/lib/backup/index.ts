// Backup bundle v1 (T05). `./schema` is safe to import from Node (no browser/Dexie deps).
export {
  parseBundle,
  summarizeBundle,
  bundleSchema,
  bundlePhotoSchema,
  recipeSchema,
  categorySchema,
  tagSchema,
  BundleError,
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  type Bundle,
  type BundlePhoto,
  type BundleSummary,
  type BundleErrorCode,
} from './schema';
export {
  buildBundle,
  bundleFileName,
  bundleToJson,
  APP_VERSION,
  type BuildBundleOptions,
} from './build';
export {
  importBundle,
  type ImportMode,
  type ImportReport,
  type ImportOptions,
  type PhotoResolver,
  type EntityCounts,
} from './import';
export {
  createSafetyExport,
  getSafetyExport,
  SAFETY_EXPORT_KEY,
  type SafetyExport,
} from './safety';
export { saveTextFile, downloadBlob, type SaveResult } from './file';
export { blobToText } from './bytes';
