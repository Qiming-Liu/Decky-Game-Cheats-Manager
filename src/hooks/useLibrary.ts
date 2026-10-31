import { useCallback, useEffect, useRef, useState } from "react";
import { getLibrary, LibraryResponse } from "../utils/backend";

const listeners = new Set<() => void>();
export const invalidateLibrary = () => listeners.forEach((listener) => listener());

export function useLibrary(appId: string, name: string) {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const response = await getLibrary(appId, name);
      if (request !== sequence.current) return;
      setLibrary(response);
      setError(response.success ? null : response.error || "library_unavailable");
    } catch {
      if (request === sequence.current) {
        setLibrary(null);
        setError("library_unavailable");
      }
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [appId, name]);
  useEffect(() => {
    const invalidate = () => { void refresh(); };
    listeners.add(invalidate);
    invalidate();
    return () => { listeners.delete(invalidate); sequence.current++; };
  }, [refresh]);
  return { library, loading, error, refresh };
}
