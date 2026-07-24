/**
 * Runtime-neutral attachment point implemented by qualified CRDT hosts.
 *
 * The first implementation is the Bun/Elysia host. Hono and Next do not
 * qualify as CRDT transports in protocol v1.
 */
export interface CrdtHostSocketPeerV1 {
	send(data: Uint8Array): boolean;
	close(code: number, reason: string): void;
}

export interface CrdtHostSocketSessionV1 {
	message(
		data: Uint8Array,
	):
		| Readonly<{ authenticated: boolean }>
		| Promise<Readonly<{ authenticated: boolean }>>;
	drain(): void | Promise<void>;
	close(code: number, reason: string): void | Promise<void>;
}

export interface CrdtHostSocketOpenInputV1 {
	request: Request;
	clientIp: string;
	peer: CrdtHostSocketPeerV1;
}

export interface CrdtHostApplicationV1 {
	readonly protocol: "QPCR/1.0";
	handleTicket(request: Request): Promise<Response>;
	handleAgentTicket(request: Request): Promise<Response>;
	openSocket(
		input: CrdtHostSocketOpenInputV1,
	): CrdtHostSocketSessionV1 | Promise<CrdtHostSocketSessionV1>;
	stop(): void | Promise<void>;
}

export interface CrdtHostAttachInputV1 {
	path: `/${string}`;
	application: CrdtHostApplicationV1;
}

export interface CrdtHostTransportV1 {
	readonly kind: "questpie-crdt-host";
	readonly protocol: "QPCR/1.0";
	readonly runtime: "bun";
	readonly compression: false;
	attach(input: CrdtHostAttachInputV1): void | Promise<void>;
}
