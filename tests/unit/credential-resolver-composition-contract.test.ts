import { expect, test } from "bun:test";

import { compositionContract } from "../../packages/compiler/src/composition";

function resolverValue(
	overrides: Readonly<{
		challenge?: (request: Request) => string | undefined;
		protectCatalog?: boolean;
		requireCredential?: boolean;
	}> = {},
) {
	return {
		name: "appCredentials",
		service: {
			__questpie: { resourceKind: "service" },
			name: "authService",
			lifetime: "application",
			effect: "external",
		},
		resolve: async () => ({ kind: "anonymous" }),
		...overrides,
	};
}

test("F6(i): the compiled credential-resolver contract captures whether challenge/protectCatalog/requireCredential are configured", () => {
	const contract = compositionContract("credentialResolver", resolverValue());
	expect(contract).toMatchObject({
		format: "questpie.credential-resolver-definition-contract",
		hasChallenge: false,
		protectCatalog: false,
		requireCredential: false,
	});
});

test("F6(i): a configured challenge function changes the digested contract, so dropping it anywhere is caught", () => {
	const withChallenge = compositionContract(
		"credentialResolver",
		resolverValue({ challenge: () => "Bearer" }),
	);
	const without = compositionContract("credentialResolver", resolverValue());
	expect(withChallenge.hasChallenge).toBe(true);
	expect(without.hasChallenge).toBe(false);
	expect(withChallenge).not.toEqual(without);
});

test("F6(i): protectCatalog and requireCredential are captured independently of each other and of challenge", () => {
	const contract = compositionContract(
		"credentialResolver",
		resolverValue({ protectCatalog: true, requireCredential: true }),
	);
	expect(contract).toMatchObject({
		hasChallenge: false,
		protectCatalog: true,
		requireCredential: true,
	});
});
