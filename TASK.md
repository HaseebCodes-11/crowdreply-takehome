# Take-home task: Brand visibility service

**Deadline:** send it back within 3 days. There's no time limit on the work itself. Spend what you think it needs, and tell us roughly how long it took.

**Tools:** use any AI tools you like. We expect you to.

## The situation

This folder is a small service like the one behind our product. Every day it receives AI answers from five models (ChatGPT, Perplexity, Gemini, Google AI Overviews and Google AI Mode) for each client's buyer questions. From those answers it works out:

- whether the client's brand was mentioned,
- its visibility,
- its competitors.

The answers come from a data vendor. The vendor's data is sometimes wrong, incomplete or missing, and the service has to cope with that. Everything runs offline. See [README.md](README.md) for how to run it and how it works.

## What clients are telling us

1. *"Our visibility looks too good to be true. When we open the answers, a lot of them don't mention us at all."* (Compass, a sales CRM)
2. *"This answer is literally about us, and your dashboard says we weren't mentioned."* (Bark & Bloom, pet grooming products)
3. *"ChatGPT visibility fell to almost nothing on Tuesday and came back on Thursday. Did we do something wrong?"* (Fieldnote, a research notes app)
4. *"Our competitor list includes Reddit, Amazon, Zoom and Slack. We sell project management software."* (Tasklane)
5. *"When I click a source under a Google AI Overview answer in your app, I land on a 404 page on your own website."* (Driftwell, a sleep app)

**These complaints don't cover everything.** There are other problems that no client has noticed yet. Part of the task is finding them.

## What to do

1. **Find every problem you can.** Start from the complaints, then look through the code and the data in `data/` for anything else that's wrong.
2. **Fix each one** in the code.
3. **Show each fix on the real data:** give example answers from `data/feed` by their `id`, as they looked before your fix and after it.
4. **Add one feature:** share of voice.

### The feature: share of voice

`GET /brands/:id/share-of-voice?days=90`

For each model, out of all the times the brand **or one of its real competitors** was named, what share went to each of them. Only count answers inside the window that we'd also count for visibility.

```json
{
  "brandId": "tasklane",
  "days": 90,
  "competitors": ["Kanbrik", "Plandrift"],
  "byModel": {
    "chatgpt": { "Tasklane": 0.31, "Kanbrik": 0.36, "Plandrift": 0.33 }
  }
}
```

- Count answers, not mentions. An answer that names Kanbrik twice counts once for Kanbrik.
- For each model, the shares add up to 1, or are all 0 if nobody was named.
- "Real competitors" means the competitor list in `/brands/:id/competitors` once it's right.

## What to send back

Zip the whole folder, **including the `.git` folder**, and send it to us. It should contain:

- **Your commits.** One commit per fix, with a clear message. Please don't squash them.
- **`NOTES.md`**, with this for each problem you found:
  - what the symptom was,
  - the root cause,
  - what you changed,
  - **examples from the data**: one or two answer `id`s (like `r_0a1b2c3d4e5f60`), with what they looked like before your fix and after it,
  - how you checked that it works.

  Also include:
  - problems you found but couldn't fix, and why,
  - at least one thing your AI tools got wrong, and how you caught it,
  - roughly how long the task took you.
- **Your AI setup:** your rules file, skills, and an export of your agent sessions if your tool supports it. A `.claude` or `.cursor` folder in the project is fine.
- **A screen recording of up to 5 minutes** walking us through your most important fix. A link in `NOTES.md` is fine.

## How we'll look at it

- We want you to find as many problems as you can, but correct fixes matter more than how many you make. One well-understood fix beats three guesses.
- Every fix should be backed by examples from the data.
- Keep the API paths and response shapes in the README as they are. Adding fields is fine.
- Don't weaken or delete existing tests to make them pass. Adding tests is welcome.
- Be honest in `NOTES.md`. "I didn't get to this" is a fine answer.
- After you send it, we'll do a 30-minute call where you walk us through it and make one small change live, with your AI tools.
