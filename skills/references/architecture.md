# INTERNAL system architecture — orientation for research

Read this before researching a story. It's a map of the three repos so the
research pass starts with the layout already known instead of rediscovering it
every run. It won't tell you where a *specific* feature lives — that's what the
grep is for — but it tells you which repo and which layer to look in, and where
the seams between repos are.

Everything here was true when written; if a search contradicts it, trust the
search — code moves.

## The three repos and how they connect

```text
 frontend  ──GraphQL──▶  bff  ──gRPC──▶  backend  ──▶ DB / ODS
 (Next.js/React)       (NestJS BFF)    (NestJS + TypeORM)
```

Repo folders and paths come from the app's Settings (repo keys below).

| Repo key | Default branch | Stack | Owns |
|----------|----------------|-------|------|
| `bff` | `develop` | NestJS + Apollo GraphQL | The GraphQL API the frontend calls; enriches/relays data; **no business rules or DB** |
| `backend` | `main` | NestJS + gRPC + TypeORM | Business logic, validation, persistence, rollup/calculation |
| `frontend` | `main` | Next.js + React + Apollo Client | Screens, forms, GraphQL queries/mutations, client-side display |

(Default branch = each repo's `origin/HEAD`; branch a story off that. Note they
differ — the BFF is `develop`, the other two are `main`.)

A rule of thumb for "which repo owns it":
- **Computation, validation, persistence, business rules** → backend.
- **Exposing a field to the UI, shaping/enriching a response, a new GraphQL
  operation** → BFF (often a thin pass-through; it frequently does *not* compute
  totals — it relays what the backend sends).
- **A button, a form field, a column, a client-side display rule** → frontend.

Most stories touch two or three of these. The interesting bugs live at the seams.

## The two seams (where cross-repo work hides)

1. **GraphQL schema — frontend ↔ BFF.** Code-first: the source of truth is the
   `*.model.ts` classes in the BFF (decorated with `@ObjectType`/`@InputType`/
   `@Field`), and `src/schema.gql` is **generated output — never hand-edit it**
   (its header says so). A new field the frontend needs = a new `@Field` on a
   BFF model, and a matching selection in the frontend's Apollo query/mutation.

2. **gRPC / protobuf — BFF ↔ backend.** The proto contracts are **not in these
   repos** — they come from the organisation's scoped npm
   packages in `node_modules/` (the bill-of-lading protobuf package, plus the
   master-data and boilerplate ones). Adding a
   proto field is therefore a change to that **external package + a version
   bump** in both the backend and the BFF — call this out as a real cost, never
   a quick edit. The BFF models `implements` the generated `Grpc*` types, so the
   two sides must move together.

When a story needs a genuinely new field end-to-end, the chain is:
proto package → backend (entity/DTO/logic) → BFF model → frontend query + UI.

## Where things live in each repo

### backend (the deepest layer — CQRS)
Modules under `src/modules/`: **`bill-of-lading`** (the main one), `pay-rises`,
`system`, `shared`. Inside `bill-of-lading`, the CQRS layering is the key to
navigation:

- `api/` — gRPC controllers (the request/response entry points).
- `application-service/` — commands (writes) and their DTOs/validation.
- `query-service/` — queries (reads), including rollup/summary computation.
- `domain/` — aggregates and domain rules.
- `infrastructure/` — TypeORM `database-entities/` (INTERNAL-owned tables) and
  `ods-database-entities/` (legacy ODS source tables), plus repositories.
- `utils/` — enums and helpers (freight-term codes, etc.).

Schema is entity-driven (TypeORM); migration tooling lives in `src/migrations/`.
This repo uses `@nestjs/cqrs` — so "where's the write path" → a Command;
"where's the read/rollup" → a Query.

### bff (thin GraphQL layer)
`src/` splits into **the domain module** (main submodule `bill-of-lading`),
`mdm` (master data — customers/payers), `shared`, `types`. Per feature you
usually touch: `*.resolver.ts` (the GraphQL operations), `*.service.ts` (calls
the backend over gRPC, enriches the response), and `models/*.model.ts` (the
GraphQL types — this is the schema source). Constants/enums live under
`src/<domain>/shared/constant/`. Remember: the BFF often relays backend data
untouched, so if a computed value looks wrong, the logic is probably in the
backend, not here.

### frontend (Next.js + Apollo)
`src/` is organized by kind: `components/` (atomic design —
`atoms`/`molecules`/`organisms`, with feature areas like
`components/bill-of-lading/organisms/revenue-information/`), `hooks/` (data-
fetching hooks wrapping Apollo operations), `lib/apollo/queries/` and
`lib/apollo/mutations/` (the GraphQL operations), `models/` (TS types),
`constants/` (option lists, enums, feature flags — e.g. pay-term options),
`store/` (client state), `utils/` (mappers that turn API responses into view
models). A UI change usually spans a component + its hook + the Apollo operation
+ possibly a mapper and a constant.

## Fast search starting points

Given a story's domain nouns, these are good first greps per repo:

- **Backend**: search `src/modules/bill-of-lading/` — enums in `utils/`, the
  read/rollup in `query-service/`, writes in `application-service/`, tables in
  `infrastructure/*database-entities/`.
- **BFF**: search `src/<domain>/bill-of-lading/` — `models/` for the field, `*.service.ts`
  for enrichment, `*.resolver.ts` for the operation; `src/<domain>/shared/constant/`
  for code maps.
- **Frontend**: search `src/components/bill-of-lading/` for the UI, `src/hooks/`
  for the data wiring, `src/lib/apollo/` for the queries, `src/constants/` for
  option lists.

Also check git branches (`git -C <repo> branch -a`) — in-progress work for the
story may already sit on a `feat/<KEY>-...` branch, which changes the breakdown
from "build" to "verify/finish" and gives you the branch to reuse in Step 5.
