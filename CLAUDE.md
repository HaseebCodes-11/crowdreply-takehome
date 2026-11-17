# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository. Read this first, then
[README.md](README.md) for the API contract, [TASK.md](TASK.md) for the take-home brief, and
[NOTES.md](NOTES.md) for every problem found, its root cause, and before/after examples by answer id.

## What this project is

A **brand visibility service**. Every day a data vendor sends AI answers from five models
(`chatgpt`, `perplexity`, `gemini`, `google_aio`, `google_ai_mode`) for each client brand's buyer
prompts. The service ingests those answers and computes, per brand: whether the client's brand was
named, visibility, real competitors, and share of voice.

Everything runs **offline** and **in memory**. No database, no network, no build step. The vendor's
data is noisy on purpose. Treat `data/` as production input to validate, never as trusted fixtures.

## Stack and toolchain

| Thing | Value |
|---|---|
| Runtime | Node.js >= 22.18, running `.ts` files directly via type stripping |
| Language | TypeScript 5.8, `strict`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, ESM |
| Runtime deps | **None.** Only `node:*` built-ins. Do not add npm runtime dependencies. |
| Dev deps | `typescript`, `@types/node`, only for `npm run typecheck` |
| Tests | `node:test` + `node:assert/strict`, one process per test file |

Write **erasable** TypeScript only: no `enum`, no parameter properties, no value `namespace`. Type
imports use `import type` or inline `type`. Relative imports keep the `.ts` extension.

## Commands

```bash
npm start                                    # http://localhost:4600
npm test                                     # 72 tests, about 6 seconds
npm install --no-package-lock && npm run typecheck   # Node does not check types, tsc does
NOW=2026-11-11 npm start                     # pin "today" (bash); useful to look at a past window
```

Always run both `npm test` and `npm run typecheck` before a commit.

## Layout

```
src/
  server.ts        Regex route table -> handler -> JSON. daysParam() validates ?days. Boots via loadAll().
  ingest.ts        checkResponse() validates one raw answer, loadAll() dedupes by id, resolves redirect
                   links, builds Answers, returns IngestStats. describeStats() is the startup line.
  failure.ts       failureReason(): http_error | empty_text | prompt_echo | refusal | null
  detect.ts        isOwnBrandMentioned(text, brand): our own reading of the text
  citations.ts     unwrap() Google wrappers, resolveRedirects() via head(), normalizeCitations()
  metrics.ts       today(), windowStart(), countedAnswers(), visibility()
  competitors.ts   competitors(brandId): LLM-confirmed names, DNS-checked domain
  shareOfVoice.ts  shareOfVoice(brandId, days)
  store.ts         One Map of answers keyed by id, one Map of brands. The only state.
  util.ts          sleep(), mapLimit()
  config.ts        DATA_DIR, PORT, NOW_OVERRIDE
  types.ts         MODELS, Brand, VendorResponse, Answer, Mention, FailureReason
  lib/             Offline stand-ins: dns.ts, http.ts, llm.ts
test/              One file per module, plus *-feed tests that assert against the real data
data/              brands.json, feed/YYYY-MM-DD.json, and the stand-ins' fixtures
```

Flow: `loadAll()` -> for each feed file -> `checkResponse()` -> dedupe by id -> `resolveRedirects()`
-> `toAnswer()` (failure, detect, citations) -> `saveAnswer()`. Each GET -> route -> metric -> JSON.

## Rules that must hold

1. **One definition of "counted answer".** Inside the window, both ends included, and `status === 'ok'`.
   Get answers through `countedAnswers()` in `metrics.ts`. Never filter by date or status anywhere else.
2. **An answer is stored once.** The store is keyed by id. Ingest counts repeats, it does not store them.
3. **Never drop an answer for a cosmetic defect.** A missing mention domain, position, text or citation
   list is filled with an empty value. Skip only what cannot be attributed, and give the skip a reason.
4. **Failure rules are exact.** An answer that names nobody is a real miss and must count. Only add a
   rule to `failure.ts` for content that is provably not an answer.
5. **The vendor's `isMentioned` decides nothing.** It is stored as `vendorIsMentioned` for audit.
6. **Competitors come from the LLM, domains from DNS.** `servfail` means unknown, never dead.
7. **Stored citations are full https links to the cited page.** Originals stay in `rawCitations`.
8. **Dates are UTC `YYYY-MM-DD` strings**, compared as strings.

## The stand-ins in `src/lib/`

Call them through their functions. Never read `data/dns.json`, `data/llm/fixture.json` or
`data/redirects.json` from application code or tests.

| Function | Behaviour to code against |
|---|---|
| `lookupDomain(domain)` | `live`, `nxdomain`, `nodata` or `servfail`. Unknown hosts are `servfail`. A `live` record can carry a `redirect` to another site, which means parked or sold. |
| `head(url)` | `{ status, location? }`, redirects not followed. Unknown URLs return 200. |
| `classifyCompetitor(brand, name)` | 1 credit per call, about 25 ms, throws `LlmRateLimitError` on every 13th call. When the limiter trips it rejects every call in flight, and those still cost credits, so call it one at a time. |

Budgets asserted by tests: classifying Tasklane takes exactly 16 LLM calls, all eight brands under 90.
If a change raises those numbers, that is a regression.

## API contract (do not break)

Paths and response shapes are frozen. Adding fields is fine. See README.md for the shapes.

- `GET /brands`
- `GET /brands/:id/visibility?days=30`
- `GET /brands/:id/competitors`
- `GET /brands/:id/share-of-voice?days=90`
- `GET /responses/:id`

Only GET. Unknown brand or id is 404. `days` outside 1 to 365 is 400.

## Working rules

1. **One commit per fix**, clear message, never squash. Each fix needs a test and a NOTES.md entry
   with real answer ids before and after.
2. **Never weaken or delete an existing test.** The eight original tests are unchanged.
3. **Check the data before writing code.** Write a throwaway script, count, print the matched text.
   Two wrong conclusions in this project came from reading a count without reading the rows.
4. **Expected values in tests come from an independent count**, not from the code under test.
5. **State what was not verified.** NOTES.md has a "found but not fixed" section. Add to it.
6. Zero runtime dependencies, erasable TypeScript, UTC dates.

## Data facts (sample feed)

- 29 files, 3,609 raw answers, 3,400 unique ids (209 exact repeats), 69 failed, 3,331 countable.
- After the fixes every brand has 84 answers per model over the last 28 days, minus failed ones.
- Each brand has 5 or 6 real competitors among 52 to 55 names the vendor lists.
- Real brand mentions are written `**Name** (domain)`. Bark & Bloom also appears as "Bark and Bloom"
  and as the bare domain. Compass collides with the ordinary word.
- One batch is dated 2026-07-17, three months before the rest. It is kept, see NOTES.md.

## Codebase graph

A graphify knowledge graph lives in `graphify-out/` (`graph.html`, `GRAPH_REPORT.md`, `graph.json`).
Regenerate after structural changes with `graphify extract . --code-only` then `graphify cluster-only .`.
