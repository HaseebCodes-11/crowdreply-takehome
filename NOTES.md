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

## Problems found but not fixed

_To be completed._

## What my AI tools got wrong

_To be completed._

## AI setup, time spent and recording

_To be completed._
