# e-glasul

A multi-tenant SaaS platform for civic issue reporting, built for Romanian municipalities: citizens report problems in public space, municipal staff process them through a traceable workflow, and every record stays inside the boundary of the municipality it belongs to.

## Status

**Backend architecture and security layer: implemented and tested. Application UI: scaffolding.**

The database schema, tenant isolation model, authorization layer and workflow functions exist, are covered by an automated test suite, and are gated in CI. The two frontend applications are project skeletons — `apps/app` contains a single React component and its test, `apps/public` a single Astro page. No production UI has been written yet.

This repository is at the stage where the security model is settled and provable, and feature work builds on top of it.

## Stack

| Layer | Choice |
|---|---|
| Repository | pnpm workspace monorepo (`apps/*`, `packages/*`) |
| Public site | Astro 7 |
| Application | React 19 + Vite 8 + TypeScript 5.9 |
| Backend | Supabase — PostgreSQL, Auth, Storage |
| Hosting | Netlify, two separate projects from one repository (ADR-0001; not yet provisioned) |
| Tooling | Biome (lint + format), Vitest (unit), `node --test` (database) |
| Runtime | Node 24, pnpm 11 (pinned in `package.json` engines and `.nvmrc`) |

## Security architecture

Tenant isolation is treated as a security boundary enforced by the database, not by application code. Four migrations define six tables and fifteen RLS policies.

**Deny by default, with FORCE.** All six tables in `public` have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. FORCE matters: without it, the table owner bypasses its own policies, so a migration or an owner-context function would silently escape the boundary. There is no policy with `USING (true)` or `WITH CHECK (true)` for the `authenticated` role — a structural test rejects one if it ever appears.

**Tenant and role are read from the database, never from client input.** A [custom access token hook](supabase/migrations/20260713141309_access_token_hook.sql) runs at token issuance, reads `tenant_id` and `app_role` from the `tenant_users` table, and writes them into `app_metadata` — which the client cannot write. `user_metadata` is deliberately not used: it is client-writable via `auth.updateUser`, so an authorization claim placed there would let every user choose their own role. A user with no active row gets neither claim, both accessor functions return `NULL`, and every policy denies. Failure closes.

Every policy has the same shape: `tenant_id = (select current_tenant_id())` plus a role predicate. The tenant never comes from a request parameter.

**Privileged writes go through `SECURITY DEFINER` functions that re-establish the tenant boundary explicitly.** Status changes and assignment are not writable through the API — `issues` has no `UPDATE` or `DELETE` policy for `authenticated` at all. The only path is [`change_issue_status`](supabase/migrations/20260723120000_sesizari_schema.sql) and `assign_issue`, both of which run with `search_path = ''` and fully qualified references, re-derive the role from the JWT, and lock the target row with `FOR UPDATE ... WHERE tenant_id = current_tenant_id()` — taken from the token, never from an argument. A row in another tenant returns "not found" rather than a permission error, so the function does not confirm that the row exists. Concurrency is handled with an `expected_status` argument: a caller working from stale state is refused deterministically instead of overwriting.

**History is append-only by construction, not by convention.** `issue_status_history` and `issue_assignment_history` carry `SELECT` policies and nothing else. There is no `INSERT`, `UPDATE` or `DELETE` policy and no write grant for `authenticated`; the workflow function is the only writer, and it appends within the same transaction as the status projection. A direct `UPDATE` or `DELETE` against history from a client cannot be expressed.

**`service_role` is prohibited across the project.** It holds `BYPASSRLS`, so any use of it in application code, tests or seeds would make the isolation suite pass without proving anything. It appears in the repository only in comments explaining its absence, and the rule is written into the project's own working rules.

The role model is a four-value enum — `citizen`, `staff`, `leadership`, `tenant_admin` — with cumulative semantics centralized in a single `has_role()` function. There is no cross-tenant super-admin, and a structural test asserts the enum contains exactly those four values.

## Testing

54 tests run with the built-in Node test runner (`node --test`) against a local Supabase stack with the migrations replayed from zero.

The suite makes its assertions **exclusively through PostgREST, using the anon key plus JWTs of real users obtained from the Auth endpoint**. A direct Postgres connection is used only to query the catalog and to seed fixtures — never to assert isolation. This distinction is the point: seeding as a superuser writes exactly the rows a client must not be able to write, which is what makes the subsequent read assertions meaningful.

**12 structural gates** query the Postgres catalog directly (`pg_policies`, `information_schema`, `pg_proc`) and fail on the class of mistake rather than on a known instance:

- every table with `tenant_id` has RLS enabled, FORCE enabled, and at least one policy
- no table in `public` is left without RLS, even one without `tenant_id`
- no permissive `USING (true)` / `WITH CHECK (true)` for `authenticated`
- every `FOR UPDATE` policy has `WITH CHECK`, not only `USING` — otherwise a row can be updated out of its tenant
- `anon` holds no `INSERT`/`UPDATE`/`DELETE` anywhere in `public`
- every table with `tenant_id` has an index leading with `tenant_id`
- the token hook reads neither `user_metadata` nor client input
- history tables have no write grant and no write policy
- every `SECURITY DEFINER` function in `public` has a fixed `search_path` and no `EXECUTE` for `anon`/`PUBLIC`

**42 behavioral tests** exercise the policies as real users. **12 of them name a second tenant and assert the boundary holds**: reading another municipality's users, requesting its records by explicit id, granting a role inside it, moving a row into it by setting `tenant_id`, editing its branding, inserting an issue into it, assigning to one of its users, and invoking the `SECURITY DEFINER` workflow functions against its data — the last one specifically because a definer-rights function is where a tenant boundary is easiest to lose. The suite also includes positive controls, so a trivially broken configuration that denies everything fails too.

One test covers concurrency directly: two simultaneous calls to `change_issue_status` on the same issue, asserting that **exactly one succeeds** and that precisely one history row exists afterward. Refusals are verified against stored state — status value and history row count — rather than against HTTP codes, because a row hidden by RLS returns `200` with an empty array, not a `403`.

## CI and process

Two jobs run on every pull request to `main` and on every push to `main`. Both are required status checks, and `main` additionally enforces **`enforce_admins`** and **linear history** — the rules apply to the repository owner as well.

- **`Typecheck and build`** — migration guard, Biome lint and format check, typecheck of both apps, Vitest, build of both apps.
- **`RLS gates (C* + T*)`** — starts a local Supabase stack, replays every migration from zero, then runs the full 54-test database suite.

Running on `push` to `main` and not only on pull requests is deliberate: a squash merge produces a commit that never existed on any branch, and two independently green pull requests can produce a red `main`.

The **migration guard** (`scripts/check-migrations.mjs`) statically rejects eight dangerous patterns in migration files — `DROP POLICY`, `ALTER POLICY`, `DROP TABLE`, `DISABLE ROW LEVEL SECURITY`, `TRUNCATE`, `SECURITY DEFINER`, `DROP FUNCTION`, and `GRANT ... TO anon`. A pattern is allowed only when the file carries a `-- guard-approved: ADR-NNNN` marker **and** that ADR actually exists in `docs/decisions/`; a marker pointing at a non-existent decision fails the build. SQL comments are stripped before matching, so discussing a pattern in a comment does not trip it. The one approved use in this repository is the `SECURITY DEFINER` pair covered by ADR-0004.

Process rules are written down in [.claude/rules/](.claude/rules/): one task, one branch, one pull request, and no direct commits to `main`. Work items live in [docs/tasks/](docs/tasks/).

**AI-assisted development.** Much of this repository is written with Claude Code, operating under a written autonomy contract in [.claude/rules/autonomy.md](.claude/rules/autonomy.md). The agent picks up a task only when its acceptance criteria can be settled by running a command rather than by judgement, and it opens pull requests but never merges them. Merging, resolving open questions, and changing the status of a risk stay with a human. The constraint is the point: an agent that cannot merge cannot put an unreviewed change on `main`, and because `enforce_admins` is on, the gates above apply to its pull requests exactly as they apply to anyone else's.

## Architecture decisions

Material decisions are recorded as ADRs in [docs/decisions/](docs/decisions/), each with the alternatives considered, the consequences accepted, and its status:

- **ADR-0001** — Phase 1 technology and deployment baseline
- **ADR-0002** — Tenancy model and tenant resolution
- **ADR-0003** — Authentication and role model
- **ADR-0004** — Workflow functions: the `SECURITY DEFINER` contract

Technical specifications are in [docs/architecture/specs/](docs/architecture/specs/); open questions and the risk register in [docs/project/](docs/project/).

**The ADRs, specifications and inline migration comments are written in Romanian**, since they are reviewed with Romanian municipal stakeholders. Code, identifiers, schema and commit messages are in English.

## Getting started

Requires Node 24, pnpm 11, and Docker (for the local Supabase stack).

```bash
pnpm install

# Static checks, unit tests, builds, migration guard
pnpm verify

# Local database: start the stack, then replay all migrations from zero
pnpm db:start
pnpm db:reset

# The 54-test isolation suite (needs the local stack running)
pnpm test:db
```

Individual commands:

| Command | What it does |
|---|---|
| `pnpm verify` | `lint` + `typecheck` + `test` + `build` + `guard:migrations` |
| `pnpm test` | Vitest unit tests for `apps/app` |
| `pnpm test:db` | 54 database tests via `node --test` |
| `pnpm guard:migrations` | Static migration guard, no database needed |
| `pnpm db:reset` | Replays every migration from zero |
| `pnpm db:stop` | Stops the local stack |
| `pnpm tasks` | Lists work items and their status |

`pnpm verify` deliberately does not include `test:db`: the database suite requires a running stack, and is run as its own CI job.

Environment variables are documented in `.env.example`. The local Supabase anon key is the CLI's shared public default and is not a secret.

## Known limitations

- The frontend applications are scaffolding; no citizen or staff interface exists yet.
- Netlify hosting is decided in ADR-0001 but not yet provisioned — there is no `netlify.toml` in the repository.
- File upload, notifications, announcements and exports are specified but not implemented.
- Phase 2 and Phase 3 scope (payments integration, appointments, transparency portal, surveys) is explicitly deferred and not present in this codebase.
