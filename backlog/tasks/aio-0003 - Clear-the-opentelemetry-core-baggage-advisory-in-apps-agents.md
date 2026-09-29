---
id: AIO-0003
title: Clear the @opentelemetry/core baggage advisory in apps/agents
status: To Do
assignee: []
created_date: '2026-09-29 10:07'
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
- [ ] #1 npm ls @opentelemetry/core in apps/agents shows no version below 2.8.0
- [ ] #2 Dependabot alert 9 is closed as fixed
- [ ] #3 The agents still export traces and generations to Agent Observability after the change
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just check
<!-- DOD:END -->
