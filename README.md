# Superhuman Clone

A Superhuman-style email + calendar app built on **Next.js 14**, **PostgreSQL**, and **[Corsair](https://corsair.dev)** — the integration layer that handles Gmail/Calendar OAuth, token storage, webhooks, and API calls.

---

## Architecture overview

```
Browser (Next.js React)
  │
  ├─ GET /inbox ──────────────────► Email list (Corsair DB cache → fast reads)
  ├─ POST /api/emails ────────────► Send email (Corsair → Gmail API)
  ├─ GET /api/calendar/events ────► List events (Corsair → Google Calendar API)
  ├─ POST /api/chat ──────────────► Streaming agent (Corsair MCP + Anthropic)
  ├─ GET /api/events/stream ──────► SSE for real-time updates (webhooks → SSE)
  │
Corsair (integration layer)
  ├─ OAuth & token storage (encrypted with your KEK)
  ├─ Gmail API proxy (all gmail.api.* calls)
  ├─ Google Calendar API proxy
  ├─ Webhook routing & signature verification
  └─ MCP tools for AI agent
  │
PostgreSQL
  ├─ corsair_* tables (managed by Corsair SDK)
  ├─ emails (local cache + pgvector embeddings)
  ├─ calendar_events (local cache)
  └─ agent_logs, drafts, users
```

---

## Tech stack

| Layer | Tech |
|---|---|
| Framework | Next.js 14 App Router (TypeScript) |
| Integration | Corsair SDK (`@corsair-dev/gmail`, `@corsair-dev/googlecalendar`) |
| Auth | NextAuth.js v4 + Google OAuth |
| Database | PostgreSQL + Drizzle ORM + pgvector |
| AI | Anthropic Claude via `@corsair-dev/mcp` |
| Embeddings | OpenAI `text-embedding-3-small` |
| Styling | Tailwind CSS |
| Data fetching | TanStack React Query |

---

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ with `pgvector` extension
- Google Cloud project with Gmail and Calendar APIs enabled
- Corsair account at [corsair.dev](https://corsair.dev)
- Anthropic API key (for chat agent)
- OpenAI API key (optional, for semantic search + priority classification)

---

## Setup

### 1. Clone and install

```bash
git clone <repo>
cd superhuman-clone
pnpm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/superhuman"

# NextAuth
NEXTAUTH_SECRET="generate-with: openssl rand -base64 32"
NEXTAUTH_URL="http://localhost:3000"

# Google OAuth — create at console.cloud.google.com
# Enable APIs: Gmail API, Google Calendar API
# Create OAuth 2.0 credentials (Web application)
# Authorized redirect URI: http://localhost:3000/api/auth/callback/google
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"

# Corsair — generate with: openssl rand -base64 32
CORSAIR_KEK="your-32-char-key-encryption-key"

NEXT_PUBLIC_APP_URL="http://localhost:3000"

# AI (optional but recommended)
OPENAI_API_KEY="sk-..."    # for semantic search + priority classification
```

### 3. Set up the database

```bash
# Create database
createdb superhuman

# Run the migration (creates all tables including Corsair's)
psql $DATABASE_URL -f drizzle/0001_init.sql
```

### 4. Configure Corsair

Install the CLI and store your Google OAuth credentials:

```bash
pnpm install @corsair-dev/cli -g

# Store Gmail OAuth app credentials (from Google Cloud Console)
npx corsair setup --plugin=gmail \
  client_id=$GOOGLE_CLIENT_ID \
  client_secret=$GOOGLE_CLIENT_SECRET

# Store Google Calendar OAuth app credentials
npx corsair setup --plugin=googlecalendar \
  client_id=$GOOGLE_CLIENT_ID \
  client_secret=$GOOGLE_CLIENT_SECRET
```

### 5. Set up webhooks (dev)

```bash
# Install ngrok
brew install ngrok  # or https://ngrok.com/download

# Expose localhost
ngrok http 3000

# Copy the HTTPS URL (e.g. https://abc123.ngrok.io)
# Update NEXT_PUBLIC_APP_URL in .env.local
# Set webhook URL in Corsair dashboard: https://abc123.ngrok.io/api/webhooks
```

### 6. Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

---

## How Corsair is used

### OAuth flow (multi-tenant)

```
User clicks "Sign in with Google"
  → NextAuth redirects to Google consent
  → Google redirects back with ?code=...
  → NextAuth exchanges code for tokens
  → linkCorsairTenant(userId, { accessToken, refreshToken })
     → corsair.withTenant(userId).gmail.keys.setAccessToken(...)
     → Corsair encrypts and stores in corsair_accounts table
  → All subsequent API calls use stored tokens automatically
```

### Making API calls

```typescript
// Always scoped to a tenant (user) — no cross-contamination
const tenant = getTenant(userId);

// Gmail — Corsair handles auth, token refresh, rate limits
const messages = await tenant.gmail.api.messages.list({ maxResults: 50 });

// Calendar
const events = await tenant.googlecalendar.api.events.getMany({
  timeMin: new Date().toISOString(),
  singleEvents: true,
});

// Corsair also maintains a local DB cache — fast reads without API calls
const cached = await tenant.gmail.db.messages.search({
  data: { subject: { contains: "project" } },
  limit: 20,
});
```

### Webhooks

```
Google pushes notification → Corsair webhook endpoint (/api/webhooks)
  → processWebhook(corsair, headers, body) — verifies signature
  → Corsair updates corsair_entities (local cache)
  → Our webhook handler runs → emits SSE event to browser
  → React Query invalidates cache → inbox/calendar refreshes
```

### MCP Agent

```typescript
// Build Corsair tools for Anthropic
const provider = new AnthropicProvider();
const tools = provider.build({ corsair: corsair.withTenant(userId) });

// The agent gets 4 tools:
// - corsair_setup: check auth status
// - list_operations: discover all Gmail/Calendar endpoints
// - get_schema: inspect parameters
// - run_script: execute API calls
```

---

## Project structure

```
src/
├── env.ts                     # Env validation (fails fast if vars missing)
├── types/index.ts             # Global TypeScript interfaces
├── schemas/index.ts           # All Zod schemas (shared FE + BE)
├── lib/
│   ├── errors.ts              # AppError classes
│   ├── api-response.ts        # Standardised response helpers
│   ├── api-client.ts          # Typed fetch wrapper for frontend
│   └── logger.ts              # Structured logger
├── server/
│   ├── lib/
│   │   ├── corsair.ts         # ← Corsair singleton (start here)
│   │   ├── sse.ts             # Real-time SSE emitter
│   │   └── gmail-parser.ts    # Gmail MIME → typed Email
│   ├── db/
│   │   ├── index.ts           # pg Pool + Drizzle instance
│   │   └── schema/            # Drizzle table definitions
│   ├── auth/
│   │   ├── config.ts          # NextAuth config with Google scopes
│   │   └── auth.service.ts    # User upsert + Corsair tenant linking
│   ├── middleware/
│   │   ├── auth.ts            # withAuth() route wrapper
│   │   └── rate-limit.ts      # Per-user rate limiting
│   ├── services/
│   │   ├── email.service.ts   # Gmail CRUD via Corsair
│   │   ├── calendar.service.ts# Google Calendar CRUD via Corsair
│   │   ├── search.service.ts  # Hybrid text + vector search
│   │   ├── chat.service.ts    # MCP agent via Anthropic + Corsair
│   │   └── priority.service.ts# LLM email classification
│   ├── jobs/
│   │   └── priority-queue.ts  # Background enrichment queue
│   └── webhooks/
│       └── index.ts           # Gmail + Calendar webhook handlers

app/
├── (auth)/login/page.tsx      # Login page
├── (app)/
│   ├── layout.tsx             # App shell + sidebar + SSE
│   ├── inbox/page.tsx         # Inbox list + email detail
│   ├── calendar/page.tsx      # Week view + event creation
│   └── chat/page.tsx          # AI assistant
├── api/
│   ├── auth/[...nextauth]/    # NextAuth handler
│   ├── connect/               # Corsair OAuth URL generator
│   ├── auth/oauth-callback/   # Corsair OAuth callback
│   ├── emails/                # Email CRUD routes
│   ├── drafts/                # Draft management
│   ├── calendar/events/       # Calendar CRUD routes
│   ├── search/                # Hybrid search
│   ├── chat/                  # Streaming agent
│   ├── webhooks/              # Corsair webhook receiver
│   ├── events/stream/         # SSE stream
│   └── health/                # Health check

src/components/
├── compose/compose-modal.tsx  # Compose + autosave + send
├── search/search-command.tsx  # Cmd+K search palette
```

---

## Key design decisions

### Corsair as the integration layer

All Gmail and Calendar API calls go through `corsair.withTenant(userId).*`. This gives us:
- **Encrypted credential storage** — KEK → DEK → token, never plaintext
- **Automatic token refresh** — handled before every API call
- **Local DB cache** — `tenant.gmail.db.messages.search()` for fast reads
- **Webhook routing** — one endpoint, Corsair routes to the right handler
- **MCP tools** — agent gets full API access with 4 standardised tools

### Permission model

```typescript
gmail({
  permissions: {
    mode: "cautious",           // reads + writes: allow; destructive: require_approval
    overrides: {
      "messages.delete": "deny", // hard-block permanent delete
    },
  },
})
```

This prevents the AI agent from accidentally deleting emails even if prompted.

### Hybrid search

1. **Text search** → `tenant.gmail.db.messages.search({ data: { subject: { contains: q } } })` (Corsair local cache, fast)
2. **Semantic search** → OpenAI embeddings stored in `emails.embedding` (pgvector), cosine distance query
3. **Hybrid** → both in parallel, merge + deduplicate

### Real-time updates

```
Corsair receives Google push notification
  → processWebhook() verifies + routes
  → webhookHooks.after() fires → emitToUser(userId, { type: "new_email" })
  → Browser EventSource receives "new_email" event
  → React Query invalidates ["emails"] cache
  → Inbox refreshes without user action
```

---

## Production checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use `HTTPS` for `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL`
- [ ] Replace in-memory rate limiter with Redis (`src/server/middleware/rate-limit.ts`)
- [ ] Replace in-memory SSE emitter with Redis pub/sub (`src/server/lib/sse.ts`)
- [ ] Build pgvector index after initial data: `CREATE INDEX emails_embedding_idx ON emails USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);`
- [ ] Set up Sentry for error monitoring
- [ ] Configure DB connection pooling (PgBouncer)
- [ ] Verify Google OAuth app is published (not in test mode) for production users
- [ ] Keep `CORSAIR_KEK` in a secrets manager — losing it loses all stored credentials

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `C` | Compose |
| `/ ` or `⌘K` | Search |
| `J / K` | Navigate emails |
| `E` | Archive selected |
| `R` | Reply to selected |
| `G → I` | Go to Inbox |
| `G → C` | Go to Calendar |
| `G → A` | Go to Assistant |
| `N` | New event (in calendar) |
| `?` | Toggle shortcuts help |
| `Esc` | Close / Cancel |
| `⌘ + Enter` | Send email |