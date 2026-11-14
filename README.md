# Brand visibility service

A small service that reads AI answers from a data vendor and works out how visible each client's brand is in them. Start with [TASK.md](TASK.md).

## Running it

You need Node.js 22.18 or newer (it runs the TypeScript files directly, with no build step). There are no runtime dependencies.

```bash
npm start            # http://localhost:4600
npm test             # the existing tests
npm install && npm run typecheck   # optional: type checking needs TypeScript from npm
```

Settings, all optional:

| Variable | What it does | Default |
|---|---|---|
| `PORT` | Port to listen on | `4600` |
| `DATA_DIR` | Folder with the data | `./data` |
| `NOW` | "Today" for date windows, as `YYYY-MM-DD` | the newest answer in the feed |

## How it works

1. **Ingest** (`src/ingest.ts`) reads every file in `data/feed/`, one per day, and stores each answer.
2. **Detect** (`src/detect.ts`) decides whether the client's own brand is named in an answer.
3. **Metrics** (`src/metrics.ts`) works out visibility and competitors.
4. **Server** (`src/server.ts`) serves the results over HTTP.

Everything is in memory and rebuilt from `data/` on every start.

### The data

| Path | What it is |
|---|---|
| `data/brands.json` | The clients' brands we track |
| `data/feed/YYYY-MM-DD.json` | The vendor's daily batches of AI answers |
| `data/dns.json` | Backs the offline DNS resolver in `src/lib/dns.ts` |
| `data/llm/fixture.json` | Backs the offline LLM in `src/lib/llm.ts` |
| `data/redirects.json` | Backs the offline HTTP check in `src/lib/http.ts` |

The vendor asks five models: `chatgpt`, `perplexity`, `gemini`, `google_aio` (Google AI Overviews) and `google_ai_mode`. For each answer it sends the text, the citations, the brands it found (`mentions`) and its own view of whether the client's brand was named (`isMentioned`).

`src/lib/dns.ts`, `src/lib/llm.ts` and `src/lib/http.ts` stand in for a real DNS resolver, a real LLM API and real HTTP requests, so everything works offline. Use them as you would the real services, through their functions, and don't read their data files directly.

## API

Other parts of our product call these endpoints. **Keep their paths and response shapes as they are.** Adding fields is fine.

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
`answers` is the number of answers we count for that model, and `visibility` is `mentioned / answers`.

### `GET /brands/:id/competitors`
`{ "brandId": "tasklane", "competitors": [ { "name", "domain", "mentions" } ] }`

### `GET /responses/:id`
One stored answer:
```json
{
  "id": "r_…", "brandId": "tasklane", "model": "perplexity", "prompt": "…",
  "fetchedAt": "2026-11-02T09:14:00Z", "day": "2026-11-02",
  "status": "ok", "text": "…",
  "ownBrandMentioned": true,
  "mentions": [ { "name": "Kanbrik", "domain": "kanbrik.com", "position": 2 } ],
  "citations": [ "https://kanbrik.com/pricing" ]
}
```
- `status` is `"ok"`, or `"failed"` for an answer we shouldn't count.
- `mentions` lists the *other* brands named in the answer, not the client's own.
- `citations` are the source pages the answer cites, as full `https://` links. Our app shows them to clients as clickable links.
