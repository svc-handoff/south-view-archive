CREATE SCHEMA IF NOT EXISTS community;

CREATE TABLE community.auth_user (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community.auth_session (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  user_id text NOT NULL REFERENCES community.auth_user(id) ON DELETE CASCADE
);
CREATE INDEX auth_session_user_idx ON community.auth_session(user_id);
CREATE TABLE community.auth_account (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  provider_id text NOT NULL,
  user_id text NOT NULL REFERENCES community.auth_user(id) ON DELETE CASCADE,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_account_user_idx ON community.auth_account(user_id);
CREATE UNIQUE INDEX auth_account_provider_idx ON community.auth_account(provider_id, account_id);
CREATE TABLE community.auth_verification (
  id text PRIMARY KEY,
  identifier text NOT NULL,
  value text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verification_identifier_idx ON community.auth_verification(identifier);
CREATE TABLE community.auth_rate_limit (
  id text PRIMARY KEY,
  key text NOT NULL UNIQUE,
  count integer NOT NULL,
  last_request bigint NOT NULL
);
CREATE TABLE community.reviewers (
  user_id text PRIMARY KEY REFERENCES community.auth_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  granted_by text
);

-- Access is through the server connection, never Supabase's public client API.
REVOKE ALL ON SCHEMA community FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA community FROM PUBLIC;
ALTER TABLE community.auth_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.auth_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.auth_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.auth_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE community.reviewers ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA community FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA community FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA community FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA community FROM authenticated;
  END IF;
END $$;
