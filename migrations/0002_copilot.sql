-- Separate bounded queue state; existing analytics workspaces remain unchanged.
CREATE TABLE copilot_workspaces (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  public_key TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  payload TEXT NOT NULL CHECK (length(CAST(payload AS BLOB)) <= 900000),
  updated_at TEXT NOT NULL
);
