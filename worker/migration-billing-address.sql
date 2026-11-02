-- Spusťte jednou nad existující D1 databází před nasazením Workeru.
-- Starší rezervace zachovají všechny údaje a budou mít adresu NULL.
ALTER TABLE course_registrations ADD COLUMN billing_address TEXT;
