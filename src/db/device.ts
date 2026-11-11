import { newId } from '../domain/ids';
import { db, onDbReset } from './db';

const DEVICE_ID_KEY = 'deviceId';
let cached: string | undefined;
onDbReset(() => {
  cached = undefined;
});

/** Returns this device's ID, generating and persisting it on first call. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const id = await db.transaction('rw', db.kv, async () => {
    const row = await db.kv.get(DEVICE_ID_KEY);
    if (typeof row?.value === 'string') return row.value;
    const fresh = newId();
    await db.kv.put({ key: DEVICE_ID_KEY, value: fresh });
    return fresh;
  });
  cached = id;
  return id;
}
