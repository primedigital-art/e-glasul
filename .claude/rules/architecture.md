# Architecture Rules

## Baseline

- Prefer a modular monolith for Phase 1.
- Define explicit module boundaries and ownership.
- Keep domain logic out of UI components and transport handlers.
- Use stable contracts between modules.
- Avoid circular dependencies.
- Avoid premature service extraction.
- Record material trade-offs in ADRs.

## Multi-tenancy

Every tenant-owned record must have an explicit tenant relationship.

All reads, writes, exports, notifications, background jobs, files, analytics, and administrative actions must preserve tenant boundaries.

Never rely only on UI filtering for tenant isolation.

## Data and workflows

- Use explicit workflow states and allowed transitions.
- Preserve status history separately from the current status.
- Do not overwrite audit-relevant facts.
- Define idempotency for operations that can be retried.
- Define file ownership and access rules.
- Define error behavior and recovery paths.

## Specifications before implementation

A technical specification must identify:

- affected modules
- data model impact
- API or action contracts
- authorization decisions
- tenant-isolation behavior
- validation rules
- failure modes
- observability needs
- migration impact
- test strategy

Do not create implementation code from an incomplete specification unless the user explicitly requests an exploratory prototype.
