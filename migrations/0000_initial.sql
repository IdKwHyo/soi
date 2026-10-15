CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE memberships (
  user_id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  role TEXT NOT NULL CHECK (role = 'owner')
);
CREATE TABLE workspaces (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  payload TEXT NOT NULL,
  last_mutation TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE records (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL CHECK (kind IN ('dataset','import','memory','run','campaign','result')),
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (business_id, kind, record_id)
);
CREATE INDEX records_business_kind ON records(business_id, kind);
CREATE TABLE mutation_audit (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (business_id, revision)
);
CREATE TABLE model_cache (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  cache_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (business_id, cache_key)
);
