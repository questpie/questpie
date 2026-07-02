/**
 * AutopilotChatTransport — the ChatTransport bridging `useChat` onto the
 * consolidated run model:
 *
 * - `sendMessages` POSTs the turn to `/api/chat` (JSON contract
 *   `{session, message, runId, streamId}` — NOT a stream), reports the turn to
 *   the hook via `onTurnCreated`, then attaches to the canonical SSE tail
 *   `GET /api/runs/{runId}/stream`.
 * - `reconnectToStream` attaches to `GET /api/chat/{sessionId}/stream` (the
 *   server resolves the session's activeRun); 204/absent → null.
 *
 * The tail frames one UIMessage chunk per SSE event (`id:{seq}\ndata:{json}`),
 * terminates with `data: [DONE]`, and signals a TTL gap with `event: expired`
 * (handled here → `onStreamExpired`, so the hook falls back to persisted
 * parts). Frames that fail JSON.parse are skipped with a warning rather than
 * thrown — a broken chunk degrades, it never blanks the chat (§4.2).
 */

import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

type Doc = Record<string, any>;

export interface AutopilotTurn {
	session: Doc;
	message: Doc;
	runId?: string;
	streamId?: string;
}

export interface AutopilotChatTransportOptions {
	/** API base path, e.g. `client.getBasePath()` → "/api". */
	basePath: string;
	/** Server chat-session id for this Chat — null until the first turn creates one. */
	getSessionId: () => string | null;
	/** Extra send context merged into the POST metadata. */
	getSendContext?: () => { activeRoute?: string | null };
	/** Fired with the POST /api/chat response before the stream attaches. */
	onTurnCreated?: (turn: AutopilotTurn) => void;
	/** Fired when the tail signals a TTL-expired gap (event: expired). */
	onStreamExpired?: () => void;
	fetchImpl?: typeof fetch;
}

function lastUserMessage(messages: UIMessage[]): UIMessage | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") return messages[index];
	}
	return null;
}

function textOf(message: UIMessage): string {
	if (!Array.isArray(message.parts)) return "";
	return message.parts
		.filter(
			(part): part is { type: "text"; text: string } =>
				!!part &&
				(part as { type?: string }).type === "text" &&
				typeof (part as { text?: unknown }).text === "string",
		)
		.map((part) => part.text)
		.join("");
}

async function errorMessageFrom(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as {
			error?: unknown;
			message?: unknown;
		};
		const message = body?.error ?? body?.message;
		if (typeof message === "string" && message) return message;
		if (message && typeof message === "object") {
			const nested = (message as { message?: unknown }).message;
			if (typeof nested === "string" && nested) return nested;
		}
	} catch {
		// fall through to status text
	}
	return `Request failed (${response.status})`;
}

/** Parse one SSE frame's `event:`/`data:`/`id:` lines (data joined per spec). */
function parseSseFrame(frame: string): {
	event: string | null;
	data: string;
	id: string | null;
} {
	let event: string | null = null;
	let id: string | null = null;
	const data: string[] = [];
	for (const rawLine of frame.split("\n")) {
		const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
		if (line.startsWith("data:")) {
			data.push(line.slice(5).trimStart());
		} else if (line.startsWith("event:")) {
			event = line.slice(6).trim();
		} else if (line.startsWith("id:")) {
			id = line.slice(3).trim();
		}
	}
	return { event, data: data.join("\n"), id };
}

/**
 * Parse the run-stream SSE wire (id/data frames, [DONE], event: expired) into
 * UIMessageChunk objects. Shared by the chat transport and the run-detail
 * live transcript.
 */
export function parseSseToChunks(
	body: ReadableStream<Uint8Array>,
	onExpired?: () => void,
	onEventId?: (id: string) => void,
): ReadableStream<UIMessageChunk> {
	// TextDecoderStream's lib.dom typing predates typed-array generics — the
	// runtime shape is a ReadableWritablePair<string, Uint8Array>.
	const reader = body
		.pipeThrough<string>(new TextDecoderStream() as never)
		.getReader();
	let buffer = "";

	const finish = async (
		controller: ReadableStreamDefaultController<UIMessageChunk>,
	) => {
		controller.close();
		try {
			await reader.cancel();
		} catch {
			// already closed
		}
	};

	return new ReadableStream<UIMessageChunk>({
		async pull(controller) {
			while (true) {
				const frameEnd = buffer.indexOf("\n\n");
				if (frameEnd === -1) {
					const { done, value } = await reader.read();
					if (done) {
						controller.close();
						return;
					}
					buffer += value;
					continue;
				}

				const frame = buffer.slice(0, frameEnd);
				buffer = buffer.slice(frameEnd + 2);
				const { event, data, id } = parseSseFrame(frame);
				if (id !== null) onEventId?.(id);
				if (event === "expired") {
					onExpired?.();
					await finish(controller);
					return;
				}
				if (!data) continue;
				if (data === "[DONE]") {
					await finish(controller);
					return;
				}

				let chunk: unknown;
				try {
					chunk = JSON.parse(data);
				} catch {
					console.warn("[autopilot-chat] skipping unparseable SSE frame", data);
					continue;
				}
				if (
					chunk &&
					typeof chunk === "object" &&
					typeof (chunk as { type?: unknown }).type === "string"
				) {
					controller.enqueue(chunk as UIMessageChunk);
					return;
				}
				console.warn("[autopilot-chat] skipping non-chunk SSE frame", data);
			}
		},
		cancel() {
			void reader.cancel().catch(() => {});
		},
	});
}

export class AutopilotChatTransport implements ChatTransport<UIMessage> {
	private readonly options: AutopilotChatTransportOptions;
	/** Last SSE id received from the CURRENT live stream — lets a reconnect
	 * resume at the true offset instead of replaying from 0 (which would
	 * duplicate parts into a partially-built assistant message). */
	private lastEventId: string | null = null;

	constructor(options: AutopilotChatTransportOptions) {
		this.options = options;
	}

	private get fetch(): typeof fetch {
		return this.options.fetchImpl ?? globalThis.fetch.bind(globalThis);
	}

	private headers(json: boolean): Record<string, string> {
		return {
			...(json ? { "content-type": "application/json" } : {}),
			"x-questpie-admin": "1",
		};
	}

	sendMessages: ChatTransport<UIMessage>["sendMessages"] = async (options) => {
		const { messages, abortSignal } = options;
		const user = lastUserMessage(messages);
		if (!user) throw new Error("No user message to send");

		const metadata = (user.metadata ?? {}) as {
			attachments?: unknown[];
		};
		const context = this.options.getSendContext?.() ?? {};
		const response = await this.fetch(`${this.options.basePath}/chat`, {
			method: "POST",
			headers: this.headers(true),
			signal: abortSignal,
			body: JSON.stringify({
				chatSessionId: this.options.getSessionId() ?? undefined,
				content: textOf(user),
				clientMessageId: user.id,
				attachments: metadata.attachments ?? [],
				metadata: {
					source: "admin-rail",
					activeRoute: context.activeRoute ?? null,
				},
			}),
		});
		if (!response.ok) {
			throw new Error(await errorMessageFrom(response));
		}

		const turn = (await response.json()) as AutopilotTurn;
		this.options.onTurnCreated?.(turn);
		if (!turn.runId) {
			// The run-model contract always returns a runId — its absence means a
			// broken server response, not a stream to attach to.
			throw new Error("Chat run model did not return a runId");
		}

		// The run is already enqueued server-side — a transient tail failure must
		// not fail the turn, so retry the attach once before giving up.
		const attach = () =>
			this.fetch(
				`${this.options.basePath}/runs/${encodeURIComponent(turn.runId!)}/stream`,
				{ method: "GET", headers: this.headers(false), signal: abortSignal },
			);
		let streamResponse = await attach().catch((error) => {
			if (abortSignal?.aborted) throw error;
			return null;
		});
		if (!streamResponse || (streamResponse.status !== 204 && !streamResponse.ok)) {
			await new Promise((resolve) => setTimeout(resolve, 600));
			streamResponse = await attach();
		}
		if (streamResponse.status !== 204 && !streamResponse.ok) {
			throw new Error(await errorMessageFrom(streamResponse));
		}
		if (streamResponse.status === 204 || !streamResponse.body) {
			// Drained before we attached (ultra-fast turn) — yield an empty stream;
			// the persisted rows arrive via realtime reconciliation.
			return new ReadableStream<UIMessageChunk>({
				start(controller) {
					controller.close();
				},
			});
		}
		this.lastEventId = null;
		return parseSseToChunks(
			streamResponse.body,
			this.options.onStreamExpired,
			(id) => {
				this.lastEventId = id;
			},
		);
	};

	reconnectToStream: ChatTransport<UIMessage>["reconnectToStream"] = async () => {
		const sessionId = this.options.getSessionId();
		if (!sessionId) return null;

		// Mid-stream reconnects (auto-recovery after a dropped connection) resume
		// AFTER the last received id — a fresh mount has none and replays from 0.
		const resumeFrom = this.lastEventId;
		const response = await this.fetch(
			`${this.options.basePath}/chat/${encodeURIComponent(sessionId)}/stream`,
			{
				method: "GET",
				headers: {
					...this.headers(false),
					...(resumeFrom !== null ? { "Last-Event-ID": resumeFrom } : {}),
				},
			},
		);
		if (response.status === 204) return null;
		if (!response.ok || !response.body) {
			// Resume is best-effort: a failed reconnect must not error the chat.
			if (response.body) {
				try {
					await response.body.cancel();
				} catch {
					// ignore
				}
			}
			return null;
		}
		return parseSseToChunks(
			response.body,
			this.options.onStreamExpired,
			(id) => {
				this.lastEventId = id;
			},
		);
	};
}
