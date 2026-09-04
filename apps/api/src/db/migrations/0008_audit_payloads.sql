-- The request and the response behind an audit row.
--
-- A row says what happened in a dozen curated fields. The question it could not answer was "what
-- exactly was sent, and what came back", which is the one a person has when something went wrong.
--
-- Bodies are kept apart from rows because they are the heavy part: a row is a few hundred bytes,
-- a body pair can be a hundred kilobytes, and they roll off on their own, shorter, clock
-- (`retention.audit_payload_days`). A row keeps its `request_id` after the bodies are gone, which
-- is how the screen tells "expired" from "there never was a request".
--
-- Keyed by the request id, which a client may supply (`X-Request-Id`), so the writer inserts with
-- OR IGNORE: the first payload under an id wins and a replayed id cannot overwrite it.
ALTER TABLE audit_logs ADD COLUMN request_id TEXT;
CREATE INDEX audit_logs_request_id ON audit_logs (request_id);

CREATE TABLE audit_payloads (
  request_id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  request TEXT,
  response TEXT,
  request_truncated INTEGER NOT NULL DEFAULT 0,
  response_truncated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX audit_payloads_created_at ON audit_payloads (created_at);
