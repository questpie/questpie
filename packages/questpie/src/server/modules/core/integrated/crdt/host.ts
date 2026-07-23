/**
 * Runtime-neutral attachment point implemented by qualified CRDT hosts.
 *
 * The first implementation is the Bun/Elysia host. Hono and Next do not
 * qualify as CRDT transports in protocol v1.
 */
export interface CrdtHostApplicationV1 {
	readonly protocol: "QPCR/1.0";
	handleTicket(request: Request): Promise<Response>;
	handleAgentTicket(request: Request): Promise<Response>;
	handleSocket(request: Request): Promise<Response>;
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
