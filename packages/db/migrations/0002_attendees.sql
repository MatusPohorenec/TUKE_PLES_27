-- Confirmed attendance from /onboarding before the ball: a name and an affiliation, seen only by the organisers in
-- /admin. Personal data: the organisers delete it after the ball (/admin). The guest lights stay anonymous and are
-- never linked to these rows.

CREATE TABLE dbo.attendees (
  id          INT IDENTITY(1, 1) NOT NULL CONSTRAINT attendees_pkey PRIMARY KEY,
  event_id    INT           NOT NULL CONSTRAINT attendees_event_id_fk REFERENCES dbo.events (id) ON DELETE CASCADE,
  full_name   NVARCHAR(120) NOT NULL,
  affiliation NVARCHAR(160) NOT NULL,
  -- HMAC of the random id kept in the guest's browser, and of IP + day: rate limiting only
  device_hash NVARCHAR(64)  NOT NULL,
  ip_hash     NVARCHAR(64)  NULL,
  created_at  DATETIME2(3)  NOT NULL CONSTRAINT attendees_created_at_df DEFAULT SYSUTCDATETIME()
);
GO
CREATE INDEX attendees_event_time ON dbo.attendees (event_id, created_at);
CREATE INDEX attendees_device ON dbo.attendees (event_id, device_hash, created_at);
GO
