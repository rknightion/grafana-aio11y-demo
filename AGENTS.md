# grafana-cloud-agento11y-demo

The public Touchline AI observability demo: a Terraform module (`terraform/`), the `touchline` Helm
chart (`charts/touchline/`), the app images (`apps/`) and the EC2 agent host (`agent-host/`). It is
a public repository, so nothing committed here may name a customer, an account id or a credential.
`tools/scrub_check.py` and the private `.scrub-denylist` in pre-commit are the gate.

## Task tracker

Backlog.md in `backlog/`, prefix `AIO`. `backlog task list --plain --exclude-status Done` is the
queue. Drive it through the CLI only; `backlog/config.yml` is the one file edited by hand.

- **Never use `--notes`, `--plan` or `--final-summary` bare**, because they replace the whole
  section. Use `--append-notes`, `--append-plan`, `--append-final-summary` or `--comment`.
- Statuses are `To Do`, `In Progress`, `Parked`, `Done`. `Parked` means attempted and blocked,
  with a concrete resume boundary.
- This public board deliberately does not carry the fan-out protocol (doc-0001 says why). Never
  import a copy here.

## Task interface

`just check` is the gate (fmt-check, `tofu validate`, tflint, helm lint and kubeconform, shellcheck,
scrub, Node tests). `just ci` adds image builds and needs Docker. `tofu -chdir=terraform validate`
needs `tofu -chdir=terraform init -backend=false` after a provider lock bump.

## Releases

release-please cuts `vX.Y.Z` from conventional commits. Its PR bumps `terraform/variables.tf`
(the `images.tag` default), the chart version and appVersion, and the reference docs. The images
workflow publishes `ghcr.io/rknightion/gc-agento11y-<app>:<version>` on release. A consumer
can pin `?ref=vX.Y.Z` only after those images exist. Releases up to v0.2.0 predate the rename from
`grafana-aio11y-demo`: their images are `grafana-aio11y-demo-<app>` and must stay pullable.

## Gotchas

- **Changing the image tag replaces the agent host.** `images.tag` is rendered into the host's
  user data, so a module bump that moves the tag destroys the EC2 host. The gateway Postgres lives
  on it with no separate volume, so spend history resets and developers sign in again (about 30
  minutes before the Claude Code and gateway dashboards fill).
- **`traffic_enabled` does not replace the host.** It lives in the agent-host secret, which the host
  re-reads within 5 minutes, and in the chart values, which scale the load generator to 0 and
  suspend the `site-browser` and `experiments` CronJobs.
- **A new counter series can arrive already holding its first increments**, so `increase()` reads
  0. In an `increase(...) or (X unless X offset 30m)` alert, keep the left side `> 0`, or its
  zero-valued series hides the new-series branch.
- `agento11y_hook_evaluations_total` files pass traffic under `rule_id="none"`. Per-rule guard
  outcomes, including passes, are on `agento11y_hook_rule_outcomes_total`.
- The experiments CronJob fires on only 40% of its slots (`apps/agents/experiments/run-experiment.mjs`),
  so a completed job with `"fires": false` is expected.
- The App Observability `team` span-metrics dimension has no API or Terraform resource. Adding it
  is a manual step in the stack's Application Observability settings.

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.53.0 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
