import { z } from 'zod';
import {
  DISPLAY_SCENES, EVENT_STATUSES, FACULTIES, LIMITS, PERSON_ROLES, VISIT_KINDS,
  type DisplayScene, type EventStatus, type GroupCode, type VisitKind,
} from './constants.ts';

const codes = <T extends readonly { code: string }[]>(list: T) => list.map(x => x.code) as unknown as [T[number]['code'], ...T[number]['code'][]];

// ---------- requests

export const PlaceRefSchema = z.union([
  z.object({ geonameId: z.number().int().positive() }),
  z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/) }),
]);
export type PlaceRef = z.infer<typeof PlaceRefSchema>;

export const PinSubmitSchema = z.object({
  code: z.string().trim().max(64).optional(),
  places: z.array(PlaceRefSchema).min(1).max(LIMITS.placesPerSubmission),
  visitKind: z.enum(codes(VISIT_KINDS)),
  role: z.enum(codes(PERSON_ROLES)).optional(),
  faculty: z.enum(codes(FACULTIES)).optional(),
});
export type PinSubmit = z.infer<typeof PinSubmitSchema>;

export const FeedbackSchema = z.object({
  page: z.string().trim().min(1).max(200),
  message: z.string().trim().min(3).max(LIMITS.feedbackChars),
  author: z.string().trim().max(120).optional(),
});
export type FeedbackInput = z.infer<typeof FeedbackSchema>;

export const LoginSchema = z.object({ password: z.string().min(1).max(200) });

export const EventPatchSchema = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  displayScene: z.enum(codes(DISPLAY_SCENES)).optional(),
  /** New access code printed in the QR link; empty string removes the code. */
  code: z.string().trim().max(64).optional(),
});
export type EventPatch = z.infer<typeof EventPatchSchema>;

export const PinPatchSchema = z.object({ status: z.enum(['visible', 'hidden']) });
export const FeedbackPatchSchema = z.object({ status: z.enum(['new', 'accepted', 'rejected', 'done']) });

// ---------- responses

export interface ApiError { error: { code: string; message: string } }

export interface GlobePlace {
  /** Place id of the dataset version (c0001 …), stable between the database and the bundled snapshot. */
  id: string;
  name: string;
  countryCode: string;
  country: string;
  lat: number;
  lon: number;
  distanceKm: number;
  /** Legend groups present in this place, highest priority first. */
  groups: GroupCode[];
  institutions: number;
  links: number;
}

export interface GlobeResponse {
  version: string;
  generated: string;
  source: 'database' | 'snapshot';
  stats: { institutions: number; places: number; countries: number; links: number };
  places: GlobePlace[];
}

export interface PlaceDetail {
  id: string;
  name: string;
  country: string;
  distanceKm: number;
  institutions: {
    name: string;
    links: { category: string; detail: string; tukeUnits: string[]; sourceUrl: string; since: string | null }[];
  }[];
}

export interface GazetteerHit {
  kind: 'city' | 'country';
  geonameId?: number;
  countryCode: string;
  name: string;
  country: string;
  admin1?: string | null;
  lat: number;
  lon: number;
}

export interface EventInfo {
  slug: string;
  name: string;
  status: EventStatus;
  requiresCode: boolean;
  displayScene: DisplayScene;
}

export interface LivePin {
  id: number;
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
  visitKind: VisitKind;
  createdAt: string;
}

export interface LiveTotals { pins: number; places: number; countries: number }

export interface LiveResponse {
  event: EventInfo;
  cursor: number;
  pins: LivePin[];
  totals: LiveTotals;
}

export interface SummaryPlace {
  key: string;
  name: string;
  countryCode: string;
  lat: number;
  lon: number;
  count: number;
  lastPinId: number;
}

export interface SummaryResponse { event: EventInfo; cursor: number; places: SummaryPlace[]; totals: LiveTotals }

export interface SubmitResponse { submissionId: string; pins: LivePin[]; undoUntil: string }

export interface AdminPin extends LivePin { status: 'visible' | 'hidden'; role: string | null; faculty: string | null }
export interface AdminFeedback { id: number; page: string; message: string; author: string | null; status: string; createdAt: string }
