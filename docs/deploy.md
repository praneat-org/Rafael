# Deploy (BE-88 config, BE-71 does the GCP side)

Config only: nothing here has run against GCP yet. Files: `apps/server/Dockerfile`, `cloudbuild.deploy.yaml`.

## What BE-71 must create (per env: dev, prod)

1. GCP project (dev, prod) with APIs enabled: Cloud Run, Cloud Build, Artifact Registry, Secret Manager.
2. Artifact Registry Docker repo `rafael` in `asia-southeast1` (or change `_REPO`).
3. Secrets in Secret Manager (create the secret and add a version): `DEEPGRAM_API_KEY` (STT, if Deepgram is chosen). LLM is Vertex AI (D20), so no API key. Name must match `_SECRETS`.
4. Cloud Build service account roles: Cloud Run Admin, Service Account User (on the Cloud Run runtime SA), Artifact Registry Writer. Runtime SA: Secret Manager Secret Accessor on the secrets above, Vertex AI User. No Storage roles (D11).
5. Trigger dev: GitHub repo praneat-org/Rafael, push to `^develop$`, config `cloudbuild.deploy.yaml`, substitution `_EXTENSION_IDS=<dev extension id>`.
6. Trigger prod: push to `^main$`, same config, **require approval**, substitutions `_SERVICE=rafael`, `_EXTENSION_IDS=<prod id>`.
7. OAuth client (Chrome Extension type) per BE-71.

## Settings baked into the config

- `--timeout=3600`, `--session-affinity`, `/api/health` startup + liveness probe (D18, no token).
- `_MIN=1 _MAX=1`: **proposal for Q2, not decided.** Override on the trigger if Q2 closes differently.
- Env var is `EXTENSION_IDS` (what `apps/server/src/index.ts` reads; BE-88 text says `ALLOWED_EXTENSION_IDS`).
- `--allow-unauthenticated` is required so the extension can reach `/ws`; auth happens in the WS `hello`.

## Check on first real deploy

`--startup-probe` / `--liveness-probe` flags in `gcloud run deploy` need a recent gcloud (if the cloud-sdk image rejects them, switch the step to `gcloud beta`). Then: `curl https://<url>/api/health` -> `{"ok":true}`; hold a WS > 60 min or confirm reconnect + resume; QA checks container `/tmp` is empty (BE-96).

## Local image check

    docker build -f apps/server/Dockerfile -t rafael-server .
    docker run --rm -p 8080:8080 rafael-server   # curl localhost:8080/api/health
