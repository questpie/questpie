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
const inverseLiveQueryEvidence = {
	failure: undefined as
		| Readonly<{ code: string; publicKeys: readonly string[] }>
		| undefined,
	lastSuccessfulMessages: [] as ReadonlyArray<
		Readonly<{
			id: string;
			body?: string;
			channelId: string;
			createdAt: string;
		}>
	>,
	publications: 0,
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

let reportSequence: Promise<void> = Promise.resolve();
function report(next: TracerPhase, whoami: Whoami): Promise<void> {
	phase = next;
	statusElement.textContent = next;
	const body = JSON.stringify({
		phase: next,
		connections,
		inverseLiveQuery: inverseLiveQueryEvidence,
		queryResource: {
			generated: true,
			...queryResourceEvidence,
			forbiddenValueObserved,
			publications,
		},
		whoami,
	});
	reportSequence = reportSequence.then(async () => {
		const response = await fetch("/__questpie_tracer/report", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body,
		});
		if (!response.ok) throw new TypeError("tracer report failed");
	});
	return reportSequence;
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
	const channelDetailResource = client.queries["channels.detail"].observe({
		id: tracerIds.channel,
	});
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
	let replacingCredential = false;
	let freshScopeReported = false;
	let finishing = false;
	const subscriptions: Array<() => void> = [];
	let priorChannelDetailDelivery: unknown;
	let inverseReady = false;
	let messagePageReady = recoveryMode;
	let messagePageObservedExpected = false;
	const completeRecoveryWhenReady = () => {
		if (
			!recoveryMode ||
			connections < 2 ||
			!inverseReady ||
			!messagePageObservedExpected ||
			finishing
		)
			return;
		finishing = true;
		void (async () => {
			await report("recovered", whoami);
			const completion = await fetch("/__questpie_tracer/complete-recovery");
			if (!completion.ok)
				throw new TypeError("tracer recovery completion failed");
			for (const unsubscribe of subscriptions) unsubscribe();
			const idle = resource.getSnapshot();
			queryResourceEvidence.lastUnsubscribeIdle =
				idle.kind === "ready" && idle.connection.kind === "idle";
			await report("qri-complete", whoami);
		})().catch(() => {
			statusElement.textContent = "recovery completion failed";
		});
	};
	const publishExpectedWhenReady = () => {
		if (
			expectedBody === null ||
			mutationStarted ||
			!inverseReady ||
			!messagePageReady
		)
			return;
		mutationStarted = true;
		void publish(expectedBody).catch((error: unknown) => {
			statusElement.textContent =
				error instanceof Error ? error.message : String(error);
		});
	};
	const synchronizeChannelDetail = () => {
		const snapshot = channelDetailResource.getSnapshot();
		if (snapshot.kind === "failed") {
			inverseLiveQueryEvidence.failure = Object.freeze({
				code: snapshot.failure.code,
				publicKeys: Object.keys(snapshot.failure).sort(),
			});
			void report(phase, whoami);
			return;
		}
		if (snapshot.connection.kind !== "connected") {
			inverseReady = false;
			return;
		}
		if (
			snapshot.kind !== "ready" ||
			snapshot.delivery === priorChannelDetailDelivery
		)
			return;
		priorChannelDetailDelivery = snapshot.delivery;
		inverseReady = true;
		inverseLiveQueryEvidence.failure = undefined;
		inverseLiveQueryEvidence.lastSuccessfulMessages =
			snapshot.value?.messages.map((message) => ({
				id: message.id,
				...(message.body === undefined ? {} : { body: message.body }),
				channelId: message.channelId,
				createdAt: message.createdAt.toISOString(),
			})) ?? [];
		inverseLiveQueryEvidence.publications += 1;
		void report(phase, whoami);
		publishExpectedWhenReady();
		completeRecoveryWhenReady();
	};
	subscriptions.push(channelDetailResource.subscribe(synchronizeChannelDetail));
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
			messagePageReady = true;
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
							replacingCredential ||
							retired.kind !== "failed" ||
							retired.failure.code !== "AUTHORIZATION_FAILED"
						)
							return;
						replacingCredential = true;
						for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
						queryResourceEvidence.authorizationFailure = Object.freeze({
							code: "AUTHORIZATION_FAILED",
						});
						void (async () => {
							await report("authorization-failed", whoami);
							const recovered = new URL(location.href);
							recovered.searchParams.delete("credential");
							recovered.searchParams.set("recovered", "1");
							const returnTo = `${recovered.pathname}${recovered.search}${recovered.hash}`;
							location.replace(
								`/__questpie_tracer/sign-in?return=${encodeURIComponent(returnTo)}`,
							);
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
				messagePageObservedExpected = true;
				completeRecoveryWhenReady();
				if (recoveryMode && connections >= 2) return;
				if (recoveryMode && !freshScopeReported) {
					freshScopeReported = true;
					void report("fresh-scope-ready", whoami);
				} else if (connections >= 2) void report("recovered", whoami);
				else if (phase === "starting" || phase === "watching")
					void report("mutation-observed", whoami);
				return;
			}
			publishExpectedWhenReady();
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
	synchronizeChannelDetail();
	synchronize();
}

void start().catch(() => {
	statusElement.textContent = "authentication unavailable";
});
