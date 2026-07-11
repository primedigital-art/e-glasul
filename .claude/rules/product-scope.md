# Product Scope Rules

## Phase 1 only

Treat the approved Phase 1 scope in `CLAUDE.md` as the active product boundary.

Before adding a feature, classify it as one of:

- `phase-1-required`
- `phase-1-supporting`
- `phase-2-deferred`
- `phase-3-deferred`
- `not-approved`

Do not silently move deferred features into Phase 1.

## Simplicity standard

Simplicity means fewer steps and clearer decisions for users. It does not mean weak security, missing audit history, unsafe data access, or undocumented behavior.

For every citizen-facing workflow:

- make the primary action obvious
- minimize required fields
- explain why sensitive data is requested
- provide clear success and error states
- preserve progress where practical
- avoid bureaucratic language

For every municipal workflow:

- show ownership and current status
- make assignment and next action obvious
- preserve history
- avoid hidden automatic changes
- provide filters that match daily operational work

## Product evidence

Do not use vague claims such as "easy", "fast", or "transparent" without defining how they are measured or verified.
