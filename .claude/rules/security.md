# Security and Privacy Rules

## Non-negotiable controls

- Deny access by default.
- Validate authorization server-side for every protected action.
- Treat tenant isolation as a security boundary.
- Never expose privileged service credentials to a client.
- Never log secrets, authentication tokens, complete uploaded documents, or unnecessary personal data.
- Validate input at trust boundaries.
- Restrict upload type, size, ownership, and access.
- Use signed or access-controlled file delivery where required.
- Record security-relevant actions in an audit trail.
- Avoid returning internal stack traces or sensitive implementation details to users.

## Privacy by design

Before collecting personal data, document:

- purpose
- minimum required fields
- visibility
- retention expectation
- export behavior
- deletion or anonymization behavior
- audit implications

Do not invent retention periods. Mark them as unresolved until validated with the municipality and legal/privacy specialists.

## Public-sector domain caution

Do not present generated content as legal advice.

When a requirement depends on Romanian law or an official public procedure:

- use current official sources
- cite the source in the domain note
- record the retrieval date
- distinguish national requirements from local practice
- mark uncertainty explicitly
