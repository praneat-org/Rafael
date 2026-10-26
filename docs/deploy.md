# Deploy (BE-88 config, BE-71 does the GCP side)

Config only: nothing here has run against GCP yet. Files: `apps/server/Dockerfile`, `cloudbuild.deploy.yaml`.

## What BE-71 must create (per env: dev, prod)

1. GCP project (dev, prod), region `asia-southeast1`, with these APIs enabled: Cloud Run, Cloud Build, Artifact Registry, Secret Manager, Speech-to-Text v2 (`speech.googleapis.com`), Drive API (`drive.googleapis.com`), Vertex AI (`aiplatform.googleapis.com`, Gemini per D20; the Vertex AI User role does nothing without it).
2. Artifact Registry Docker repo `rafael` in `asia-southeast1` (or change `_REPO`). The image is `rafael-server`, full path `asia-southeast1-docker.pkg.dev/<project>/rafael/rafael-server:<sha>`.
3. Secrets in Secret Manager (create the secret and add a version), names must match `_SECRETS`:
   - `DEEPGRAM_API_KEY`: only if BE-79 picks Deepgram. Chirp 3 uses the service account, no key; then set `_SECRETS=''` on the trigger (the deploy step then passes `--clear-secrets`).
   - No `ANTHROPIC_API_KEY` (BE-71 lists it, D20 replaced it with Vertex AI).
4. Cloud Build service account roles: Cloud Run Admin, Service Account User (on the Cloud Run runtime SA), Artifact Registry Writer, Logs Writer (`roles/logging.logWriter`, needed for `CLOUD_LOGGING_ONLY`). Runtime SA: Secret Manager Secret Accessor on the secrets above, Vertex AI User, Speech client role if Chirp 3. No Storage roles (D11).
5. Trigger dev: GitHub repo praneat-org/Rafael, push to `^develop$`, config `cloudbuild.deploy.yaml`, substitutions `_ALLOWED_EXTENSION_IDS=<dev extension id>`, `_RUNTIME_SA=<runtime SA email>`.
6. Trigger prod: push to `^main$`, same config, **require approval**, substitutions `_SERVICE=rafael`, `_ALLOWED_EXTENSION_IDS=<prod id>`, `_RUNTIME_SA=<runtime SA email>`.
7. OAuth consent screen: **Internal** (workspace praneat.com). Scopes exactly `openid email profile` + `https://www.googleapis.com/auth/drive.readonly` (D13), nothing else.
8. OAuth client, type **Chrome Extension**, with the fixed extension ID derived from the `key` in the extension manifest (FE-34, or generate the key first).
9. Drive MCP registration (Google-hosted, Developer Preview): **optional / deferred**, skip until BE-92 (deferred) is picked up.

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
- Env var is `ALLOWED_EXTENSION_IDS` (per the BE-88 card; read by `apps/server/src/index.ts`).
- `--allow-unauthenticated` is required so the extension can reach `/ws`; auth happens in the WS `hello`. Until BE-87 installs the token verifier, the server denies every `hello` on Cloud Run, so only `/api/health` is testable; test WS after BE-87.

## Check on first real deploy

`--startup-probe` / `--liveness-probe` flags in `gcloud run deploy` need a recent gcloud (if the cloud-sdk image rejects them, switch the step to `gcloud beta`). Then: `curl https://<url>/api/health` -> `{"ok":true}`; after BE-87: hold a WS > 60 min or confirm reconnect + resume; QA checks container `/tmp` is empty (BE-96).

## Local image check

    docker build -f apps/server/Dockerfile -t rafael-server .
    docker run --rm -p 8080:8080 rafael-server   # curl localhost:8080/api/health
