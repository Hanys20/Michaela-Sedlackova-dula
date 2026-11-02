CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS course_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_type TEXT NOT NULL DEFAULT 'complete' CHECK (course_type IN ('complete','one_day')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  time_label TEXT,
  address TEXT,
  capacity INTEGER NOT NULL,
  booked_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS course_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id INTEGER NOT NULL REFERENCES course_slots(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  billing_address TEXT,
  attendance_type TEXT NOT NULL CHECK (attendance_type IN ('individual','pair')),
  headcount INTEGER NOT NULL,
  price INTEGER NOT NULL,
  message TEXT,
  qr_token TEXT,
  booking_identity TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_qr_token ON course_registrations(qr_token);
CREATE INDEX IF NOT EXISTS idx_registrations_identity ON course_registrations(slot_id, booking_identity, created_at);
