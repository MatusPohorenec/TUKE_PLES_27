-- Photos from guests (/zapoj-sa): a guest in one of the places they lit, or at the ball right now. The wall shows
-- them as postcards beside their light, once an admin has approved them (or at once, see events.photo_mode).
-- Personal data (faces): seen on the wall and in /admin only, deleted after the ball (/admin). The JPEG bytes live in
-- the database (the API keeps no files): resized in the guest's browser, checked and stripped of metadata (EXIF, GPS)
-- by the API.

-- off: no photos (none sent, none on the wall) · review: on the wall once an admin approved them · auto: at once
ALTER TABLE dbo.events ADD photo_mode NVARCHAR(16) NOT NULL CONSTRAINT events_photo_mode_df DEFAULT N'review';
GO

CREATE TABLE dbo.photos (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT photos_pkey PRIMARY KEY CONSTRAINT photos_id_df DEFAULT NEWID(),
  event_id     INT              NOT NULL CONSTRAINT photos_event_id_fk REFERENCES dbo.events (id) ON DELETE CASCADE,
  -- place: the guest in one of their lit places (place_* copied from that light) · ball: at the ball (Košice)
  kind         NVARCHAR(16)     NOT NULL,
  -- the guest's own light the photo belongs to; no foreign key (SQL Server allows one cascade path): undoing the
  -- light deletes its photos in the API
  pin_id       INT              NULL,
  place_name   NVARCHAR(200)    NULL,
  country_code NCHAR(2)         NULL CONSTRAINT photos_country_code_fk REFERENCES dbo.countries (code),
  lat          FLOAT            NULL,
  lon          FLOAT            NULL,
  visit_kind   NVARCHAR(32)     NULL,
  -- pending: waits for an admin · approved: on the wall · hidden: taken off the wall
  status       NVARCHAR(16)     NOT NULL CONSTRAINT photos_status_df DEFAULT N'pending',
  width        INT              NOT NULL,
  height       INT              NOT NULL,
  -- JPEG of the wall (long side up to LIMITS.photoSide) and a small one for the admin's list
  image        VARBINARY(MAX)   NOT NULL,
  thumb        VARBINARY(MAX)   NOT NULL,
  -- HMAC of the random id kept in the guest's browser, and of IP + day: rate limits and the guest's own undo
  device_hash  NVARCHAR(64)     NOT NULL,
  ip_hash      NVARCHAR(64)     NULL,
  created_at   DATETIME2(3)     NOT NULL CONSTRAINT photos_created_at_df DEFAULT SYSUTCDATETIME(),
  -- when it was approved (the wall shows new approvals first) or hidden
  reviewed_at  DATETIME2(3)     NULL
);
GO
CREATE INDEX photos_wall ON dbo.photos (event_id, status, reviewed_at);
CREATE INDEX photos_device ON dbo.photos (event_id, device_hash, created_at);
CREATE INDEX photos_ip ON dbo.photos (event_id, ip_hash, created_at);
CREATE INDEX photos_pin ON dbo.photos (pin_id);
GO
