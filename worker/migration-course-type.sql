-- Spusťte jednou nad existující D1 databází před nasazením nové verze Workeru.
-- Dosavadní termíny zůstanou kompletní dvoudenní přípravou.
ALTER TABLE course_slots
ADD COLUMN course_type TEXT NOT NULL DEFAULT 'complete'
CHECK (course_type IN ('complete', 'one_day'));
