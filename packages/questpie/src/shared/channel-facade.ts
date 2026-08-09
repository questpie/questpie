const OBJECT_FACADE_KEYS = [
	"__proto__",
	"__defineGetter__",
	"__defineSetter__",
	"__lookupGetter__",
	"__lookupSetter__",
	"constructor",
	"hasOwnProperty",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"then",
	"toLocaleString",
	"toString",
	"valueOf",
] as const;

export const SERVER_CHANNEL_FACADE_RESERVED_KEYS = [
	...OBJECT_FACADE_KEYS,
	"authorize",
	"getDefinition",
	"preparePublish",
	"preparePublishRequest",
	"publish",
	"publishBatch",
	"publishPrepared",
	"resolveName",
	"resolvePresence",
	"revokeAuthority",
] as const;

export type ServerChannelFacadeReservedKey =
	(typeof SERVER_CHANNEL_FACADE_RESERVED_KEYS)[number];

const serverReservedKeys = new Set<string>(SERVER_CHANNEL_FACADE_RESERVED_KEYS);

export function isServerChannelFacadeReservedKey(
	key: string,
): key is ServerChannelFacadeReservedKey {
	return serverReservedKeys.has(key);
}

export const CLIENT_CHANNEL_FACADE_RESERVED_KEYS = [
	...OBJECT_FACADE_KEYS,
	"channelCount",
	"destroy",
	"subscriberCount",
] as const;

export type ClientChannelFacadeReservedKey =
	(typeof CLIENT_CHANNEL_FACADE_RESERVED_KEYS)[number];

const clientReservedKeys = new Set<string>(CLIENT_CHANNEL_FACADE_RESERVED_KEYS);

export function isClientChannelFacadeReservedKey(
	key: string,
): key is ClientChannelFacadeReservedKey {
	return clientReservedKeys.has(key);
}
