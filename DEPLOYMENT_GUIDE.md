# SyncStrike Deployment Guide (GCP & Firebase)

This guide provides a step-by-step walkthrough for deploying SyncStrike to Google Cloud Platform, handling high-concurrency via Cloud Run, Memorystore (Redis), and Firestore.

## 1. Firebase Configuration (Database)
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Create a new project (e.g., `syncstrike-prod`).
3. Navigate to **Firestore Database** -> **Create database**. Start in **Production mode**.
4. Choose a region close to your users (e.g., `us-central1`).
5. To allow the Node.js backend to access Firestore, go to **Project Settings** (the gear icon) -> **Service Accounts**.
6. Click **Generate new private key**. Save the downloaded JSON file.
7. Go to **Project Settings** -> **General** to find your Web App config keys (API Key, Auth Domain, etc.) for the Organizer App.

## 2. GCP Networking & Memorystore (Redis)
Cloud Run instances are stateless and ephemeral. To share the leaderboard and enforce the spam rule across multiple instances, we need a centralized Redis cache. Cloud Run cannot communicate with Memorystore over the public internet, so we must set up a VPC Connector.

### A. Create a Redis Instance
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Navigate to **Memorystore for Redis**.
3. Click **Create Instance**.
4. **Name**: `syncstrike-redis`
5. **Tier**: Standard (Provides high availability, vital for a live event).
6. **Capacity**: 1 GB is more than enough for pure state handling and leaderboard sorting.
7. **Region**: Match your Firestore region (`us-central1`).
8. **Network**: Leave as `default`.
9. Click **Create**. Note the **Primary Endpoint IP** when it finishes.

### B. Create a Serverless VPC Access Connector
1. Navigate to **Serverless VPC Access**.
2. Click **Create Connector**.
3. **Name**: `syncstrike-vpc`
4. **Region**: `us-central1`
5. **Network**: `default`
6. **Subnet**: Custom range (e.g., `10.8.0.0/28`).
7. Click **Create**.

## 3. Deploying the Node.js Backend (Cloud Run)
1. In your local repository, copy the Firebase Service Account JSON contents and minify it into a single line string.
2. Ensure you have the `gcloud` CLI installed and authenticated.
3. Deploy the backend using:
   ```bash
   gcloud run deploy syncstrike-backend \
     --source ./apps/backend \
     --region us-central1 \
     --vpc-connector syncstrike-vpc \
     --set-env-vars="REDIS_URL=redis://<YOUR_REDIS_IP>:6379,ADMIN_PASS=supersecret,FIREBASE_SERVICE_ACCOUNT='{\"type\":\"service_account\",...}'" \
     --allow-unauthenticated
   ```
4. Note the deployed backend URL.

## 4. Deploying the Frontends (Vercel or Cloud Run)
You can deploy the Participant, Projector, and Organizer Next.js apps easily to Vercel or Cloud Run.
Make sure to set the `NEXT_PUBLIC_BACKEND_URL` environment variable to your deployed Cloud Run backend URL.

For the Organizer app, also supply the Firebase config variables:
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
...etc.

## Summary of Data Flow
- Mobile hits -> Cloud Run Backend -> Validated against Redis -> Saved in Redis Sorted Set -> Emitted to Projector WebSockets.
- Organizer hits -> Cloud Run API -> Updates Firestore -> Emits State to WebSockets.
