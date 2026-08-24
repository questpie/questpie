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
	| Readonly<{ kind: "resolved"; principal: Principal }>
	| Readonly<{ kind: "unavailable" }>;

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
	}>,
): CredentialResolverDefinition<Name, Service> {
	return Object.freeze({
		__questpie: Object.freeze({
			category: "definition",
			resourceKind: "credentialResolver",
		}),
		name: input.name,
		service: input.service,
		executableSlots: Object.freeze(["resolve"] as const),
		resolve: input.resolve,
	});
}
