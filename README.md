# SyncStrike

Real-time quiz battleground for Android Club events, built for GeekRush.

Built in under 2 days, battle-tested for live concurrency, and designed to stay stable under pressure.

## Why This Project Is Special

- Real-time buzzer race with Redis-backed ordering.
- Multi-surface experience:
	- Participant app (teams buzz in)
	- Projector app (live queue + scoreboard)
	- Organizer app (control room + judging)
- Scalable backend architecture with Socket.IO, Redis, and Firestore.
- Fast deployment flow using Firebase Hosting + GCP Cloud Run + Upstash Redis.

## Architecture Overview

### Frontend Apps

- Participant: Next.js static export, default local port 3000
- Projector: Next.js static export, default local port 3001
- Organizer: Next.js static export, default local port 3002

### Backend

- Node.js + Express + Socket.IO on Cloud Run (local default port 8080)
- Redis for shared game state, anti-spam counters, leaderboard ordering
- Firebase Firestore for persistent event data

### Shared Types

- Common event/state contracts in packages/shared-types

## Repository Layout

```text
apps/
	backend/
	participant/
	projector/
	organizer/
packages/
	shared-types/
	ui/
assets/
firebase.json
.firebaserc
env.yaml
```

## Prerequisites

- Node.js 18+ and npm
- Firebase CLI
- Google Cloud SDK (gcloud)
- A Firebase project (Firestore + Hosting)
- An Upstash Redis database (TLS endpoint)

Optional for local Redis testing:

- Docker

## Local Development

### 1. Install dependencies

```bash
npm install
```

### 2. Run frontend apps together

```bash
npm run dev
```

This starts:

- participant on 3000
- projector on 3001
- organizer on 3002

### 3. Run full stack (frontend + backend)

```bash
npm run dev:full
```

### 4. Backend environment variables

Set these for backend runtime:

- REDIS_URL
- ADMIN_PASS
- FIREBASE_SERVICE_ACCOUNT (JSON string)

Example local Redis:

```bash
REDIS_URL=redis://localhost:6379
```

### 5. Frontend environment variables

Set per app as needed:

- NEXT_PUBLIC_BACKEND_URL

Organizer additionally uses Firebase web config:

- NEXT_PUBLIC_FIREBASE_API_KEY
- NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
- NEXT_PUBLIC_FIREBASE_PROJECT_ID
- NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
- NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
- NEXT_PUBLIC_FIREBASE_APP_ID

## Deployment Commands (Kept Exactly)

These are your original commands and remain valid in this README:

```bash
npm run build --workspaces
firebase deploy --only hosting
gcloud run deploy syncstrike-backend --source . --region asia-south1 --env-vars-file=env.yaml --allow-unauthenticated
```

## Comprehensive Deployment Guide

## Step 1: Firebase Setup (Firestore + Hosting)

1. Create or open your Firebase project in Firebase Console.
2. Enable Firestore in production mode.
3. Set rules from firestore.rules.
4. Verify Hosting targets in firebase.json and .firebaserc:
	 - participant
	 - projector
	 - organizer

If you need to bind targets manually:

```bash
firebase target:apply hosting participant <participant-site-id>
firebase target:apply hosting projector <projector-site-id>
firebase target:apply hosting organizer <organizer-site-id>
```

## Step 2: Upstash Redis Setup

1. Create a Redis database in Upstash.
2. Copy the TLS connection string from Upstash dashboard.
3. Set REDIS_URL to that value in Cloud Run env (or env.yaml).

Typical Upstash URL format:

```text
rediss://default:<password>@<endpoint>.upstash.io:6379
```

Notes:

- Use rediss for TLS.
- Keep credentials out of source control in production workflows.

## Step 3: Backend Deploy to Google Cloud Run

You are currently using env.yaml with:

- REDIS_URL
- ADMIN_PASS
- FIREBASE_SERVICE_ACCOUNT

Deploy command:

```bash
gcloud run deploy syncstrike-backend --source . --region asia-south1 --env-vars-file=env.yaml --allow-unauthenticated
```

After deploy:

1. Copy the Cloud Run URL.
2. Use it as NEXT_PUBLIC_BACKEND_URL for all frontend apps.
3. Confirm health by opening backend URL and checking logs.

## Step 4: Build and Deploy Frontends to Firebase Hosting

Build all workspaces:

```bash
npm run build --workspaces
```

Deploy hosting targets:

```bash
firebase deploy --only hosting
```

Firebase serves static exports from:

- apps/participant/out
- apps/projector/out
- apps/organizer/out

## Step 5: Production Validation Checklist

- Participant can join with valid team code.
- Organizer can authenticate and control rounds.
- Projector shows live queue and total scoreboard updates.
- New round resets queue for all clients.
- Reaction timings are measured from round start.
- Redis connectivity is stable in Cloud Run logs.

## Reliability and Scalability Notes

- Redis centralizes state so multiple backend instances stay consistent.
- Anti-spam logic blocks repeated buzz abuse per round.
- Socket events broadcast synchronized state to all surfaces.
- Firestore persists questions, teams, and score updates.

## Troubleshooting

### Build fails in monorepo

If npm run build --workspaces fails on a non-critical workspace, build apps directly:

```bash
npm run build --workspace=participant
npm run build --workspace=projector
npm run build --workspace=organizer
npm run build --workspace=backend
```

### Projector/Participant not receiving updates

- Verify NEXT_PUBLIC_BACKEND_URL points to active backend.
- Verify Cloud Run logs show active socket connections.
- Verify REDIS_URL is valid and reachable from backend.

### Firebase deploy succeeds but app looks stale

- Clear browser cache and hard refresh.
- Re-run build, then deploy hosting again.

## Security Reminder

For long-term production hardening, move sensitive values out of committed files and into managed secrets (for example, Cloud Run secrets or CI/CD secret stores).

## Credits

Created for Android Club event GeekRush.

This is a real-world sprint build with serious scale ambitions, fast iteration, and resilient live-event behavior.