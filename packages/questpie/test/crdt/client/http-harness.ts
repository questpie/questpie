import { CrdtClientCoordinator } from "../../../src/client/crdt/coordinator.js";
import { CrdtClientDocument } from "../../../src/client/crdt/document.js";
import { createClientSetSnapshot } from "../../../src/client/crdt/set-engine.js";
import type {
	CrdtClientClock,
	CrdtClientExchangePort,
	CrdtClientManifestOwner,
	CrdtClientOpenedSession,
	CrdtClientRealtimeSessionPort,
	CrdtClientStorage,
	CrdtClientTextEngine,
} from "../../../src/client/crdt/types.js";
import type {
	CrdtExchangeAppendReceiptV1,
	CrdtExchangePullFieldV1,
	CrdtExchangeRequestFrameV1,
	CrdtExchangeResponseFrameV1,
} from "../../../src/shared/crdt-exchange.js";

export type TestField = Readonly<{
	key: string;
	fieldSlot: number;
	format: "text" | "set";
	value: string | readonly string[];
	grant?: "view" | "edit";
	/**
	 * Initial snapshot in the ENGINE's own format. Required when driving the
	 * harness with a real CRDT engine; the default toy engine derives it from
	 * `value`.
	 */
	snapshot?: Uint8Array;
	fieldEpoch?: bigint;
	fieldCursor?: bigint;
}>;

export type ExchangeHarnessOptions = Readonly<{
	fields?: readonly TestField[];
	awarenessEnabled?: boolean;
	storage?: CrdtClientStorage;
	clock?: CrdtClientClock;
	maxPendingUpdates?: number;
	maxPendingBytes?: number;
	autoAcknowledge?: boolean;
	namespace?: string;
	deploymentFingerprint?: string;
	offlineSubjectKey?: string;
	incarnationKey?: string;
	schemaVersion?: number;
	schemaFingerprint?: string;
	textEngine?: CrdtClientTextEngine;
}>;

export class CrdtExchangeHarness {
	readonly sent: CrdtExchangeRequestFrameV1[] = [];
	readonly opened: Parameters<CrdtClientExchangePort["open"]>[0][] = [];
	readonly registrations: Array<{
		id: string;
		bindingId: string;
		onDirty(lane: "visible" | "awareness"): void;
		onError(error: Error): void;
	}> = [];
	readonly releasedRegistrations: string[] = [];
	readonly releasedCapabilities: string[] = [];
	readonly manifest: CrdtClientOpenedSession["manifest"];
	readonly exchange: CrdtClientExchangePort;
	readonly realtimeSession: CrdtClientRealtimeSessionPort;
	rosterPages: unknown[] = [];
	autoAcknowledge: boolean;
	responseOverride?: (
		frame: CrdtExchangeRequestFrameV1,
		response: CrdtExchangeResponseFrameV1,
		signal?: AbortSignal,
	) => CrdtExchangeResponseFrameV1 | Promise<CrdtExchangeResponseFrameV1>;
	openOverride?: (
		input: Parameters<CrdtClientExchangePort["open"]>[0],
		opened: CrdtClientOpenedSession,
	) => CrdtClientOpenedSession | Promise<CrdtClientOpenedSession>;
	registrationOverride?: (
		input: (typeof this.registrations)[number],
		sequence: number,
	) => void | Promise<void>;
	private readonly snapshots = new Map<number, Uint8Array>();
	private readonly cursors = new Map<number, bigint>();
	private readonly epochs = new Map<number, bigint>();
	private readonly acknowledged = new Map<
		string,
		CrdtExchangeAppendReceiptV1
	>();
	private readonly delayedAppends: Array<{
		frame: Extract<CrdtExchangeRequestFrameV1, { opcode: 0x02 }>;
		resolve(response: CrdtExchangeResponseFrameV1): void;
	}> = [];
	private readonly bindingIdsByOpenId = new Map<string, string>();
	private registrationSequence = 0;
	private bindingSequence = 0x20;
	private activeManifest: CrdtClientOpenedSession["manifest"];

	constructor(readonly options: ExchangeHarnessOptions = {}) {
		const fields =
			options.fields ??
			([
				{
					key: "title",
					fieldSlot: 1,
					format: "text",
					value: "Draft",
				},
			] satisfies readonly TestField[]);
		const textEngineForManifest = options.textEngine ?? testTextEngine();
		const manifestFields: Record<
			string,
			CrdtClientOpenedSession["manifest"]["fields"][string]
		> = {};
		for (const field of [...fields].sort(
			(left, right) => left.fieldSlot - right.fieldSlot,
		)) {
			manifestFields[field.key] = Object.freeze({
				fieldSlot: field.fieldSlot,
				format: field.format,
				// Derived from the configured engine, not hardcoded: the client
				// rejects a manifest whose engineId/formatVersion do not match its
				// own engine, so a harness that always claims "test-text" can only
				// ever be driven by the toy engine.
				formatVersion:
					field.format === "text" ? textEngineForManifest.formatVersion : 1,
				engineId:
					field.format === "text"
						? textEngineForManifest.engineId
						: "questpie.deterministic-add-wins-set/v1",
				grant: field.grant ?? "edit",
			});
			// The initial snapshot must be in the ENGINE's format. The toy engine
			// treats a text snapshot as raw UTF-8; a real CRDT engine expects its
			// own encoded state, so build it through the engine when one is given.
			this.snapshots.set(
				field.fieldSlot,
				field.format === "text"
					? (field.snapshot ??
							textSnapshotFor(textEngineForManifest, field.value as string))
					: createClientSetSnapshot(field.value as readonly string[]),
			);
			this.cursors.set(field.fieldSlot, field.fieldCursor ?? 0n);
			this.epochs.set(field.fieldSlot, field.fieldEpoch ?? 1n);
		}
		this.manifest = Object.freeze({
			schemaVersion: options.schemaVersion ?? 1,
			schemaFingerprint: options.schemaFingerprint ?? "S".repeat(43),
			awarenessEnabled: options.awarenessEnabled ?? false,
			fields: Object.freeze(manifestFields),
		});
		this.activeManifest = this.manifest;
		this.autoAcknowledge = options.autoAcknowledge ?? true;
		this.exchange = Object.freeze({
			open: async (input) => {
				this.opened.push(input);
				const opened = this.openedSession(input.mode, input.openId);
				const result = this.openOverride
					? this.openOverride(input, opened)
					: opened;
				const resolved = await result;
				this.activeManifest = resolved.manifest;
				return resolved;
			},
			exchange: async (frame, signal) => {
				this.sent.push(frame);
				if (frame.opcode === 0x02 && !this.autoAcknowledge) {
					return new Promise<CrdtExchangeResponseFrameV1>((resolve) => {
						this.delayedAppends.push({ frame, resolve });
					});
				}
				const response = await this.respond(frame);
				return this.responseOverride
					? this.responseOverride(frame, response, signal)
					: response;
			},
		});
		this.realtimeSession = Object.freeze({
			acquireEdgeCapability: async (signal) => {
				if (signal?.aborted) throw abortError();
				const sequence = ++this.registrationSequence;
				let released = false;
				return {
					sessionId: "00000000-0000-4000-8000-000000000010",
					token: `edge-token-${sequence}`,
					registerCrdt: async (input) => {
						if (released) throw new Error("released capability");
						await this.registrationOverride?.(input, sequence);
						this.registrations.push(input);
						let unregistered = false;
						return () => {
							if (unregistered) return;
							unregistered = true;
							this.releasedRegistrations.push(input.bindingId);
							const index = this.registrations.indexOf(input);
							if (index >= 0) this.registrations.splice(index, 1);
						};
					},
					release: () => {
						if (released) return;
						released = true;
						this.releasedCapabilities.push(`edge-${sequence}`);
					},
				};
			},
		});
	}

	createDocument(
		locator: { id: string | number } = { id: "article-1" },
	): CrdtClientDocument {
		const clock = this.options.clock;
		const coordinator = new CrdtClientCoordinator(
			clock
				? {
						setTimeout: clock.setTimeout.bind(clock) as typeof setTimeout,
						clearTimeout: clock.clearTimeout.bind(clock) as typeof clearTimeout,
					}
				: {},
		);
		return new CrdtClientDocument(
			{
				baseURL: "https://api.example.com",
				basePath: "/api",
				fetcher: globalThis.fetch,
				realtimeSession: this.realtimeSession,
				exchange: this.exchange,
				runtime: {
					engines: { text: this.options.textEngine ?? testTextEngine() },
					...(this.options.storage ? { storage: this.options.storage } : {}),
					...(clock ? { clock } : {}),
					...(this.options.maxPendingUpdates === undefined
						? {}
						: { maxPendingUpdates: this.options.maxPendingUpdates }),
					...(this.options.maxPendingBytes === undefined
						? {}
						: { maxPendingBytes: this.options.maxPendingBytes }),
				},
			},
			"collection",
			"articles",
			locator,
			undefined,
			coordinator,
		);
	}

	dirty(lane: "visible" | "awareness" = "visible"): void {
		for (const registration of this.registrations) {
			registration.onDirty(lane);
		}
	}

	failRealtime(error = new Error("realtime failed")): void {
		for (const registration of this.registrations) {
			registration.onError(error);
		}
	}

	setText(fieldSlot: number, value: string, fieldCursor?: bigint): void {
		this.snapshots.set(fieldSlot, new TextEncoder().encode(value));
		if (fieldCursor !== undefined) this.cursors.set(fieldSlot, fieldCursor);
	}

	setRoster(pages: readonly unknown[]): void {
		this.rosterPages = [...pages];
	}

	async releaseNextAppend(): Promise<void> {
		const delayed = this.delayedAppends.shift();
		if (!delayed) throw new Error("No delayed append");
		const response = await this.respond(delayed.frame);
		delayed.resolve(
			this.responseOverride
				? await this.responseOverride(delayed.frame, response)
				: response,
		);
	}

	private openedSession(
		mode: "view" | "edit",
		openId: string,
	): CrdtClientOpenedSession {
		let bindingId = this.bindingIdsByOpenId.get(openId);
		if (!bindingId) {
			bindingId = `00000000-0000-4000-8000-${this.bindingSequence
				.toString(16)
				.padStart(12, "0")}`;
			this.bindingSequence += 1;
			this.bindingIdsByOpenId.set(openId, bindingId);
		}
		const manifest =
			mode === "edit"
				? this.manifest
				: Object.freeze({
						...this.manifest,
						fields: Object.freeze(
							Object.fromEntries(
								Object.entries(this.manifest.fields).map(([key, field]) => [
									key,
									Object.freeze({ ...field, grant: "view" as const }),
								]),
							),
						),
					});
		return Object.freeze({
			protocol: "questpie-crdt-http",
			version: 1,
			namespace: this.options.namespace ?? "app",
			deploymentFingerprint:
				this.options.deploymentFingerprint ?? "deployment-1",
			bindingId,
			bindingIdBytes: uuidBytes(bindingId),
			sessionGeneration: 1n,
			deliveryGeneration: 1n,
			leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
			incarnationKey:
				this.options.incarnationKey ?? "00000000-0000-4000-8000-000000000030",
			effectiveMode: mode,
			offlineSubjectKey: this.options.offlineSubjectKey ?? "A".repeat(43),
			manifest,
		});
	}

	private async respond(
		frame: CrdtExchangeRequestFrameV1,
	): Promise<CrdtExchangeResponseFrameV1> {
		switch (frame.opcode) {
			case 0x01:
				return this.pull(frame);
			case 0x02: {
				const cursors = frame.payload.parts.map((part) => {
					const cursor = (this.cursors.get(part.fieldSlot) ?? 0n) + 1n;
					this.cursors.set(part.fieldSlot, cursor);
					return { fieldSlot: part.fieldSlot, fieldCursor: cursor };
				});
				const receipt = Object.freeze({
					updateId: new Uint8Array(frame.payload.updateId),
					aggregateEpoch: frame.payload.aggregateEpoch,
					cursors,
				});
				this.acknowledged.set(hex(frame.payload.updateId), receipt);
				return response(frame, 0x82, receipt);
			}
			case 0x03:
				return response(frame, 0x83, {
					receipts: frame.payload.receipts.flatMap((query) => {
						const receipt = this.acknowledged.get(hex(query.updateId));
						return receipt ? [receipt] : [];
					}),
				});
			case 0x04:
				return response(frame, 0x84, {
					value: frame.payload.action === "roster" ? this.rosterPages : [],
				});
			case 0x05:
				return response(frame, 0x85, {
					serverTimeMs: BigInt(this.options.clock?.now() ?? Date.now()),
				});
			case 0x06:
				return response(frame, 0x86, {});
		}
	}

	private async pull(
		frame: Extract<CrdtExchangeRequestFrameV1, { opcode: 0x01 }>,
	): Promise<CrdtExchangeResponseFrameV1> {
		const fields: CrdtExchangePullFieldV1[] = [];
		const chunks: Extract<
			CrdtExchangeResponseFrameV1,
			{ opcode: 0x81 }
		>["payload"]["chunks"][number][] = [];
		let chunkIndex = 0;
		for (const contract of Object.values(this.activeManifest.fields).sort(
			(left, right) => left.fieldSlot - right.fieldSlot,
		)) {
			const bytes = this.snapshots.get(contract.fieldSlot)!;
			const digest = await sha256(bytes);
			const field = Object.freeze({
				fieldSlot: contract.fieldSlot,
				grant: contract.grant === "edit" ? (1 as const) : (0 as const),
				fieldEpoch: this.epochs.get(contract.fieldSlot) ?? 1n,
				formatVersion: contract.formatVersion,
				fieldCursor: this.cursors.get(contract.fieldSlot) ?? 0n,
				byteLength: bytes.byteLength,
				digest,
			});
			fields.push(field);
			chunks.push(
				Object.freeze({
					fieldSlot: field.fieldSlot,
					fieldEpoch: field.fieldEpoch,
					formatVersion: field.formatVersion,
					throughFieldCursor: field.fieldCursor,
					chunkIndex: chunkIndex++,
					offset: 0,
					final: true,
					bytes: new Uint8Array(bytes),
				}),
			);
		}
		return response(frame, 0x81, {
			pullId: new Uint8Array(frame.payload.pullId),
			aggregateEpoch: 1n,
			schemaVersion: this.activeManifest.schemaVersion,
			artifactDigest: await artifactDigest(fields, this.snapshots),
			complete: true,
			continuation: null,
			fields,
			chunks,
		});
	}
}

/**
 * Initial text snapshot for the DEFAULT toy engine, which stores text as raw
 * UTF-8 and reads it back directly in restore().
 *
 * A real CRDT engine has no such shortcut — an empty byte array is not a valid
 * Yjs update, for instance. Tests driving a real engine pass `snapshot` on the
 * field instead, built with that engine, so this harness stays engine-agnostic
 * rather than importing one.
 */
function textSnapshotFor(
	_engine: CrdtClientTextEngine<any>,
	value: string,
): Uint8Array {
	return new TextEncoder().encode(value);
}

export function testTextEngine(): CrdtClientTextEngine<string> {
	const apply = (
		replica: string,
		operations: readonly (
			| { type: "insert"; index: number; value: string }
			| { type: "delete"; index: number; length: number }
		)[],
	) => {
		let next = replica;
		for (const operation of operations) {
			if (
				operation.index < 0 ||
				operation.index > next.length ||
				(operation.type === "delete" &&
					operation.index + operation.length > next.length)
			) {
				throw new Error("invalid text operation");
			}
			next =
				operation.type === "insert"
					? next.slice(0, operation.index) +
						operation.value +
						next.slice(operation.index)
					: next.slice(0, operation.index) +
						next.slice(operation.index + operation.length);
		}
		return {
			replica: next,
			update: new TextEncoder().encode(JSON.stringify(operations)),
		};
	};
	return Object.freeze({
		engineId: "test-text",
		formatVersion: 1,
		relativePositions: Object.freeze({
			create(_replica, input) {
				const bytes = new Uint8Array(5);
				const view = new DataView(bytes.buffer);
				view.setUint8(0, input.affinity === "preceding" ? 0 : 1);
				view.setUint32(1, input.offset);
				return base64Url(bytes);
			},
			resolve(_replica, position) {
				const bytes = fromBase64Url(position);
				if (bytes.byteLength !== 5 || (bytes[0] !== 0 && bytes[0] !== 1)) {
					throw new Error("invalid test relative position");
				}
				return Object.freeze({
					offset: new DataView(
						bytes.buffer,
						bytes.byteOffset,
						bytes.byteLength,
					).getUint32(1),
					affinity: bytes[0] === 0 ? "preceding" : "following",
				});
			},
		}),
		restore: (snapshot) => new TextDecoder().decode(snapshot),
		snapshot: (replica) => new TextEncoder().encode(replica),
		proof: () => new Uint8Array(),
		value: (replica) => replica,
		apply,
		applyUpdate: (replica, update) =>
			apply(
				replica,
				JSON.parse(new TextDecoder().decode(update)) as Parameters<
					typeof apply
				>[1],
			).replica,
		mergeUpdates: (updates) =>
			new TextEncoder().encode(
				JSON.stringify(
					updates.flatMap(
						(update) =>
							JSON.parse(new TextDecoder().decode(update)) as unknown[],
					),
				),
			),
	});
}

export function manifestOwner(
	harness: CrdtExchangeHarness,
): CrdtClientManifestOwner {
	return harness.manifest;
}

async function artifactDigest(
	fields: readonly CrdtExchangePullFieldV1[],
	snapshots: ReadonlyMap<number, Uint8Array>,
): Promise<Uint8Array> {
	const writer = new DigestWriter();
	writer.raw(new TextEncoder().encode("questpie-crdt-pull-artifact-v1\0"));
	for (const field of fields) {
		writer.u16(field.fieldSlot);
		writer.u8(field.grant);
		writer.u64(field.fieldEpoch);
		writer.u16(field.formatVersion);
		writer.u64(field.fieldCursor);
		writer.u32(field.byteLength);
		writer.raw(field.digest);
		writer.raw(snapshots.get(field.fieldSlot)!);
	}
	return sha256(writer.finish());
}

async function sha256(value: Uint8Array): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

function response<TOpcode extends CrdtExchangeResponseFrameV1["opcode"]>(
	request: CrdtExchangeRequestFrameV1,
	opcode: TOpcode,
	payload: Extract<CrdtExchangeResponseFrameV1, { opcode: TOpcode }>["payload"],
): Extract<CrdtExchangeResponseFrameV1, { opcode: TOpcode }> {
	return {
		major: 1,
		minor: 0,
		opcode,
		requestId: new Uint8Array(request.requestId),
		payload,
	} as Extract<CrdtExchangeResponseFrameV1, { opcode: TOpcode }>;
}

class DigestWriter {
	private readonly chunks: Uint8Array[] = [];

	u8(value: number): void {
		this.chunks.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.chunks.push(bytes);
	}

	u32(value: number): void {
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.chunks.push(bytes);
	}

	u64(value: bigint): void {
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value);
		this.chunks.push(bytes);
	}

	raw(value: Uint8Array): void {
		this.chunks.push(new Uint8Array(value));
	}

	finish(): Uint8Array {
		const length = this.chunks.reduce(
			(total, chunk) => total + chunk.byteLength,
			0,
		);
		const output = new Uint8Array(length);
		let offset = 0;
		for (const chunk of this.chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return output;
	}
}

function uuidBytes(value: string): Uint8Array {
	const hexValue = value.replace(/-/g, "");
	return Uint8Array.from({ length: 16 }, (_, index) =>
		Number.parseInt(hexValue.slice(index * 2, index * 2 + 2), 16),
	);
}

function hex(value: Uint8Array): string {
	return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(value: Uint8Array): string {
	return btoa(String.fromCharCode(...value))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
	return Uint8Array.from(
		atob(
			value.replace(/-/g, "+").replace(/_/g, "/") +
				"=".repeat((4 - (value.length % 4)) % 4),
		),
		(character) => character.charCodeAt(0),
	);
}

function abortError(): DOMException {
	return new DOMException("Aborted", "AbortError");
}
