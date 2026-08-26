import { createSupportBetterAuth } from "../../runtime/better-auth";
import { demoAuthIdentities } from "../../src/auth/demo-identities";

const infrastructure = await createSupportBetterAuth();

try {
	for (const identity of Object.values(demoAuthIdentities)) {
		try {
			await infrastructure.auth.api.signUpEmail({
				body: {
					email: identity.email,
					name: identity.name,
					password: identity.password,
				},
			});
		} catch {
			try {
				await infrastructure.auth.api.signInEmail({
					body: {
						email: identity.email,
						password: identity.password,
					},
				});
			} catch (signInError) {
				throw new Error(`Could not seed or verify ${identity.email}`, {
					cause: signInError,
				});
			}
		}
	}
	console.log(
		`Better Auth demo identities ready: ${Object.keys(demoAuthIdentities).length}`,
	);
} finally {
	await infrastructure.close();
}
