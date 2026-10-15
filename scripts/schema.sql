CREATE TABLE IF NOT EXISTS provider_state (
  provider_id text PRIMARY KEY,
  checked_at timestamptz,
  observed_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  message text NOT NULL DEFAULT '',
  rates jsonb NOT NULL DEFAULT '[]',
  lease_until timestamptz
);
CREATE TABLE IF NOT EXISTS observations (
  id bigserial PRIMARY KEY,
  provider_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  rates jsonb NOT NULL,
  source_hash text NOT NULL,
  UNIQUE(provider_id, observed_at)
);
CREATE INDEX IF NOT EXISTS observations_provider_time ON observations(provider_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS source_documents (
  hash text PRIMARY KEY,
  provider_id text NOT NULL,
  source_url text NOT NULL,
  markdown text NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS source_hash text;
ALTER TABLE provider_state ADD COLUMN IF NOT EXISTS parser_version text;
