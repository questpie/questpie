# Reactive Query state in browser applications

Status: pre-acceptance public-documentation draft; not current product authority

Use a Query Resource when a screen needs the latest complete result of a
watchable Query. The generated client owns Query identity, Context partition,
input encoding, and Live Query transport. UI packages only subscribe to its
state.

## Observe a generated Query

```ts
import { createClient } from "#questpie/client";

const support = createClient({ baseUrl: location.origin }).withContext({
	organizationId,
	membershipId,
});

const queue = support.queries["tickets.queue"].observe({
	after: null,
	first: 50,
	status: "open",
});
```

`observe` exists only when the compiler proves that the Query can be watched.
A Query with unsupported raw reads remains callable once and has no `.observe`.

Read the current immutable snapshot and subscribe to later changes:

```ts
function render() {
	const snapshot = queue.getSnapshot();
	if (snapshot.kind === "pending") return showLoading();
	if (snapshot.kind === "failed") return showFailure(snapshot.failure.code);
	return showTickets(snapshot.value.nodes);
}

render();
const unsubscribe = queue.subscribe(render);
```

The first subscriber opens the watch. Further subscribers share it. The last
unsubscribe stops it. A later subscriber opens a fresh watch while the resource
keeps its last complete idle snapshot in the bounded client cache.

The result is always complete. An `update` or `reset` replaces it; the client
does not patch entities or echo Mutation input. During retryable reconnect, a
ready resource keeps its previously disclosed value and exposes the reconnect
attempt. A terminal failure clears that value.

## Use the optional React adapter

Install the adapter beside the exact matching `questpie` release and React 19:

```sh
bun add @questpie/react react
```

The adapter has one hook:

```tsx
import { useQueryResource } from "@questpie/react";

export function TicketQueue() {
	const snapshot = useQueryResource(
		support.queries["tickets.queue"].observe({
			after: null,
			first: 50,
			status: "open",
		}),
	);

	if (snapshot.kind === "pending") return <p>Loading tickets…</p>;
	if (snapshot.kind === "failed")
		return <p>Ticket updates are unavailable: {snapshot.failure.code}</p>;

	return (
		<ul>
			{snapshot.value.nodes.map((ticket) => (
				<li key={ticket.id}>{ticket.summary}</li>
			))}
		</ul>
	);
}
```

The React package does not create another client or cache. It subscribes with
React's external-store API. It does not add Suspense, SSR, hydration, optimistic
updates, Mutation invalidation, or a global provider.

## Replace the scope when credentials change

A generated Context scope is one cache partition. Two calls to `withContext`
never share resources, even with equal input.

Credentials remain owned by the application's Auth integration. On sign-in,
sign-out, account switch, or another credential transition, unsubscribe the old
UI and create a new generated client scope. QUESTPIE does not inspect cookies or
guess when Auth state changes.

Every result delivered by the Runtime still resolves fresh Context and checks
current Policy. An authority reset supplies a fresh complete result. An
authorization failure clears the resource and exposes only
`AUTHORIZATION_FAILED`.

## Mutations do not write the client cache

A successful Mutation does not cause a client-wide refetch and does not update
a Query Resource from its input or result. The committed Change Ledger makes an
affected watched Query recompute under fresh Policy. A rolled-back Mutation
causes no update.

When several panels must change atomically, expose one composite Query and
observe it. Re-call a one-shot-only Query explicitly when the application needs
another result.

## Model a discriminated reference value

Some application values can refer to one of several domain kinds without
requiring database Relation behavior. Model that value as an ordinary
discriminated union:

```ts
type DiscriminatedValue<Variants extends Record<string, object>> = {
	[Kind in keyof Variants]: Readonly<{ kind: Kind } & Variants[Kind]>;
}[keyof Variants];

type ActivitySubject = DiscriminatedValue<{
	ticket: { id: string };
	comment: { id: string };
}>;
```

Use an exhaustive matcher when application code consumes it:

```ts
type Cases<Value extends { kind: PropertyKey }, Result> = {
	[Kind in Value["kind"]]: (value: Extract<Value, { kind: Kind }>) => Result;
};

function matchDiscriminated<Value extends { kind: PropertyKey }, Result>(
	value: Value,
	cases: Cases<Value, Result>,
): Result {
	return cases[value.kind](value as never);
}

const label = matchDiscriminated<ActivitySubject, string>(subject, {
	ticket: ({ id }) => `Ticket ${id}`,
	comment: ({ id }) => `Comment ${id}`,
});
```

This pair is a discriminated reference value, not a QUESTPIE Relation. It has no
foreign key, inverse, join, cascade, Policy traversal, or automatic Live Query
dependency. Resolve a target through an explicit named Query or Mutation so the
target's current Policy controls disclosure.
