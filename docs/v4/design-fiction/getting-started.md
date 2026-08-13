---
title: Create your first QUESTPIE application
description: Define, compile, migrate, run, and call a small PostgreSQL application.
status: design-fiction
implementation-status: unimplemented
candidate-contracts:
  - project initialization and generated package imports
  - named Query authoring and network exposure
  - inferred named Query output materialization
  - sync and explain CLI commands for executable Resources
  - generated App and client artifact filenames, roles, and package imports
  - generated server App construction, direct execution, and close lifecycle
  - policy-free anonymous non-System Execution bootstrap
  - DATABASE_URL Runtime binding
  - Runtime build, start, port, and development CLI commands
---

# Create your first QUESTPIE application

In this chapter you create a small collaboration backend with Channels and
Messages. You compile its application contract, review and apply its first
Migration, start the standalone Runtime, and call the same Query directly and
through the generated client.

The finished application has three authored files:

```text
collaboration/
  questpie.json
  src/
    model/collaboration.ts
    features/messages.ts
  scripts/
    read-messages.ts
```

QUESTPIE discovers the exported Definitions under `src`. The folders organize
ordinary TypeScript; they do not create Resource identity or runtime behavior.

## Create the project

Create an empty Bun project and install QUESTPIE:

```bash
mkdir collaboration
cd collaboration
bun init -y
bun add questpie
bunx questpie init
```

`questpie init` adds `.questpie/` to `.gitignore` and creates stable imports for
generated application code. Keep `questpie/` under version control; that
separate directory contains reviewed Migrations and Seeds.

```json title="package.json (excerpt)"
{
	"imports": {
		"#questpie/app": "./.questpie/generated/app.ts",
		"#questpie/client": "./.questpie/generated/client.ts",
		"#questpie/source/*": "./src/*"
	}
}
```

Set the application name, PostgreSQL schema, and source root in
`questpie.json`:

```json title="questpie.json"
{
	"$schema": "https://questpie.dev/schema/application-v1.json",
	"version": 1,
	"application": {
		"name": "collaboration"
	},
	"postgres": {
		"schema": "collaboration",
		"minimumMajor": 16,
		"databaseCollation": "C.UTF-8",
		"databaseCType": "C.UTF-8",
		"extensions": [],
		"physicalNames": {}
	},
	"source": {
		"root": "src",
		"exclude": []
	},
	"packages": {}
}
```

The Application Identity is `application:collaboration`. The application owns
objects in the PostgreSQL `collaboration` schema. QUESTPIE keeps Runtime
bookkeeping in the reserved `questpie_internal` schema.

## Define Channels and Messages

Create both Collections in one module:

```ts title="src/model/collaboration.ts"
import { constraint, defineCollection, field, index, relation } from "questpie";

export const channels = defineCollection({
	name: "channels",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		name: field.text({ nullable: false, maxLength: 120 }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});

export const messages = defineCollection({
	name: "messages",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		channelId: field.uuid({ nullable: false }),
		body: field.text({ nullable: false, maxLength: 20_000 }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
		updatedAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	indexes: {
		byChannelAndCreatedAt: index({
			fields: ["channelId", { field: "createdAt", order: "asc" }],
		}),
	},
	relations: {
		channel: relation.toOne({
			target: channels,
			fields: ["channelId"],
			references: ["id"],
			onDelete: "cascade",
			onUpdate: "restrict",
		}),
	},
});
```

Each regular Collection has exactly one named primary-key Constraint. `id`,
`createdAt`, and `updatedAt` are ordinary Fields. The `"now"` default
initializes a timestamp on insert; it does not update `updatedAt` after a
write. The Mutation chapter gives that behavior an explicit transaction owner.

The `channel` Relation also defines the PostgreSQL foreign key. QUESTPIE does
not create a hidden Collection or infer a Relation from the `channelId` name.

Run the first synchronization so TypeScript can import the generated Data
contract:

```bash
bunx questpie sync
```

## Add a typed Query

Define the structural read and its named application Query together:

```ts title="src/features/messages.ts"
import { defineQuery, type AppData } from "#questpie/app";
import { dataQuery, query } from "questpie";

export const messagePageData = dataQuery<AppData["collections"]["messages"]>()({
	from: "messages",
	parameters: {
		channelId: query.parameter.uuid({ nullable: false }),
		first: query.parameter.integer({
			nullable: false,
			minimum: 1,
			maximum: 100,
		}),
		after: query.parameter.cursor({ nullable: true }),
	},
	select: ({ fields }) => ({
		id: fields.id,
		channelId: fields.channelId,
		body: fields.body,
		createdAt: fields.createdAt,
	}),
	where: ({ fields, parameters }) =>
		fields.channelId.equal(parameters.channelId),
	orderBy: ({ fields }) => [
		fields.createdAt.ascending({ nulls: "last" }),
		fields.id.ascending({ nulls: "last" }),
	],
	page: ({ parameters }) =>
		query.forwardCursor({
			first: parameters.first,
			after: parameters.after,
		}),
});

export const messagePage = defineQuery({
	name: "messages.page",
	input: {
		channelId: query.parameter.uuid({ nullable: false }),
		first: query.parameter.integer({
			nullable: false,
			minimum: 1,
			maximum: 100,
		}),
		after: query.parameter.cursor({ nullable: true }),
	},
	handler: async ({ input, ctx }) => ctx.data.run(messagePageData, input),
	network: true,
});
```

The structural Query states its complete selection, filter, total order, and
forward page. Its final order Field is the non-null primary key, so QUESTPIE
does not add a hidden tie-breaker. A page contains at most 100 nodes.

`network: true` exposes only the named `messages.page` Operation. A client can
send its declared input, but it cannot send a different selection, filter,
Policy, or Authority object.

## Know where the types come from

The example does not rely on an ambient application registry:

| Code                                 | Contextual type source                                       |
| ------------------------------------ | ------------------------------------------------------------ |
| `defineQuery`                        | the current generated `#questpie/app` factory                |
| `AppData["collections"]["messages"]` | the concrete generated Data Contract                         |
| structural `fields`                  | that exact generated Collection projection                   |
| structural `parameters`              | the local `parameters` declaration                           |
| handler `input`                      | the local named Query `input` declaration                    |
| handler `ctx`                        | the generated App Contract, narrowed to read-only Query mode |
| `ctx.data.run` result                | the selection and page contract of `messagePageData`         |
| direct and client method             | the compiled `messages.page` input, output, and exposure     |

Typing `fields.unknown` or `ctx.data.unknown` fails in the editor. A Query
context cannot call Collection writes. Public declarations contain no ORM type
and do not recursively infer the whole application inside either leaf
Definition.

## Compile and inspect the application

Compile again after adding the Query:

```bash
bunx questpie sync
bunx questpie explain collection:messages
bunx questpie explain query:messages.page
```

`sync` checks the structural program and writes deterministic files under
`.questpie/generated/`:

```text
.questpie/generated/
  manifest.json
  schema-projection.json
  origin-map.json
  build-input.json
  app.ts
  client.ts
  internal/
```

The files have distinct jobs:

| Artifact                 | What it tells you                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `manifest.json`          | exact Resource identities, ownership, Data contract, and Query contract              |
| `schema-projection.json` | desired PostgreSQL objects used by migration planning                                |
| `origin-map.json`        | source location for every generated Resource and member                              |
| `build-input.json`       | exact configuration, source, Package, lockfile, Bun, TypeScript, and compiler inputs |
| `app.ts`                 | concrete server-side App Contract and direct-call surface                            |
| `client.ts`              | browser-safe client with only network-exposed Operations                             |
| `internal/`              | compiler-owned Runtime programs and bindings                                         |

The generated App Contract contains concrete names and wire values. Its
relevant shape is equivalent to this excerpt:

```ts title=".questpie/generated/app.ts (excerpt)"
export interface AppContract {
	queries: {
		"messages.page": {
			input: {
				channelId: string;
				first: number;
				after: string | null;
			};
			output: {
				nodes: Array<{
					id: string;
					channelId: string;
					body: string;
					createdAt: string;
				}>;
				pageInfo: {
					endCursor: string | null;
					hasNextPage: boolean;
				};
			};
		};
	};
}
```

The excerpt shows only the Query projection. The real generated declaration
also contains exact closed Data members and contains no `unknown`, `any`, broad
operation name, or ORM type.

`questpie explain` joins each Resource identity to its Owner, Origin,
structural contract, executable handler, generated members, and artifact
digests. You inspect compiler output without maintaining a handler registry or
a second application manifest.

## Create and apply the first Migration

Set a direct PostgreSQL connection for the CLI and Runtime:

```bash
export DATABASE_URL='postgres://postgres:postgres@localhost:5432/collaboration'
```

Compile the desired schema and create a read-only Migration Plan:

```bash
bunx questpie schema compile
bunx questpie migration plan --name create-collaboration
```

The planner prints the exact Plan Digest and writes its canonical plan below
`.questpie/plans/`. Review the step classifications, expected locks, Origins,
and recovery instructions. A Migration Plan contains semantic steps, not SQL.
Create the Committed Migration from that exact file:

```bash
export PLAN_DIGEST='<digest printed by migration plan>'
export PLAN_FILE=".questpie/plans/$PLAN_DIGEST.json"
bunx questpie migration create --plan "$PLAN_FILE"
```

Review the generated `up.sql`, then commit the new directory under
`questpie/migrations/`. It contains the plan, base and target Schema
Projections, generated SQL, metadata, and checksum.

Apply the committed chain and verify the live Schema Fingerprint:

```bash
bunx questpie migration apply
bunx questpie schema drift
```

Apply verifies the chain, checksum, application binding, live base, and target
inside the accepted transactional migration protocol. A lost success response
is safe to retry: the Migration Receipt lets QUESTPIE return `alreadyApplied`
without running the SQL again.

## Start the standalone Runtime

Build the matched Runtime artifact, then start it as its own long-lived
process:

```bash
bunx questpie build
bunx questpie start --port 4000
```

The Runtime reads `DATABASE_URL`, verifies its generated build and database
binding, and listens at `http://localhost:4000`. Runtime startup does not scan
source files, merge Modules, activate Packages, or infer application shape.

For local development, one command watches source, recompiles, checks pending
schema work, and restarts the same standalone Runtime:

```bash
bunx questpie dev --port 4000
```

## Call the Query directly

Server code and tests can load the generated application without crossing the
network. Keep this script outside `src` so it is not part of the structural
source root:

```ts title="scripts/read-messages.ts"
import { createApp } from "#questpie/app";
import { principal } from "questpie";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

const page = await app.execution(
	{ principal: principal.anonymous(), context: {} },
	({ queries }) =>
		queries["messages.page"]({
			channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			first: 20,
			after: null,
		}),
);

console.log(page.nodes);
await app.close();
```

Run it with Bun:

```bash
bun scripts/read-messages.ts
```

The direct method opens the same bounded read snapshot, applies the same input
codec and Query program, and validates the same output as a network request.
This policy-free bootstrap still creates an anonymous, non-System Execution; a
missing request never grants System Authority. After you add Context Resolution
and Policy, every direct and network call creates an explicit resolved
Execution with Principal, Tenant, and Authority. The
[Policy chapter](./authorize-with-policy.md) adds that contract without changing
the Query handler.

## Call the generated client

Frontend code imports the concrete browser-safe client:

```ts title="web/messages.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
});

const page = await client.queries["messages.page"]({
	channelId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
	first: 20,
	after: null,
});

for (const message of page.nodes) {
	console.log(message.body, message.createdAt);
}
```

The client method has the same exact input and result as the direct call. It
cannot name a server-only Resource. A source change that removes or changes the
Operation removes or changes the generated member on the next compile, so a
stale client build fails before deployment.

You now have one application meaning across authored Definitions, generated
types, reviewed PostgreSQL schema, direct execution, the standalone Runtime,
and a framework-neutral client. The next chapter expands the data model and
shows how Collections, nested values, Relations, Constraints, and structural
Queries behave at their exact limits.
