---
title: "Entro Security"
subtitle: "Turning the complex landscape of Non-Human Identities and secrets management into an intuitive platform"
role: "Product Design Lead"
client: "Entro Security"
year: 2026
ongoing: true
tags: ["Cybersecurity", "B2B", "Non-Human Identities", "Secrets Management"]
cover: "/images/imports/entro/cover.webp"
gallery:
  - src: "/images/imports/entro/01.webp"
  - src: "/images/imports/entro/02.webp"
  - src: "/images/imports/entro/03.webp"
  - src: "/images/imports/entro/04.webp"
video: "https://www.youtube.com/watch?v=Ze9h2e4y8Wg"
animations:
  - src: "/animations/entro/slack-remediation.json"
    caption: "Sending a Slack alert straight from the risk card"
    width: 1780
    height: 1064
  - src: "/animations/entro/take-action.json"
    caption: "The action menu on an exposed identity — disable token, revalidate, raise a ticket"
    width: 1780
    height: 1063
  - src: "/animations/entro/lineage.json"
    caption: "Lineage map: an AI agent, what it can reach, and its human owners"
    width: 560
    height: 336
order: 1
---

## The Challenge

For every human employee in an organisation there are now dozens of identities that are not human: API keys, tokens, service accounts, certificates. They are created automatically every time one service talks to another, they are spread across cloud, code repositories and CI/CD tooling, and usually nobody remembers who made them or why.

For a security team that is a landscape which is close to impossible to map. It is hard enough to know what exists — harder still to know what is dangerous. A secret leaked into a public repository and a secret sitting exactly where it belongs look, at first glance, identical.

## The Solution

I lead product design at Entro, and my starting point is that a user should not have to hold the whole map in their head before they can begin.

Rather than presenting a long inventory and leaving the user to sort it, the platform opens on the practical question — **what is risky right now, and why** — and only then unfolds into depth: who created the secret, which systems it can reach, when it was last used, and what breaks if it is revoked.

## How That Shows Up

The work pulls between two ends that want opposite things: security researchers who want all the raw context, and managers who need one clear decision. The design tries to serve both in the same screen — a top-level picture that reads in a second, and layers that open only for the people looking for them.
