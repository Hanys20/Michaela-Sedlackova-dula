-- Spusťte jednou před nasazením ochrany opakovaných rezervací.
-- Existující rezervace zůstávají beze změny; Worker je rozpozná i bez identity.
ALTER TABLE course_registrations ADD COLUMN booking_identity TEXT;
CREATE INDEX IF NOT EXISTS idx_registrations_identity
ON course_registrations(slot_id, booking_identity, created_at);
