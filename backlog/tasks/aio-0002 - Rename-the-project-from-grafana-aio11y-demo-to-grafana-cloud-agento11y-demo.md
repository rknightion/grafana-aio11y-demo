---
id: AIO-0002
title: Rename the project from grafana-aio11y-demo to grafana-cloud-agento11y-demo
status: To Do
assignee: []
created_date: '2026-09-29 09:25'
updated_date: '2026-09-29 09:40'
labels:
  - naming
dependencies: []
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The demo is about Grafana Cloud Agent Observability, and the product name is agento11y, so grafana-aio11y-demo names it after a term the product does not use. Rename the GitHub repository to rknightion/grafana-cloud-agento11y-demo and every grafana-aio11y / aio11y identifier inside the project. Outside the repo the rename reaches: the published GHCR images (ghcr.io/rknightion/grafana-aio11y-demo-<app>), which consumers pull by name; the Terraform module source URL that consumers pin (the private lab consumer stack); the docs-sync roster (docs-repos.json in the docs hub site repo) and the docs site slug; the release-please config and CHANGELOG links. GitHub redirects the old repo URL after a rename, but GHCR packages do not follow it, so old image tags must stay pullable until consumers move. Changing images.tag replaces the agent host (see AGENTS.md Gotchas), so the consumer move should ride a release bump anyway. The Backlog prefix AIO can stay.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The GitHub repository is rknightion/grafana-cloud-agento11y-demo and the local checkout's remote points at it
- [ ] #2 No tracked file outside CHANGELOG.md history entries and backlog/ contains grafana-aio11y or aio11y, checked with git grep
- [ ] #3 The previously published grafana-aio11y-demo-<app> images remain pullable
- [ ] #4 The docs site builds under the new name and the docs-sync roster lists the new repository
- [ ] #5 The images workflow publishes ghcr.io/rknightion/gc-agento11y-<app> for a release, and the image defaults in terraform/variables.tf, the chart and the images-push recipe point at them
- [ ] #6 The private lab consumer stack sources the module from the new repository URL at a released tag and plans cleanly
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 just check
<!-- DOD:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Requested wording: repository name grafana-cloud-agento11y-demo; identifiers renamed from grafana-aio11y to grafana-agento11y. Settle at pickup whether in-project identifiers (image names, docs slug, buildx builder) take grafana-agento11y-demo or match the repository name grafana-cloud-agento11y-demo; one name everywhere is simpler.

Decided (Rob): every in-project identifier matches the repository name grafana-cloud-agento11y-demo (image names ghcr.io/rknightion/grafana-cloud-agento11y-demo-<app>, docs slug, buildx builder, module source), not grafana-agento11y-demo. Supersedes the open question above.

Amended (Rob): images are the exception to the one-name rule. Publish them as ghcr.io/rknightion/gc-agento11y-<app> (e.g. gc-agento11y-agents, gc-agento11y-dev-workstation); everything else takes grafana-cloud-agento11y-demo. The images-push recipe's default prefix follows (gc-agento11y-).
<!-- SECTION:NOTES:END -->
