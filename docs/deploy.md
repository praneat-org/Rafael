# Deploy (BE-88 config, BE-71 does the GCP side)

Config only: nothing here has run against GCP yet. Files: `apps/server/Dockerfile`, `cloudbuild.deploy.yaml`.

## What BE-71 must create (per env: dev, prod)

Terraform in `terraform/` (team convention: `module/app` + one folder per env) creates: enabled APIs, service accounts
(`rafael-<env>-cloudbuild`, `rafael-<env>-backend`) and their roles, Artifact Registry repo `rafael`, Secret Manager
secrets (ids only, no values), the GitHub repo link and the Cloud Build trigger with all substitutions. Cloud Run itself
stays owned by `cloudbuild.deploy.yaml`. Roles: Cloud Build SA = Cloud Run Admin, Artifact Registry Writer, Logs Writer,
Service Account User on the backend SA only; backend SA = Vertex AI User (Gemini for LLM and STT, D22), Secret Accessor.
No Storage roles (D11).

By hand, in this order (dev project `rafael-512903`):

1. State bucket: `gcloud storage buckets create gs://terraform-state-rafael-dev --project=rafael-512903 --location=asia-southeast1 --uniform-bucket-level-access`
2. Enable the Cloud Build API (`gcloud services enable cloudbuild.googleapis.com secretmanager.googleapis.com --project=rafael-512903`), then Cloud Build > Repositories > 2nd gen > **Create host connection**: GitHub, region `asia-southeast1`, name `rafael-dev-github-connection`, install the Cloud Build GitHub App on `praneat-org/Rafael` (needs a GitHub org admin).
3. OAuth consent screen: **Internal** (workspace praneat.com). Scopes exactly `openid email profile` + `https://www.googleapis.com/auth/drive.readonly` (D13), nothing else.
4. OAuth client, type **Chrome Extension**, item ID `cpilkkgdkpjgjdfbicnnjkncjclnfiff` (from the dev `key` in `apps/extension/wxt.config.ts`). Put the client id in `dev.auto.tfvars` (`oauth_client_id`) and in `apps/extension/.env` (`WXT_OAUTH_CLIENT_ID`).
5. Apply:

       cd terraform/dev
       gcloud secrets versions access latest --secret=rafael-dev-infra-tfvars --project=rafael-512903 > dev.auto.tfvars   # after the first apply; first time: write it by hand
       gcloud auth application-default login
       terraform init && terraform apply
       gcloud secrets versions add rafael-dev-infra-tfvars --data-file=dev.auto.tfvars --project=rafael-512903

6. App secrets: none (D22, Gemini via Vertex uses the backend SA). If one is ever needed: add its id to `app_secret_ids`, apply, then `gcloud secrets versions add <ID> --data-file=-`.
7. Prod: copy `terraform/dev` to `terraform/prod` with bucket `terraform-state-rafael-prod`, branch `^main$`, `cloudbuild_approval_required = true`, `cloud_run_service_name = "rafael"`, the prod extension id.
8. Drive MCP registration (Google-hosted, Developer Preview): **optional / deferred**, skip until BE-92 (deferred) is picked up.

If the org policy `iam.allowedPolicyMemberDomains` blocks `allUsers`, `--allow-unauthenticated` fails on deploy: ask the org admin for an exception on this project.

## BE-71: report back when done (comment on BE-71, no secrets)

- project id (dev, prod)
- region
- Artifact Registry repo path (`.../rafael/rafael-server`)
- secret names
- OAuth client id (not a secret)
- Cloud Build trigger names (dev, prod)

## Settings baked into the config

- `--timeout=3600`, `--session-affinity`, `/api/health` startup + liveness probe (D18, no token).
- `_MIN=1 _MAX=1`: **proposal for Q2, not decided.** Override on the trigger if Q2 closes differently.
- Env vars set on deploy: `ALLOWED_EXTENSION_IDS`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `DETECTOR_MODEL`, `ANSWERER_MODEL` (trigger substitutions from Terraform).
- `--allow-unauthenticated` is required so the extension can reach `/ws`; auth happens in the WS `hello`. Until BE-87 installs the token verifier, the server denies every `hello` on Cloud Run, so only `/api/health` is testable; test WS after BE-87.

## Check on first real deploy

`--startup-probe` / `--liveness-probe` flags in `gcloud run deploy` need a recent gcloud (if the cloud-sdk image rejects them, switch the step to `gcloud beta`). Then: `curl https://<url>/api/health` -> `{"ok":true}`; after BE-87: hold a WS > 60 min or confirm reconnect + resume; QA checks container `/tmp` is empty (BE-96).

## Local image check

    docker build -f apps/server/Dockerfile -t rafael-server .
    docker run --rm -p 8080:8080 rafael-server   # curl localhost:8080/api/health
