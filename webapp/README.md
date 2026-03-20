## Run locally

```bash
# Run this command in the repository root
docker compose up -d

# Run these commands in the webapp directory
cd webapp
npm ci
npx prisma db push
cp .env.local.example .env.local
# Edit .env.local with values from CDK deploy outputs
npm run dev
```

Open [http://localhost:3010](http://localhost:3010) with your browser to see the result.

## Environment variables

- Runtime env vars (e.g. `USER_POOL_ID`, `COGNITO_DOMAIN`) are set in `.env.local` for local development and injected via CDK `environment` for deployed builds.
- Build-time env vars prefixed with `NEXT_PUBLIC_` must be set as CDK build args in `webapp.ts` — they are baked into the Docker image at build time and cannot be changed at runtime.

See `.env.local.example` for the full list.

## Development guide

See [`AGENTS.md`](../AGENTS.md) in the repository root for authentication patterns, async job setup, DB migration, coding conventions, and constraints.
