# Brand visibility service

A small service that reads AI answers from a data vendor and works out how visible each client's brand is in them. Start with [TASK.md](TASK.md). What was found and fixed is in [NOTES.md](NOTES.md).

## Running it

You need Node.js 22.18 or newer (it runs the TypeScript files directly, with no build step). There are no runtime dependencies.

```bash
npm start            # http://localhost:4600
npm test             # all tests
npm install && npm run typecheck   # optional: type checking needs TypeScript from npm
```

Settings, all optional:

| Variable | What it does | Default |
|---|---|---|
| `PORT` | Port to listen on | `4600` |
| `DATA_DIR` | Folder with the data | `./data` |
| `NOW` | "Today" for date windows, as `YYYY-MM-DD` | the newest answer in the feed |

On start the server prints what ingest did, for example:

```
Loaded 8 brands and 3400 answers (0 skipped; 209 duplicate deliveries ignored). 69 answers are marked failed and not counted (prompt_echo: 36, refusal: 23, empty_text: 10). Citations: 1981 rewritten to the page they point at, 328 dropped.
```

## How it works

1. **Ingest** (`src/ingest.ts`) reads every file in `data/feed/`, one per day. It checks each answer, keeps one copy of an answer the vendor delivers twice, and stores it. An answer is only skipped when it cannot be attributed (no id, unknown brand or model, unusable date), and skips are counted by reason.
2. **Failure check** (`src/failure.ts`) marks an answer `failed` when the model returned nothing usable: an error status, empty text, the prompt echoed back, or a refusal. The vendor reports HTTP 200 for these, so the status code alone is not enough.
3. **Detect** (`src/detect.ts`) decides from the text whether the client's own brand is named. The vendor's `isMentioned` flag is not used for this.
4. **Citations** (`src/citations.ts`) turns the vendor's citations into full links to the cited pages.
5. **Metrics** (`src/metrics.ts`) works out visibility. **Competitors** (`src/competitors.ts`) works out the real competitors. **Share of voice** (`src/shareOfVoice.ts`) builds on both.
6. **Server** (`src/server.ts`) serves the results over HTTP.

Everything is in memory and rebuilt from `data/` on every start.

Which answers count: every metric counts the same answers, those fetched inside the window (first and last day included) that are not `failed`.

### The data

| Path | What it is |
|---|---|
| `data/brands.json` | The clients' brands we track |
| `data/feed/YYYY-MM-DD.json` | The vendor's daily batches of AI answers: `{ "batch", "vendor", "responses": [ … ] }` |
| `data/dns.json` | Backs the offline DNS resolver in `src/lib/dns.ts` |
| `data/llm/fixture.json` | Backs the offline LLM in `src/lib/llm.ts` |
| `data/redirects.json` | Backs the offline HTTP check in `src/lib/http.ts` |

The vendor asks five models: `chatgpt`, `perplexity`, `gemini`, `google_aio` (Google AI Overviews) and `google_ai_mode`. For each answer it sends the text, the citations, the brands it found (`mentions`) and its own view of whether the client's brand was named (`isMentioned`).

Things to know about the vendor's data, all handled by ingest:

- Some answers are delivered twice, in the same file or again in the next day's file.
- `httpStatus` is 200 even when the model returned nothing.
- `isMentioned` is a loose substring match. It is wrong for brand names that are also ordinary words and for names written in more than one way.
- `mentions` holds every name the vendor found, including platforms such as Reddit and the AI engines themselves, and some entries have no domain.
- Google AI Overviews citations are often links relative to google.com, and Gemini citations are opaque redirect links, some of them dead.

`src/lib/dns.ts`, `src/lib/llm.ts` and `src/lib/http.ts` stand in for a real DNS resolver, a real LLM API and real HTTP requests, so everything works offline. Use them as you would the real services, through their functions, and don't read their data files directly.

- The LLM is called lazily, the first time a brand's competitors are needed, once per candidate name, with retry on rate limits. Verdicts are kept in memory.
- Each distinct Gemini redirect link is checked once with an HTTP HEAD request during ingest.
- DNS is used to choose which of a competitor's domains to show.

## API

Other parts of our product call these endpoints. **Keep their paths and response shapes as they are.** Adding fields is fine.

Only `GET` is supported. An unknown brand or answer returns `404 { "error": "Not found." }`. A `days` value that is not a whole number from 1 to 365 returns `400 { "error": "days must be a whole number from 1 to 365." }`.

### `GET /brands`
`{ "brands": [ { "id", "name", "domain", "category", "description" } ] }`

### `GET /brands/:id/visibility?days=30`
How often the brand is named, per model, over the last `days` days (today included).
```json
{
  "brandId": "tasklane", "days": 30, "from": "2026-10-16", "to": "2026-11-14",
  "byModel": { "chatgpt": { "answers": 80, "mentioned": 40, "visibility": 0.5 } },
  "overall": { "answers": 400, "mentioned": 170, "visibility": 0.425 }
}
```
`answers` is the number of answers we count for that model, and `visibility` is `mentioned / answers`. A model with no countable answers in the window has `answers: 0` and `visibility: 0`.

### `GET /brands/:id/competitors`
`{ "brandId": "tasklane", "competitors": [ { "name", "domain", "mentions" } ] }`

The brand's real competitors, most-named first, at most ten. A name is a competitor when the LLM confirms it sells a competing product. `mentions` is the number of counted answers that name it. `domain` is the most-cited domain that resolves and serves its own site, or `null` when none can be confirmed.

### `GET /brands/:id/share-of-voice?days=90`
For each model, out of all the answers that name the brand or one of its real competitors, the share that went to each.
```json
{
  "brandId": "tasklane", "days": 90, "from": "2026-08-17", "to": "2026-11-14",
  "competitors": ["Kanbrik", "Plandrift"],
  "byModel": { "chatgpt": { "Tasklane": 0.31, "Kanbrik": 0.36, "Plandrift": 0.33 } },
  "counts": { "chatgpt": { "Tasklane": 42, "Kanbrik": 49, "Plandrift": 45 } }
}
```
- `competitors` is the list from `/brands/:id/competitors`.
- An answer counts once per name, however often it names it.
- For each model the shares add up to 1, or are all 0 if nobody was named.
- `counts` is the number of answers behind each share.

### `GET /responses/:id`
One stored answer:
```json
{
  "id": "r_…", "brandId": "tasklane", "model": "perplexity", "prompt": "…",
  "fetchedAt": "2026-11-02T09:14:00Z", "day": "2026-11-02",
  "status": "ok", "failureReason": null, "text": "…",
  "ownBrandMentioned": true, "vendorIsMentioned": true,
  "mentions": [ { "name": "Kanbrik", "domain": "kanbrik.com", "position": 2 } ],
  "citations": [ "https://kanbrik.com/pricing" ],
  "rawCitations": [ "https://kanbrik.com/pricing" ]
}
```
- `status` is `"ok"`, or `"failed"` for an answer we shouldn't count. `failureReason` says why: `http_error`, `empty_text`, `prompt_echo` or `refusal`. It is `null` when the status is `"ok"`.
- `ownBrandMentioned` is our own reading of the text. `vendorIsMentioned` is what the vendor claimed, kept for comparison.
- `mentions` lists the *other* brands named in the answer, not the client's own. `domain` can be `null`.
- `citations` are the source pages the answer cites, as full `https://` links. Our app shows them to clients as clickable links. `rawCitations` is the list as the vendor sent it.
