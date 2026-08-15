import { principal, type Principal } from "questpie";

const ingressPrincipals = new WeakMap<Request, Principal>();

export function bindIngressPrincipal(
	request: Request,
	value: Principal,
): Request {
	if (!principal.is(value))
		throw new TypeError("Ingress Principal must be a valid Principal");
	ingressPrincipals.set(request, value);
	return request;
}

export function readIngressPrincipal(request: Request): Principal | null {
	return ingressPrincipals.get(request) ?? null;
}
