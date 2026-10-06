import type { AdminFeedback, AdminPin, EventInfo, EventPatch, FeedbackInput, GazetteerHit, GlobeResponse, LiveResponse, PinSubmit, PlaceDetail, SubmitResponse, SummaryResponse } from '@ples/shared';
import { deviceId } from './device.ts';

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-device-id', deviceId());
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'offline', 'Server je nedostupný. Skontroluj pripojenie a skús znova.');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? `Chyba ${res.status}`);
  return body as T;
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
