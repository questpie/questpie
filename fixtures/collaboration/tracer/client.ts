import { createClient } from "#questpie/client";

import { tracerIds } from "./constants";

type TracerPhase = "starting" | "watching" | "mutation-observed" | "recovered";

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
let phase: TracerPhase = "starting";
let connections = 0;
let mutationStarted = false;

async function report(next: TracerPhase): Promise<void> {
	phase = next;
	statusElement.textContent = next;
	await fetch("/__questpie_tracer/report", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ phase: next, connections }),
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

const client = createClient({ baseUrl: location.origin }).withContext({
	companyId: tracerIds.company,
});

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

client.queries["messages.page"].watch(
	{ after: null, channelId: tracerIds.channel, first: 50 },
	(page) => {
		render(page);
		const observed =
			expectedBody !== null &&
			page.nodes.some((message) => message.body === expectedBody);
		if (observed) {
			void report(connections >= 2 ? "recovered" : "mutation-observed");
			return;
		}
		if (expectedBody !== null && !mutationStarted) {
			mutationStarted = true;
			void publish(expectedBody).catch((error: unknown) => {
				statusElement.textContent =
					error instanceof Error ? error.message : String(error);
			});
		}
	},
	{
		onStateChange: (state) => {
			if (state.kind === "connected") connections += 1;
			if (phase === "starting") void report("watching");
			else statusElement.textContent = `${phase} · ${state.kind}`;
		},
		onError: (error) => {
			statusElement.textContent = `watch error · ${error.code}`;
		},
	},
);
