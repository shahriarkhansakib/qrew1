---
name: architecture-decision-records
description: >-
  Capture consequential architectural decisions as numbered ADR markdown files in docs/adr/ with context, alternatives considered, and consequences. Use when choosing frameworks, database/ID strategies, security boundaries, or modifying module architecture.
---

# Qrew Architecture Decision Records (ADRs)

Record durable, hard-to-reverse engineering decisions in `docs/adr/` so every developer and agent shares the exact rationale and constraints.

## Directory Structure

```text
docs/adr/
├── README.md
└── NNNN-kebab-case-title.md
```

## ADR Template

```markdown
# ADR-NNNN: [Decision Title]

- **Date:** YYYY-MM-DD
- **Status:** proposed | accepted | deprecated | superseded by ADR-NNNN
- **Deciders:** [Project Owner / Engineering Team]

## Context

Describe the problem, architectural invariants, and constraints driving this decision.

## Decision

State the chosen architecture or design clearly in present tense.

## Alternatives Considered

### [Alternative Name]
- **Pros:** ...
- **Cons:** ...
- **Why rejected:** ...

## Consequences

- **Positive:** ...
- **Negative / Trade-offs:** ...
- **Verification:** How compliance with this decision is tested or enforced.
```

## Rules

1. Never edit or delete historical accepted ADRs silently; supersede them with a new numbered ADR and update `docs/adr/README.md`.
2. Keep each ADR concise (readable in under 2 minutes).
3. Link relevant ADRs from code/contracts rather than duplicating prose.
