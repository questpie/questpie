/**
 * Render the credential-gate bindings the generated application passes to
 * the Runtime: the optional `WWW-Authenticate` challenge callback and the
 * two static booleans that decide whether the MCP catalog/tool calls are
 * protected. Split out of application.ts to keep that file's per-segment
 * render-helper convention (see application-schedules.ts, application-jobs.ts)
 * instead of growing the already-large template inline.
 */
export function renderApplicationCredentialChallenge(
	credentialResolverDefinition: string | null | undefined,
): string {
	return `const resolveApplicationChallenge = (request) => {
			${
				credentialResolverDefinition
					? `return typeof ${credentialResolverDefinition}.challenge === "function" ? ${credentialResolverDefinition}.challenge(request) : undefined;`
					: "return undefined;"
			}
		};
	const mcpCatalogRequiresCredential = ${
		credentialResolverDefinition
			? `Boolean(${credentialResolverDefinition}.protectCatalog)`
			: "false"
	};
	const mcpCallsRequireCredential = ${
		credentialResolverDefinition
			? `Boolean(${credentialResolverDefinition}.requireCredential)`
			: "false"
	};`;
}
