/**
 * Database schema as Kysely types. The tables themselves are created by the SQL migrations in
 * packages/db/migrations (Microsoft SQL Server); names here are the SQL names, so queries read like T-SQL.
 * Two independent parts:
 *  - hard facts (category_groups … cooperation_links): a read-only copy of the versioned dataset in data/,
 *    replaced as a whole by every import; corrections go to the data pipeline, never to these tables
 *  - live data (events … admin_audit): lights added by guests and the operation of the wall
 *
 * Mapping of SQL Server types: BIT -> boolean, FLOAT -> number, DATETIME2 -> Date (UTC),
 * UNIQUEIDENTIFIER -> string, JSON in NVARCHAR(MAX) -> string (see toJson / fromJson).
 */
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';
import type { DisplayScene, EventStatus, FacultyCode, PersonRole, VisitKind } from '@ples/shared';

/** Column filled by a DEFAULT constraint (SYSUTCDATETIME()): optional on insert. */
type CreatedAt = ColumnType<Date, Date | undefined, Date>;
/** JSON text (NVARCHAR(MAX) with an ISJSON check). */
type JsonText = string;

// ---------------------------------------------------------------- reference data

export interface CategoryGroupsTable {
  code: string;
  label: string;
  color: string;
  sort: number;
}

export interface CategoriesTable {
  code: string;
  group_code: string;
  label: string;
  sort: number;
}

export interface CountriesTable {
  code: string;
  name_sk: string;
  name_en: string;
  continent: string | null;
  /** Where a "whole country" light lands: the capital. */
  lat: number | null;
  lon: number | null;
  /** Cooperation and guest lights in hidden countries are left off the map (policy decision, see data/README.md). */
  is_hidden: Generated<boolean>;
}

/** GeoNames cities with 15 000+ inhabitants (CC BY 4.0) – the dictionary guests pick places from. */
export interface GazetteerTable {
  geoname_id: number;
  name: string;
  ascii_name: string;
  country_code: string;
  admin1: string | null;
  lat: number;
  lon: number;
  population: Generated<number>;
  /** "|name|alternate|…|": normalizeSearch() of the name followed by its Latin-script alternate names. */
  search_text: string;
}

// ---------------------------------------------------------------- hard facts (dataset)

export interface DatasetImportsTable {
  id: Generated<number>;
  /** "generated" date of data/tuke_cooperation.json + first 8 characters of its sha256 */
  version: string;
  sha256: string;
  is_current: Generated<boolean>;
  /** Record<string, number | string> */
  stats: JsonText;
  imported_at: CreatedAt;
}

/** A city on the globe: institutions of the dataset clustered within 15 km. */
export interface CoopPlacesTable {
  id: Generated<number>;
  import_id: number;
  ext_id: string;
  name: string;
  country_code: string;
  lat: number;
  lon: number;
  distance_km: number;
}

export interface InstitutionsTable {
  id: Generated<number>;
  import_id: number;
  ext_id: string;
  place_id: number;
  name: string;
  city: Generated<string>;
  country_code: string;
  lat: number;
  lon: number;
}

/** One documented tie between TUKE and an institution; every row carries its source. */
export interface CooperationLinksTable {
  id: Generated<number>;
  institution_id: number;
  category_code: string;
  /** string[] */
  tuke_units: ColumnType<JsonText, JsonText | undefined, JsonText>;
  detail: Generated<string>;
  since: string | null;
  source_url: string;
  confidence: 'high' | 'medium' | 'low';
  /** nominated_students, nominated_staff, joint_works, projects … as delivered by the pipeline */
  metrics: ColumnType<JsonText, JsonText | undefined, JsonText>;
}

// ---------------------------------------------------------------- live data

export interface EventsTable {
  id: Generated<number>;
  slug: string;
  name: string;
  /** draft: off · open: before the ball, only the onboarding · live: the ball night · closed: read only (gateOf) */
  status: ColumnType<EventStatus, EventStatus | undefined, EventStatus>;
  /** sha256 of the access code from the QR link; null = form open without a code */
  code_hash: string | null;
  display_scene: ColumnType<DisplayScene, DisplayScene | undefined, DisplayScene>;
  display_params: ColumnType<JsonText, JsonText | undefined, JsonText>;
  starts_at: Date | null;
  ends_at: Date | null;
  updated_at: CreatedAt;
}

/** One sent form. Holds the optional facts about the person; no name, no e-mail. */
export interface SubmissionsTable {
  id: Generated<string>;
  event_id: number;
  /** HMAC of the random id kept in the guest's browser: rate limiting and undo */
  device_hash: string;
  /** HMAC of IP + day: rate limiting only, cleared after the event */
  ip_hash: string | null;
  person_role: PersonRole | null;
  faculty: FacultyCode | null;
  created_at: CreatedAt;
}

/** One light on the globe. Coordinates are copied from the gazetteer so the live feed needs no joins. */
export interface PinsTable {
  id: Generated<number>;
  event_id: number;
  submission_id: string;
  geoname_id: number | null;
  country_code: string;
  place_name: string;
  lat: number;
  lon: number;
  visit_kind: VisitKind;
  status: ColumnType<'visible' | 'hidden', 'visible' | 'hidden' | undefined, 'visible' | 'hidden'>;
  created_at: CreatedAt;
}

/** Confirmed attendance from /onboarding (personal data, organisers only; not linked to the lights). */
export interface AttendeesTable {
  id: Generated<number>;
  event_id: number;
  full_name: string;
  affiliation: string;
  device_hash: string;
  ip_hash: string | null;
  created_at: CreatedAt;
}

/** Comments from reviewers (pripomienky) sent from the prototype. */
export interface FeedbackTable {
  id: Generated<number>;
  page: string;
  message: string;
  author: string | null;
  status: ColumnType<FeedbackStatus, FeedbackStatus | undefined, FeedbackStatus>;
  ip_hash: string | null;
  created_at: CreatedAt;
}
export type FeedbackStatus = 'new' | 'accepted' | 'rejected' | 'done';

export interface AdminAuditTable {
  id: Generated<number>;
  /** login_ok, login_fail, event_update, pin_status, feedback_status, attendee_delete */
  action: string;
  target: string | null;
  payload: JsonText | null;
  ip_hash: string | null;
  created_at: CreatedAt;
}

/** Values the server creates for itself, e.g. the HMAC secret when SESSION_SECRET is not configured. */
export interface AppSettingsTable {
  key: string;
  value: string;
  created_at: CreatedAt;
}

/** Applied migration files (packages/db/migrations), maintained by runMigrations(). */
export interface SchemaMigrationsTable {
  id: string;
  applied_at: CreatedAt;
}

export interface Database {
  category_groups: CategoryGroupsTable;
  categories: CategoriesTable;
  countries: CountriesTable;
  gazetteer: GazetteerTable;
  dataset_imports: DatasetImportsTable;
  coop_places: CoopPlacesTable;
  institutions: InstitutionsTable;
  cooperation_links: CooperationLinksTable;
  events: EventsTable;
  submissions: SubmissionsTable;
  pins: PinsTable;
  attendees: AttendeesTable;
  feedback: FeedbackTable;
  admin_audit: AdminAuditTable;
  app_settings: AppSettingsTable;
  schema_migrations: SchemaMigrationsTable;
}

export type EventRow = Selectable<EventsTable>;
export type PinRow = Selectable<PinsTable>;
export type NewPin = Insertable<PinsTable>;

/** JSON columns are NVARCHAR(MAX) text. */
export const toJson = (value: unknown): string => JSON.stringify(value ?? null);
export function fromJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}
