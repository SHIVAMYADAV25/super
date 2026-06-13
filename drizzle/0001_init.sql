-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Corsair tables (run before app tables) ───────────────────────────────────
-- These are managed by Corsair SDK automatically via `corsair migrate`
-- Include here for reference; run `pnpm corsair migrate` in your setup script

CREATE TABLE IF NOT EXISTS corsair_integrations (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    dek TEXT NULL
);

CREATE TABLE IF NOT EXISTS corsair_accounts (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    tenant_id TEXT NOT NULL,
    integration_id TEXT NOT NULL,
    config TEXT NOT NULL,
    dek TEXT NULL,
    FOREIGN KEY (integration_id) REFERENCES corsair_integrations(id)
);

CREATE TABLE IF NOT EXISTS corsair_entities (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    account_id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    version TEXT NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY (account_id) REFERENCES corsair_accounts(id)
);

CREATE TABLE IF NOT EXISTS corsair_events (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    account_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT,
    FOREIGN KEY (account_id) REFERENCES corsair_accounts(id)
);

-- Corsair permissions table (for agent approval flows)
CREATE TABLE IF NOT EXISTS corsair_permissions (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    token TEXT NOT NULL,
    plugin TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    args TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    status TEXT NOT NULL DEFAULT 'pending',
    expires_at TEXT NOT NULL,
    error TEXT NULL
);

-- ─── App tables ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    image TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_id TEXT NOT NULL,
    thread_id TEXT,
    from_addr TEXT,
    to_addrs JSONB NOT NULL DEFAULT '[]',
    cc_addrs JSONB NOT NULL DEFAULT '[]',
    bcc_addrs JSONB NOT NULL DEFAULT '[]',
    subject TEXT,
    snippet TEXT,
    body TEXT,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    labels JSONB NOT NULL DEFAULT '[]',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('high', 'normal', 'low')),
    attachments JSONB NOT NULL DEFAULT '[]',
    embedding vector(1536),
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gmail_draft_id TEXT,
    to_addrs JSONB NOT NULL DEFAULT '[]',
    cc_addrs JSONB NOT NULL DEFAULT '[]',
    subject TEXT,
    body TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    gcal_id TEXT NOT NULL,
    summary TEXT,
    description TEXT,
    location TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    start_time_zone TEXT,
    end_time_zone TEXT,
    attendees JSONB NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'tentative', 'cancelled')),
    html_link TEXT,
    recurring_event_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL,
    response TEXT,
    actions JSONB NOT NULL DEFAULT '[]',
    duration_ms TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- emails: fast lookup by user + time, unique on gmail_id per user
CREATE UNIQUE INDEX IF NOT EXISTS emails_user_gmail_id_unique ON emails(user_id, gmail_id);
CREATE INDEX IF NOT EXISTS emails_user_received ON emails(user_id, received_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS emails_user_thread ON emails(user_id, thread_id);
CREATE INDEX IF NOT EXISTS emails_user_read ON emails(user_id, is_read);

-- pgvector ivfflat index for cosine similarity search
-- NOTE: Build this AFTER you have inserted at least some rows
-- CREATE INDEX IF NOT EXISTS emails_embedding_idx ON emails
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- calendar_events
CREATE UNIQUE INDEX IF NOT EXISTS events_user_gcal_id_unique ON calendar_events(user_id, gcal_id);
CREATE INDEX IF NOT EXISTS events_user_start ON calendar_events(user_id, start_time);

-- agent_logs
CREATE INDEX IF NOT EXISTS agent_logs_user ON agent_logs(user_id, created_at DESC);

-- drafts
CREATE INDEX IF NOT EXISTS drafts_user ON drafts(user_id, updated_at DESC);
