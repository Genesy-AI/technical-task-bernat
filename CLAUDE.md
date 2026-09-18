# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository. Read this before changing code.

## What this is

**TinyEnginy** — a small lead-management app: import leads from CSV, list them, enrich them
(verify emails, generate outreach messages from templates). Two independent packages, no monorepo
tooling: each is installed and run on its own.

```
backend/    Express 5 + Prisma (SQLite) + Temporal worker   → http://localhost:4000
frontend/   React 18 + Vite + TanStack Query + Tailwind v4  → http://localhost:5173
docs/       Sample CSVs + UI wireframes (use these as fixtures)
```

Data flows one way: **CSV file → `csvParser.ts` (client-side parse + validate) → `POST /leads/bulk`
→ Prisma → `GET /leads` → `LeadsList`**. Enrichment (email verify, future phone enrich) goes through
Temporal workflows started by the Express layer.

## Commands

Everything is `pnpm`, run from inside `backend/` or `frontend/` (there is no root package.json).
Node version is pinned in each `.nvmrc` (v22) — run `nvm use` first.

| | backend | frontend |
|---|---|---|
| install | `pnpm install` | `pnpm install` |
| dev | `pnpm dev` (nodemon + ts-node) | `pnpm dev` |
| test (watch) | `pnpm test` | `pnpm test` |
| test (once) | `npx vitest run` | `npx vitest run` |
| typecheck | `npx tsc -p . --noEmit` | `npx tsc -b` |
| build | `pnpm build` | `pnpm build` |
| format | `pnpm format` | `pnpm format` |

Backend one-time setup also needs `pnpm migrate:dev`, `pnpm gen:prisma`, and a running
`temporal server start-dev` (Temporal listens on `localhost:7233`).

**`pnpm test` starts Vitest in watch mode** and will hang a non-interactive session. Always use
`npx vitest run` when you need a single pass.

## Baseline state — know what is already broken

Do not attribute these to your change, and do not "fix" them silently as a side effect of unrelated work:

- **`frontend` typecheck fails on `main`.** `src/api/mutations/useApiMutation.ts:64` builds an
  optimistic lead without `emailVerified`, which `LeadsGetManyOutput` now requires. One error,
  pre-existing. Compare against this baseline rather than expecting zero errors.
- **`frontend`'s `pnpm lint` does not run.** ESLint 9 is installed but the config is a legacy
  `.eslintrc.cjs`; ESLint 9 wants flat `eslint.config.js`. Lint is effectively unavailable — rely on
  `tsc` and tests.
- **Prettier drift.** Six files are not formatted to their package's `.prettierrc.json`
  (`useApiMutation.ts`, `verifyEmails.ts`, `LeadsList.tsx`, and the three `src/workflows/**` files —
  the workflow files use 4-space indent and semicolons, unlike the rest of the codebase).
- **`backend/prisma/dev.db` is committed to git.** Running the app or `pnpm migrate:dev` dirties the
  working tree. Leave it out of your commits unless changing it is the point.
- **`backend/.env` does not exist and is not needed.** `schema.prisma` hardcodes
  `url = "file:./dev.db"`; `.env.sample` describes a MySQL URL that nothing reads. Don't wire up
  `DATABASE_URL` expecting it to take effect.

`pnpm format` runs `prettier --write .` across the whole package and will rewrite unrelated files.
Format only what you touched: `npx prettier --write src/path/to/file.ts` from inside the package.

## Architecture, file by file

### Backend

- `src/index.ts` — **every route lives in this one file.** No router/controller/service split, no
  validation library, no error middleware. Each handler: guard the body by hand, call Prisma, return
  JSON. Follow the existing shape rather than introducing a framework layer for a single endpoint.
- `prisma/schema.prisma` — single `lead` model. All enrichment fields are nullable.
- `src/utils/messageGenerator.ts` — pure template renderer (`{firstName}` → value). Throws on unknown
  or empty fields. **This is the best-tested file in the repo (24 tests) — keep it pure.**
- `src/worker.ts` — Temporal worker. **It is started in-process by `src/index.ts`**, so `pnpm dev`
  boots API + worker together. A crash in the worker takes down the API.
- `src/workflows/workflows.ts` — workflow definitions. `src/workflows/activities/utils.ts` — activities.
  Both re-exported through barrel `index.ts` files.

### Frontend

- `src/api/` is the seam worth respecting. `utils.ts` exposes an overloaded `endpoint()` helper;
  `modules/leads.ts` declares one line per route; `types/leads/<name>.ts` declares
  `Xxx Input` / `Xxx Output` per route. The `as const satisfies ApiModule` on `leadsApi` is what keeps
  `useApiMutation`'s path strings type-safe — don't drop it.
- `src/utils/csvParser.ts` — Papaparse wrapper that normalizes headers
  (`header.toLowerCase().replace(/[^a-z]/g, '')`), maps them through an explicit `switch`, and
  attaches per-row `isValid` / `errors`. **Validation happens here and again in the backend**; both
  sides must agree.
- `src/components/` — three large components (`LeadsList`, `CsvImportModal`, `MessageTemplateModal`),
  Tailwind utility classes inline, modals via `createPortal`. No component library, no `ui/` folder.
- `src/Providers.tsx` — QueryClient + `react-hot-toast` config. **Toasts are the only user-feedback
  channel**; every mutation has `onSuccess`/`onError` toasts.

## The checklists that actually matter

### Adding a field to `lead`

This is the repo's most common change and the field name is duplicated in **eight** places. Miss one
and the field silently disappears somewhere in the pipeline. In order:

1. `backend/prisma/schema.prisma` — add the column (nullable: existing rows have no value).
2. `pnpm migrate:dev` — generates `prisma/migrations/<ts>_<name>/migration.sql`. Commit it. Never
   hand-edit an existing migration.
3. `backend/src/index.ts` → `POST /leads/bulk` — add it to the `prisma.lead.create` data block
   (`lead.x ? lead.x.trim() : null`). Also `POST /leads` / `PATCH /leads/:id` if it applies.
4. `backend/src/utils/messageGenerator.ts` — add to the `Lead` interface **and** the
   `availableFields` object, or `{newField}` in a template throws "Unknown field".
5. `frontend/src/api/types/leads/getMany.ts` and `bulkImport.ts` — add to both.
6. `frontend/src/utils/csvParser.ts` — add to `CsvLead` **and** a `case` in the header `switch`
   (the normalized header is lowercase letters only: `yearsInRole` → `yearsinrole`).
7. `frontend/src/components/CsvImportModal.tsx` — add to `leadsToImport` in the import mutation, or
   the parsed value never reaches the API.
8. `frontend/src/components/LeadsList.tsx` (table `<th>` + `<td>`) and
   `MessageTemplateModal.tsx` (`availableFields` array).

Sample CSVs in `docs/` already carry `yearsInRole` and `phoneNumber` columns — use them as fixtures.

### Adding an endpoint

1. Handler in `backend/src/index.ts`, next to its siblings: body guard → `try/catch` →
   `res.status(4xx).json({ error })` or `res.json(payload)`.
2. `frontend/src/api/types/leads/<name>.ts` with `Input`/`Output` types mirroring the handler exactly.
3. One line in `frontend/src/api/modules/leads.ts` via `endpoint<Output, Input>(method, path)`.
   Path builders receive the input object, e.g. ``({ id }) => `/leads/${id}` ``.
4. Consume with `useMutation({ mutationFn: api.leads.x })` + `queryClient.invalidateQueries({ queryKey: ['leads', 'getMany'] })` + toasts.

The query key is the literal `['leads', 'getMany']` everywhere. Anything that mutates leads must
invalidate it.

### Working with Temporal

Hard rules, in rough order of how often they are violated:

- **Workflow code must be deterministic.** No Prisma, no `axios`/`fetch`, no `Date.now()`, no
  `Math.random()`, no `setTimeout` inside `src/workflows/workflows.ts`. All I/O goes in an activity;
  use `sleep()` from `@temporalio/workflow` for delays.
- **New activities must be exported from `src/workflows/activities/index.ts`** (which re-exports
  `utils.ts`) — the worker registers whatever that barrel exports, and `proxyActivities<typeof activities>`
  derives its types from it.
- **Always set both a timeout and an explicit `retry` policy** on `proxyActivities`. The existing
  `verifyEmail` proxy sets `startToCloseTimeout: '1 second'` with **no** retry policy, so Temporal's
  default of unlimited retries applies — a slow activity retries forever and the HTTP request never
  returns. That is the "email verification hangs" bug; don't copy the pattern.
- **Don't `await client.workflow.execute()` inside a request handler in a loop.** `POST /leads/verify-emails`
  does exactly that: it blocks the response on N sequential workflows with no overall timeout. New
  enrichment endpoints should `start()` the workflow and let the client poll status.
- **Make `workflowId` deterministic** when the operation should be idempotent — one workflow per lead
  (`enrich-phone-${leadId}`), not `...-${Date.now()}` as `verify-email-` currently does.
- Task queue is the string `'myQueue'` and the address `'localhost:7233'` is hardcoded in both
  `src/index.ts` and `src/worker.ts`. If you add a third connection point, pull all of them into one
  constant rather than adding a fourth literal.
- A changed workflow signature needs the worker restarted (`pnpm dev` covers this) and, in real
  deployments, versioning — in-flight workflows replay against old history.

## Testing

Vitest in both packages, `globals: true`, `@` aliased to `src`. Tests sit next to their subject
(`foo.ts` → `foo.test.ts`). Frontend uses jsdom + `@testing-library/jest-dom` via
`src/test/setup.ts`.

There are exactly two test files, both covering **pure functions**: `messageGenerator.test.ts` and
`csvParser.test.ts`. There are no route tests, no component tests, and no Temporal test environment
configured. The practical consequence:

- Put new logic in a **pure, exported function** and test it there. Parsing, validation, provider
  response normalization, retry/backoff decisions — all of these can be pure.
- Handlers and components are currently verified by running the app. If you change a route, exercise
  it manually (`curl localhost:4000/...`) and say so in your summary.
- Follow the existing test style: nested `describe` by behaviour group, one assertion-focused `it`
  each, explicit fixtures at the top of the file.

## Conventions

- **Prettier, per package**: no semicolons, single quotes, 2-space indent, `printWidth: 110`,
  `trailingComma: es5`. TypeScript `strict` on both sides; frontend additionally has
  `noUnusedLocals`/`noUnusedParameters`, so unused imports break the build.
- React: `FC<Props>` with an `interface XProps`, named exports for components (`export const LeadsList: FC = ...`),
  `App` is the only default export. Handlers passed to memoized children wrapped in `useCallback`.
- Tailwind v4 via `@tailwindcss/vite`; classes inline, no CSS modules, no `clsx`. `src/index.css` is
  one `@import 'tailwindcss'` line.
- Backend responses: success is a bare object (`{ success: true, importedCount, errors }`), failures
  are `{ error: string }` with a 4xx/5xx status. Bulk operations return per-item `errors[]` and keep
  going rather than failing the batch — preserve that partial-success shape.
- `$TSFixMe` exists in `frontend/src/globalTypes.d.ts` as a deliberate escape hatch. Prefer a real
  type; if you must escape, use `$TSFixMe` so it's greppable rather than a bare `any`.

## Safety rails

- **Don't refactor across the task boundary.** The repo has real structural problems (routes in one
  file, no auth, `Access-Control-Allow-Origin: *`, no request validation, duplicated validation
  logic, hardcoded ports). They are worth writing down in `IMPROVEMENTS.md`, not worth fixing inside
  an unrelated change.
- **Don't rewrite `pnpm-lock.yaml`** as a side effect. If a dependency is genuinely needed, add it
  explicitly and say why.
- **Don't edit migration files that already exist** or delete `dev.db` to escape a migration problem
  without saying so — that discards everyone's local data.
- **Verify before claiming.** `npx vitest run` in the package you touched, plus `npx tsc -p . --noEmit`
  (backend) / `npx tsc -b` (frontend) compared against the known baseline error above. Report failures
  with their output.
- Secrets (`ANTHROPIC_API_KEY`, provider API keys) belong in the environment, never in source. Note
  that the third-party provider keys in `README.md` are already public in this repo — treat them as
  throwaway test credentials, and still read them from config rather than inlining them.

## Branches

`main` is the working branch. `origin/feature/implement-gender-guessing` is the open PR under review
(adds a `gender` column, `/leads/guess-genders`, and CSV/table plumbing) — a good reference for what a
full-stack field addition touches end to end.
