// Creates the storage bucket on self-hosted object storage if missing
// (ADR-062). Reads STORAGE_* like the API; does nothing when unset.
//   node scripts/ensure-bucket.mjs
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ObjectStore,
  storageSettings,
} = require('../packages/shared/dist/index.js');

const settings = storageSettings(process.env);
if (!settings) {
  console.log('Storage is not configured; skipping the bucket.');
  process.exit(0);
}
const store = new ObjectStore(settings);
// Storage may still be starting, or its certificate may still be issuing.
for (let attempt = 1; attempt <= 60; attempt += 1) {
  try {
    console.log(`Bucket ${settings.bucket}: ${await store.ensureBucket()}`);
    process.exit(0);
  } catch (error) {
    if (attempt === 60) {
      console.error(`Could not reach storage: ${error.message}`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
