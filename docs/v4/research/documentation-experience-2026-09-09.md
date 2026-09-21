# Documentation experience research

Date: 2026-09-09. Scope: official public documentation for Convex, Payload,
Supabase, Better Auth, and ElysiaJS. This is an information architecture study,
not a comparative framework benchmark or authority for QUESTPIE behavior.

The observations below come from the linked pages and their rendered text and
navigation. No usability study, authenticated dashboard inspection, or execution
of competitor examples was performed. Recommendations are editorial inferences.
QUESTPIE implementation verification belongs to the accompanying documentation
work and must use local public exports, source, tests, and Accepted ADRs.

## Convex: show the whole application path

The React quickstart offers a scaffold command, then a manual path with named
files: create an app, install the library, start the backend development command,
import sample tasks, optionally add a schema, declare a Query, configure a React
provider, and render the result. It states what each command creates and ends
with a visible task list. Its navigation separates Tutorial, Quickstarts,
Understand Convex, Platform, Guides, Client Libraries, Tools, and API Reference.
[React quickstart](https://docs.convex.dev/quickstart/react).

The conceptual overview starts with the relationship between database, server
functions, and clients. It then traces a task Query through a subscription and a
Mutation, including the changed result. Query, Mutation, and Action restrictions
are explained as consequences of transaction and external-I/O behavior, rather
than as unexplained categories.
[Overview](https://docs.convex.dev/understanding/overview).

The API entry page groups reference material by package entry point and keeps
generated code, deployment APIs, and errors separately discoverable.
[API reference](https://docs.convex.dev/api/).

**Inference for QUESTPIE:** use one visible end-to-end result early. Teach the
reason for each Operation kind with the same booking example. Keep package and
generated-client lookup outside the learning sequence. Do not import Convex's
consistency claims into QUESTPIE prose without QUESTPIE-specific evidence.

## Payload: establish vocabulary and ownership

Payload's introduction describes the result of writing a Config, then links
use cases, concepts, installation, database, APIs, authentication, access control,
and uploads. Its concepts page defines a small shared vocabulary through short
descriptions of Config, Collections, Fields, Hooks, and related concepts, each
linked to deeper documentation.
[Introduction](https://payloadcms.com/docs/getting-started/what-is-payload),
[Concepts](https://payloadcms.com/docs/getting-started/concepts).

Installation states software requirements before offering a scaffold and an
existing-application path. The Local API page explains why server-local access
is useful, where the instance comes from, and then lists operations with concrete
arguments and result descriptions. Its examples make options such as
`overrideAccess` visible at the point of use.
[Installation](https://payloadcms.com/docs/getting-started/installation),
[Local API](https://payloadcms.com/docs/local-api/overview).

**Inference for QUESTPIE:** define Collection, Operation, Policy, and Runtime in
plain language before compiler details. State where declarations, generated
files, and runtime configuration belong. Give escape hatches their own section
with concrete authority effects. Do not borrow Payload's implicit expectation
of an included administration UI or upload system.

## Supabase: separate tasks, products, and method lookup

The docs home has distinct entry points for framework quickstarts, backend
products, database extensions, client libraries, migration, and platform tools.
This supports both a new application and a developer arriving with a specific
task. The database overview explicitly explains that a project exposes a full
Postgres database, then links tools for working with it.
[Docs home](https://supabase.com/docs),
[Database overview](https://supabase.com/docs/guides/database/overview).

The React quickstart follows one `instruments` dataset through SQL creation and
sample rows, database grants and a read policy, client environment variables,
and a rendered list. Authorization is part of the first successful data flow.
[React quickstart](https://supabase.com/docs/guides/getting-started/quickstarts/reactjs).

JavaScript reference has method-oriented navigation grouped by subsystem.
The `select` page supplies parameters and examples for a single method rather
than requiring the reader to work through the onboarding guide again.
[JavaScript reference](https://supabase.com/docs/reference/javascript/introduction),
[`select` reference](https://supabase.com/docs/reference/javascript/select).

**Inference for QUESTPIE:** use task titles such as “Read and change data” and
“Connect your frontend,” with a separate symbol-oriented reference. Include
Policy in the first usable example. Expose PostgreSQL ownership and migration
steps directly. A broad ecosystem directory must label actual integrations
and application-owned recipes separately.

## Better Auth: make integration boundaries explicit

The introduction states the scope and extension model. Navigation separates
Get Started, Concepts, Authentication, Databases, Integrations, Infrastructure,
Plugins, Guides, and Reference. Installation proceeds through package setup,
environment variables, instance creation, database configuration and tables,
enabled methods, a mounted handler, and a client instance.
[Introduction](https://better-auth.com/docs/introduction),
[Installation](https://better-auth.com/docs/installation).

Basic Usage connects configuration with sign-up, sign-in, sign-out, and session
access. It separates client and server session reads, showing the request headers
required by the server. The API concept page explains the server `api` object
and the different shape of body, headers, and query arguments. The Options
reference supplies individual configuration entries with descriptions and
defaults where applicable.
[Basic Usage](https://better-auth.com/docs/basic-usage),
[API concepts](https://better-auth.com/docs/concepts/api),
[Options reference](https://better-auth.com/docs/reference/options).

**Inference for QUESTPIE:** an auth example needs the complete session-to-Context
handoff, not just a Policy function. Distinguish the identity provider, session
verification, application identity mapping, and Policy enforcement. Mark any
unimplemented provider adapter as application work and avoid presenting session
input supplied by a browser as trusted identity.

## ElysiaJS: show useful behavior and important failure cases

“At a glance” starts with a small working server and then develops type
inference, validation, and OpenAPI examples. It includes interactive response
previews and type hovers. The quickstart offers runtime choices and automatic
or manual installation. Navigation groups Getting Started, Essential, Patterns,
Eden, Plugins, Integration, and Internal.
[At a glance](https://elysiajs.com/at-glance),
[Quick Start](https://elysiajs.com/quick-start).

The key-concept page teaches encapsulation with a concrete authentication-hook
example: a check on one instance does not automatically protect a route added
to another. Configuration reference records option types and defaults, while
the OpenAPI plugin page separately documents generated application API docs.
[Key Concept](https://elysiajs.com/key-concept),
[Configuration](https://elysiajs.com/patterns/configuration),
[OpenAPI plugin](https://elysiajs.com/plugins/openapi).

**Inference for QUESTPIE:** show the observable consequence of inferred types,
resource identity, transactions, and authority scope. Put one relevant invalid
case next to each boundary. Distinguish the framework API reference from an
application's generated OpenAPI document. Interactive previews are optional;
correct runnable source is a prerequisite.

## Proposed QUESTPIE reading path

This is a synthesis of the observations, constrained by the local
[product specification](../../../SPEC.md),
[canonical language](../../../CONTEXT.md), and
[public-documentation workflow](../../agents/product-documentation.md).
It is not a proposal to add framework functionality.

| Group            | Reader question              | Content                                                                                                                                               |
| ---------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start here       | Why would I use this?        | Product scope, benefits through concrete behavior, prerequisites, installation and CLI, first runnable Barbershop result                              |
| Build Barbershop | How do the pieces fit?       | One cumulative application: data, Operation calls, client, identity and Policy, custom work                                                           |
| Guides           | How do I complete this task? | Data and relations, Operations, clients and realtime, auth, uploads, custom logic and Jobs, migrations and runtime, escape hatches, ecosystem         |
| API reference    | What exactly can I call?     | Public exports, declaration builders, fields and Codec, execution context, generated client, React Query, runtime configuration, CLI, HTTP and errors |

Keep the home page short: a plain product statement, one reason to care, a
small example showing the result, a boundary statement, and a clear starting
link. The initial concept map should introduce only terms needed for that
example. Compiler artifacts and operational details belong where the reader
first needs to inspect or configure them.

Use the repository's canonical Barbershop application throughout. Services,
barbers, appointments, and customer access can explain relations, reads, writes,
Policy, live results, and external work without inventing a new domain on each
page. Later examples must name the earlier file they extend, show complete
replacement declarations when required, and preserve identifiers and generated
client names. A guide can branch from the tutorial, but must identify its
prerequisites.

Use this page structure:

1. **Why:** name the user's problem in one short paragraph.
2. **What:** explain the relevant framework concept and its useful boundary.
3. **How:** show file paths, imports, commands, declarations, and calls.
4. **Result:** state what the reader sees or what changes in the database.
5. **Limits and recovery:** describe real errors and the supported next action.
6. **Next:** link the next tutorial step and the exact reference entry.

The words “Why,” “What,” and “How” need not be repeated as generic headings.
Task-specific headings and connected prose can carry the same progression.

The API reference should be independently usable. Each entry needs an exact
import or generated path, purpose, signature or complete minimal call,
required/optional arguments and defaults, result, important errors, and links
to the teaching guide. Separate framework symbols, CLI commands, and generated
application Operations. A directory of links alone is not a usable reference.

## Verification and capability boundaries

These are requirements for the rewrite, not claims that checks have already
passed:

- Inspect exported package surfaces before documenting an import. Do not expose
  private Runtime/compiler/testkit workspaces as consumer dependencies.
- Exercise installation and CLI steps in an isolated consumer location. State
  prerequisites and the origin of any local package artifact honestly.
- Compile/typecheck cumulative examples against the actual package. Run the
  relevant fixture or runtime behavior when the claim concerns execution.
- Verify Policy and Context flow, including the unauthorized case, rather than
  checking only successful TypeScript compilation.
- Check lifecycle ownership for workers, realtime clients, and embedded Fetch
  usage. Document teardown where the user owns a resource.
- Describe upload/storage integration as application work if no public Files
  facility exists. An Action or Route is an extension point, not evidence of an
  implemented upload protocol, storage adapter, or permission model.
- Check ecosystem claims individually. A standard Fetch boundary is not proof
  of maintained lifecycle integrations for every web framework.
- Keep missing capabilities in plain user-facing terms, with a supported path
  when one exists. Keep proposal status, acceptance evidence, and ADR discussion
  internal.
- Replace old public pages and navigation as one coherent change; retain
  internal ADRs and proof evidence. Check redirects or link migrations,
  documentation build/typecheck, relevant formatting, and `git diff --check`.

The initial implementation audit, before the owner authorized CLI implementation,
reported that the CLI lacked a
new-application scaffold and a public migration-generation workflow. The
rewrite must make that onboarding gap explicit and bind the claim to its
CLI/source evidence in the implementation report. Do not copy the competitors'
scaffold-first structure by inventing `init`, `sync`, or `dev` commands. Provide
the actually verified package/fixture path, explain what it proves, and state
which new-application setup steps the framework does not supply. A repository
fixture walkthrough must identify itself as such; it cannot be described as a
complete fresh-project onboarding experience.

The strongest combined lesson is a complete small success followed by precise
boundaries. A friendly tutorial and an exact reference serve different reading
tasks; both need to describe the same checked application surface.

## Implementation outcome

The owner subsequently authorized building the missing CLI in this repository.
The [delivery record](../implementation/docs-onboarding-cli.md) supersedes the
initial gap assessment for `init`, migration planning/creation, and Seed creation.
The rewritten tutorial now exercises those real commands from a packed package;
`sync` and `dev` are still not invented aliases. Provider-owned Auth and storage
retain their explicitly described application boundaries.
