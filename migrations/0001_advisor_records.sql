CREATE TABLE records_advisor_new (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL CHECK (kind IN ('dataset','import','memory','run','campaign','result','receipt','receipt-upload')),
  record_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (business_id, kind, record_id)
);
INSERT INTO records_advisor_new(business_id,kind,record_id,revision,payload,created_at)
  SELECT business_id,kind,record_id,revision,payload,created_at FROM records;
DROP TABLE records;
ALTER TABLE records_advisor_new RENAME TO records;
CREATE INDEX records_business_kind ON records(business_id, kind);
