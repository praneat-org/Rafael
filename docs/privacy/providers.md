# Provider data retention / training / logging (BE-93, CAR-3824 AC 3)

Checked: **2026-10-24** (all URLs fetched that day unless noted). Summaries are paraphrased from official pages; anything not stated on the page is marked **UNVERIFIED**. This is not legal advice; contract terms (DPA, ZDR approval) must be confirmed with each vendor.

Scope note: BE-93's title says "Claude API". Per **D20** the LLM is **Google Gemini via Vertex AI**, so Anthropic is not covered here. **D21**: Vertex CachedContent holds the Session Pack only, ttl <= 1h, deleted on `session.end` (required by D21; implemented in BE-94, PR #17 draft, not merged; wiring in BE-108). STT is undecided (Chirp 3 vs Deepgram, BE-77/79), so both are covered. Google Drive API is covered in its own section below.

## Summary table

| | Vertex AI Gemini | STT: Google Chirp 3 (V2) | STT: Deepgram |
|---|---|---|---|
| Data sent | Session Pack text (cache), transcript window, question | Audio PCM stream | Audio PCM stream |
| Training on our data | No, without prior permission/instruction [1] | Training: **UNVERIFIED** (not stated on the Chirp 3 page). Logging: off by default, opt-in only [3] | Only if in Model Improvement Program; opt out per request with `mip_opt_out=true` [5] |
| Logging / retention default | Abuse monitoring: prompts logged only when classifiers flag suspicious activity, kept up to 90 days in the selected region; customers with a Google Cloud Master Agreement (CMA) exempt by default; Frontier models: prompts + responses up to 30 days [10]. Request-response logging to BigQuery off by default [1]. In-memory cache <= 24h [1] | "By default, Cloud Speech-to-Text does not log customer audio data or transcripts" (V1 page; V2/Chirp 3 coverage UNVERIFIED) [3] | Opted-out requests kept "only as long as needed to process the request" [5]. Not opted out = in program (implied, not stated) [5] |
| How to turn off | Keep request-response logging off; disable caching via `cacheConfig.disableCache=true` (needs `roles/aiplatform.admin`) [1]. No self-serve opt-out; exemption = CMA by default, otherwise contact account team [10] | Never opt in to data logging [3] | Send `mip_opt_out=true` on every request (streaming too); verify in Console > Usage > Logs [5] |
| Region | Gemini listed in asia-southeast1 (Singapore); no Thailand region [2]. Abuse-monitoring logs stay in the selected region [10] | Chirp 3 table lists only `us`, `eu` multi-region; a code sample says `asia-southeast1` is valid; a search snippet showed asia-southeast1 GA on one page version. **Conflict, verify with the locations API** [4] | EU endpoint `api.eu.deepgram.com`, "all processing fully contained within the EU" [6] (AWS EU hosting: **UNVERIFIED**, search snippet only); Asia/Singapore endpoint **not found**; India/Australia: **UNVERIFIED** (search snippet only) [7] |
| Thai | n/a | `th-TH` **Preview** on Chirp 3, covered by the streaming statement [4] | Nova-3 lists `th`/`th-TH`; the page recommends Nova-3 generally "in batch or streaming" (nothing Thai-specific on streaming) [8] |
| DPA | Google Cloud Data Processing Addendum: Google is processor, deletes customer data within max 180 days after term end; subprocessor / transfer sections not read [11] | **UNVERIFIED** (that STT is covered by the Cloud DPA was not checked) | **UNVERIFIED** |

## Vertex AI Gemini

- **Training:** "Google won't use your data to train or fine-tune any AI/ML models without your prior permission or instruction." [1]
- **Abuse monitoring (per [10]):** prompts are logged only when automated safety classifiers detect suspicious activity, kept up to 90 days, in the selected region. "Customers with a Google Cloud Master Agreement are exempt from prompt logging for this abuse monitoring by default." No self-serve opt-out is described; otherwise contact the account team. **Action: check whether Praneat has a Google Cloud Master Agreement** (if not, flagged prompts can be kept 90 days).
- **Frontier models (model-choice input for D20):** Google Frontier Models (the page names Gemini 4 Argon Cyber Permissive) may log prompts **and responses** "solely for ensuring safe use", kept up to 30 days (stored in the customer's environment; CMA customers exempt from human review). Gemini 4 Argon is listed in asia-southeast1 [2]. Choosing a Frontier model therefore adds a logging condition that standard Gemini models do not have. Advanced AI (non-Google) models: all prompts + responses logged up to 30 days. [10]
- **Request-response logging:** off by default (BigQuery, per model/project). Keep it off. [1]
- **Context caching (D21):**
  - Explicit cache default lifetime 60 min, extendable; storage billed by time stored; "cached content is never shared across projects"; delete API exists. [9]
  - Docs state: "To prevent cache data retention, disable implicit caching and avoid creating explicit caches." [9] So **an explicit cache of the Session Pack is not zero-retention** by Google's own definition. How an explicit cache is stored and whether it is covered by ZDR: **UNVERIFIED**. D21's ttl <= 1h + delete on `session.end` is our mitigation, not a ZDR guarantee.
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
- Region: EU endpoint `api.eu.deepgram.com`, "all processing fully contained within the EU" [6]. No Singapore/Thailand endpoint found. **UNVERIFIED** (search snippets only, not on [6]): AWS EU hosting, dedicated single-tenant deployment, and US processing of operational metadata / billing for regional endpoints [7].
- Thai: Nova-3 supports `th`. [8]

## Google Drive API (server reads the Session Pack with the user's `drive.readonly` token)

Status: partly implemented. The Drive reader is merged (BE-90 #16) but not wired into the session flow (BE-91 #18, BE-108 not merged). Current develop verifies the WebSocket accessToken and stores packId; it does not yet call the Drive API from a session or call Gemini.

- Data: our server sends the user's access token and file requests; Drive returns the pack file content. Whether Drive reads fall under the Google Cloud Data Processing Addendum (formerly the Workspace "Data Processing Amendment") is **UNVERIFIED** (the covered-services appendix was not read); if it does, Google is processor with deletion within max 180 days after term end [11]. Drive region: **UNVERIFIED**. Drive's own retention of the files is a Praneat Workspace admin setting: **not found / not researched** (not Rafael-controlled).
- Our app is bound by the Google API Services User Data Policy: Limited Use (use only for user-facing features, no transfer except listed exceptions, human reading only in narrow cases, data secured in transit and at rest). The page does not mention AI model training and sets no retention period. [12] Open question for DPO / legal: whether sending pack content to Gemini is a permitted transfer.
- Provider logging / zero-retention controls for Drive: **not found / UNVERIFIED**; [12] does not specify Drive logging or a zero-retention control.
- Google Drive MCP: see the dedicated section below (researched 2026-11-02, BE-117).
- Token handling: in memory only, per session (D11). Proof card: BE-85 (#8, merged) for in-memory session state; the Drive reader card was not checked here.

## Google Drive MCP (Google-hosted, Developer Preview) - BE-117

Checked: **2026-11-02**. Official pages only; "not stated" means the page does not say so as of that date. Not legal advice. No real MCP call was made (needs a user `drive.readonly` token; smoke is the remaining part of BE-117). Code: BE-92 (PR #44), opt-in via `SOURCE_PROVIDER=mcp`, default `driveApi`.

| Topic | Finding | Source |
|---|---|---|
| What it is | `https://drivemcp.googleapis.com/mcp/v1`, Streamable HTTP, OAuth 2.0. Needs the Drive API + Drive MCP API enabled on a GCP project and an OAuth client marked "Use this client for an AI-powered agent". Scopes `drive.readonly`, `drive.file`. Tools listed: `copy_file`, `create_file`, `download_file_content`, `get_file_metadata`, `get_file_permissions`, `list_recent_files`, `read_file_content`, `search_files` (no parameters or output schemas on the page). | [13] |
| Preview status | "Available as part of the Google Workspace Developer Preview Program"; membership required. Page last updated 2026-10-29. GA date, SLA, support: not stated. | [13][14] |
| Data passed through | Not stated as a data-flow description. Functionally: our query text (search terms), file ids, and the file content Google returns for `read_file_content` / `download_file_content`, plus the OAuth token. Content is parsed Google-side (CSE files are ineligible because "AI agents" cannot parse them), so Google processes the pack content, unlike the plain Drive API download. Permissions: "Inherit the same permissions and data governance controls as the user". Ineligible items (IRM / DLP-IRM, CAA block, CSE, spam, malware, trash) are filtered from lists and error on single reads. | [13][15][17] |
| Region / data residency | **Not stated in the docs as of 2026-11-02.** Separately, test data under the Pre-GA terms "is not subject to the data location requirements" (Workspace Service Specific Terms s.6.1(c), paraphrased from the Thai page). Effect: residency of pack content cannot be asserted; treat as possibly outside Asia. | [13][14][16] |
| Retention / deletion | **Not stated in the docs as of 2026-11-02** (neither the MCP setup page nor the eligibility page). Cannot claim zero retention. | [13][15] |
| Logging | Only stated: admins can see "OAuth log events" in the security investigation tool. Logging / retention of MCP tool calls or request content: **not stated as of 2026-11-02**. Page recommends Model Armor or own screening of prompts / responses. | [13][14] |
| Use of data to improve Google products | Developer Preview Program term (vi): "Google may use any data submitted, stored, sent, or received via any Pre-GA APIs" (to improve them, subject to applicable law). Workspace Service Specific Terms s.6.1(b): customer test data may be used by Google to test, analyze, develop and improve the pre-GA offering and other Google products used with it. Whether the Drive MCP is a "Pre-GA API" under these terms is an inference from "Developer Preview"; the MCP pages do not state it. | [14][16] |
| DPA | Not mentioned on the MCP pages. Service Specific Terms s.6.1 (third paragraph): the Cloud Data Processing Addendum applies to a pre-GA offering as a "Service" **only if the customer has accepted it / the parties agree**; Praneat's CDPA status was not checked. Pre-GA = AS IS, no SLA, no TSS support. | [14][16] |
| Terms that bind us | Developer Preview Program terms (Google APIs Terms of Service, Pre-GA offering terms), Google API Services User Data Policy (consent screen), Workspace Service Specific Terms s.6. Program term (iv): Pre-GA APIs not for production apps shared outside the org; Rafael is internal (@praneat.com). Term (vii): regulated/government users may use only test data (whether Praneat is in scope: not assessed). | [12][14][16][17] |

Effect on the prod decision:

- Three facts that matter for deal content are unresolved or negative: region not stated, retention not stated, and the Pre-GA terms allow Google to use data sent via Pre-GA APIs to improve them. D11/D21 want a bounded story for pack content; MCP gives none in writing.
- The Drive API path (BE-90) returns the file to our server and the Drive API terms / Workspace agreement apply (CDPA coverage there is itself still UNVERIFIED above, but it is GA, not Pre-GA).

**Proposed prod default (for the human decision, CAR-3820 AC 3): keep `SOURCE_PROVIDER=driveApi`.** Do not set `mcp` on prod until (1) the BE-117 smoke and file-type table pass, and (2) DPO / legal accept the Pre-GA data-use term, or Google confirms in writing (account team): region, retention, no-training for Drive MCP content under the CDPA, or GA arrives with GA terms. This is a proposal; the decision is the human's.

## Q1: direct API vs Vertex (settled by D20)

We call the regional endpoint in asia-southeast1 (same as Cloud Run), but "Endpoints don't guarantee data residency or in-region ML processing" [2], so in-region processing is not guaranteed. Vertex has IAM, audit logs and VPC-SC for caches [9]. Downside: abuse-monitoring logging has no self-serve opt-out (CMA exemption only, see above). Direct Claude API vs Vertex: not compared; D20 chose Gemini/Vertex and closed Q1, and this card's title predates D20.

## Recommendation (for the human decision, BE-79 / decision log)

1. Vertex Gemini regional endpoint asia-southeast1; no grounding, no logging sink, `store=false` where applicable.
2. Check whether Praneat has a Google Cloud Master Agreement (default abuse-logging exemption); if not, ask Google about an exemption. Also ask Google in writing: (b) explicit CachedContent storage / ZDR status.
3. STT: if Chirp 3 in asia-southeast1 cannot do th-TH streaming, region is `us`/`eu`; Deepgram would be the EU endpoint (verified) or the US (UNVERIFIED). Any of these is a cross-border transfer out of Thailand; flag to DPO.
4. When adapters land (BE-77/79): Deepgram `mip_opt_out=true` in adapter config. No code exists yet.

## Sources (checked 2026-10-24)

1. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/data-governance
2. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/locations
3. https://docs.cloud.google.com/speech-to-text/docs/data-logging
4. https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3
5. https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
6. https://deepgram.com/learn/deepgram-eu-endpoint-now-generally-available (fetched)
7. https://deepgram.com/learn/deepgram-india-endpoint-now-generally-available (search snippet)
8. https://developers.deepgram.com/docs/models-languages-overview
9. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
10. https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/abuse-monitoring
11. https://cloud.google.com/terms/data-processing-addendum/ (first 100k chars read; subprocessors/transfers not read)
12. https://developers.google.com/terms/api-services-user-data-policy
13. https://developers.google.com/workspace/drive/api/guides/configure-mcp-server (checked 2026-11-02)
14. https://developers.google.com/workspace/preview (Developer Preview Program terms, checked 2026-11-02)
15. https://developers.google.com/workspace/drive/api/guides/drive-mcp-server-file-eligibility (checked 2026-11-02)
16. https://workspace.google.com/terms/service-terms/ (s.6 Pre-GA Offerings; fetched in Thai, first 100k of 105k chars read, 2026-11-02)
17. https://developers.google.com/workspace/guides/configure-mcp-servers (checked 2026-11-02)
