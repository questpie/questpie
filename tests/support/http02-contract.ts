export const http02Context = Object.freeze({
	tenantId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
});

export const http02ContextCodec = {
	kind: "object",
	properties: { tenantId: { kind: "uuid" } },
} as const;

export const http02InputCodec = {
	kind: "object",
	properties: { value: { kind: "text", maxLength: 32 } },
} as const;

export const http02OutputCodec = {
	kind: "object",
	properties: { ok: { kind: "boolean" } },
} as const;

export const http02MutationIdentity = "mutation:messages.publish";
export const http02ActionIdentity = "action:delivery.send";
