# NOTES

What I found in the brand visibility service, what I changed, and how I checked it.

Every "before" below was captured from the untouched code at commit `34a4b24`. Every "after" was captured from the commit that fixes that problem. All answer ids are real ids from `data/feed`.

To reproduce any example, start the server and fetch the answer or metric:

```bash
npm start
curl -s localhost:4600/responses/r_02ed75293f5602
curl -s "localhost:4600/brands/compass/visibility?days=30"
```

## Problems found and fixed

### 1. Ingest silently dropped 18% of all answers

**Symptom.** No client reported this. The startup line said `Loaded 8 brands and 2943 answers (666 skipped)`. The feed holds 3,609 answers.

**Root cause.** `toAnswer()` in `src/ingest.ts` threw a `ValidationError` when any brand in an answer's `mentions` had no domain, and the whole answer was skipped. The vendor often lists a brand without a domain. It does so for Perplexity (165 times) and ChatGPT (88 times) when those engines name themselves, and for real competitors (71 distinct names in total). The stored `Mention` type already allowed `domain: null`, so there was no reason to reject these.

The loss was uneven across models: google_aio 208, google_ai_mode 205, perplexity 165, chatgpt 88, gemini 0. Per-model visibility was therefore computed on a biased sample. 285 of the dropped answers were ones where the vendor said the client's brand was mentioned.

**Change.** A mention without a domain is kept with `domain: null`. A mention without a name is dropped on its own, without losing the answer. Validation now only rejects an answer that cannot be attributed at all (no id, unknown brand, unknown model, unusable `fetchedAt`), and each rejection carries a reason code. `loadAll()` returns `skippedByReason` and the startup line prints it, so the next surprise from the vendor is visible. A feed file that cannot be parsed is reported and skipped instead of crashing the load.

**Examples.**

| Answer | Before | After |
|---|---|---|
| `r_02ed75293f5602` (Fieldnote, google_ai_mode). Names Fieldnote in second place. Lists `Margina` with `domain: null`. | `GET /responses/r_02ed75293f5602` returns 404. The answer is in no metric. | 200, `ownBrandMentioned: true`, mentions include `{ "name": "Margina", "domain": null }`. |
| `r_2a8e74a45fba7d` (Driftwell, google_aio). Lists `Noctily` with `domain: null`. | 404 | 200, `ownBrandMentioned: true` |
| `loadAll()` | `{ saved: 2943, skipped: 666 }` | `{ saved: 3609, skipped: 0, skippedByReason: {} }` |
| Tasklane, 30 days, google_ai_mode | 22 mentioned of 65 answers | 29 of 88 |
| Tasklane, 30 days, google_aio | 24 of 70 | 32 of 89 |

The "after" counts in the last two rows still include duplicate answers. Problem 2 removes those.

**How I checked.** `test/ingest.test.ts` asserts that `r_02ed75293f5602` is stored with the null-domain mention, that nothing in the sample feed is skipped, and that each rejection reason fires on a hand-made bad answer. I also compared the startup counts and the two `/responses` calls above before and after.

### 2. Answers the vendor delivered twice were counted twice

**Symptom.** No client reported this. Answer counts per model were ragged (for Compass over 30 days: 90, 87, 92, 92, 88) although the vendor asks every model the same three prompts every day.

**Root cause.** The vendor resends answers. 209 ids occur twice in the feed and each pair is byte-identical: 132 pairs sit inside one file and 77 are repeated in the next day's file. `saveAnswer()` in `src/store.ts` pushed every delivery onto an array, so both copies were counted in every metric. The by-id map next to it overwrote, which hid the problem from `GET /responses/:id`.

**Change.** Ingest collects one copy per id before storing, and counts the repeats in `loadAll()` as `duplicates`. If a repeat ever differs from the first copy, the most recent fetch wins and it is counted separately as `conflictingDuplicates` (0 in the sample feed). The store is now a single map keyed by id, so storing an id twice cannot double count, and loading the feed twice adds nothing.

**Examples.**

| What | Before | After |
|---|---|---|
| `r_1abf85aa322bf1` (Compass, google_aio). In `2026-10-18.json` and again in `2026-10-19.json`, same `fetchedAt` `2026-10-18T08:37:00Z`. | 2 copies in the store, counted twice | 1 copy |
| `loadAll()` | `saved: 3609` | `saved: 3400, duplicates: 209, conflictingDuplicates: 0` |
| Compass, 30 days, all models | 253 mentioned of 449 answers | 239 of 420 |
| Compass, 30 days, answers per model | 90, 87, 92, 92, 88 | 84, 84, 84, 84, 84 |

After this fix every brand has exactly 84 counted answers per model in the 30-day window, which is 28 days of data times 3 prompts. That regular grid is the best evidence that problems 1 and 2 are both fully fixed.

**How I checked.** `test/ingest.test.ts` asserts one stored copy of `r_1abf85aa322bf1`, 209 duplicates, 3,400 stored answers with 3,400 distinct ids, and that calling `loadAll()` a second time leaves the count unchanged.

### 3. The date window had a start but no end

**Symptom.** No client reported this. With "today" pinned through the documented `NOW` setting, the response reported one window and counted answers from a longer one.

**Root cause.** `visibility()` in `src/metrics.ts` only skipped answers with `a.day < from`. Nothing excluded answers fetched after `to`. With the default setting "today" is the newest answer in the feed, so nothing lies after it and the bug is invisible. It appears as soon as `NOW` is pinned, for example in a test, a backfill, or a report for a past date.

**Change.** A new `countedAnswers(brandId, days, to)` in `src/metrics.ts` filters on both ends of the window and on status. `visibility()` uses it, and so do the competitor list and share of voice added later, so every metric counts the same answers.

**Examples.** Server started with `NOW=2026-11-11`, then `GET /brands/fieldnote/visibility?days=2`. The response says `from: 2026-11-10, to: 2026-11-11` in both cases.

| What | Before | After |
|---|---|---|
| `overall.answers` | 75 (five days of answers, Nov 10 to Nov 14) | 30 (two days) |
| `byModel.chatgpt.answers` | 15 | 6 |
| `r_9db15d83684df0` (Fieldnote, chatgpt, fetched 2026-11-13) | counted in the window that ends 2026-11-11 | not counted |

**How I checked.** `test/metrics.test.ts` pins the end of the window to 2026-11-11 and asserts that every counted answer is dated Nov 10 or Nov 11 and that no model has more than 6 answers.

### 4. A ChatGPT outage was counted as "brand not mentioned" (Fieldnote's complaint)

**Symptom.** "ChatGPT visibility fell to almost nothing on Tuesday and came back on Thursday."

**Root cause.** `toAnswer()` in `src/ingest.ts` marked an answer `failed` only when `httpStatus` was not 200. Every one of the 3,609 answers in the feed has `httpStatus: 200`, so nothing was ever failed. On Tuesday 2026-11-10 and Wednesday 2026-11-11 ChatGPT returned junk for 17 of 24 and 16 of 24 answers across all eight brands, and none on the days either side. The junk comes in three shapes: empty text, the sentence "I don't have search results for that query right now.", or the prompt echoed back as the answer. Each was stored as a normal answer that did not mention the brand, which pulled visibility down. Fieldnote noticed because all six of its ChatGPT answers on those two days were junk.

This is not limited to the outage. 69 unique answers are junk: 33 from ChatGPT and 36 from Perplexity, which fails steadily at two or three answers a day.

**Change.** New `src/failure.ts` with `failureReason()`. An answer is failed when the HTTP status is not 200 (`http_error`), the text is empty (`empty_text`), the text equals the prompt (`prompt_echo`), or the text is the refusal sentence (`refusal`). The stored answer gets a new `failureReason` field next to `status`, and `loadAll()` reports `failed` and `failedByReason`. Failed answers are stored and can be fetched, but no metric counts them.

I chose exact rules on purpose. A broader rule such as "no brands and no citations" matches the same 69 answers today, but it would also discard a genuine answer that recommends nobody, and that answer is a real miss that visibility should count. The known limit is a refusal worded differently from the one in the feed. It would be counted as a miss until the pattern is added.

**Examples.**

| Answer | Before | After |
|---|---|---|
| `r_991f893225aecc` (Fieldnote, chatgpt, 2026-11-10), text is `""` | `status: "ok"`, counted as not mentioned | `status: "failed"`, `failureReason: "empty_text"` |
| `r_c75b21627ed4b4` (Fieldnote, chatgpt, 2026-11-10), text is "I don't have search results for that query right now." | `status: "ok"` | `status: "failed"`, `failureReason: "refusal"` |
| `r_7424f93ca93846` (Fieldnote, chatgpt, 2026-11-11), text is its own prompt "tool to organise interview notes and tag insights" | `status: "ok"` | `status: "failed"`, `failureReason: "prompt_echo"` |
| Fieldnote ChatGPT on Nov 10 and 11 (`NOW=2026-11-11`, `days=2`) | 6 answers, 0 mentioned, visibility 0 | 0 answers, which is "no data" and not 0% |
| Fieldnote ChatGPT, 30 days | 44 of 84 (52.4%) | 44 of 78 (56.4%) |
| `loadAll()` | no failed answers | `failed: 69`, `{ prompt_echo: 36, refusal: 23, empty_text: 10 }` |

**How I checked.** `test/failure.test.ts` covers each rule on hand-made input, asserts the three answers above, asserts the 69 total and its split, and asserts that all 69 failed answers have no mentions and no citations (so no real answer was caught). It also asserts that a real answer naming no brand is not a failure. My first version of the test had the wrong split because I had counted duplicates. The test failed and I corrected the expectation after checking it against the feed.

## Problems found but not fixed

_To be completed._

## What my AI tools got wrong

_To be completed._

## AI setup, time spent and recording

_To be completed._
