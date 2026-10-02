---
id: AIO-0003
title: Clear the @opentelemetry/core baggage advisory in apps/agents
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-29 10:07'
updated_date: '2026-10-02 09:22'
labels:
  - deps
dependencies: []
priority: low
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dependabot alert 9 (moderate): @opentelemetry/core below 2.8.0 allocates unbounded memory in W3C Baggage propagation. apps/agents pins 2.11.0 directly, but @grafana/agento11y 0.13.0 pulls 2.6.x and 2.7.0 transitively (its bundled OTLP exporters and @google/adk). Either a newer @grafana/agento11y that lifts them or an npm override forcing @opentelemetry/core 2.11.0 would clear it; an override needs the SDK's exporters to still work, so the agents' telemetry must be checked after.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm ls @opentelemetry/core in apps/agents shows no version below 2.8.0
- [x] #2 Dependabot alert 9 is closed as fixed
- [ ] #3 The agents still export traces and generations to Agent Observability after the change
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just check
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add npm override forcing @opentelemetry/core 2.11.0 in apps/agents; 2. npm install, confirm npm ls shows no version below 2.8.0; 3. just check and node --test; 4. exercise the telemetry init locally
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shipped 3e6ad14: npm override @opentelemetry/core 2.11.0 in apps/agents; npm ls shows 35 copies, all 2.11.0. Dependabot alert 9 state fixed 2026-10-02T09:22Z. just check exit 0, 117 agents tests pass. Telemetry exercised locally: orchestrator against a local OTLP sink exports /v1/traces, identical to the pre-change baseline (metrics did not reach the sink in either run). AC3 stays open: generations to Agent Observability not checked, needs the lab stack.
<!-- SECTION:NOTES:END -->
