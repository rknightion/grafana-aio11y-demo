---
title: Cost
description: What grafana-aio11y-demo costs to run, and how to cap it.
---

# Cost

Rough on-demand estimates for the defaults in `eu-west-1`, with 730 hours a month. Check the AWS
pricing calculator for your region before relying on them.

| Item | Default | Approximate cost |
|---|---|---|
| EKS control plane | one cluster | USD 0.10/hour, about USD 73/month |
| EKS Auto Mode compute | agents, site, Redis, Alloy (about 0.5 vCPU and 1.9 GiB requested) | one or two small nodes plus the Auto Mode management fee, roughly USD 50 to 110/month |
| Agent host | `t4g.xlarge`, 60 GB gp3 | about USD 110/month |
| NAT gateway | one, from `examples/eks-auto-mode` | about USD 35/month plus USD 0.048 per GB processed |
| Secrets Manager, Firehose, metric stream, Cognito (5 users), CloudWatch | | a few USD/month |
| Bedrock, in-app agents | load generator at 2 questions/minute, its own daily budget guard (chart value `loadgen.dailyBudgetUsd`, USD 5/day by default) | usually well under the guard; a typical question costs under one US cent |
| Bedrock, Claude Code developers | 5 developers, a session every 20 minutes each, USD 0.30 hard budget per session | capped by the gateway: USD 20/day per developer by default, USD 5/day for the trading team, USD 2/day for one platform developer; so at most about USD 52/day |
| Bedrock, LLM-judge evaluations | 10 to 25% sampling on Haiku | small next to the traffic itself |
| Grafana Cloud | | see below |

Fixed infrastructure is roughly USD 280 to 340 a month. Bedrock is the variable part and, with
traffic on all day, usually the biggest.

## Kill switch

`traffic_enabled = false` stops the developer sessions, the load generator and the experiment
schedule without removing anything; Bedrock spend then drops to near zero while the dashboards
keep their history. This knob lives in the agent-host secret, not the host's user data, so the
host picks it up within 5 minutes without being replaced. `agent_host_enabled = false` removes the
host.

## Grafana Cloud

A free stack is enough to try the demo for a short time, but full content capture (prompts,
responses and tool content in logs) and Claude Code's per-session metric series grow quickly. For
a demo you leave running for days, use a paid or trial stack and watch the stack's usage
dashboards. Agent Observability, Frontend Observability and Application Observability are billed
under their own usage terms.

## See also

- [Teardown](teardown.md) to remove everything, or pause instead
- [Security](security.md) for what content capture actually turns on
