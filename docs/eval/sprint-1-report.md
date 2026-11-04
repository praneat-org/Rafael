# Sprint 1 report: Rafael dry-run + Go / No-go (SKELETON)

Linear BE-104 (parent BE-67, Jira CAR-3825) · created 2026-11-04 · **status: skeleton, real results pending**

Rules: every number needs a source (command, log, or URL + access date). No deal content, transcripts, cue text, audio or keys in this file (D11). Empty cells mean "not measured yet", not zero.

## 1. Decision

| Go / No-go / Buy | **PENDING real data** |
| -- | -- |
| Waiting on | BE-68 (real deal pack + 20 questions + key), BE-72 (real audio), BE-102 (3 human dry-runs) |
| Not allowed as basis | Section 5 (synthetic). Do not recommend Go from synthetic results. |

Rationale (<= 5 lines, fill after the 3 rounds): TBD

## 2. Go / No-go criteria and results (REAL rounds only)

Criteria from BE-67 sprint goal (proposed, adjustable before the rounds start). Source for each cell: eval harness report (`bench/eval`) for the round + server latency log (no content).

| Criterion | Threshold | R1 quiet room | R2 noisy room | R3 Google Meet | Pass? |
| -- | -- | -- | -- | -- | -- |
| Cue correct per source | >= 16/20 | | | | |
| Cue cites outside source (D10, counted apart from "wrong") | = 0 | | | | |
| Latency total (speaker done to first cue) p50 | <= 3 s | | | | |
| Latency total p95 | <= 5 s | | | | |
| Rated helpful (count) | no threshold set | | | | |
| Rated neutral (count) | no threshold set | | | | |
| Rated disruptive (count) | no threshold set | | | | |
| Cost per pitch hour (measured, STT + LLM) | recorded only | | | | |

Latency breakdown per stage (find the bottleneck), same rounds:

| Stage | Budget | R1 p50 / p95 | R2 p50 / p95 | R3 p50 / p95 |
| -- | -- | -- | -- | -- |
| STT (speech end to final segment) | <= 800 ms | | | |
| Detector | <= 600 ms | | | |
| Answerer first token | <= 1200 ms | | | |
| Render (server to side panel) | no budget | | | |
| Total | p50 <= 3 s, p95 <= 5 s | | | |

Round notes (setup, mic/tab audio, noise level, no content): TBD

## 3. Cost per hour (ESTIMATE, not measured)

Config as of 2026-11-04 (repo: `terraform/`, `cloudbuild.deploy.yaml`, `docs/llm-provider.md`):

| Part | Config | Unit price | Source + access date | Estimate / hour |
| -- | -- | -- | -- | -- |
| STT | `gemini-3.5-transcribe-live`, Vertex location `global` (D22, D24) | TBD | https://cloud.google.com/vertex-ai/generative-ai/pricing (access 2026-11-04: page body not extractable by the fetch tool; read the table in a browser) | TBD |
| Detector | Gemini 3.5 Flash (`DETECTOR_MODEL`) | TBD | same page | TBD |
| Answerer | Gemini 3.5 Flash (`ANSWERER_MODEL`), context cache of the pack (D21) | TBD | same page | TBD |
| Cloud Run | `asia-southeast1`, min = max = 1 instance (Q2 proposal), instance billing for the open WebSocket | TBD | https://cloud.google.com/run/pricing (access 2026-11-04: tables not extractable) | TBD |
| Total | | | | TBD |

What exists today, with caveats:
* `bench/eval/fixtures/prices.json` holds placeholder prices (`sttPerMinute` 0.01; per 1M tokens input 1, cacheRead 0.1, cacheWrite 1.25, output 4). **They have no recorded source**; verify against the pricing page before use.
* QA run on the synthetic text eval printed about 0.156 USD per pitch hour, **tokens only** (Answerer, no STT, no Detector, no Cloud Run), computed from those placeholder prices. Not a total cost.
* Formula to finish: hours of audio x STT price + (input, cacheRead, output tokens) x price + Cloud Run vCPU-s / GiB-s for 3600 s. Real usage per hour comes from the BE-102 rounds (usage log: tokens and audio seconds).

This is an estimate. Replace with the measured value from BE-102 when available.

## 4. Comparison vs Research tools (CAR-3818 / M0)

Only what is documented. Sources: `docs/research/market-tools.md` (BE-69 desk research, accessed 2026-10-23, web claims not hands-on), Decision log D17. The hands-on tests (BE-73/74/75) and BE-78 table are no longer gates (D17) and no results are documented here.

| | Rafael (BE-102 rounds) | Fireflies Live Assist (closest per D17) | Otter | Fathom |
| -- | -- | -- | -- | -- |
| Same 20 questions on the same pack | TBD | TBD (not tested) | TBD | TBD |
| Cue correct x/20 | TBD | TBD | TBD | TBD |
| p50 / p95 latency | TBD | TBD | TBD | TBD |
| Source = Google Drive folder with anchor | Yes by design (Session Pack) | Not found in official docs (upload or web URL KB) | Not found | Not found |
| Bot-free real-time | Yes (listens only) | Live Assist yes, Google Meet on Chrome only; Sales Assist needs a bot | Not stated | No real-time found |
| Triggers on customer question automatically | Yes by design | No, user asks (D17) | TBD | TBD |
| Thai | Tested only on synthetic/recorded audio (`docs/llm-provider.md`) | Not specified | TBD | TBD |
| Data region | Vertex asia-southeast1; STT `global` (D24, Q6 open) | US | US | US |
| Trains on our data | Not per `docs/privacy/providers.md` (re-check) | No (F3) | Policy says yes (O1) | Default yes, opt-out (T1) |
| Price (3-5 seats) | see Section 3 | ~$30-50 (Pro) to $57-95 (Business) per month, list, plus AI credits (blog 2026-07-10) | Live Assist enterprise only, price not found | no real-time plan |

## 5. SYNTHETIC (not for Go/No-go)

Synthetic fictional deal pack (`bench/eval/fixtures/synthetic-deal/`), **text input, no audio, no STT, no Detector**, Gemini 3.5 Flash Answerer on Vertex. Shows the harness works; says nothing about real deals or real speech.

| Item | Result | Note |
| -- | -- | -- |
| Correct (fact-checked) | 19/20 (as reported by the requester) | QA comment on BE-101 for PR #57 @ 3ebcd68 recorded 18/20 (16 correct + 2 not-found-correct). Confirm which run the 19/20 comes from and the command before this goes into a review. |
| Not-found-correct | 3/3 | |
| q6 | wrong-fact | Key too strict (required a region code the question did not ask for). QA judged this a key problem, not a model error. |
| q19 (not in source) | model answered by inference instead of notFound in the QA run | Follow-up: tune Answerer prompt (BE-101 comment). |
| Outside-source | 0 | |
| Latency (QA run, text only) | total p50 553 ms / p95 718 ms; answerer first token p50 470 / p95 607 ms | Not comparable to real rounds (no STT/Detector). |

Re-run: `pnpm --filter @rafael/eval eval` flags per `bench/eval/src/cli.ts`; text runner `apps/server/scripts/eval-text.ts` (needs Vertex ADC; keep `--out` outside the repo, D11).

Audio synthetic rows (TTS replay through the full pipeline): TBD. Pending BE-121 and BE-101 (both in progress).

| Row | Correct | Outside-source | p50 / p95 | Note |
| -- | -- | -- | -- | -- |
| Synthetic audio, quiet | TBD | TBD | TBD | |
| Synthetic audio, with noise | TBD | TBD | TBD | |

## 6. Next-sprint backlog (only if Go)

Order by measured impact once Section 2 is filled. Candidates named in BE-67: retrieval, mobile/iPad viewer (FE-41), Answerer prompt tuning for not-found (q19 pattern), STT region (Q6). Not ranked yet.

## 7. Open items before this report can be final

* BE-68 real pack + key, BE-72 real audio, BE-102 three rounds, BE-121 / BE-101 audio replay
* Pricing numbers (Section 3) read from the official pages and dated
* Q6 (STT at `global` for real customer data) decided before using real customer audio
* Human sprint review: BE-105
