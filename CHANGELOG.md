# Changelog

## [0.4.2](https://github.com/rknightion/grafana-cloud-agento11y-demo/compare/v0.4.1...v0.4.2) (2026-10-02)


### Bug Fixes

* **dev-session:** skip prompts another developer started recently ([2da17ef](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/2da17efe6b0000118c11d44aabf6566e6d10c7d4))

## [0.4.1](https://github.com/rknightion/grafana-cloud-agento11y-demo/compare/v0.4.0...v0.4.1) (2026-10-02)


### Bug Fixes

* **deps:** force @opentelemetry/core 2.11.0 in apps/agents ([3e6ad14](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/3e6ad140b57bf0076ca8f57b4c6755eb1206d394))
* **deps:** update dependency @aws-sdk/client-bedrock-runtime to v3.1143.0 ([#36](https://github.com/rknightion/grafana-cloud-agento11y-demo/issues/36)) ([a1febab](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/a1febabca47ca528694e585e39937a91ae17bc93))
* **deps:** update dependency @aws-sdk/client-bedrock-runtime to v3.1144.0 ([#38](https://github.com/rknightion/grafana-cloud-agento11y-demo/issues/38)) ([8c156fe](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/8c156fe0110c1b663440f31bd1d58f9a5d3633bc))
* **deps:** update dependency @aws-sdk/client-bedrock-runtime to v3.1145.0 ([#42](https://github.com/rknightion/grafana-cloud-agento11y-demo/issues/42)) ([f01d357](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/f01d35782a5dc92bd8565e97d9379a0e016d6c74))
* **images:** take Debian security upgrades in site-browser and dev-workstation ([f527f54](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/f527f5413a3d763f6f51086bbd0fd41b8a937626))


### Documentation

* add a screenshots gallery page ([6179ec7](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/6179ec768267a544c7dcda188a33c3894ba38dcf))
* keep diagram source HTML out of the published site ([9ed258c](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/9ed258c942e08d883104f2d72b2efbeee2b33e41))
* replace the Mermaid architecture diagrams with designed images ([b6c9749](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/b6c97496836fc850e8cfc63046f905c6be5d972f))

## [0.4.0](https://github.com/rknightion/grafana-cloud-agento11y-demo/compare/v0.3.0...v0.4.0) (2026-09-29)


### Features

* more Agent Observability: tool guards in tiers, new evals and five test suites ([7d92497](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/7d92497a62b86dd3c340d820481813b3454d8978))


### Documentation

* describe pre-rename image names without the old literal ([da6552f](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/da6552fd28006e69e04e8f18fe8313586d70ccc1))

## [0.3.0](https://github.com/rknightion/grafana-cloud-agento11y-demo/compare/v0.2.0...v0.3.0) (2026-09-29)


### Features

* rename the project to grafana-cloud-agento11y-demo ([981dfe5](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/981dfe5e545c0b34654cc542d87c416bca96ef8c))


### Build & CI

* **dev-workstation:** let Renovate keep the agento11y CLI and plugin current ([33ce015](https://github.com/rknightion/grafana-cloud-agento11y-demo/commit/33ce015b3cb8001f7bd271ad0a248e90cf9694f2))

## [0.2.0](https://github.com/rknightion/grafana-aio11y-demo/compare/v0.1.1...v0.2.0) (2026-09-29)


### Features

* **corpus-gen:** grow the traffic corpora with Haiku, committed only after review ([0fe6e1b](https://github.com/rknightion/grafana-aio11y-demo/commit/0fe6e1bbf334a496b0383f2365d448a2e3f9ad1c))
* **dev-sessions:** a seeded Touchline codebase, multi-turn sessions and PII bursts ([912c4cf](https://github.com/rknightion/grafana-aio11y-demo/commit/912c4cf71970745ce416b466645352c8c7ccd60e))
* **traffic:** reader personas, a shared question corpus and a daily traffic curve ([b7bc52c](https://github.com/rknightion/grafana-aio11y-demo/commit/b7bc52c4fb224508c23122ce6adbdc9ce9c20732))


### Documentation

* add the Backlog.md managed block to AGENTS.md ([7489bda](https://github.com/rknightion/grafana-aio11y-demo/commit/7489bda4cbf9ecc64cb9e831d5e3452c9071aa5f))
* keep the fan-out protocol off the public board ([cc8fc95](https://github.com/rknightion/grafana-aio11y-demo/commit/cc8fc9596230dec89f13df8e59a83b0220c97713))

## [0.1.1](https://github.com/rknightion/grafana-aio11y-demo/compare/v0.1.0...v0.1.1) (2026-09-28)


### Bug Fixes

* **ci:** rebuild the Renovate config change on current main ([#4](https://github.com/rknightion/grafana-aio11y-demo/issues/4)) ([9c54976](https://github.com/rknightion/grafana-aio11y-demo/commit/9c54976da5c16b6f0f8c5159c8780bc499b99cb2))
* **rules:** let the guard alerts fire on a counter's first denies ([a79e2df](https://github.com/rknightion/grafana-aio11y-demo/commit/a79e2df4d370cf034a98c39f986f0bb0cda8d288))


### Documentation

* de-AI pass over the component READMEs and variable descriptions ([9c5ac0d](https://github.com/rknightion/grafana-aio11y-demo/commit/9c5ac0d660d5a7230e7f45c078fa81d00a341a0e))
* fix nine stale or wrong claims found by a docs-versus-code sweep ([059f12f](https://github.com/rknightion/grafana-aio11y-demo/commit/059f12f87ebf5814143f30a66fbb5be3d043cd63))
* note in-cluster pod log tailing and the pushed agent name ([7c3c6f5](https://github.com/rknightion/grafana-aio11y-demo/commit/7c3c6f5e599f667668c2c445b9556bc96d4e778c))
* put the dashboard screenshots where each dashboard is described ([d4a6ae5](https://github.com/rknightion/grafana-aio11y-demo/commit/d4a6ae5ed58338b859d7635efd6e90ac7df32537))


### Build & CI

* add a ci-success aggregator over check and scrub ([2f85f73](https://github.com/rknightion/grafana-aio11y-demo/commit/2f85f738a38269fb9d5c3f6dd7a72a897ad70ffc))
* bump container-publish to v1.25.3 for the shared registry build cache ([d519242](https://github.com/rknightion/grafana-aio11y-demo/commit/d519242c04dfb8ff698e4458d1356a8909de1c06))

## 0.1.0 (2026-09-24)


### Miscellaneous

* release 0.1.0 ([6ebbfc0](https://github.com/rknightion/grafana-aio11y-demo/commit/6ebbfc09483bb63689a63cf231881dd7722afa7a))
