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

### 5. Own-brand detection trusted the vendor and matched exact strings (Compass's and Bark & Bloom's complaints)

**Symptom.** Compass: "Our visibility looks too good to be true. When we open the answers, a lot of them don't mention us at all." Bark & Bloom: "This answer is literally about us, and your dashboard says we weren't mentioned."

**Root cause.** Two lines in `isOwnBrandMentioned()` in `src/detect.ts`, one for each complaint.

1. `if (vendorSaysMentioned) return true;` trusted the vendor's `isMentioned` flag. That flag is a case-insensitive substring match. For Compass it fires on the ordinary word "compass". Of 258 answers the vendor flags for Compass, 188 name the brand as `**Compass** (compasscrm.io)` and 70 only use the noun (65 after removing duplicates). The vendor even adds Compass to `mentions[]` for those.
2. `text.toLowerCase().includes(brand.name.toLowerCase())` looks for the exact string "bark & bloom". 55 unique answers name the brand another way: about half write "Bark and Bloom" and the rest name only the domain `barkandbloom.co`. The vendor's flag misses them for the same reason.

**Change.** `isOwnBrandMentioned()` now decides from the text alone. The brand counts as named when the text contains its domain as a whole host, or its name as a whole word. Between the words of a name, "&" may be written "&", "and", "+" or "'n'", and a hyphen or space may be a hyphen, a space or nothing. A name that starts with a capital must be written with a capital, which is what separates Compass from a compass. The vendor's flag is still accepted as a third argument so no caller breaks, but it is ignored. It is stored on each answer as the new field `vendorIsMentioned` so the two can be compared.

Known limit: a sentence that begins with the generic word, such as "Compass readings vary", would count as a mention. The feed has no such case. Requiring bold text or a nearby domain would close that gap, but it would also miss plain-prose mentions and tie detection to the current answer formatting, so I did not do it.

**Examples.**

| Answer | Before | After |
|---|---|---|
| `r_5421763f19a03a` (Compass, chatgpt). Recommends Salesmoor, Leadquill and Dealvine, then: "A clear ideal customer profile works like a compass for every rep." | `ownBrandMentioned: true` | `ownBrandMentioned: false`, `vendorIsMentioned: true` |
| `r_6d33eefbe25360` (Compass, perplexity). "Good forecasting gives the whole team a compass, not just the managers." | `true` | `false` |
| `r_ba4dcde1405aa2` (Bark & Bloom, chatgpt). "2. **Bark and Bloom**: a reliable all-rounder with responsive support." | `ownBrandMentioned: false` | `ownBrandMentioned: true`, `vendorIsMentioned: false` |
| `r_81f61cfe3c1e34` (Bark & Bloom, gemini). "Many reviewers recommend barkandbloom.co; it is good value" | `false` | `true` |
| Compass, 30 days | 239 of 412 (58.0%) | 174 of 412 (42.2%) |
| Compass, 30 days, perplexity | 51 of 80 | 29 of 80 |
| Bark & Bloom, 30 days | 107 of 415 (25.8%) | 160 of 415 (38.6%) |

**How I checked.** `test/detect.test.ts` keeps the two original tests and adds cases for the common noun, capitalised and all-caps names, longer words ("Compassion", "encompass"), every way of writing the "&", hyphen variants, domain-only mentions and lookalike domains. `test/detect-feed.test.ts` runs against the real feed. It asserts the four answers above and, most importantly, that our result differs from the vendor's on exactly 65 Compass answers and 55 Bark & Bloom answers and on nothing for the other six brands. That shows the new detector changes only what was wrong.

### 6. The competitor list was a raw count of every name the vendor found (Tasklane's complaint)

**Symptom.** "Our competitor list includes Reddit, Amazon, Zoom and Slack. We sell project management software."

**Root cause.** `competitors()` in `src/metrics.ts` counted every entry in the vendor's `mentions` and returned the ten most frequent. The vendor lists every name it finds in an answer: real competitors, but also platforms (Reddit, Amazon, YouTube, G2), the AI engines themselves (Perplexity, ChatGPT) and a long tail of one-off names. Each brand has 52 to 55 such names and only 5 or 6 are competitors. Three more things were wrong in the same function:

- It counted failed answers and had no date bound.
- It showed the first domain it happened to see. The vendor reports two domains for some brands, and one of them is wrong: `plandrift.com` and `pipewellhq.com` do not exist, and `sprintmoss.com` resolves but redirects to a domain marketplace. `sprintmoss.com` was the domain shown for Sprintmoss.
- It never used the LLM classifier or the DNS resolver that the codebase provides for exactly this.

**Change.** New `src/competitors.ts`. For a brand it counts each name once per counted answer (not failed, not after "today"), asks `classifyCompetitor()` about the names that appear in at least 20 answers, and keeps the ones the LLM confirms. For each competitor it picks the most-cited domain that `lookupDomain()` confirms is live and serving its own site.

Decisions inside that:

- **Cost.** The LLM is treated as paid and rate limited. Verdicts are cached per brand and name for the life of the process, and the cached value is the promise, so concurrent requests share one call. The work is lazy, on a brand's first request. The 20-answer threshold means about 10 names per brand are classified and not 54. Real competitors are named in 190 or more answers and the one-off names in 7 or fewer, so the threshold loses nothing here. Total for all eight brands: 82 credits. Classifying every name would be 464.
- **Rate limits.** `LlmRateLimitError` is retried with a growing wait, up to four times. A verdict that fails for good is not cached. Calls go one at a time. I first ran four in parallel and measured 108 credits instead of 82, because when the limiter trips it rejects every call in flight and a rejected call still costs a credit.
- **DNS failures.** `servfail` is retried twice and then treated as "unknown", never as "dead". `inkpond.com` returns `servfail` and is the only domain of a real competitor that is named in 250 answers. Dropping it would be wrong. A dead or parked domain is never shown. If no domain can be confirmed the field is `null`.

The route's path and shape are unchanged: `{ "brandId", "competitors": [ { "name", "domain", "mentions" } ] }`. The list is now 5 or 6 entries long because that is how many real competitors each brand has.

**Examples.**

| What | Before | After |
|---|---|---|
| `GET /brands/tasklane/competitors` | Taskwyn 194, Sprintmoss 186, Boardhaven 178, Trellova 173, Kanbrik 169, Plandrift 168, **Reddit 150, Amazon 146, Zoom 144, Slack 141** | Taskwyn 218, Sprintmoss 208, Boardhaven 206, Trellova 205, Plandrift 202, Kanbrik 194 |
| Sprintmoss domain | `sprintmoss.com` (parked, redirects to a marketplace) | `sprintmoss.app` |
| `GET /brands/compass/competitors` | five real ones, then G2 75, LinkedIn 57, Google 54, YouTube 48, Marwick 6 | Pipewell 250, Closera 246, Dealvine 246, Leadquill 244, Salesmoor 237 |
| `r_dc44bd5062834e` (Tasklane, gemini) mentions Plandrift, Boardhaven, Trellova, Amazon and Reddit | counts towards Amazon and Reddit as competitors | counts towards Plandrift, Boardhaven and Trellova only |
| `r_03e0508f6029dd` (Tasklane, google_aio) lists `Sprintmoss (sprintmoss.com)`, YouTube, Zoom, Google | was not stored at all (problem 1) | counts towards Taskwyn, Boardhaven, Kanbrik and Sprintmoss |

The counts went up for real competitors because problems 1 and 2 are fixed: the previously dropped answers are now included and nothing is counted twice.

**How I checked.** `test/competitors.test.ts` asserts the exact Tasklane list with domains and counts, that no platform is in it, that classifying Tasklane takes exactly 16 LLM calls (15 names plus one rate-limit retry), that repeated and concurrent requests cost no further calls, that Inkpond is kept with `inkpond.com`, that Pipewell shows `pipewell.io`, and that all eight brands together stay under 90 calls. The expected counts in the test came from an independent script over the raw feed, not from the new code.

### 7. Google citations were stored as received and were not usable links (Driftwell's complaint)

**Symptom.** "When I click a source under a Google AI Overview answer in your app, I land on a 404 page on your own website."

**Root cause.** `toAnswer()` in `src/ingest.ts` stored `citations` exactly as the vendor sent them. The README promises "full `https://` links" that the app shows as clickable. Three models send those. The two Google ones do not:

| Model | What it sends | Count (unique answers) |
|---|---|---|
| google_aio | links relative to google.com: `/url?q=<page>`, `/goto?url=<page>&ref=aio` | 696 |
| google_aio | `/search?q=<query>`, a Google search page and not a source | 202 |
| google_aio | the same wrapper as a full link: `https://www.google.com/url?q=<page>` | 337 |
| gemini | opaque redirect links: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/<token>` | 1,072 distinct links, 126 of them dead |

A relative link rendered in our app resolves against our own domain. That is the 404 on our own website. The `google.com/url` wrappers and the Gemini redirect links are technically https links, but they send the client through Google, and 126 of the Gemini ones lead nowhere.

**Change.** New `src/citations.ts`, applied at ingest so the store holds clean data.

- Google wrapper links, relative or absolute, are opened to the page in their `q` or `url` parameter. The wrapper's own tracking parameters go away with it. The page's own query string is kept.
- Google pages that are not a cited source (`/search`) are dropped, and so is anything that is not an http or https link.
- Gemini redirect links are resolved with `head()`: a redirect becomes its `Location`, a 4xx drops the link, a 5xx or network error is retried and then the link is kept as it is. Each distinct link is checked once, 16 at a time.
- Repeats within an answer are removed and the order is kept.
- The original list is kept in the new field `rawCitations`.

The cost is 1,072 `head()` calls at startup, which takes the load from about 0.04 s to about 0.9 s here.

**Examples.**

| Answer | Before | After |
|---|---|---|
| `r_2a8e74a45fba7d` (Driftwell, google_aio) | was not stored at all (problem 1). Its four citations are `/url?q=https%3A%2F%2Frestwave.com%2F&sa=U…`, `/goto?url=https%3A%2F%2Fdozely.com%2Fblog%2Fbest-app-to-improve-sleep&ref=aio`, `/goto?url=https%3A%2F%2Fdriftwell.app%2F&ref=aio`, `/search?q=best%20app%20to%20improve%20sleep…` | `https://restwave.com/`, `https://dozely.com/blog/best-app-to-improve-sleep`, `https://driftwell.app/` |
| `r_03e0508f6029dd` (Tasklane, google_aio) | `https://www.google.com/url?q=https%3A%2F%2Fkanbrik.com%2F&sa=U&ved=…`, `/goto?url=https%3A%2F%2Fsprintmoss.app%2Fblog%2F…&ref=aio`, `/search?q=…` | `https://kanbrik.com/`, `https://sprintmoss.app/blog/best-project-management-software-for-agencies` |
| `r_dc44bd5062834e` (Tasklane, gemini) | two `vertexaisearch.cloud.google.com/grounding-api-redirect/…` links, the first of which returns 404 | `https://www.reddit.com/r/project-management/comments/292055` |
| `r_81f61cfe3c1e34` (Bark & Bloom, gemini) | three redirect links | `https://barkandbloom.co/`, `https://furrowfinch.com/`, `https://brinora.com/blog/best-natural-dog-shampoo` |
| `loadAll()` | no citation handling | `citationsRewritten: 1981, citationsDropped: 328` |

Per model after the fix: google_aio keeps 1,338 of 1,540 citations (the 202 search links go), gemini keeps 1,248 of 1,374 (the 126 dead ones go), and the other three models are untouched. 21 Gemini answers end up with no citations because every link they cited is dead.

**How I checked.** `test/citations.test.ts` covers each wrapper shape, the dropped shapes, ordering and repeats, and a redirect link that is not in the sample data (kept as it is). Against the feed it asserts the exact before and after of `r_2a8e74a45fba7d`, that `r_dc44bd5062834e` loses its dead link, and that every stored citation in all 3,400 answers starts with `https://`, is not on google.com and is not repeated.

## Problems found but not fixed

_To be completed._

## What my AI tools got wrong

_To be completed._

## AI setup, time spent and recording

_To be completed._
