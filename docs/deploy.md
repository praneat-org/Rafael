# Deploy (BE-88 config, BE-71 does the GCP side)

Config only: nothing here has run against GCP yet. Files: `apps/server/Dockerfile`, `cloudbuild.deploy.yaml`.

## What BE-71 must create (per env: dev, prod)

Terraform in `terraform/` (team convention: `module/app` + one folder per env) creates: enabled APIs, service accounts
(`rafael-<env>-cloudbuild`, `rafael-<env>-backend`) and their roles, Artifact Registry repo (`rafael` for dev, `rafael-prod` for prod), Secret Manager
secrets (ids only, no values), the GitHub repo link and the Cloud Build trigger with all substitutions. Cloud Run itself
stays owned by `cloudbuild.deploy.yaml`. Roles: Cloud Build SA = Cloud Run Admin, Artifact Registry Writer, Logs Writer,
Service Account User on the backend SA only; backend SA = Vertex AI User (Gemini for LLM and STT, D22), Secret Accessor.
No Storage roles (D11).

By hand, in this order (dev project `rafael-512903`):

1. State bucket: `gcloud storage buckets create gs://terraform-state-rafael-dev --project=rafael-512903 --location=asia-southeast1 --uniform-bucket-level-access`, then `gcloud storage buckets update gs://terraform-state-rafael-dev --versioning` (recover an overwritten state)
2. Enable the Cloud Build API (`gcloud services enable cloudbuild.googleapis.com secretmanager.googleapis.com --project=rafael-512903`), then Cloud Build > Repositories > 2nd gen > **Create host connection**: GitHub, region `asia-southeast1`, name `rafael-dev-github-connection`, install the Cloud Build GitHub App on `praneat-org/Rafael` (needs a GitHub org admin).
3. OAuth consent screen (Google Auth Platform). prod: **Internal** (workspace praneat.com). dev: **External + Testing**, every tester (Gmail or praneat.com) added under Audience > Test users, because a tester has no praneat.com account; that Gmail also goes in `allowed_emails` (tfvars, ALLOWED_EMAILS, D13 dev-only exception). Scopes exactly `openid email profile` + `https://www.googleapis.com/auth/drive.readonly` (D13), nothing else.
4. OAuth client, type **Chrome Extension**, item ID `cpilkkgdkpjgjdfbicnnjkncjclnfiff` (from the dev `key` in `apps/extension/wxt.config.ts`). Put the client id in `dev.auto.tfvars` (`oauth_client_id`) and in `apps/extension/.env` (`WXT_OAUTH_CLIENT_ID`).
5. Apply:

       cd terraform/dev
       gcloud secrets versions access latest --secret=rafael-dev-infra-tfvars --project=rafael-512903 > dev.auto.tfvars   # after the first apply; first time: write it by hand
       gcloud auth application-default login
       terraform init && terraform apply
       gcloud secrets versions add rafael-dev-infra-tfvars --data-file=dev.auto.tfvars --project=rafael-512903

6. App secrets: none (D22, Gemini via Vertex uses the backend SA). If one is ever needed: add its id to `app_secret_ids`, apply, then `gcloud secrets versions add <ID> --data-file=-`.
7. Prod (BE-127, after Go + DPO): **cutover, not side by side.** `terraform/prod` is ready but not applied. When dev work is done, dev is removed and prod takes its place in the same project `rafael-512903` (second root on the same module). Dev and prod never run together, because the Cloud Build SA roles are project-wide: a `develop` build could otherwise deploy over prod. Locked prod values (a wrong tfvars value fails `terraform plan`): `environment = "prod"`, branch `^main$`, `cloudbuild_approval_required = true`, service `rafael`, repo `rafael-prod`, connection `rafael-prod-github-connection`, `max_instance_count = 1`, `allowed_emails = []`, `stt_end_sensitivity = ""`.
   All commands below run from the repo root.
   0. Before touching dev, check that the consent screen can be **Internal**: Google Auth Platform > Audience must offer "Internal", which needs `rafael-512903` to belong to the praneat.com Workspace organization. If it does not, stop and do not destroy dev: prod needs Internal (BE-127), so ask the org admin to move the project into the praneat.com organization, or plan a separate prod project.
   1. Save the dev tfvars first, it is the base for prod and `terraform destroy` deletes its secret: `gcloud secrets versions access latest --secret=rafael-dev-infra-tfvars --project=rafael-512903 > terraform/dev/dev.auto.tfvars`, check it is not empty (`test -s terraform/dev/dev.auto.tfvars`), then `cp terraform/dev/dev.auto.tfvars terraform/prod/prod.auto.tfvars`. Do not go on if either file is missing. If `app_secret_ids` is not empty (it is empty today, D22), save each secret value too: destroy deletes those secrets with all versions.
   2. Remove dev: `gcloud auth application-default login`, `terraform -chdir=terraform/dev init`, then `terraform -chdir=terraform/dev destroy` (trigger, repo link, SAs, AR repo `rafael`, secrets; APIs stay on). Then delete the dev Cloud Run service, named by `cloud_run_service_name` in the dev tfvars (`rafael-dev` today): `gcloud run services delete rafael-dev --region=asia-southeast1 --project=rafael-512903` (Cloud Run is not in Terraform). Then delete `rafael-dev-github-connection` in the console. Check that the dev trigger is gone: `gcloud builds triggers list --region=asia-southeast1 --project=rafael-512903` shows no `rafael-dev-*`.
   3. State bucket: `gcloud storage buckets create gs://terraform-state-rafael-prod --project=rafael-512903 --location=asia-southeast1 --uniform-bucket-level-access`, then `gcloud storage buckets update gs://terraform-state-rafael-prod --versioning`; and GitHub host connection `rafael-prod-github-connection` (the Cloud Build GitHub App is already installed on the org, pick that installation).
   4. OAuth: consent screen to **Internal** (praneat.com only; the Gmail testers are gone with dev), remove the test users. Extension id: keep the current `key` (same id, reuse the existing OAuth client) for a self-hosted build, or a Web Store item (new id, new OAuth client of type Chrome Extension). Web Store path needs a code change first: `apps/extension/wxt.config.ts` hardcodes the dev `key`, so the store upload must be built without it, and an unpacked prod test build must use the Web Store item's public key instead (otherwise it keeps the dev id and the new OAuth client rejects it).
   5. Edit `terraform/prod/prod.auto.tfvars` (the copy from 7.1): keep `project_id`, set `github_connection_name`, `oauth_client_id` and `allowed_extension_ids` (if the id changed). Remove the lines for `environment`, `cloudbuild_trigger_branch_name`, `cloudbuild_approval_required`, `cloud_run_service_name`, `allowed_emails`, `stt_end_sensitivity` (the prod defaults apply).
   6. `terraform -chdir=terraform/prod init && terraform -chdir=terraform/prod apply`, then `gcloud secrets versions add rafael-prod-infra-tfvars --data-file=terraform/prod/prod.auto.tfvars --project=rafael-512903`, and delete both local tfvars.
   7. First release: `release/x.y.z` PR into `main`, approve the build in Cloud Build, then check that `/api/health` returns 200. URL: `gcloud run services describe rafael --region=asia-southeast1 --project=rafael-512903 --format="value(status.url)"`.
   8. Prod extension build with that URL: `WXT_SERVER_URL=<rafael url> WXT_OAUTH_CLIENT_ID=<client id> pnpm --filter extension build` (production mode: no mock, no localhost). Old dev logs stay in the project until their retention ends (tell the DPO).
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
- Env vars set on deploy: `ALLOWED_EXTENSION_IDS`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, `STT_MODEL`, `STT_LOCATION` (BE-89, empty = no STT), `STT_END_SENSITIVITY` (BE-89, dev only: terraform/dev sets HIGH, default empty), `DETECTOR_MODEL`, `ANSWERER_MODEL` (trigger substitutions from Terraform).
- `--allow-unauthenticated` is required so the extension can reach `/ws`; auth happens in the WS `hello`. Until BE-87 installs the token verifier, the server denies every `hello` on Cloud Run, so only `/api/health` is testable; test WS after BE-87.

## Check on first real deploy

`--startup-probe` / `--liveness-probe` flags in `gcloud run deploy` need a recent gcloud (if the cloud-sdk image rejects them, switch the step to `gcloud beta`). Then: `curl https://<url>/api/health` -> `{"ok":true}`; after BE-87: hold a WS > 60 min or confirm reconnect + resume; QA checks container `/tmp` is empty (BE-96).

## Local image check

    docker build -f apps/server/Dockerfile -t rafael-server .
    docker run --rm -p 8080:8080 rafael-server   # curl localhost:8080/api/health
