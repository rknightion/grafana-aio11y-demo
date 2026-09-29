# Growing the traffic corpus

Two things make the synthetic traffic read like real usage instead of a chatbot demo loop:

- **The reader corpus** (`apps/corpus/readers.json` + `apps/corpus/readers.mjs`): personas, the
  intents each persona asks, and the phrasings/follow-ups for each intent. The in-app load
  generator and the site-browser CronJob both draw from it.
- **The developer prompts** (`agent-host/prompts/*.txt`): one Claude Code session per file, a
  `team: newsroom|trading|platform` header, a title, and one or more turns. Some are ordinary
  engineering tasks; files named `pii-*` are deliberate PII probes the preflight deny guard should
  block.
- **The fictional Touchline codebase** (`agent-host/codebase/`) the developer prompts run against,
  seeded fresh into each session's working directory.

Both corpora are committed and finite, so anyone watching the demo for long enough would start
spotting repeats. `apps/agents/corpus-gen/` grows them with a cheap model (Haiku on Bedrock), but
nothing it generates reaches the committed corpora without a person reviewing it first.

## The review-then-commit workflow

1. **Grow**: ask for candidates for one persona, intent, team or scenario. This calls the model and
   writes a review file — never the real corpus files.

   ```bash
   just corpus-grow reader-intent best-price          # more phrasings/follow-ups for an intent
   just corpus-grow reader-persona casual-fan 8        # a few new intents for a persona
   just corpus-grow dev-team trading 10 0.30           # new Claude Code session prompts for a team
   just corpus-grow dev-scenario best-price-brief       # a variant of an existing scenario family
   ```

   `just corpus-grow <kind> <name> <count> <max_usd>` runs
   `node apps/agents/corpus-gen/grow.mjs --kind <kind> --name <name> --count <count> --max-usd <max_usd>`.
   `<name>` is a persona id, an intent id, a team (`newsroom`/`trading`/`platform`), or an existing
   scenario stem (the filename of a prompt file, without `.txt`) to grow variants around.
   Add `--dry-run` to print the exact prompt the model would receive without spending anything.

2. **Review**: open the review file it printed the path to (default
   `corpus-review/<kind>-<name>-<timestamp>.json`, gitignored). It holds every candidate the model
   proposed, `status: "candidate"` if it passed validation and deduplication, `status: "rejected"`
   with a `reason` if it didn't. Change `status` to `"accepted"` on the ones you want; leave
   everything else alone.

3. **Accept**: merge only the entries marked `"accepted"`.

   ```bash
   just corpus-accept corpus-review/reader-intent-best-price-2026-01-01T00-00-00-000Z.json
   ```

   This re-validates before writing anything: a reader-corpus merge that would fail
   `validateReaderCorpus` (a bad placeholder, a duplicate id, an orphaned reference) aborts with no
   write at all, and a dev-prompt candidate whose target filename already exists is refused rather
   than overwritten. Reader-corpus candidates are merged into `apps/corpus/readers.json`; dev-team
   and dev-scenario candidates are written as new files under `agent-host/prompts/`.

4. **Diff and commit**: `git diff`, read what actually landed, then commit it like any other
   change. Nothing under `corpus-review/` is ever committed itself.

## Validation and deduplication

Every candidate is checked before it can reach `status: "candidate"`:

- **Reader-corpus candidates** (new phrasings/followups for an intent, or a whole new intent for a
  persona) are merged into a working copy of the corpus and checked with the real
  `validateReaderCorpus` from `apps/corpus/readers.mjs` — the same rules the load generator and
  site-browser depend on (unique ids, persona references resolve, only `{home}`/`{away}`/`{team}`
  placeholders).
- **Developer prompt candidates** are run through the same Seam 2 parser the real prompt files use
  (`team`/`title`/`effort`/`budget` header, `---`, turns separated by `--- followup`), so a
  candidate that wouldn't parse as a real prompt file never reaches the review file as a candidate.
- **Deduplication** runs against both the existing corpus and the rest of the batch: an exact match
  (after lowercasing and stripping punctuation) or a near-duplicate (token Jaccard similarity
  ≥ 0.8) is rejected with `reason: "duplicate"` rather than silently regenerating the same question.

## Spend

Every model call is priced from its own returned token usage against the same USD-per-million-token
table the load generator paces itself against (Haiku by default). Before starting a call, its
worst case — the input tokens plus the requested `maxTokens` output cap, both priced — must fit
under the remaining budget, or the run stops there rather than starting a call it can't account
for. `--max-usd` defaults to $0.50 and can never exceed the hard $2.00 ceiling built into the tool,
regardless of what's passed on the command line. The review file's `spend` block records the cap,
what was actually spent, and every call's estimate vs. actual cost.

## Tracing

Each `corpus-grow` run is itself a traced agent in Agent Observability — the same
`@grafana/agento11y` SDK pattern the in-app agents use, agent name `touchline-corpus-gen`, one
conversation per run, one generation recorded per model call with its real token usage. It exports
over the standard `OTEL_EXPORTER_OTLP_*` variables and needs `AGENTO11Y_ENDPOINT`,
`AGENTO11Y_AUTH_TENANT_ID` and `AGENTO11Y_AUTH_TOKEN` to reach Agent Observability. None of that is
required to run the tool: without it, `corpus-grow` prints a warning and proceeds with a no-op
tracing client.

## Required environment

- `CORPUS_GEN_MODEL_ID` — a Bedrock Haiku model id or inference profile ARN.
- `AWS_REGION` (or `AWS_DEFAULT_REGION`) — the Bedrock region, plus AWS credentials with
  `bedrock:InvokeModel` on that model/profile.
- `CORPUS_GEN_MODEL_NAME` (optional) — overrides the recorded/priced model name; defaults to a
  Haiku name.
- `AGENTO11Y_ENDPOINT`, `AGENTO11Y_AUTH_TENANT_ID`, `AGENTO11Y_AUTH_TOKEN` and the standard
  `OTEL_EXPORTER_OTLP_*` variables (optional) — for Agent Observability tracing.
