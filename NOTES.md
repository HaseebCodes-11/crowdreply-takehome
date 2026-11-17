# NOTES

What I found in the brand visibility service, what I changed, and how I checked it.

Every "before" below was captured from the untouched code at commit `34a4b24`. Every "after" was captured from the commit that fixes that problem. All answer ids are real ids from `data/feed`.

To reproduce any example, start the server and fetch the answer or metric:

```bash
npm start
curl -s localhost:4600/responses/r_02ed75293f5602
curl -s "localhost:4600/brands/compass/visibility?days=30"
```

## Summary

Eight problems fixed, one feature added. One commit each, in this order.

| # | Problem | Who noticed | Commit |
|---|---|---|---|
| 1 | Ingest dropped 18% of answers | nobody | Keep answers whose mentions have no domain |
| 2 | Duplicate deliveries counted twice | nobody | Store each answer once when the vendor delivers it twice |
| 3 | Date window had no end | nobody | Stop counting answers fetched after the end of the window |
| 4 | Junk answers counted as misses | Fieldnote | Mark junk answers as failed instead of counting them as misses |
| 5 | Own-brand detection wrong both ways | Compass, Bark & Bloom | Detect the client's brand from the text, not from the vendor flag |
| 6 | Competitor list full of platforms | Tasklane | Build the competitor list from LLM verdicts and live domains |
| 7 | Citations not usable links | Driftwell | Store citations as full links to the cited pages |
| 8 | Bad `days` crashed the request | nobody | Reject a days value that is not a whole number from 1 to 365 |
| | Share of voice | feature | Add share of voice: GET /brands/:id/share-of-voice?days=90 |

Effect on 30-day visibility (2026-10-16 to 2026-11-14, all models), original code against the final code:

| Brand | Before | After |
|---|---|---|
| Compass | 204 of 369 (55.3%) | 174 of 412 (42.2%) |
| Bark & Bloom | 94 of 356 (26.4%) | 160 of 415 (38.6%) |
| Fieldnote | 153 of 356 (43.0%) | 178 of 411 (43.3%) |
| Tasklane | 153 of 370 (41.4%) | 178 of 409 (43.5%) |
| Lumora | 144 of 364 (39.6%) | 171 of 412 (41.5%) |
| Driftwell | 137 of 363 (37.7%) | 163 of 414 (39.4%) |
| Nook-Box | 133 of 368 (36.1%) | 160 of 408 (39.2%) |
| Peakmint | 146 of 363 (40.2%) | 163 of 410 (39.8%) |

The tests went from 8 to 72. Twelve of them are end-to-end (`test/e2e.test.ts`): they start the real server as a separate process and use only HTTP. The original 8 are unchanged and pass. `npm run typecheck` is clean.

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

### 8. A bad `days` value crashed the request or returned a nonsense window

**Symptom.** No client reported this. `GET /brands/tasklane/visibility?days=abc` returned `500 {"error":"Something went wrong."}` and logged a `RangeError: Invalid time value`.

**Root cause.** The route in `src/server.ts` passed `Number(q.get('days') ?? 30)` straight into `windowStart()`. `Number('abc')` is `NaN`, which produces an invalid date. Zero, negative and fractional values did not crash but produced windows nobody could mean.

**Change.** A `daysParam()` helper in `src/server.ts` accepts a whole number from 1 to 365 and uses the default when the parameter is absent. Anything else returns `400 {"error":"days must be a whole number from 1 to 365."}`. Valid requests behave exactly as before. There is no answer id for this one because it does not depend on the data.

**Examples.**

| Request | Before | After |
|---|---|---|
| `?days=abc` | 500 | 400 |
| `?days=0` | 200, window `2026-11-15` to `2026-11-14` (starts after it ends) | 400 |
| `?days=-5` | 200, window `2026-11-20` to `2026-11-14` | 400 |
| `?days=1.5` | 200, window `2026-11-13` to `2026-11-14` | 400 |
| `?days=366` | 200 | 400 |
| `?days=7` | 200, `2026-11-08` to `2026-11-14` | unchanged |
| no `days` | 200, 30 days | unchanged |

The upper limit of 365 is my choice, not something the brief asks for. If another part of the product sends larger values today, this is the one line to change (`MAX_DAYS`).

**How I checked.** `test/api.test.ts` sends each bad value and expects 400 with the message, and checks that 1, 365 and the default still work.

## The feature: share of voice

`GET /brands/:id/share-of-voice?days=90`, implemented in `src/shareOfVoice.ts`.

```json
{
  "brandId": "tasklane",
  "days": 90,
  "from": "2026-08-17",
  "to": "2026-11-14",
  "competitors": ["Taskwyn", "Sprintmoss", "Boardhaven", "Trellova", "Plandrift", "Kanbrik"],
  "byModel": {
    "chatgpt": { "Tasklane": 0.1511, "Taskwyn": 0.1547, "Sprintmoss": 0.1475, "Boardhaven": 0.1439, "Trellova": 0.1331, "Plandrift": 0.1259, "Kanbrik": 0.1439 }
  },
  "counts": { "chatgpt": { "Tasklane": 42, "Taskwyn": 43, "…": 0 } }
}
```

(Shares are shortened here. The API returns full precision.)

How each rule in the brief is met:

- **Real competitors.** The list comes from the same function that serves `/brands/:id/competitors`, so the two can never disagree. A test asserts they are equal.
- **Count answers, not mentions.** Each answer contributes at most one count per name. A test stores an answer that lists Kanbrik twice and checks that Kanbrik's count goes up by one.
- **Same answers as visibility.** Both go through `countedAnswers()`: inside the window, not failed, no duplicates.
- **Shares add up to 1, or are all 0.** Each share is the name's count divided by the sum of all counts for that model. A test checks the sum for all eight brands and five models, and checks the all-zero case on Fieldnote's ChatGPT answers during the outage, where nothing is countable.
- **Who is "named".** The client's brand uses our own detector from problem 5. Competitors use the vendor's `mentions`. I checked that choice first: for the real competitors the vendor's list agrees with the answer text in all 9,954 cases in the feed, so re-detecting them from text would add code without changing a number.

Two fields are added to the shape in the brief: `from` and `to` (as visibility has), and `counts`, the number of answers behind each share, so any share can be checked by hand. `days` defaults to 90 and is validated like the visibility route.

**How I checked.** `test/share-of-voice.test.ts`. The expected ChatGPT shares for Tasklane in the test were produced by a separate script over the raw feed before the endpoint existed, and the endpoint matches them to three decimals.

## README corrections

The README described intended behaviour that the code did not have, and left out things about the vendor's data that matter. The final commit updates it:

- It said `status` is `failed` "for an answer we shouldn't count". In the original code that could never happen for this feed, because every answer has `httpStatus: 200`. It is true now, and the reasons are documented.
- It said citations are full `https://` links. Two of the five models did not send them. It is true now.
- It said ingest "stores each answer". It dropped 18% and stored duplicates twice.
- It did not say the feed files also carry `batch` and `vendor`, that answers are resent, that `isMentioned` is unreliable, or that `mentions` includes platforms and entries without a domain.
- It now documents the new endpoint, the added fields, and the 400 response for a bad `days` value.

## Problems found but not fixed

- **A generic word at the start of a sentence.** Detection requires a capital to tell Compass from a compass. A sentence that begins with the generic word ("Compass readings vary") would be counted as a mention. The feed has no such sentence. I left it because the stricter alternatives miss real mentions.
- **Refusals worded differently.** Only the one refusal sentence in the feed is recognised. A new wording would be counted as a miss until it is added to `src/failure.ts`.
- **A competitor that is rarely named.** Names in fewer than 20 counted answers are never sent to the LLM, to save credits. A real but rarely named competitor would be left out. Nothing in this feed is close to the line (real ones 190+, others 7 or fewer), and the constant is `MIN_ANSWERS_TO_CLASSIFY` in `src/competitors.ts`.
- **Competitor detection relies on the vendor.** I replaced the vendor's judgement for the client's own brand but kept its `mentions` for competitors, because they agree with the text in every case here. If the vendor missed a competitor the way it missed "Bark and Bloom", share of voice would undercount it.
- **The July batch.** `data/feed/2026-07-17.json` holds 40 answers, three months older than everything else. They look valid, so I kept them. They fall outside the 30 and 90 day windows. They do count towards `mentions` in `/competitors`, which has no window, adding 2 to 4 to each count. I could not tell from the data whether this file is a stray or a legitimate backfill, so I did not exclude it.
- **Nothing is persisted.** LLM verdicts and resolved redirect links live in memory. Every restart spends the 82 credits again and repeats the 1,072 link checks (about a second). A real deployment should store both.
- **Concurrent first requests for different brands.** LLM calls are sequential within one brand. Two brands requested at the same moment interleave, and a rate-limit rejection can then hit two calls at once and waste a credit.
- **The 365-day cap on `days`** is my assumption. See problem 8.

## What my AI tools got wrong

I used Claude Code throughout. These are the mistakes it made and how each was caught.

1. **It misread a Bark & Bloom variant.** After a first probe it reported that 28 answers spell the brand "BarkandBloom". A second probe that printed the matched text showed those answers name only the domain `barkandbloom.co`, and the first probe's pattern had matched inside the domain. The fix was the same in spirit (match the domain), but the claim was wrong, and a detector built for "BarkandBloom" alone would have looked right in a unit test and missed all 28 real answers.
2. **It treated "live" as "valid" for a domain.** It first listed `sprintmoss.com` and `sprintmoss.app` as two valid domains because DNS reports both as `live`. Printing the full records showed `sprintmoss.com` uses a marketplace's nameservers and redirects there. That is why the domain picker looks at the redirect and not only the status.
3. **Its first guess for Fieldnote was wrong.** The initial rules file pointed at `httpStatus` handling and gaps in the feed. Profiling the feed showed every status is 200 and no day is missing. The failures are in the answer text.
4. **It wrote a test expectation from memory.** The split of the 69 failed answers by reason was typed in from earlier numbers that still included duplicates. The test failed on first run, and the expectation was corrected against the feed (36, 23, 10).
5. **It parallelised the LLM calls.** Four calls at a time looked like a free speed-up. A test with a credit budget failed: 108 calls instead of 82. The stand-in rejects every in-flight call when the limiter trips and still charges for them. Calls are now sequential.
6. **It tried to stop a test server by killing every Node process on the machine.** The permission check blocked the command. It then started and closed the server inside the test script.

What worked in catching these: checking every claim against the feed with a script before writing code, taking expected values in tests from an independent count and not from the new code, and asserting budgets (LLM calls) as well as results.

## AI setup, time spent and recording

- **Tool.** Claude Code (desktop app).
- **Rules file.** `CLAUDE.md` in the project root.
- **Codebase graph.** `graphify-out/` (open `graph.html`), built with graphify from the code only, no LLM.
- **Decision report.** Before any code was written, the findings and three options per decision were written up with evidence, and I chose one option for each. The choices were: tolerant ingest with accounting, exact failure rules, own detector, lazy cached LLM verdicts with a threshold, citations normalised at ingest, detector plus vendor mentions for share of voice, and 400 for a bad `days`.
- **Session export.** TODO (author): add the exported agent sessions.
- **Time spent.** TODO (author): add roughly how long the task took.
- **Screen recording.** TODO (author): add the link to the recording of the most important fix. Suggested subject: problem 5, because it changes two clients' headline numbers and the feed test shows it changes nothing else.
