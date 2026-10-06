/** Random id of this browser. Lets a guest undo their own lights; the server stores only an HMAC of it. */
const KEY = 'ples-device-id';
let memory: string | undefined;

export function deviceId(): string {
  if (memory) return memory;
  try {
    memory = localStorage.getItem(KEY) ?? undefined;
    if (!memory) { memory = crypto.randomUUID(); localStorage.setItem(KEY, memory); }
  } catch {
    memory ??= crypto.randomUUID(); // private mode: valid for this visit only
  }
  return memory;
}

/** Small JSON value in localStorage that tolerates blocked storage. */
export const store = {
  get<T>(key: string): T | null {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked: nothing to keep */ }
  },
};
