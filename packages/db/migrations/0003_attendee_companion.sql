-- A confirmation of attendance may bring a companion (doprovod): the companion's name, seen only by the organisers.

ALTER TABLE dbo.attendees ADD companion_name NVARCHAR(120) NULL;
GO
