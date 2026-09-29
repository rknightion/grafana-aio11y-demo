---
id: AIO-0002
title: Rename the project from grafana-aio11y-demo to grafana-cloud-agento11y-demo
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 09:25'
updated_date: '2026-09-29 11:21'
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
- [x] #1 The GitHub repository is rknightion/grafana-cloud-agento11y-demo and the local checkout's remote points at it
- [x] #2 No tracked file outside CHANGELOG.md history entries and backlog/ contains grafana-aio11y or aio11y, checked with git grep
- [x] #3 The previously published grafana-aio11y-demo-<app> images remain pullable
- [x] #4 The docs site builds under the new name and the docs-sync roster lists the new repository
- [x] #5 The images workflow publishes ghcr.io/rknightion/gc-agento11y-<app> for a release, and the image defaults in terraform/variables.tf, the chart and the images-push recipe point at them
- [x] #6 The private lab consumer stack sources the module from the new repository URL at a released tag and plans cleanly
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 just check
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. OpenBao (needs a fresh admin token): new permission set, policy and JWT role release-please-grafana-cloud-agento11y-demo (the old set names the repo by name, so it stops minting after the rename), and a new role docs-sync-grafana-cloud-agento11y-demo. Both roles bind repository_id, which survives the rename.
2. gh repo rename to grafana-cloud-agento11y-demo; repoint the local remote.
3. In-repo rename: workflows (image-name gc-agento11y-<app>, permission set, docs-sync role and payload), terraform/variables.tf and chart name_prefix gc-agento11y-, justfile images-push prefix and buildx builder, docs.toml, docs, READMEs, deploy/, examples/, AGENTS.md, backlog/config.yml project name. just check, then one feat commit so release-please cuts 0.3.0.
4. Docs hub: docs-repos.json entry, the projects slug map, and a 301 in the renamed-projects _redirects block.
5. Merge the release PR; confirm images publish as gc-agento11y-<app>:0.3.0, are public and pull anonymously; confirm old grafana-aio11y-demo-<app> tags still pull.
6. Private lab consumer stack: module source to the new URL at v0.3.0, tofu plan only (the host replacement is expected; Rob applies).
7. Delete the old OpenBao permission set, policy and roles once the new ones mint green.
8. Rename the local checkout directory and rekey the Claude Code project memory path.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Requested wording: repository name grafana-cloud-agento11y-demo; identifiers renamed from grafana-aio11y to grafana-agento11y. Settle at pickup whether in-project identifiers (image names, docs slug, buildx builder) take grafana-agento11y-demo or match the repository name grafana-cloud-agento11y-demo; one name everywhere is simpler.

Decided (Rob): every in-project identifier matches the repository name grafana-cloud-agento11y-demo (image names ghcr.io/rknightion/grafana-cloud-agento11y-demo-<app>, docs slug, buildx builder, module source), not grafana-agento11y-demo. Supersedes the open question above.

Amended (Rob): images are the exception to the one-name rule. Publish them as ghcr.io/rknightion/gc-agento11y-<app> (e.g. gc-agento11y-agents, gc-agento11y-dev-workstation); everything else takes grafana-cloud-agento11y-demo. The images-push recipe's default prefix follows (gc-agento11y-).

Decided (Rob, pickup): Claude merges the 0.3.0 release PR; the lab consumer stack gets a plan only, Rob applies; new gc-agento11y-<app> GHCR packages are made public if they come up private; the local checkout directory is renamed at the end and the Claude Code memory path rekeyed.
In-repo rename staged (not committed): 30 files, just check green. The rename commit waits for the new OpenBao permission set, because pushing it before the rename would point release-please at a set that cannot mint yet.

Done so far (2026-09-29):
- OpenBao: new permission sets, policies and roles release-please-grafana-cloud-agento11y-demo, renovate-repair-grafana-cloud-agento11y-demo (both repositories=grafana-cloud-agento11y-demo) and role docs-sync-grafana-cloud-agento11y-demo. Roles bind repository_id, which the rename kept.
- Repo renamed; remote repointed. Rename commit 981dfe5; the broker token opened release PR #25 (new permission set proven) and the Trigger Documentation Sync trigger-sync job succeeded (new role proven). v0.3.0 released from e3df39b.
- renovate-repair derives renovate-repair-<repo-name>, so its repos.txt, repair.md and lock followed (0110a5c). Its lock carries gh-aw-actions setup v0.90.0 from Renovate while its justfile pins the v0.89.21 compiler; only the repo line and frontmatter hash were changed, the pin drift is left.
- Docs hub: roster, slug, icon pair, social card and a 301 from /grafana-aio11y-demo/* (b6453f1). The renamed site builds strict in isolation; the full hub deploy has been red since 2026-09-28 on an unrelated broken anchor in another project's docs, so the new docs path 404s until that is fixed. Repo homepage URL left on the old path until then.
- New gc-agento11y-<app> GHCR packages came up public; anonymous pull works for all six, and all six old grafana-aio11y-demo-<app> packages still pull anonymously.
- Lab consumer: module source moved to the new URL at v0.3.0 and pushed; plan with -var enabled=true: 2 add, 1 change, 2 destroy (agent host and the render.py bundle object replaced, helm release updated to gc-agento11y- and 0.3.0). Not applied.

Verified: v0.3.0 publish run 36559350905 success; all six gc-agento11y-<app>:0.3.0 and grafana-aio11y-demo-<app>:0.2.0 manifests return 200 anonymously. AC #2: git grep -i aio11y outside backlog/ and CHANGELOG.md returns nothing. just check green after the release. Old OpenBao release-please, renovate-repair and docs-sync entries for the old name deleted; only the new-name entries remain.
AC #4 stays open: the roster lists the new repository and the site builds strict through the hub's own build-fleet in isolation, but the live hub deploy is red on an unrelated broken anchor in another project, so the new docs path is not served yet. Close it once a hub deploy succeeds, and then point the repository homepage at the new docs path.

AC #4 verified: the hub deploy was blocked by a broken anchor in another project's docs, fixed upstream. The hub run at 2026-09-29T11:18Z succeeded; the new docs path returns 200 and old-name paths 301 to it, deep links included. Repo homepage now points at the new docs path. Left for Rob: rename the local checkout directory once no Claude session is using it (commands handed over in chat).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Renamed the project to grafana-cloud-agento11y-demo: GitHub repo, every in-repo identifier, and images as ghcr.io/rknightion/gc-agento11y-<app> from v0.3.0. Moved the OpenBao release-please, docs-sync and renovate-repair entries to the new name and deleted the old ones, updated the renovate-repair target list, and moved the docs hub roster, slug and assets, with a 301 from the old path. Pointed the lab consumer at the new module URL at v0.3.0 (planned, not applied). Verified: new-set token minted release PR #25, the docs-sync trigger job succeeded, the v0.3.0 publish run succeeded, and all old and new image manifests return 200 anonymously. git grep shows no old identifier outside CHANGELOG and backlog, just check is green, the hub deploy succeeded, and the new docs path serves 200 with old paths 301. The lab consumer plan is 2 add, 1 change, 2 destroy (host replacement expected). Not done here: renaming the local checkout directory, which waits until no Claude session uses it.
<!-- SECTION:FINAL_SUMMARY:END -->
