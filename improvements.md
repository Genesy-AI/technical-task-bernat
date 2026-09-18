# General Improvements
- The frontend should be fully responsive
- 


# Test Coverage Review 

- The unit testing on the code is not broadly covering but the few tests existing are thorough and high quality. The rest of the codebase should be covered in unit tests held to that same standard
- Frontend typecheck fails. One pre-existing error at useApiMutation.ts:64 — optimistic lead missing emailVerified. Known baseline, not from this branch (fix/email-verification-stalls is currently identical to main).
- ESLint is non-functional. ESLint 9.34 plus plugins are installed, but the config is a legacy .eslintrc.cjs; v9 requires flat eslint.config.js. pnpm lint errors out with "couldn't find an eslint.config.(js|mjs|cjs) file". So react-hooks and @typescript-eslint rules are effectively enforcing nothing. Backend has no linter at all.
- Prettier drift — 6 files fail --check: backend src/workflows/{index.ts,activities/index.ts,activities/utils.ts} (4-space indent + semicolons) and pnpm-lock.yaml; frontend verifyEmails.ts and LeadsList.tsx. Note this differs slightly from CLAUDE.md's list — useApiMutation.ts is currently formatted correctly.
- Coverage reporting doesn't work. Both packages have a test:coverage script and the backend vitest.config.ts declares provider: 'v8', but @vitest/coverage-v8 isn't in either package.json (only @vitest/ui is installed). The script would prompt to install on first run.
- No CI. No .github/ directory, no workflows — nothing runs tests, typecheck, or format on push.
- No git hooks. No husky, no lint-staged; .git/hooks holds only samples

# Security Review



**Scope:** `backend/` (Express 5 + Prisma + Temporal) and `frontend/` (React 18 + Vite), reviewed as if deployed as a live production service holding real lead PII.

**Date:** 2026-09-18 · **Branch reviewed:** `fix/email-verification-stalls`

Severity is relative to a production deployment. Line references are to the state of the branch at review time.

> **Note on the Temporal hang:** the unbounded-retry defect (`startToCloseTimeout: '1 second'` with no retry policy) is **fixed** on this branch — `src/temporalConfig.ts` now sets a finite `maximumAttempts`, a `scheduleToCloseTimeout` backstop, and a deterministic `workflowId`. Finding 5 covers only what remains.

---

## Summary

| # | Finding | Severity |
|---|---|---|
| 1 | No authentication or authorization on any route | Critical |
| 2 | Unauthenticated bulk PII disclosure | Critical |
| 3 | Unauthenticated destructive operations | Critical |
| 4 | Wildcard CORS (`Access-Control-Allow-Origin: *`) | High |
| 5 | Request-blocking enrichment loop + in-process worker | High |
| 6 | Error and stack-trace disclosure | High |
| 7 | Server-side input validation effectively absent | High |
| 8 | Injection risks in the outbound-message path | Medium |
| 9 | Secrets and production-shaped data in version control | Medium |
| 10 | No rate limiting or abuse controls | Medium |
| 11 | Missing transport and browser hardening | Medium |

**Not vulnerabilities** (checked explicitly): no SQL injection — Prisma parameterises all queries and there is no `$queryRaw` in the codebase. No XSS in the current UI — nothing uses `dangerouslySetInnerHTML` or `innerHTML`. No CSRF exposure *yet*, solely because there are no cookies to ride.

---

## 1. No authentication or authorization — CRITICAL

- **Location:** all 9 routes in `backend/src/index.ts`; `model lead` in `backend/prisma/schema.prisma`
- No auth middleware, session, bearer token, or API key check exists on any route.
- No `userId` / `orgId` / `tenantId` column on `lead`, so there is no data model capable of expressing ownership even if auth were bolted on.
- No role separation: read, write, and destructive operations are equally available to an anonymous caller.
- **Impact:** anyone who can resolve the hostname has full CRUD over the entire dataset.
- **Fix:** auth middleware ahead of all `/leads` routes, plus a tenancy column scoped into every Prisma `where` clause.

## 2. Unauthenticated bulk PII disclosure — CRITICAL

- **Location:** `index.ts:57-61` (`GET /leads`), `index.ts:47-55` (`GET /leads/:id`)
- `prisma.lead.findMany()` is called with no arguments at all: no `where`, no `take`/`skip`, no `select`.
- Returns `firstName`, `lastName`, `email`, `jobTitle`, `companyName`, `countryCode`, and the generated outreach `message` for every row in the table.
- `GET /leads/:id` performs no ownership check. IDOR is not even required — the collection endpoint already returns everything.
- **Impact:** a single unauthenticated `GET` exfiltrates the complete lead database. Under GDPR Art. 33 this is a notifiable personal-data breach.
- **Fix:** auth + tenancy scoping, mandatory pagination, explicit `select` allowlist rather than returning whole rows.

## 3. Unauthenticated destructive operations — CRITICAL

- **Location:** `index.ts:88-113` (`DELETE /leads`), `index.ts:78-86` (`DELETE /leads/:id`)
- `DELETE /leads` accepts an arbitrary `ids` array and runs `deleteMany` — one request can remove every row.
- Hard deletes: no `deletedAt` column, no recovery path short of a backup restore.
- No audit log, no actor recorded, no confirmation step or token.
- **Impact:** anonymous, unrecoverable, untraceable destruction of the dataset.
- **Fix:** auth, soft deletes, a per-request cap on `ids.length`, and an append-only audit trail.

## 4. Wildcard CORS — HIGH

- **Location:** `index.ts:18` — `res.header('Access-Control-Allow-Origin', '*')`
- Hand-rolled CORS rather than the `cors` package: no origin allowlist, no `Vary: Origin`, no per-environment configuration.
- **The primary risk is browser-mediated pivoting.** If the API sits on an internal network or behind a VPN while the frontend is public, any website an employee visits can read and destroy the internal lead database using that employee's browser and network position.
- `*` is incompatible with `credentials: 'include'`, so this header must change before cookie-based auth can be introduced — and changing it breaks any client that came to depend on it.
- **Fix:** explicit origin allowlist sourced from config; adopt the `cors` middleware.

## 5. Request-blocking enrichment loop and in-process worker — HIGH

The infinite-retry hang is fixed. These four issues remain:

- **Sequential blocking:** `index.ts:290-315` `await`s `client.workflow.execute()` once per lead inside the request handler. Per-workflow time is now capped at 3 minutes by `VERIFY_EMAIL_WORKFLOW_EXECUTION_TIMEOUT`, but total request time scales as *N × 3 min* with no ceiling on *N* — an unauthenticated caller can hold a connection open for hours.
- **No cap on `leadIds` length:** the only bound is the 100 KB default of `express.json()`, which still admits thousands of ids per request.
- **Worker shares the API process:** `index.ts:332-335` runs `runTemporalWorker()` in-process and calls `process.exit(1)` on any worker error. Worker saturation degrades the API, and a worker crash terminates the HTTP server — reachable by an unauthenticated request.
- **New Temporal connection per request:** `index.ts:282-283` opens and closes a `Connection` on every call instead of reusing a module-scoped client.
- **Fix:** `start()` the workflow and let the client poll for status; cap `leadIds.length`; run the worker as its own process with its own supervisor; hoist the Temporal client to module scope.

## 6. Error and stack-trace disclosure — HIGH

- **No error-handling middleware exists** in `index.ts`, so unhandled rejections reach Express's default `finalhandler`, which **includes the stack trace in the response body whenever `NODE_ENV !== 'production'`**.
- **Reproducible trigger:** `GET /leads/abc` → `Number('abc')` is `NaN` (`index.ts:51`) → Prisma throws → 500 with stack.
- **Raw Prisma messages are returned by design** in the partial-success arrays: `index.ts:160`, `index.ts:244`, and `index.ts:312` each forward `error.message` to the client, leaking schema, constraint, and driver internals.
- `index.ts:243` additionally echoes the full submitted `lead` object back inside the error payload.
- **Fix:** central error middleware returning opaque messages plus a correlation id; log detail server-side only; set `NODE_ENV=production` in deployment.

## 7. Server-side input validation effectively absent — HIGH

- No validation library. Every guard is a hand-rolled truthiness check.
- **Email format is never validated server-side.** `index.ts:188-200` accepts any non-empty string. The only format check lives client-side in `frontend/src/utils/csvParser.ts:15-18` and is bypassed by calling the API directly.
- **No length limit on any field** — a 100 KB string is stored verbatim in `firstName`, `companyName`, or `template`.
- **Unsafe coercion:** `Number(id)` yields `NaN` on non-numeric input (`index.ts:51`, `:103`, `:134`); `String(name)` at `index.ts:71-72` writes the literal string `"undefined"` when `PATCH` omits a field.
- **Unbounded query fan-out:** `index.ts:208-214` expands N submitted leads into an N-clause Prisma `OR`. SQLite's default `SQLITE_MAX_EXPR_DEPTH` is 1000, so large imports fail with a 500 rather than a clean validation error.
- **Validation is duplicated and divergent:** client and server apply different rules, and the server — the only authority that matters — is the weaker of the two.
- **Fix:** one Zod (or equivalent) schema per route, shared with the frontend so the two cannot drift; `.max()` on every string; explicit array-length caps.

## 8. Injection risks in the outbound-message path — MEDIUM

- **Replacement-pattern injection — confirmed by execution.** `backend/src/utils/messageGenerator.ts:34` passes attacker-controlled `fieldValue` as the *replacement* argument to `String.replace`, where `$&`, ``$` ``, `$'`, and `$1` are special:

  ```
  template:  "Hi {firstName}, welcome to SECRET-CONTEXT"
  firstName: "$&$`"
  result:    "Hi {firstName}Hi , welcome to SECRET-CONTEXT"
  ```

  A lead field can splice unrelated parts of the template into the rendered message. None of the file's 24 tests cover this. **Fix:** pass a replacer *function* instead of a replacement string.
- **Downstream CSV formula injection / stored XSS:** unvalidated field content (finding 7) is composed into `message` and persisted. React's JSX escaping protects the current table, but a `firstName` of `=HYPERLINK("http://evil/",..)` or an HTML payload becomes live the moment messages are sent as HTML email or exported to CSV — both natural next features for this product.
- **Unbounded template amplification:** `template` has no length cap and is written to the `message` column of every selected lead.

## 9. Secrets and production-shaped data in version control — MEDIUM

- **`backend/prisma/dev.db` is git-tracked and contains lead records.** Confirmed by reading names and email addresses out of `git show HEAD:backend/prisma/dev.db`. Data committed to git history is permanent.
- **Third-party provider API keys are in plaintext** in `README.md`: `mySecretKey123`, `1234jhgf`, `000099998888`. Throwaway credentials in this exercise, but this is the pattern that ships.
- **`frontend/.env` is git-tracked.** Its current contents are harmless (`VITE_API_URL=http://localhost:4000`), but every `VITE_*` variable is inlined into the public JS bundle — any secret placed there is published to all users.
- `backend/.env.sample` advertises a `DATABASE_URL` that nothing reads (`schema.prisma` hardcodes `file:./dev.db`), so an operator's attempt to configure credentials silently has no effect.
- **Fix:** untrack `dev.db` and rotate anything ever committed; read keys from the environment only; treat every `VITE_*` value as public by definition.

## 10. No rate limiting or abuse controls — MEDIUM

- No `express-rate-limit`, no proxy-level throttling, no per-IP or per-account quota on any route.
- `POST /leads/verify-emails` is an unauthenticated **email-validation oracle**: a caller can probe deliverability for arbitrary addresses at no cost.
- Once the phone-enrichment providers from the README are wired in, the same endpoint shape becomes a way to **burn paid provider quota** — the README notes those providers are about to introduce rate limits, so exhausting them degrades the product for all tenants.
- No request logging or metrics, so abuse is neither detectable nor attributable after the fact.
- **Fix:** rate limiting at the edge and per-route; per-tenant quotas on provider-backed endpoints; structured request logging with retention.

## 11. Missing transport and browser hardening — MEDIUM

- **No `helmet` or equivalent:** no CSP, no HSTS, no `X-Content-Type-Options: nosniff`, no frame-ancestors protection.
- **No TLS enforcement:** `frontend/.env` points at `http://`, and the backend neither redirects nor sets HSTS. Lead PII would transit in cleartext.
- **React Query Devtools ships in the production bundle:** `frontend/src/Providers.tsx` mounts `<ReactQueryDevtools />` unconditionally, exposing the full client-side query cache unless gated behind an environment check.
- **Hardcoded listen port:** `index.ts:328` hardcodes `4000` with no environment override, so the service cannot be reconfigured per environment.

---

## Recommended sequencing

**Blocks launch — do not deploy without these**

1. Authentication + a tenancy model (findings 1, 2, 3). Everything else is an amplifier on this; nothing below matters until it is done.
2. Origin allowlist replacing wildcard CORS (finding 4).
3. Split the Temporal worker out of the API process; convert enrichment endpoints to `start()`-and-poll (finding 5).

**First hardening pass — roughly one day's work, closes most of the remainder**

4. Central error middleware; stop returning raw Prisma messages; `NODE_ENV=production` (finding 6).
5. A shared validation schema layer, with length and array-size caps (finding 7).
6. `helmet`, TLS enforcement, gate the devtools, port from environment (finding 11).
7. Rate limiting and structured request logging (finding 10).

**Follow-up**

8. The `String.replace` replacer-function fix and a regression test in `messageGenerator.test.ts` (finding 8) — a one-line change in the repo's best-tested file.
9. Untrack `dev.db`, purge it from history, rotate any real credentials, remove the misleading `.env.sample` (finding 9). This needs history rewriting, not just a `.gitignore` entry.
10. Plan for the export and HTML-email paths before building them, so field sanitisation lands with the feature rather than after it (finding 8).
