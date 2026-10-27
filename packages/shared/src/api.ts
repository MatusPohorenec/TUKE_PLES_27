import { z } from 'zod';
import {
  DISPLAY_SCENES, EVENT_STATUSES, FACULTIES, LIMITS, PERSON_ROLES, PHOTO_MODES, PHOTO_STATUSES, VISIT_KINDS,
  type DisplayScene, type EventStatus, type GateState, type GroupCode, type PhotoKind, type PhotoMode, type PhotoStatus, type VisitKind,
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

/** Confirmation of attendance before the ball (/onboarding), optionally with a companion. Personal data: organisers only. */
export const AttendeeSchema = z.object({
  name: z.string().trim().min(2).max(LIMITS.attendeeNameChars),
  affiliation: z.string().trim().min(2).max(LIMITS.attendeeAffiliationChars),
  /** name of the person coming along (doprovod) */
  companion: z.string().trim().min(2).max(LIMITS.attendeeNameChars).optional(),
});
export type AttendeeInput = z.infer<typeof AttendeeSchema>;

/**
 * The fields of a photo upload (POST /events/:slug/photos, multipart: `meta` = this as JSON, `photo` and `thumb` =
 * JPEG files). A place photo names one of the guest's own lights; the API copies the place from it.
 */
export const PhotoUploadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('place'), pinId: z.number().int().positive(), code: z.string().trim().max(64).optional() }),
  z.object({ kind: z.literal('ball'), code: z.string().trim().max(64).optional() }),
]);
export type PhotoUpload = z.infer<typeof PhotoUploadSchema>;

export const LoginSchema = z.object({ password: z.string().min(1).max(200) });

export const EventPatchSchema = z.object({
  status: z.enum(EVENT_STATUSES).optional(),
  displayScene: z.enum(codes(DISPLAY_SCENES)).optional(),
  /** New access code printed in the QR link; empty string removes the code. */
  code: z.string().trim().max(64).optional(),
  photos: z.enum(PHOTO_MODES).optional(),
});
export type EventPatch = z.infer<typeof EventPatchSchema>;

export const PinPatchSchema = z.object({ status: z.enum(['visible', 'hidden']) });
export const PhotoPatchSchema = z.object({ status: z.enum(PHOTO_STATUSES) });
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
  /** Year of the earliest dated cooperation here (first joint paper, project start, agreement…); null when no source gives a year. */
  since: number | null;
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
  /** guests' photos: off, review (shown once approved), auto (shown at once) */
  photos: PhotoMode;
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

/**
 * A photo on the wall. Place photos sit at the guest's light (its place, country and what they did there), ball photos
 * at Košice. width/height: of the JPEG, so the wall lays the postcard out before the picture has loaded.
 */
export interface WallPhoto {
  id: string;
  kind: PhotoKind;
  /** the place of the light; for a ball photo the venue's name */
  name: string;
  countryCode: string;
  country: string;
  lat: number;
  lon: number;
  visitKind: VisitKind | null;
  width: number;
  height: number;
  createdAt: string;
  /** when an admin approved it (or it was sent, without review): the wall shows new approvals first */
  approvedAt: string;
}

/** The newest approved photos (LIMITS.photoWindow) and how many are on the wall: a different count makes the wall reload the list. */
export interface PhotoFeed { latest: WallPhoto[]; total: number }

export interface LiveResponse {
  event: EventInfo;
  cursor: number;
  pins: LivePin[];
  totals: LiveTotals;
  photos: PhotoFeed;
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

export interface PhotoUploadResponse { id: string; status: PhotoStatus; undoUntil: string }

export interface AdminPin extends LivePin { status: 'visible' | 'hidden'; role: string | null; faculty: string | null }
export interface AdminPhoto extends Omit<WallPhoto, 'approvedAt'> { status: PhotoStatus; approvedAt: string | null }
export interface AdminFeedback { id: number; page: string; message: string; author: string | null; status: string; createdAt: string }
export interface AdminAttendee { id: number; name: string; affiliation: string; companion: string | null; createdAt: string }

/** GET /api/gate: which pages the venue shows this visitor (gateOf in constants.ts), never cached. */
export interface GateResponse { state: GateState; admin: boolean }
export interface AttendeeResponse { id: number; name: string; companion: string | null }
