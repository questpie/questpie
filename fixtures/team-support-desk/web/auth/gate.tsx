import { type FormEvent, useState } from "react";

import { demoAuthIdentities } from "../../src/auth/demo-identities";
import { errorMessage } from "../shared/format";
import { authClient, supportSession } from "./client";
import { DeskSession } from "./desk-session";

async function signIn(email: string, password: string): Promise<void> {
	const result = await authClient.signIn.email({ email, password });
	if (result.error) throw new Error(result.error.message ?? "Sign in failed");
}

function LoginScreen() {
	const [email, setEmail] = useState<string>(demoAuthIdentities.agent.email);
	const [password, setPassword] = useState<string>(
		demoAuthIdentities.agent.password,
	);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState("");

	async function authenticate(nextEmail: string, nextPassword: string) {
		setBusy(true);
		setFailure("");
		try {
			await signIn(nextEmail, nextPassword);
		} catch (error) {
			const message = errorMessage(error);
			setFailure(message);
		} finally {
			setBusy(false);
		}
	}

	function submit(event: FormEvent<HTMLFormElement>): void {
		event.preventDefault();
		void authenticate(email, password);
	}

	return (
		<main className="auth-shell">
			<section className="auth-card" aria-labelledby="auth-heading">
				<div className="brand auth-brand">
					<span className="brand-mark" aria-hidden="true">
						Q
					</span>
					<span>
						<strong>Support Desk</strong>
						<small>Team operations</small>
					</span>
				</div>
				<p className="eyebrow">Better Auth session</p>
				<h1 id="auth-heading">Sign in to your support queue</h1>
				<p className="auth-intro">
					Authentication establishes identity. QUESTPIE still resolves current
					membership and enforces tenant and role Policy on every operation.
				</p>
				<form className="auth-form" onSubmit={submit}>
					<label>
						Email
						<input
							autoComplete="username"
							disabled={busy}
							onChange={(event) => setEmail(event.currentTarget.value)}
							required
							type="email"
							value={email}
						/>
					</label>
					<label>
						Password
						<input
							autoComplete="current-password"
							disabled={busy}
							onChange={(event) => setPassword(event.currentTarget.value)}
							required
							type="password"
							value={password}
						/>
					</label>
					<p className="form-error" role="alert">
						{failure}
					</p>
					<button className="primary" disabled={busy} type="submit">
						{busy ? "Signing in…" : "Sign in"}
					</button>
				</form>
				<div className="demo-identities" aria-label="Local demo identities">
					<p>Use a local demo identity</p>
					{Object.entries(demoAuthIdentities).map(([persona, identity]) => (
						<button
							disabled={busy}
							key={persona}
							onClick={() => {
								setEmail(identity.email);
								setPassword(identity.password);
							}}
							type="button"
						>
							{identity.label}
						</button>
					))}
				</div>
			</section>
		</main>
	);
}

export function AuthGate() {
	const sessionQuery = authClient.useSession();
	if (sessionQuery.isPending)
		return (
			<p className="bootstrap-state" role="status">
				Loading session…
			</p>
		);
	if (sessionQuery.error)
		return (
			<main className="bootstrap-error">
				<h1>Session unavailable</h1>
				<p role="alert">{sessionQuery.error.message}.</p>
			</main>
		);
	if (sessionQuery.data === null) return <LoginScreen />;

	const session = supportSession(sessionQuery.data);
	if (session === null)
		return (
			<main className="bootstrap-error">
				<h1>No support membership</h1>
				<p role="alert">
					This authenticated account has no Team Support Desk routing hints.
				</p>
				<button type="button" onClick={() => void authClient.signOut()}>
					Sign out
				</button>
			</main>
		);

	return (
		<DeskSession
			key={JSON.stringify([
				sessionQuery.data.session.id,
				session.membershipId,
				session.organizationId,
			])}
			onSignOut={() => authClient.signOut().then(() => undefined)}
			session={session}
		/>
	);
}
