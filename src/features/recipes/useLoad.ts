import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads async data on mount; `reload()` refetches. `data` is undefined while loading. */
export function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(undefined);
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });
  const alive = useRef(true);
  const reload = useCallback(async () => {
    const v = await fnRef.current();
    if (alive.current) setData(v);
  }, []);
  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);
  return { data, reload };
}
