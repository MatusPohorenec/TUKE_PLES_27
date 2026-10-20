-- Initial schema for Microsoft SQL Server 2022 (port of the Postgres schema, tag pred-mssql).
-- Applied by `npm run db:migrate` (packages/db/src/migrations.ts): batches are separated by GO lines,
-- so the file also runs as is in SSMS.
--
-- Conventions
--  - every table lives in dbo: the TUKE login has its own default schema, so names are always qualified
--  - text is NVARCHAR (Slovak diacritics); JSON is NVARCHAR(MAX) guarded by ISJSON
--  - times are UTC in DATETIME2(3), filled by SYSUTCDATETIME()
--  - SQL Server allows only one cascade path into a table, so institutions.import_id and pins.event_id
--    do not cascade: a dataset import is removed through its places, guest lights through their submission

-- ---------------------------------------------------------------- reference data

CREATE TABLE dbo.category_groups (
  code  NVARCHAR(64)  NOT NULL CONSTRAINT category_groups_pkey PRIMARY KEY,
  label NVARCHAR(200) NOT NULL,
  color NVARCHAR(32)  NOT NULL,
  sort  SMALLINT      NOT NULL
);
GO

CREATE TABLE dbo.categories (
  code       NVARCHAR(64)  NOT NULL CONSTRAINT categories_pkey PRIMARY KEY,
  group_code NVARCHAR(64)  NOT NULL CONSTRAINT categories_group_code_fk REFERENCES dbo.category_groups (code),
  label      NVARCHAR(200) NOT NULL,
  sort       SMALLINT      NOT NULL
);
GO

CREATE TABLE dbo.countries (
  code      NCHAR(2)      NOT NULL CONSTRAINT countries_pkey PRIMARY KEY,
  name_sk   NVARCHAR(200) NOT NULL,
  name_en   NVARCHAR(200) NOT NULL,
  continent NCHAR(2)      NULL,
  -- where a "whole country" light lands: the capital
  lat       FLOAT         NULL,
  lon       FLOAT         NULL,
  -- cooperation and guest lights in hidden countries are left off the map (policy decision, see data/README.md)
  is_hidden BIT           NOT NULL CONSTRAINT countries_is_hidden_df DEFAULT 0
);
GO

-- GeoNames cities with 15 000+ inhabitants (CC BY 4.0): the dictionary guests pick places from.
-- search_text = "|name|alternate|…|", lowercase ASCII (normalizeSearch). The binary collation makes
-- LIKE a plain character match: no accent folding and no "ch" digraph rules of national collations.
CREATE TABLE dbo.gazetteer (
  geoname_id   INT            NOT NULL CONSTRAINT gazetteer_pkey PRIMARY KEY,
  name         NVARCHAR(200)  NOT NULL,
  ascii_name   NVARCHAR(200)  NOT NULL,
  country_code NCHAR(2)       NOT NULL CONSTRAINT gazetteer_country_code_fk REFERENCES dbo.countries (code),
  admin1       NVARCHAR(20)   NULL,
  lat          FLOAT          NOT NULL,
  lon          FLOAT          NOT NULL,
  population   INT            NOT NULL CONSTRAINT gazetteer_population_df DEFAULT 0,
  search_text  NVARCHAR(1300) COLLATE Latin1_General_100_BIN2 NOT NULL
);
GO
CREATE INDEX gazetteer_country ON dbo.gazetteer (country_code);
GO

-- ---------------------------------------------------------------- hard facts (dataset)

CREATE TABLE dbo.dataset_imports (
  id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT dataset_imports_pkey PRIMARY KEY,
  -- "generated" date of data/tuke_cooperation.json + first 8 characters of its sha256
  version     NVARCHAR(100) NOT NULL CONSTRAINT dataset_imports_version_unique UNIQUE,
  sha256      NVARCHAR(64)  NOT NULL,
  is_current  BIT           NOT NULL CONSTRAINT dataset_imports_is_current_df DEFAULT 0,
  stats       NVARCHAR(MAX) NOT NULL CONSTRAINT dataset_imports_stats_json CHECK (ISJSON(stats) = 1),
  imported_at DATETIME2(3)  NOT NULL CONSTRAINT dataset_imports_imported_at_df DEFAULT SYSUTCDATETIME()
);
GO

-- A city on the globe: institutions of the dataset clustered within 15 km.
CREATE TABLE dbo.coop_places (
  id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT coop_places_pkey PRIMARY KEY,
  import_id    INT           NOT NULL CONSTRAINT coop_places_import_id_fk REFERENCES dbo.dataset_imports (id) ON DELETE CASCADE,
  ext_id       NVARCHAR(16)  NOT NULL,
  name         NVARCHAR(200) NOT NULL,
  country_code NCHAR(2)      NOT NULL CONSTRAINT coop_places_country_code_fk REFERENCES dbo.countries (code),
  lat          FLOAT         NOT NULL,
  lon          FLOAT         NOT NULL,
  distance_km  INT           NOT NULL
);
GO
CREATE UNIQUE INDEX coop_places_import_ext ON dbo.coop_places (import_id, ext_id);
GO

CREATE TABLE dbo.institutions (
  id           INT IDENTITY(1, 1) NOT NULL CONSTRAINT institutions_pkey PRIMARY KEY,
  import_id    INT           NOT NULL CONSTRAINT institutions_import_id_fk REFERENCES dbo.dataset_imports (id),
  ext_id       NVARCHAR(16)  NOT NULL,
  place_id     INT           NOT NULL CONSTRAINT institutions_place_id_fk REFERENCES dbo.coop_places (id) ON DELETE CASCADE,
  name         NVARCHAR(400) NOT NULL,
  city         NVARCHAR(200) NOT NULL CONSTRAINT institutions_city_df DEFAULT N'',
  country_code NCHAR(2)      NOT NULL CONSTRAINT institutions_country_code_fk REFERENCES dbo.countries (code),
  lat          FLOAT         NOT NULL,
  lon          FLOAT         NOT NULL
);
GO
CREATE UNIQUE INDEX institutions_import_ext ON dbo.institutions (import_id, ext_id);
CREATE INDEX institutions_place ON dbo.institutions (place_id);
GO

-- One documented tie between TUKE and an institution; every row carries its source.
CREATE TABLE dbo.cooperation_links (
  id             INT IDENTITY(1, 1) NOT NULL CONSTRAINT cooperation_links_pkey PRIMARY KEY,
  institution_id INT            NOT NULL CONSTRAINT cooperation_links_institution_id_fk REFERENCES dbo.institutions (id) ON DELETE CASCADE,
  category_code  NVARCHAR(64)   NOT NULL CONSTRAINT cooperation_links_category_code_fk REFERENCES dbo.categories (code),
  -- JSON array of TUKE units (faculties, departments)
  tuke_units     NVARCHAR(MAX)  NOT NULL CONSTRAINT cooperation_links_tuke_units_df DEFAULT N'[]'
                                CONSTRAINT cooperation_links_tuke_units_json CHECK (ISJSON(tuke_units) = 1),
  detail         NVARCHAR(MAX)  NOT NULL CONSTRAINT cooperation_links_detail_df DEFAULT N'',
  since          NVARCHAR(32)   NULL,
  source_url     NVARCHAR(2000) NOT NULL,
  confidence     NVARCHAR(10)   NOT NULL,
  -- nominated_students, nominated_staff, joint_works, projects … as delivered by the pipeline
  metrics        NVARCHAR(MAX)  NOT NULL CONSTRAINT cooperation_links_metrics_df DEFAULT N'{}'
                                CONSTRAINT cooperation_links_metrics_json CHECK (ISJSON(metrics) = 1)
);
GO
CREATE INDEX links_institution ON dbo.cooperation_links (institution_id);
CREATE INDEX links_category ON dbo.cooperation_links (category_code);
GO

-- ---------------------------------------------------------------- live data

CREATE TABLE dbo.events (
  id             INT IDENTITY(1, 1) NOT NULL CONSTRAINT events_pkey PRIMARY KEY,
  slug           NVARCHAR(64)  NOT NULL CONSTRAINT events_slug_unique UNIQUE,
  name           NVARCHAR(200) NOT NULL,
  -- draft: hidden · open: collecting before the ball · live: the ball night · closed: read only
  status         NVARCHAR(16)  NOT NULL CONSTRAINT events_status_df DEFAULT N'draft',
  -- sha256 of the access code from the QR link; NULL = form open without a code
  code_hash      NVARCHAR(64)  NULL,
  display_scene  NVARCHAR(32)  NOT NULL CONSTRAINT events_display_scene_df DEFAULT N'cooperation',
  display_params NVARCHAR(MAX) NOT NULL CONSTRAINT events_display_params_df DEFAULT N'{}'
                               CONSTRAINT events_display_params_json CHECK (ISJSON(display_params) = 1),
  starts_at      DATETIME2(3)  NULL,
  ends_at        DATETIME2(3)  NULL,
  updated_at     DATETIME2(3)  NOT NULL CONSTRAINT events_updated_at_df DEFAULT SYSUTCDATETIME()
);
GO

-- One sent form. Holds the optional facts about the person; no name, no e-mail.
CREATE TABLE dbo.submissions (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT submissions_pkey PRIMARY KEY CONSTRAINT submissions_id_df DEFAULT NEWID(),
  event_id    INT          NOT NULL CONSTRAINT submissions_event_id_fk REFERENCES dbo.events (id) ON DELETE CASCADE,
  -- HMAC of the random id kept in the guest's browser: rate limiting and undo
  device_hash NVARCHAR(64) NOT NULL,
  -- HMAC of IP + day: rate limiting only, cleared after the event
  ip_hash     NVARCHAR(64) NULL,
  person_role NVARCHAR(32) NULL,
  faculty     NVARCHAR(32) NULL,
  created_at  DATETIME2(3) NOT NULL CONSTRAINT submissions_created_at_df DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX submissions_device ON dbo.submissions (event_id, device_hash, created_at);
CREATE INDEX submissions_ip ON dbo.submissions (event_id, ip_hash, created_at);
GO

-- One light on the globe. Coordinates are copied from the gazetteer so the live feed needs no joins.
CREATE TABLE dbo.pins (
  id            INT IDENTITY(1, 1) NOT NULL CONSTRAINT pins_pkey PRIMARY KEY,
  event_id      INT              NOT NULL CONSTRAINT pins_event_id_fk REFERENCES dbo.events (id),
  submission_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT pins_submission_id_fk REFERENCES dbo.submissions (id) ON DELETE CASCADE,
  geoname_id    INT              NULL CONSTRAINT pins_geoname_id_fk REFERENCES dbo.gazetteer (geoname_id),
  country_code  NCHAR(2)         NOT NULL CONSTRAINT pins_country_code_fk REFERENCES dbo.countries (code),
  place_name    NVARCHAR(200)    NOT NULL,
  lat           FLOAT            NOT NULL,
  lon           FLOAT            NOT NULL,
  visit_kind    NVARCHAR(32)     NOT NULL,
  status        NVARCHAR(16)     NOT NULL CONSTRAINT pins_status_df DEFAULT N'visible',
  created_at    DATETIME2(3)     NOT NULL CONSTRAINT pins_created_at_df DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX pins_event_cursor ON dbo.pins (event_id, id);
CREATE INDEX pins_submission ON dbo.pins (submission_id);
GO

-- Comments from reviewers (pripomienky) sent from the prototype.
CREATE TABLE dbo.feedback (
  id         INT IDENTITY(1, 1) NOT NULL CONSTRAINT feedback_pkey PRIMARY KEY,
  page       NVARCHAR(200)  NOT NULL,
  message    NVARCHAR(4000) NOT NULL,
  author     NVARCHAR(200)  NULL,
  status     NVARCHAR(16)   NOT NULL CONSTRAINT feedback_status_df DEFAULT N'new',
  ip_hash    NVARCHAR(64)   NULL,
  created_at DATETIME2(3)   NOT NULL CONSTRAINT feedback_created_at_df DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE dbo.admin_audit (
  id         INT IDENTITY(1, 1) NOT NULL CONSTRAINT admin_audit_pkey PRIMARY KEY,
  -- login_ok, login_fail, event_update, pin_status, feedback_status
  action     NVARCHAR(32)  NOT NULL,
  target     NVARCHAR(200) NULL,
  payload    NVARCHAR(MAX) NULL CONSTRAINT admin_audit_payload_json CHECK (ISJSON(payload) = 1),
  ip_hash    NVARCHAR(64)  NULL,
  created_at DATETIME2(3)  NOT NULL CONSTRAINT admin_audit_created_at_df DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX admin_audit_action_time ON dbo.admin_audit (action, created_at);
GO

-- Values the server creates for itself, e.g. the HMAC secret when SESSION_SECRET is not configured.
CREATE TABLE dbo.app_settings (
  [key]      NVARCHAR(64)  NOT NULL CONSTRAINT app_settings_pkey PRIMARY KEY,
  value      NVARCHAR(MAX) NOT NULL,
  created_at DATETIME2(3)  NOT NULL CONSTRAINT app_settings_created_at_df DEFAULT SYSUTCDATETIME()
);
GO
