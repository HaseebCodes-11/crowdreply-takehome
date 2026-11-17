# Graph Report - crowdreply-takehome  (2026-11-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 156 nodes · 374 edges · 9 communities
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1bc0c273`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Ingest pipeline: vendor feed -> validation -> brand detection -> in-memory store
- package.json: scripts, engines, dev dependencies
- Offline service stand-ins: DNS resolver, HTTP HEAD, LLM classifier (+ DATA_DIR config)
- HTTP API layer: server routes, handlers, API tests
- tsconfig.json: TypeScript compiler options
- Metrics: visibility windows, competitors, date handling
- detect.ts
- compilerOptions
- config.ts

## God Nodes (most connected - your core abstractions)
1. `loadAll()` - 17 edges
2. `competitors()` - 12 edges
3. `compilerOptions` - 11 edges
4. `getBrand()` - 9 edges
5. `allAnswers()` - 8 edges
6. `checkResponse()` - 8 edges
7. `unwrap()` - 8 edges
8. `countedAnswers()` - 7 edges
9. `answersFor()` - 7 edges
10. `getAnswer()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `reasonFor()` --calls--> `checkResponse()`  [EXTRACTED]
  test/ingest.test.ts → src/ingest.ts
- `askLlm()` --calls--> `sleep()`  [EXTRACTED]
  src/competitors.ts → src/util.ts
- `competitors()` --calls--> `today()`  [EXTRACTED]
  src/competitors.ts → src/metrics.ts
- `competitors()` --calls--> `answersFor()`  [EXTRACTED]
  src/competitors.ts → src/store.ts
- `competitors()` --calls--> `mapLimit()`  [EXTRACTED]
  src/competitors.ts → src/util.ts

## Import Cycles
- None detected.

## Communities (9 total, 0 thin omitted)

### Community 0 - "Ingest pipeline: vendor feed -> validation -> brand detection -> in-memory store"
Cohesion: 0.14
Nodes (20): askLlm(), bare(), Candidate, candidates(), Competitor, DomainHealth, domainHealth(), health (+12 more)

### Community 1 - "package.json: scripts, engines, dev dependencies"
Cohesion: 0.15
Nodes (12): competitors(), describeStats(), BadRequest, createServer(), daysParam(), Handler, NotFound, routes (+4 more)

### Community 2 - "Offline service stand-ins: DNS resolver, HTTP HEAD, LLM classifier (+ DATA_DIR config)"
Cohesion: 0.23
Nodes (13): IngestStats, countedAnswers(), ModelVisibility, today(), visibility(), windowStart(), allAnswers(), answersById (+5 more)

### Community 3 - "HTTP API layer: server routes, handlers, API tests"
Cohesion: 0.18
Nodes (17): failureReason(), checkResponse(), cleanMentions(), isRecord(), loadAll(), readBatch(), toAnswer(), ValidationError (+9 more)

### Community 4 - "tsconfig.json: TypeScript compiler options"
Cohesion: 0.14
Nodes (15): devDependencies, @types/node@22.10.2, typescript@5.8.3, engines, node, name, private, scripts (+7 more)

### Community 5 - "Metrics: visibility windows, competitors, date handling"
Cohesion: 0.28
Nodes (13): destinations, follow(), headWithRetry(), isGoogleSearchHost(), isRedirectLink(), normalizeCitations(), parse(), resolveRedirects() (+5 more)

### Community 6 - "detect.ts"
Cohesion: 0.23
Nodes (11): domainRegex(), escape(), isOwnBrandMentioned(), Matcher, matcherFor(), matchers, nameRegex(), bark (+3 more)

### Community 7 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, module, moduleResolution, noEmit, skipLibCheck, strict (+4 more)

### Community 8 - "config.ts"
Cohesion: 0.27
Nodes (6): DATA_DIR, NOW_OVERRIDE, PORT, DnsRecord, DnsStatus, HeadResult

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `loadAll()` connect `HTTP API layer: server routes, handlers, API tests` to `Ingest pipeline: vendor feed -> validation -> brand detection -> in-memory store`, `package.json: scripts, engines, dev dependencies`, `Offline service stand-ins: DNS resolver, HTTP HEAD, LLM classifier (+ DATA_DIR config)`, `Metrics: visibility windows, competitors, date handling`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **Should `Ingest pipeline: vendor feed -> validation -> brand detection -> in-memory store` be split into smaller, more focused modules?**
  _Cohesion score 0.1383399209486166 - nodes in this community are weakly interconnected._
- **Why does `Brand` connect `Ingest pipeline: vendor feed -> validation -> brand detection -> in-memory store` to `Offline service stand-ins: DNS resolver, HTTP HEAD, LLM classifier (+ DATA_DIR config)`, `HTTP API layer: server routes, handlers, API tests`, `detect.ts`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **Should `tsconfig.json: TypeScript compiler options` be split into smaller, more focused modules?**
  _Cohesion score 0.14166666666666666 - nodes in this community are weakly interconnected._
- **Why does `competitors()` connect `package.json: scripts, engines, dev dependencies` to `Ingest pipeline: vendor feed -> validation -> brand detection -> in-memory store`, `Offline service stand-ins: DNS resolver, HTTP HEAD, LLM classifier (+ DATA_DIR config)`, `Metrics: visibility windows, competitors, date handling`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._