import { defineCredentialResolver, principal } from "questpie";

import { demoIds } from "../demo-ids";
import { supportAuth } from "./service";

export const integrationCredentialHeader = "x-team-support-integration-key";
export const localIntegrationKey = "team-support-desk-local-integration-key-v1";

const encoder = new TextEncoder();

function equalText(left: string, right: string): boolean {
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	const length = Math.max(leftBytes.byteLength, rightBytes.byteLength);
	let difference = leftBytes.byteLength ^ rightBytes.byteLength;
	for (let index = 0; index < length; index += 1)
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	return difference === 0;
}

export const applicationCredentials = defineCredentialResolver({
	name: "teamSupport.applicationCredentials",
	service: supportAuth,
	resolve: async ({ request, service }) => {
		const integrationKey = request.headers.get(integrationCredentialHeader);
		if (
			integrationKey !== null &&
			equalText(integrationKey, localIntegrationKey)
		)
			return {
				kind: "resolved",
				principal: principal.service({ name: demoIds.principals.integration }),
			};

		try {
			const principalId = await service.principalId(request.headers);
			return principalId === null
				? { kind: "anonymous" }
				: {
						kind: "resolved",
						principal: principal.user({ id: principalId }),
					};
		} catch {
			return { kind: "unavailable" };
		}
	},
});

export { supportAuth };
