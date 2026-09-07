# Stakeholder Map — aidlc-fleet Distribution CLI

| Stakeholder | Interest | Decision-maker / Influencer | Communication requirement | Source |
|---|---|---|---|---|
| Primary maintainer / operator (multi-project AI-DLC user) | Wants one central declaration of engine version + plugin set that every project can safely follow via `update`/`check`, without corrupting composed plugin surfaces or silently degrading | Decision-maker — sole described stakeholder in the document | None described beyond the CLI's own `status`/`doctor`/`check` output | [Q2] [Q7] |
| Downstream projects (each individual AI-DLC-enabled project in the fleet) | Needs safe, idempotent engine/plugin updates that never infer success from exit code alone, and that preserve local modifications and receipt-external files | Not a distinct human stakeholder — represented by the primary maintainer/operator; confirmed accepted per the `## Assumption Confirmation` checkpoint | None described beyond the CLI's own `status`/`doctor`/`check` output | [Q1] [Q3] |
| Upstream project (`awslabs/aidlc-workflows`) | Owns the canonical engine/plugin compose logic this CLI must never modify or reimplement; this CLI is designed to retire once upstream ships RFC #722 / PR #756 | Influencer — sets the compatibility surface (install.ts, compose, plugin-targets.json) this CLI must track | None described; tracked via upstream tags/CHANGELOG, not a communication channel | [Q4] |

## Decision-makers vs. Influencers

- **Decision-maker**: the primary maintainer/operator — the document
  describes a single-operator context; no multi-team approval chain,
  product council, or delivery team is specified. [Q5] [Q6]
- **Influencer**: the upstream `awslabs/aidlc-workflows` project — its
  install/compose behavior and release cadence constrain what this CLI can
  safely automate, but it does not participate in this CLI's own scope or
  priority decisions. [Q4]

## Communication Requirements

None described in the source document. The CLI's own `status`, `doctor`,
and `check` commands are the only reporting surfaces defined; there is no
external stakeholder reporting cadence to track. [Q7]

## Assumptions & Open Questions

None. (The prior open assumption — whether "downstream projects" ever
represent distinct human stakeholders rather than the same operator across
multiple repos — was confirmed accepted by the human via the
`## Assumption Confirmation` checkpoint in `intent-capture-questions.md`.)
