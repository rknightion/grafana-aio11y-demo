---
id: AIO-0001
title: Make the demo synthetic traffic read like real customer usage
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 08:46'
updated_date: '2026-10-02 10:21'
labels:
  - traffic
dependencies: []
priority: medium
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Viewers of the dashboards and Agent Observability conversation lists can tell the traffic is synthetic within a minute. In-app reader questions are seven formal templates crossed with the fixture list, and every follow-up is the literal "Give one more concise detail for <question>". Every Claude Code developer session is one polished single-shot `claude -p` prompt from a pool of 57, a third of them about unrelated open-source repositories, all ending in the same boilerplate. Guard probes arrive at a steady rate. Chosen direction: a hybrid - a richer committed corpus now, plus a job that grows it with a small model and commits additions only after review. Subtasks carry the pieces; this parent closes when they are all Done.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every subtask is Done
- [ ] #2 A 30-minute sample of conversations in Agent Observability shows no two first messages with identical text outside deliberate repeats
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just check
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Lanes in one checkout, disjoint files, frozen seams (reader corpus apps/corpus/, prompt file format with '--- followup' turns, agent-host/codebase/seed-repo). Lane A: .01+.04 (loadgen, site-browser, corpus). Lane B1: .03+.05 (dev-session mechanism). Lane B2: .02 + PII prompt content (codebase, prompts). Lane C: .06 (corpus generator). Main thread wires, runs just check, commits per subtask, releases, bumps the lab consumer stack, then checks the live ACs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
All subtask code shipped in v0.2.0 and deployed to the lab 2026-09-29. Open: AC2 (30-minute no-duplicate sample) not sampled at Rob's request; AIO-0001.05 AC3 waits for the first live multi-turn session. Follow-on: renovate.json now tracks the agento11y CLI/plugin (33ce015).

2026-10-02: Rob chose to leave the lab down; the remaining live AC is proved on the next demo deploy, not by a standalone redeploy.

2026-10-02: v0.4.1 released and deployed to the lab by a full apply (156 added); touchline pods Running. Live ACs can now be sampled: dev sessions after the agent host's ~30-minute sign-in, the Experiments AC within 24h.
<!-- SECTION:NOTES:END -->
