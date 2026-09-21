import type { Principal } from "./context";
import type {
	ServiceDefinition,
	ServiceDependencyMap,
	ServiceInstance,
} from "./service";

type MaybePromise<Value> = Value | Promise<Value>;

type CredentialService = ServiceDefinition<
	string,
	"application",
	"external",
	ServiceDependencyMap,
	unknown
>;

export type CredentialResolution =
	| Readonly<{ kind: "anonymous" }>
	| Readonly<{ kind: "malformed" }>
	| Readonly<{ kind: "resolved"; principal: Principal }>
	| Readonly<{ kind: "unavailable" }>;

/**
 * A `WWW-Authenticate` challenge value the application attaches to a real
 * HTTP `401` produced from a missing/invalid credential. The framework never
 * inspects or constructs this value (no OAuth knowledge lives in the
 * framework); it only forwards whatever the application returns, verbatim,
 * as the header value. A `string` is a fixed challenge; a function may vary
 * the challenge per Request (for example a resource-scoped
 * `resource_metadata` URL). Returning `undefined` from the function
 * suppresses the header for that Request, leaving today's behavior (401
 * without a challenge header, or for MCP the framework-fixed error frame)
 * unchanged.
 */
export type CredentialChallenge =
	| string
	| ((request: Request) => string | undefined);

export interface CredentialResolverDefinition<
	Name extends string = string,
	Service extends CredentialService = CredentialService,
> {
	readonly __questpie: Readonly<{
		category: "definition";
		resourceKind: "credentialResolver";
	}>;
	readonly name: Name;
	readonly service: Service;
	readonly executableSlots: readonly ["resolve"];
	resolve(
		input: Readonly<{
			request: Request;
			service: ServiceInstance<Service>;
		}>,
	): MaybePromise<CredentialResolution>;
	/**
	 * Normalized to a function (or `undefined`) regardless of how the
	 * application declared it. Called by the Runtime, request-by-request,
	 * only when a missing/invalid credential is about to become a real HTTP
	 * `401` (MCP `tools/call`/`tools/list`/`server/discover`, and the
	 * canonical HTTP Query/Mutation/Action surfaces). The framework never
	 * calls it for an authenticated caller who is denied by Policy.
	 */
	readonly challenge?: (request: Request) => string | undefined;
	/**
	 * Opt-in only: when `true`, MCP `tools/list` and `server/discover` also
	 * require a valid, non-anonymous credential (the same `401` + `challenge`
	 * shape as an armed `tools/call`) instead of staying open per ADR-0038's
	 * basic default. Omitted/`false` preserves today's public, unauthenticated
	 * catalogue. This still discloses the same catalogue to every
	 * credentialed caller alike; it is not per-Principal filtering.
	 */
	readonly protectCatalog?: boolean;
	/**
	 * Opt-in only: when `true`, MCP `tools/call` requires a valid,
	 * non-anonymous credential — a missing/invalid credential becomes a real
	 * `401` (or `503` on a credential-provider outage), and an anonymous
	 * caller (the normal shape of "no credential presented") is also treated
	 * as unauthenticated, even for an Operation whose own admission/Policy
	 * would otherwise allow an anonymous caller. Omitted/`false` preserves
	 * today's behavior: `tools/call` still resolves a credential for every
	 * call, but an anonymous outcome is passed through to each Operation's
	 * own admission/Policy exactly as it is on canonical HTTP — a `network:
	 * true` public Operation stays callable anonymously over MCP too.
	 */
	readonly requireCredential?: boolean;
}

export function defineCredentialResolver<
	const Name extends string,
	const Service extends CredentialService,
>(
	input: Readonly<{
		name: Name;
		service: Service;
		resolve(
			input: Readonly<{
				request: Request;
				service: ServiceInstance<Service>;
			}>,
		): MaybePromise<CredentialResolution>;
		challenge?: CredentialChallenge;
		protectCatalog?: boolean;
		requireCredential?: boolean;
	}>,
): CredentialResolverDefinition<Name, Service> {
	const challenge =
		typeof input.challenge === "string"
			? () => input.challenge as string
			: input.challenge;
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "credentialResolver",
		}),
		name: input.name,
		service: input.service,
		executableSlots: Object.freeze(["resolve"] as const),
		resolve: input.resolve,
		...(challenge === undefined ? {} : { challenge }),
		...(input.protectCatalog === undefined
			? {}
			: { protectCatalog: input.protectCatalog }),
		...(input.requireCredential === undefined
			? {}
			: { requireCredential: input.requireCredential }),
	});
}
