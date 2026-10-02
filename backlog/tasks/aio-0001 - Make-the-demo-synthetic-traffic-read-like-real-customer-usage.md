---
id: AIO-0001
title: Make the demo synthetic traffic read like real customer usage
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 08:46'
updated_date: '2026-10-02 14:07'
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
- [x] #1 Every subtask is Done
- [x] #2 A 30-minute sample of conversations in Agent Observability shows no two first messages with identical text outside deliberate repeats
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just check
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

AC2 failed live 2026-10-02 on v0.4.1: in a 30-minute window two newsroom developers (10:46Z and 10:53Z) drew the same newsroom-glossary-typo prompt and sent identical opening text; in-app titles had no repeats. Cause: each developer picked at random from its team pool (newsroom 15 prompts) with no coordination. Fix 2da17ef (Rob chose it): a shared recent-prompts volume on the agent host, written under a host-wide flock, from which pick_prompt drops anything started in the last 45 minutes. Scratch proof: 40 sequential newsroom picks gave 19 distinct before and 40 after; 36 concurrent picks from three pickers in a Linux container were all distinct; a held lock falls back after 30 s without writing. Re-sample after v0.4.2 is deployed.

AC2 live-verified 2026-10-02 on v0.4.3: the first 30 minutes of sessions after the redeploy (13:33:09Z to 14:03:09Z) held 37 conversations, 13 developer and 24 in-app, with no two sharing a title (titles are the first message truncated to 72 characters, so identical first messages would collide). It took two fixes: 2da17ef (v0.4.2) shares recent developer prompts across containers, and cfd54eb (v0.4.3) claims every in-app first question from loadgen and site-browser in the chart Redis for 45 minutes. The v0.4.2 window had passed for developers but repeated one site-browser question 21 minutes apart. just check green.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Synthetic traffic now reads like real usage: persona-based reader questions shaped by time of day and matchday, a fictional Touchline codebase with team-specific Claude Code prompts, occasional PII incidents, multi-turn and abandoned developer sessions, a reviewed corpus generator, and no repeated opening text across processes within 45 minutes. Verified live in Agent Observability on v0.4.3.
<!-- SECTION:FINAL_SUMMARY:END -->
