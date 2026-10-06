/** Origin of every arc on the globe. */
export const ORIGIN = { name: 'Technická univerzita v Košiciach', city: 'Košice', countryCode: 'SK', lat: 48.7305, lon: 21.2455 } as const;

/** Event slug used by the wall and the guest form when no other event is given. */
export const DEFAULT_EVENT = 'ples-2027';

/** Legend groups of the cooperation dataset. Order = priority when a place belongs to several groups. */
export const CATEGORY_GROUPS = [
  { code: 'agreements', label: 'Ulysseus a zmluvy', color: '#ffffff' },
  { code: 'erasmus', label: 'Erasmus+', color: '#8fb8ff' },
  { code: 'research', label: 'Výskumné projekty', color: '#b79bff' },
  { code: 'publications', label: 'Spoločné publikácie', color: '#5fe3ff' },
  { code: 'other', label: 'Ostatné', color: '#9aa6c8' },
] as const;
export type GroupCode = (typeof CATEGORY_GROUPS)[number]['code'];

/** Cooperation categories produced by the data pipeline (scripts/build_dataset.py). */
export const CATEGORIES = [
  { code: 'alliance', group: 'agreements', label: 'Európska univerzita Ulysseus' },
  { code: 'bilateral_agreement', group: 'agreements', label: 'Zmluva / memorandum o spolupráci' },
  { code: 'double_degree', group: 'agreements', label: 'Dvojitý diplom' },
  { code: 'erasmus_ka171', group: 'agreements', label: 'Erasmus+ mobilita mimo EÚ (KA171)' },
  { code: 'network_membership', group: 'agreements', label: 'Členstvo v medzinárodnej organizácii' },
  { code: 'erasmus_eu', group: 'erasmus', label: 'Erasmus+ bilaterálna zmluva (EÚ/EHP)' },
  { code: 'erasmus_ka2', group: 'erasmus', label: 'Erasmus+ projekt spolupráce (KA2)' },
  { code: 'ceepus', group: 'erasmus', label: 'CEEPUS sieť' },
  { code: 'research_project_eu', group: 'research', label: 'Spoločný projekt EÚ (FP7 / H2020 / Horizon Europe)' },
  { code: 'research_cooperation', group: 'research', label: 'Výskumná spolupráca' },
  { code: 'research_infrastructure', group: 'research', label: 'Veľká výskumná infraštruktúra' },
  { code: 'eit_kic', group: 'research', label: 'EIT znalostné a inovačné spoločenstvo' },
  { code: 'crossborder_project', group: 'research', label: 'Cezhraničný / regionálny projekt' },
  { code: 'bilateral_st_project', group: 'research', label: 'Bilaterálny vedecko-technický projekt' },
  { code: 'cost', group: 'research', label: 'COST akcia' },
  { code: 'industry_partner', group: 'research', label: 'Zahraničný priemyselný partner' },
  { code: 'coauthorship', group: 'publications', label: 'Spoločné vedecké publikácie' },
  { code: 'student_org', group: 'other', label: 'Medzinárodná študentská organizácia' },
  { code: 'other', group: 'other', label: 'Iná spolupráca' },
] as const satisfies readonly { code: string; group: GroupCode; label: string }[];
export type CategoryCode = (typeof CATEGORIES)[number]['code'];

/** What a guest says they did in a place. */
export const VISIT_KINDS = [
  { code: 'erasmus_study', label: 'Erasmus – štúdium' },
  { code: 'erasmus_traineeship', label: 'Erasmus – stáž' },
  { code: 'study_research', label: 'Iné štúdium alebo výskum' },
  { code: 'work', label: 'Práca' },
  { code: 'conference', label: 'Konferencia' },
  { code: 'travel', label: 'Cestovanie' },
] as const;
export type VisitKind = (typeof VISIT_KINDS)[number]['code'];

export const PERSON_ROLES = [
  { code: 'student', label: 'Študent/ka TUKE' },
  { code: 'alumni', label: 'Absolvent/ka' },
  { code: 'staff', label: 'Zamestnanec/kyňa TUKE' },
  { code: 'guest', label: 'Hosť' },
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number]['code'];

export const FACULTIES = [
  { code: 'FBERG', label: 'Fakulta baníctva, ekológie, riadenia a geotechnológií' },
  { code: 'FMMR', label: 'Fakulta materiálov, metalurgie a recyklácie' },
  { code: 'SjF', label: 'Strojnícka fakulta' },
  { code: 'FEI', label: 'Fakulta elektrotechniky a informatiky' },
  { code: 'SvF', label: 'Stavebná fakulta' },
  { code: 'EkF', label: 'Ekonomická fakulta' },
  { code: 'FVT', label: 'Fakulta výrobných technológií' },
  { code: 'FU', label: 'Fakulta umení' },
  { code: 'LF', label: 'Letecká fakulta' },
] as const;
export type FacultyCode = (typeof FACULTIES)[number]['code'];

export const EVENT_STATUSES = ['draft', 'open', 'live', 'closed'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Scenes the wall can show; the operator switches them in /admin. */
export const DISPLAY_SCENES = [
  { code: 'cooperation', label: 'Spolupráca TUKE' },
  { code: 'live', label: 'Svetlá hostí' },
] as const;
export type DisplayScene = (typeof DISPLAY_SCENES)[number]['code'];

/** Limits enforced by the API and shown by the form. */
export const LIMITS = {
  placesPerSubmission: 10,
  submissionsPerDevice10min: 5,
  submissionsPerIp10min: 300, // the venue Wi-Fi puts every guest behind one address
  undoMinutes: 15,
  /** newest lights in the shared, CDN-cached live feed; clients keep their own cursor */
  liveWindow: 60,
  feedbackChars: 2000,
} as const;
