# Provider data retention / training / logging (BE-93, CAR-3824 AC 3)

Checked: **2026-10-24** (all URLs fetched that day unless noted). Summaries are paraphrased from official pages; anything not stated on the page is marked **UNVERIFIED**. This is not legal advice; contract terms (DPA, ZDR approval) must be confirmed with each vendor.

Scope note: BE-93's title says "Claude API". Per **D20** the LLM is **Google Gemini via Vertex AI**, so Anthropic is not covered here. **D21**: Vertex CachedContent holds the Session Pack only, ttl <= 1h, deleted on `session.end`. STT is undecided (Chirp 3 vs Deepgram, BE-77/79), so both are covered. Google Drive API (reads the pack with the user's token) is not covered in this pass.

## Summary table

| | Vertex AI Gemini | STT: Google Chirp 3 (V2) | STT: Deepgram |
|---|---|---|---|
| Data sent | Session Pack text (cache), transcript window, question | Audio PCM stream | Audio PCM stream |
| Training on our data | No, without prior permission/instruction [1] | Not stated on Chirp 3 page; logging off by default, opt-in only [3] | Only if in Model Improvement Program; opt out per request with `mip_opt_out=true` [5] |
| Logging / retention default | Abuse monitoring: Google *may* log prompts (GCP ToS customers) [1]. Request-response logging to BigQuery off by default [1]. In-memory cache <= 24h [1] | "By default, Cloud Speech-to-Text does not log customer audio data or transcripts" (V1 page; V2/Chirp 3 coverage UNVERIFIED) [3] | Opted-out requests kept "only as long as needed to process the request" [5]. Not opted out = in program (implied, not stated) [5] |
| How to turn off | Keep request-response logging off; disable caching via `cacheConfig.disableCache=true` (needs `roles/aiplatform.admin`) [1]. Abuse-monitoring opt-out: not documented on the page, **UNVERIFIED** | Never opt in to data logging [3] | Send `mip_opt_out=true` on every request (streaming too); verify in Console > Usage > Logs [5] |
| Region | Gemini listed in asia-southeast1 (Singapore); no Thailand region [2] | Chirp 3 table lists only `us`, `eu` multi-region; a code sample says `asia-southeast1` is valid; a search snippet showed asia-southeast1 GA on one page version. **Conflict, verify with the locations API** [4] | EU endpoint GA (AWS EU) [6]; Asia/Singapore endpoint **not found**; India/Australia posts exist [7] |
| Thai | n/a | `th-TH` **Preview** on Chirp 3, covered by the streaming statement [4] | Nova-3 lists `th`/`th-TH`, streaming recommended [8] |
| DPA | Google Cloud DPA (not fetched, **UNVERIFIED**) | same | **UNVERIFIED** |

## Vertex AI Gemini

- **Training:** "Google won't use your data to train or fine-tune any AI/ML models without your prior permission or instruction." [1]
- **Abuse monitoring:** "Google may log prompts to detect potential abuse" for customers under the GCP Terms of Service. The page gives **no self-serve switch** to disable it, and says zero data retention "may not be possible" with some advanced features. [1] **This is the main D11 risk**: prompts (transcript + pack content) may be logged by Google outside our control. Needs a written answer from Google (ZDR / abuse-logging exception) before real customer pilots.
- **Request-response logging:** off by default (BigQuery, per model/project). Keep it off. [1]
- **Context caching (D21):**
  - Explicit cache default lifetime 60 min, extendable; storage billed by time stored; "cached content is never shared across projects"; delete API exists. [9]
  - Docs state: "To prevent cache data retention, disable implicit caching and avoid creating explicit caches." So **an explicit cache of the Session Pack is not zero-retention** by Google's own definition. How an explicit cache is stored and whether it is covered by ZDR: **UNVERIFIED**. D21's ttl <= 1h + delete on `session.end` is our mitigation, not a ZDR guarantee.
  - Implicit caching (on by default): in-memory, deleted within 24h, processed in the serving region; durable cache (some models) is encrypted at rest, <= 24h, no CMEK. Disable all with `disableCache: true` (project-wide, admin role). [1]
  - Region support: "regions where Generative AI on Agent Platform is available", no explicit list. **Context caching in asia-southeast1 UNVERIFIED**; check with a real `cachedContents.create` there. [9]
- **Region:** asia-southeast1 is listed for Gemini 2.5 Pro/Flash/Flash-Lite and several newer Gemini models. No Bangkok region. "Endpoints don't guarantee data residency or in-region ML processing." Do not use the `global` endpoint (requests and cached data may be served from any region). Use the regional endpoint `asia-southeast1-aiplatform.googleapis.com`. [1][2] Model availability changes often; re-check the locations page for the chosen model.
- **Other things that break ZDR (do not use):** Grounding with Google Search (3-day logs, cannot disable), Maps (30 days), Live API session resumption (24h), Interactions API `store` (default true; set false). [1]

## Google Cloud Speech-to-Text (Chirp 3)

- Data logging is **opt-in** (for discounted pricing); default is no logging of audio/transcripts. Logged data is not deleted when the project is deleted. **Action: never opt in.** [3] (Page is V1 docs; V2 equivalence **UNVERIFIED**.)
- Region: see table. Thai `th-TH` is Preview (may change). Confirm via `locations.list` that asia-southeast1 supports Chirp 3 + th-TH streaming; otherwise the only documented options are `us`/`eu`, i.e. audio leaves Asia. [4]
- Audit logging content not read (UNVERIFIED).

## Deepgram

- Setting: `mip_opt_out=true` on every request (live streaming included). [5]
- Retention for opted-out requests: only as needed to process. Fuller retention terms, DPA, subprocessor list: **UNVERIFIED**.
- Region: EU endpoint `api.eu.deepgram.com` (AWS EU, voice data stays in the EU). Dedicated single-tenant deployment possible in a chosen cloud region. No Singapore/Thailand endpoint found. India/Australia posts say operational metadata and billing are processed in the US (EU equivalent UNVERIFIED). [6][7]
- Thai: Nova-3 supports `th`. [8]

## Q1: direct API vs Vertex (settled by D20)

Vertex keeps LLM traffic in the same GCP family/region as Cloud Run (asia-southeast1) under Google Cloud terms with IAM, audit logs, VPC-SC for caches [9]. Downside: abuse-monitoring logging cannot be self-disabled.

## Recommendation (for the human decision, BE-79 / decision log)

1. Vertex Gemini regional endpoint asia-southeast1; no grounding, no logging sink, `store=false` where applicable.
2. Ask Google in writing: (a) abuse-monitoring logging exemption / ZDR for our project, (b) explicit CachedContent storage / ZDR status.
3. STT: if Chirp 3 in asia-southeast1 cannot do th-TH streaming, region is `us`/`eu`; Deepgram would be EU or US. Both are cross-border transfers out of Thailand/Singapore; flag to DPO.
4. When adapters land (BE-77/79): Deepgram `mip_opt_out=true` in adapter config. No code exists yet.

## Sources (checked 2026-10-24)

1. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance
2. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
3. https://docs.cloud.google.com/speech-to-text/docs/data-logging
4. https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3
5. https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
6. https://deepgram.com/learn/deepgram-eu-endpoint-now-generally-available (search snippet, not fetched)
7. https://deepgram.com/learn/deepgram-india-endpoint-now-generally-available (search snippet)
8. https://developers.deepgram.com/docs/models-languages-overview
9. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
