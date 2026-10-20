import type { AdminFeedback, AdminPin, EventInfo, EventPatch, FeedbackInput, GazetteerHit, GlobeResponse, LiveResponse, PinSubmit, PlaceDetail, SubmitResponse, SummaryResponse } from '@ples/shared';
import { deviceId } from './device.ts';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/**
 * Where the API lives: the same origin (/api, the Vite proxy in development), or another host set at build
 * time, e.g. VITE_API_URL=https://api.srdcom.tuke.sk/api on the TUKE servers. Across hosts the admin cookie
 * needs credentials: 'include' and the API lists this origin in WEB_ORIGIN (CORS).
 */
const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');
const credentials: RequestCredentials = API_URL.startsWith('/') ? 'same-origin' : 'include';

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // only writes need the device id (undo, rate limits); reads stay simple requests without a CORS preflight
  if (init.method && init.method !== 'GET') headers.set('x-device-id', deviceId());
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials });
  } catch {
    throw new ApiError(0, 'offline', 'Server je nedostupný. Skontroluj pripojenie a skús znova.');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? fallbackMessage(res.status, path, init.method ?? 'GET'));
  return body as T;
}

/**
 * IIS on the TUKE server replaces the JSON body of an API error with its own error page (Plesk custom errors);
 * the status and the CORS headers survive. These are the API's own messages, chosen by status and route.
 */
function fallbackMessage(status: number, path: string, method: string): string {
  const login = path === '/admin/login';
  switch (status) {
    case 400: return 'Neplatné údaje. Skús to znova.';
    case 401: return login ? 'Nesprávne heslo.' : 'Prihlás sa.';
    case 403: return 'Na pridanie svetla naskenuj QR kód z plesu.';
    case 404: return method === 'DELETE' ? 'Svetlá sa už nedajú vrátiť.' : 'Nenašlo sa.';
    case 409: return 'Pridávanie svetiel je momentálne zatvorené.';
    case 429: return login ? 'Priveľa pokusov. Skús to o 15 minút.' : 'Veľa požiadaviek naraz. Skús to o pár minút.';
    case 503: return path.startsWith('/admin') ? 'Administrácia nie je zapnutá.' : 'Služba je dočasne nedostupná. Skús to o chvíľu.';
    default: return status >= 500 ? 'Na serveri sa niečo pokazilo. Skús to znova.' : `Chyba ${status}`;
  }
}

export const api = {
  globe: () => request<GlobeResponse>('/globe'),
  place: (id: string) => request<PlaceDetail>(`/globe/places/${encodeURIComponent(id)}`),
  search: (q: string, signal?: AbortSignal) => request<{ query: string; hits: GazetteerHit[] }>(`/gazetteer/search?q=${encodeURIComponent(q)}`, { signal }),
  event: (slug: string) => request<EventInfo>(`/events/${slug}`),
  submit: (slug: string, body: PinSubmit) => request<SubmitResponse>(`/events/${slug}/pins`, { method: 'POST', json: body }),
  undo: (slug: string, submissionId: string) => request<{ ok: true }>(`/events/${slug}/submissions/${submissionId}`, { method: 'DELETE' }),
  live: (slug: string) => request<LiveResponse>(`/events/${slug}/live`),
  summary: (slug: string) => request<SummaryResponse>(`/events/${slug}/summary`),
  feedback: (body: FeedbackInput) => request<{ id: number }>('/feedback', { method: 'POST', json: body }),
  admin: {
    login: (password: string) => request<{ ok: true }>('/admin/login', { method: 'POST', json: { password } }),
    logout: () => request<{ ok: true }>('/admin/logout', { method: 'POST' }),
    me: () => request<{ ok: true }>('/admin/me'),
    event: (slug: string) => request<EventInfo>(`/admin/events/${slug}`),
    patchEvent: (slug: string, patch: EventPatch) => request<EventInfo>(`/admin/events/${slug}`, { method: 'PATCH', json: patch }),
    pins: () => request<{ pins: AdminPin[] }>('/admin/pins?limit=200'),
    patchPin: (id: number, status: 'visible' | 'hidden') => request<{ ok: true }>(`/admin/pins/${id}`, { method: 'PATCH', json: { status } }),
    feedback: () => request<{ feedback: AdminFeedback[] }>('/admin/feedback'),
    patchFeedback: (id: number, status: string) => request<{ ok: true }>(`/admin/feedback/${id}`, { method: 'PATCH', json: { status } }),
  },
};
