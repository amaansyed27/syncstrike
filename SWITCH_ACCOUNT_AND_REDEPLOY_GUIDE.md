# SyncStrike: Switch Account and Redeploy Guide (PowerShell)

Use this guide when billing is disabled on the old account/project and you need to move deployment to a new billed Google account.

This runbook covers:
- Switching GCP and Firebase CLI account context
- Creating a brand new GCP project from PowerShell
- Enabling billing and required APIs
- Attaching Firebase to the new project
- Rebinding Hosting targets
- Redeploying Cloud Run backend + Firebase Hosting frontends

## 1. Prerequisites

Run in PowerShell from repo root:

```powershell
Set-Location "C:\Users\Amaan\Downloads\SyncStrike"
```

Make sure tools are available:

```powershell
gcloud version
npx -y firebase-tools@latest --version
node -v
npm -v
```

## 2. Define Variables (Edit These First)

```powershell
$ACCOUNT_EMAIL = "your-new-billed-account@gmail.com"
$PROJECT_ID = "syncstrike-prod-2"
$PROJECT_NAME = "SyncStrike Prod 2"
$REGION = "asia-south1"
$BILLING_ACCOUNT_ID = "000000-000000-000000"

# Optional if under an org/folder
$ORG_ID = ""
$FOLDER_ID = ""
```

## 3. Login and Switch Active GCP Account

```powershell
gcloud auth login --no-launch-browser
gcloud auth list
gcloud config set account $ACCOUNT_EMAIL
```

## 4. Create New GCP Project from PowerShell

Use one of these commands:

Personal project:

```powershell
gcloud projects create $PROJECT_ID --name="$PROJECT_NAME"
```

Under organization:

```powershell
gcloud projects create $PROJECT_ID --name="$PROJECT_NAME" --organization=$ORG_ID
```

Under folder:

```powershell
gcloud projects create $PROJECT_ID --name="$PROJECT_NAME" --folder=$FOLDER_ID
```

Set active project:

```powershell
gcloud config set project $PROJECT_ID
gcloud config list project
```

If you see this while setting project:

- Listed 0 items from gcloud projects list
- The caller does not have permission

Do this:

1. Do not continue with invalid project set. Type N when prompted.
2. Verify active account:

```powershell
gcloud auth list
gcloud config get-value account
```

3. Re-login with the billed account:

```powershell
gcloud auth login --no-launch-browser
gcloud config set account $ACCOUNT_EMAIL
```

4. Create the project first, then set it:

```powershell
gcloud projects create $PROJECT_ID --name="$PROJECT_NAME"
gcloud config set project $PROJECT_ID
```

5. If project creation fails with permission errors, ask org admin to grant:

- Project Creator (roles/resourcemanager.projectCreator)
- Billing Account User (roles/billing.user)

6. After access is fixed, continue from Step 5.

## 5. Attach Billing and Enable Required APIs

```powershell
gcloud billing accounts list
gcloud beta billing projects link $PROJECT_ID --billing-account=$BILLING_ACCOUNT_ID

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firebase.googleapis.com firestore.googleapis.com
```

## 6. Login Firebase CLI and Attach Firebase to This Project

```powershell
npx -y firebase-tools@latest logout
npx -y firebase-tools@latest login --no-localhost
npx -y firebase-tools@latest projects:addfirebase $PROJECT_ID
npx -y firebase-tools@latest use --add $PROJECT_ID
```

## 7. Create Firebase Hosting Sites (if new project)

```powershell
npx -y firebase-tools@latest hosting:sites:create "$PROJECT_ID"
npx -y firebase-tools@latest hosting:sites:create "$PROJECT_ID-projector"
npx -y firebase-tools@latest hosting:sites:create "$PROJECT_ID-organizer"
```

Bind them to existing targets used by firebase.json:

```powershell
npx -y firebase-tools@latest target:apply hosting participant "$PROJECT_ID"
npx -y firebase-tools@latest target:apply hosting projector "$PROJECT_ID-projector"
npx -y firebase-tools@latest target:apply hosting organizer "$PROJECT_ID-organizer"
```

## 8. Create Service Account for Backend (Recommended)

```powershell
gcloud iam service-accounts create syncstrike-backend-sa --display-name="SyncStrike Backend SA"

gcloud projects add-iam-policy-binding $PROJECT_ID --member="serviceAccount:syncstrike-backend-sa@$PROJECT_ID.iam.gserviceaccount.com" --role="roles/datastore.user"

gcloud iam service-accounts keys create .\syncstrike-backend-sa.json --iam-account="syncstrike-backend-sa@$PROJECT_ID.iam.gserviceaccount.com"
```

Convert key to one-line JSON for env.yaml:

```powershell
$sa = Get-Content .\syncstrike-backend-sa.json -Raw | ConvertFrom-Json | ConvertTo-Json -Compress
$sa
```

## 9. Update env.yaml for New Project

Update these keys in env.yaml:
- REDIS_URL (Upstash URL)
- ADMIN_PASS
- CORS_ORIGINS
- FIREBASE_SERVICE_ACCOUNT (new one-line JSON from above)

Recommended CORS_ORIGINS format:

```text
https://<participant-site>.web.app,https://<projector-site>.web.app,https://<organizer-site>.web.app
```

## 10. Deploy Backend to Cloud Run

```powershell
npm run build --workspace=backend
gcloud run deploy syncstrike-backend --source . --region $REGION --env-vars-file=env.yaml --allow-unauthenticated
```

Get service URL:

```powershell
gcloud run services describe syncstrike-backend --region $REGION --format="value(status.url)"
```

## 11. Set Frontend Backend URL and Build

Set NEXT_PUBLIC_BACKEND_URL in each frontend environment to your new Cloud Run URL.

Then:

```powershell
npm run build --workspaces
```

## 12. Deploy Frontends to Firebase Hosting

```powershell
npx -y firebase-tools@latest deploy --only hosting
```

## 13. Verify Deployment Health

Backend health check:

```powershell
Invoke-RestMethod "https://<your-cloud-run-url>/healthz"
```

Tail logs:

```powershell
gcloud run services logs read syncstrike-backend --region $REGION --limit 100
```

## 14. Quick Recovery Commands

If CLI context gets mixed up:

```powershell
gcloud config set account $ACCOUNT_EMAIL
gcloud config set project $PROJECT_ID
npx -y firebase-tools@latest use $PROJECT_ID
```

## 15. Security Notes

- Do not commit new service account keys or secrets.
- Rotate old credentials from the disabled-billing project if they were ever shared.
- Prefer managed secrets for Cloud Run in long-term production.
