import { createClient } from "#questpie/client";

import { tracerIds } from "./constants";

type TracerPhase =
	| "starting"
	| "watching"
	| "mutation-observed"
	| "authority-redacted"
	| "authority-restored"
	| "signed-out-ready"
	| "authorization-failed"
	| "fresh-scope-ready"
	| "recovered"
	| "qri-complete";
type Whoami = Readonly<{
	principal: Readonly<{ kind: "user"; id: string }>;
}>;

const status = document.querySelector<HTMLElement>("[data-status]");
const messages = document.querySelector<HTMLUListElement>("[data-messages]");
const form = document.querySelector<HTMLFormElement>("form");
const input = document.querySelector<HTMLInputElement>("input");
if (!status || !messages || !form || !input)
	throw new TypeError("collaboration tracer markup is incomplete");
const statusElement = status;
const messagesElement = messages;
const formElement = form;
const inputElement = input;

const expectedBody = new URL(location.href).searchParams.get("body");
const forbiddenBody = new URL(location.href).searchParams.get("forbiddenBody");
const recoveryMode =
	new URL(location.href).searchParams.get("recovered") === "1";
let phase: TracerPhase = "starting";
let connections = 0;
let mutationStarted = recoveryMode;
let publications = 0;
let forbiddenValueObserved = false;
const queryResourceEvidence = {
	authorizationFailure: undefined as
		| Readonly<{ code: "AUTHORIZATION_FAILED" }>
		| undefined,
	byteEqualScopesIsolated: false,
	credentialLifetimeReplaced: recoveryMode,
	duplicateSubscriberIndependent: false,
	lastUnsubscribeIdle: false,
	retainedEvictionTerminal: false,
	subscriberFaultContained: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseWhoami(value: unknown): Whoami {
	if (
		!isRecord(value) ||
		Object.keys(value).length !== 1 ||
		!isRecord(value.principal) ||
		Object.keys(value.principal).length !== 2 ||
		value.principal.kind !== "user" ||
		typeof value.principal.id !== "string" ||
		value.principal.id.trim().length === 0
	) {
		throw new TypeError("invalid whoami response");
	}

	return {
		principal: { kind: "user", id: value.principal.id },
	};
}

async function loadWhoami(): Promise<Whoami> {
	const response = await fetch("/api/whoami");
	if (!response.ok) throw new TypeError("whoami request failed");
	return parseWhoami(await response.json());
}

async function report(next: TracerPhase, whoami: Whoami): Promise<void> {
	phase = next;
	statusElement.textContent = next;
	await fetch("/__questpie_tracer/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			phase: next,
			connections,
			queryResource: {
				generated: true,
				...queryResourceEvidence,
				forbiddenValueObserved,
				publications,
			},
			whoami,
		}),
	});
}

function render(
	page: Readonly<{ nodes: ReadonlyArray<Readonly<{ body?: string }>> }>,
) {
	messagesElement.replaceChildren(
		...page.nodes.map((message) => {
			const item = document.createElement("li");
			item.textContent = message.body ?? "[redacted]";
			return item;
		}),
	);
}

async function start(): Promise<void> {
	const whoami = await loadWhoami();
	const rootClient = createClient({ baseUrl: location.origin });
	const retiredScope = rootClient.withContext({
		companyId: tracerIds.company,
	});
	const client = rootClient.withContext({ companyId: tracerIds.company });
	const queryInput = {
		after: null,
		channelId: tracerIds.channel,
		first: 50,
	} as const;
	const retained = retiredScope.queries["messages.page"].observe(queryInput);
	const resource = client.queries["messages.page"].observe(queryInput);
	queryResourceEvidence.byteEqualScopesIsolated = retained !== resource;
	for (let index = 0; index < 128; index += 1) {
		retiredScope.queries["messages.page"].observe({
			...queryInput,
			channelId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
		});
	}
	const replacement = retiredScope.queries["messages.page"].observe(queryInput);
	const retainedStop = retained.subscribe(() => undefined);
	retainedStop();
	const retainedSnapshot = retained.getSnapshot();
	queryResourceEvidence.retainedEvictionTerminal =
		retainedSnapshot.kind === "failed" &&
		retainedSnapshot.failure.code === "RESOURCE_LIMIT" &&
		replacement !== retained &&
		retiredScope.queries["messages.page"].observe(queryInput) === replacement;

	async function publish(body: string): Promise<void> {
		await client.mutations["message.publish"](
			{ body, channelId: tracerIds.channel },
			{ callId: `tracer:${crypto.randomUUID()}` },
		);
	}

	formElement.addEventListener("submit", (event) => {
		event.preventDefault();
		const body = inputElement.value.trim();
		if (body.length === 0) return;
		inputElement.value = "";
		void publish(body);
	});

	let priorConnection = "idle";
	let priorDelivery: unknown;
	let expectedMessageId: string | undefined;
	let signingOut = false;
	let freshScopeReported = false;
	let finishing = false;
	const subscriptions: Array<() => void> = [];
	const synchronize = () => {
		const snapshot = resource.getSnapshot();
		if (snapshot.kind === "failed") {
			statusElement.textContent = `watch error · ${snapshot.failure.code}`;
			return;
		}
		if (
			snapshot.connection.kind === "connected" &&
			priorConnection !== "connected"
		)
			connections += 1;
		priorConnection = snapshot.connection.kind;
		if (phase === "starting") void report("watching", whoami);
		else statusElement.textContent = `${phase} · ${snapshot.connection.kind}`;
		if (snapshot.kind === "ready") {
			const page = snapshot.value;
			if (snapshot.delivery !== priorDelivery) {
				priorDelivery = snapshot.delivery;
				publications += 1;
			}
			if (
				forbiddenBody !== null &&
				page.nodes.some((message) => message.body === forbiddenBody)
			)
				forbiddenValueObserved = true;
			render(page);
			const visibleExpected =
				expectedBody === null
					? undefined
					: page.nodes.find((message) => message.body === expectedBody);
			if (visibleExpected !== undefined) expectedMessageId = visibleExpected.id;
			const expectedMessage = page.nodes.find(
				(message) => message.id === expectedMessageId,
			);
			if (
				phase === "mutation-observed" &&
				expectedMessage !== undefined &&
				expectedMessage.body === undefined
			) {
				void report("authority-redacted", whoami);
				return;
			}
			if (
				phase === "authority-redacted" &&
				expectedMessage?.body === expectedBody
			) {
				if (signingOut) return;
				signingOut = true;
				void (async () => {
					await report("authority-restored", whoami);
					const response = await fetch("/__questpie_tracer/sign-out", {
						method: "POST",
					});
					if (!response.ok) throw new TypeError("tracer sign-out failed");
					await report("signed-out-ready", whoami);
					const retiredClient = createClient({
						baseUrl: location.origin,
						fetch: Object.assign(
							(request: RequestInfo | URL) =>
								fetch(request, { credentials: "omit" }),
							{ preconnect: fetch.preconnect },
						),
					}).withContext({ companyId: tracerIds.company });
					const retiredResource =
						retiredClient.queries["messages.page"].observe(queryInput);
					retiredResource.subscribe(() => {
						const retired = retiredResource.getSnapshot();
						if (
							retired.kind !== "failed" ||
							retired.failure.code !== "AUTHORIZATION_FAILED"
						)
							return;
						queryResourceEvidence.authorizationFailure = Object.freeze({
							code: "AUTHORIZATION_FAILED",
						});
						void (async () => {
							await report("authorization-failed", whoami);
							const signIn = await fetch("/__questpie_tracer/sign-in", {
								method: "POST",
							});
							if (!signIn.ok) throw new TypeError("tracer sign-in failed");
							const recovered = new URL(location.href);
							recovered.searchParams.delete("credential");
							recovered.searchParams.set("recovered", "1");
							location.replace(recovered);
						})().catch(() => {
							statusElement.textContent = "credential replacement failed";
						});
					});
				})().catch(() => {
					statusElement.textContent = "credential retirement failed";
				});
				return;
			}
			const observed = visibleExpected !== undefined;
			if (observed) {
				if (recoveryMode && connections >= 2 && !finishing) {
					finishing = true;
					void (async () => {
						await report("recovered", whoami);
						for (const unsubscribe of subscriptions) unsubscribe();
						const idle = resource.getSnapshot();
						queryResourceEvidence.lastUnsubscribeIdle =
							idle.kind === "ready" && idle.connection.kind === "idle";
						await report("qri-complete", whoami);
					})();
				} else if (recoveryMode && !freshScopeReported) {
					freshScopeReported = true;
					void report("fresh-scope-ready", whoami);
				} else if (connections >= 2) void report("recovered", whoami);
				else if (phase === "starting" || phase === "watching")
					void report("mutation-observed", whoami);
				return;
			}
			if (expectedBody !== null && !mutationStarted) {
				mutationStarted = true;
				void publish(expectedBody).catch((error: unknown) => {
					statusElement.textContent =
						error instanceof Error ? error.message : String(error);
				});
			}
		}
	};
	subscriptions.push(resource.subscribe(synchronize));
	let duplicateNotifications = 0;
	const duplicateSubscriber = () => {
		duplicateNotifications += 1;
		queryResourceEvidence.duplicateSubscriberIndependent = true;
	};
	const unsubscribeDuplicate = resource.subscribe(duplicateSubscriber);
	subscriptions.push(resource.subscribe(duplicateSubscriber));
	unsubscribeDuplicate();
	const subscriberFault = new Error("qri02 subscriber fault");
	window.addEventListener("error", (event) => {
		if (event.error !== subscriberFault) return;
		event.preventDefault();
	});
	let faultThrown = false;
	subscriptions.push(
		resource.subscribe(() => {
			if (faultThrown) return;
			faultThrown = true;
			queryResourceEvidence.subscriberFaultContained =
				duplicateNotifications > 0;
			throw subscriberFault;
		}),
	);
	synchronize();
}

void start().catch(() => {
	statusElement.textContent = "authentication unavailable";
});
