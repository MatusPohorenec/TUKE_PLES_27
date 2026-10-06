/**
 * Database schema. Two independent parts:
 *  - hard facts (categories … cooperation_links): a read-only copy of the versioned dataset in data/,
 *    replaced as a whole by every import; corrections go to the data pipeline, never to these tables
 *  - live data (events … admin_audit): lights added by guests and the operation of the wall
 */
import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, char, doublePrecision, index, integer, jsonb, pgTable, serial, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import {
  DISPLAY_SCENES, EVENT_STATUSES, FACULTIES, PERSON_ROLES, VISIT_KINDS,
} from '@ples/shared';

const codes = <T extends readonly { code: string }[]>(list: T) => list.map(x => x.code) as unknown as [T[number]['code'], ...T[number]['code'][]];
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------- reference data

export const categoryGroups = pgTable('category_groups', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  color: text('color').notNull(),
  sort: smallint('sort').notNull(),
});

export const categories = pgTable('categories', {
  code: text('code').primaryKey(),
  groupCode: text('group_code').notNull().references(() => categoryGroups.code),
  label: text('label').notNull(),
  sort: smallint('sort').notNull(),
});

export const countries = pgTable('countries', {
  code: char('code', { length: 2 }).primaryKey(),
  nameSk: text('name_sk').notNull(),
  nameEn: text('name_en').notNull(),
  continent: char('continent', { length: 2 }),
  /** Where a "whole country" light lands: the capital. */
  lat: doublePrecision('lat'),
  lon: doublePrecision('lon'),
  /** Cooperation and guest lights in hidden countries are left off the map (policy decision, see data/README.md). */
  isHidden: boolean('is_hidden').notNull().default(false),
});

/** GeoNames cities with 15 000+ inhabitants (CC BY 4.0) – the dictionary guests pick places from. */
export const gazetteer = pgTable('gazetteer', {
  geonameId: integer('geoname_id').primaryKey(),
  name: text('name').notNull(),
  asciiName: text('ascii_name').notNull(),
  countryCode: char('country_code', { length: 2 }).notNull().references(() => countries.code),
  admin1: text('admin1'),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  population: integer('population').notNull().default(0),
  /** "|name|alternate|…|": normalizeSearch() of the name followed by its Latin-script alternate names. */
  searchText: text('search_text').notNull(),
}, t => [
  index('gazetteer_search_trgm').using('gin', t.searchText.op('gin_trgm_ops')),
  index('gazetteer_country').on(t.countryCode),
]);

// ---------------------------------------------------------------- hard facts (dataset)

export const datasetImports = pgTable('dataset_imports', {
  id: serial('id').primaryKey(),
  /** "generated" date of data/tuke_cooperation.json + first 8 characters of its sha256 */
  version: text('version').notNull().unique(),
  sha256: text('sha256').notNull(),
  isCurrent: boolean('is_current').notNull().default(false),
  stats: jsonb('stats').$type<Record<string, number | string>>().notNull(),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A city on the globe: institutions of the dataset clustered within 15 km. */
export const coopPlaces = pgTable('coop_places', {
  id: serial('id').primaryKey(),
  importId: integer('import_id').notNull().references(() => datasetImports.id, { onDelete: 'cascade' }),
  extId: text('ext_id').notNull(),
  name: text('name').notNull(),
  countryCode: char('country_code', { length: 2 }).notNull().references(() => countries.code),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  distanceKm: integer('distance_km').notNull(),
}, t => [uniqueIndex('coop_places_import_ext').on(t.importId, t.extId)]);

export const institutions = pgTable('institutions', {
  id: serial('id').primaryKey(),
  importId: integer('import_id').notNull().references(() => datasetImports.id, { onDelete: 'cascade' }),
  extId: text('ext_id').notNull(),
  placeId: integer('place_id').notNull().references(() => coopPlaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  city: text('city').notNull().default(''),
  countryCode: char('country_code', { length: 2 }).notNull().references(() => countries.code),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
}, t => [
  uniqueIndex('institutions_import_ext').on(t.importId, t.extId),
  index('institutions_place').on(t.placeId),
]);

/** One documented tie between TUKE and an institution; every row carries its source. */
export const cooperationLinks = pgTable('cooperation_links', {
  id: serial('id').primaryKey(),
  institutionId: integer('institution_id').notNull().references(() => institutions.id, { onDelete: 'cascade' }),
  categoryCode: text('category_code').notNull().references(() => categories.code),
  tukeUnits: text('tuke_units').array().notNull().default(sql`'{}'::text[]`),
  detail: text('detail').notNull().default(''),
  since: text('since'),
  sourceUrl: text('source_url').notNull(),
  confidence: text('confidence', { enum: ['high', 'medium', 'low'] }).notNull(),
  /** nominated_students, nominated_staff, joint_works, projects … as delivered by the pipeline */
  metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
}, t => [
  index('links_institution').on(t.institutionId),
  index('links_category').on(t.categoryCode),
]);

// ---------------------------------------------------------------- live data

export const events = pgTable('events', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  /** draft: hidden · open: collecting before the ball · live: the ball night · closed: read only */
  status: text('status', { enum: EVENT_STATUSES }).notNull().default('draft'),
  /** sha256 of the access code from the QR link; null = form open without a code */
  codeHash: text('code_hash'),
  displayScene: text('display_scene', { enum: codes(DISPLAY_SCENES) }).notNull().default('cooperation'),
  displayParams: jsonb('display_params').$type<Record<string, unknown>>().notNull().default({}),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One sent form. Holds the optional facts about the person; no name, no e-mail. */
export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  /** HMAC of the random id kept in the guest's browser: rate limiting and undo */
  deviceHash: text('device_hash').notNull(),
  /** HMAC of IP + day: rate limiting only, cleared after the event */
  ipHash: text('ip_hash'),
  personRole: text('person_role', { enum: codes(PERSON_ROLES) }),
  faculty: text('faculty', { enum: codes(FACULTIES) }),
  createdAt: createdAt(),
}, t => [
  index('submissions_device').on(t.eventId, t.deviceHash, t.createdAt),
  index('submissions_ip').on(t.eventId, t.ipHash, t.createdAt),
]);

/** One light on the globe. Coordinates are copied from the gazetteer so the live feed needs no joins. */
export const pins = pgTable('pins', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventId: integer('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  geonameId: integer('geoname_id').references(() => gazetteer.geonameId),
  countryCode: char('country_code', { length: 2 }).notNull().references(() => countries.code),
  placeName: text('place_name').notNull(),
  lat: doublePrecision('lat').notNull(),
  lon: doublePrecision('lon').notNull(),
  visitKind: text('visit_kind', { enum: codes(VISIT_KINDS) }).notNull(),
  status: text('status', { enum: ['visible', 'hidden'] }).notNull().default('visible'),
  createdAt: createdAt(),
}, t => [
  index('pins_event_cursor').on(t.eventId, t.id),
  index('pins_submission').on(t.submissionId),
]);

/** Comments from reviewers (pripomienky) sent from the prototype. */
export const feedback = pgTable('feedback', {
  id: serial('id').primaryKey(),
  page: text('page').notNull(),
  message: text('message').notNull(),
  author: text('author'),
  status: text('status', { enum: ['new', 'accepted', 'rejected', 'done'] }).notNull().default('new'),
  ipHash: text('ip_hash'),
  createdAt: createdAt(),
});

export const adminAudit = pgTable('admin_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  /** login_ok, login_fail, event_update, pin_status, feedback_status */
  action: text('action').notNull(),
  target: text('target'),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  ipHash: text('ip_hash'),
  createdAt: createdAt(),
}, t => [index('admin_audit_action_time').on(t.action, t.createdAt)]);

/** Values the server creates for itself, e.g. the HMAC secret when SESSION_SECRET is not configured. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: createdAt(),
});
