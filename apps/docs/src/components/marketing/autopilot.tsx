/* The Autopilot page, band for band from ui_kits/marketing/autopilot.html.
 *
 * Four bands: the approval that is the product, one list holding both kinds of
 * teammate, the three limits, and the ask.
 *
 * Everything that looks like a product screenshot here is live DOM. Nothing on
 * this page is interactive, though: the buttons inside the two devices render as
 * spans rather than <button>, so a keyboard user does not tab into an
 * illustration and press something that cannot respond.
 */
import { type FormEvent, useState } from "react";

import { CodeSample } from "./code";

/* CONFIRM BEFORE LAUNCH. There is no early-access capture anywhere in this repo
 * — no endpoint, no form service, no address — so this is the conventional inbox
 * for the domain and nothing more. The page it replaces held the address in
 * React state and dropped it on submit, showing a thank-you for a message nobody
 * received; a composer that opens against the wrong address at least fails where
 * the sender can see it. Replace with a real destination and this becomes a POST. */
const EARLY_ACCESS_EMAIL = "hello@questpie.com";

/* The kit wrote `orders.update(4412, { … })`. The documented accessor is
 * `collections.<name>.updateById({ id, data })` (docs/concepts/collections.mdx,
 * optimistic-concurrency.mdx) — and a proposal reads better against the row it
 * loaded than against the order number a human sees. */
const PROPOSAL = `await collections.orders.updateById({
  id: order.id,
  data: {
    status: "paid",
    paidAt: new Date(),
  },
});`;

const LIMITS = [
	{
		body: "An agent reads the same permission table a person does. No side channel, no service account.",
		title: "A role, not a key",
	},
	{
		body: "Anything that changes data comes to you first. You see what it read and what it would do.",
		title: "Proposals, not writes",
	},
	{
		body: "Every step is written in plain sentences, next to the work it belongs to.",
		title: "A log you can read",
	},
];

function ApprovalCard() {
	return (
		<div className="hero-card">
			<div className="hero-card-head">
				<span className="qp-eyebrow">Waiting on you</span>
				<span className="count">order #4412</span>
			</div>

			<div className="row" style={{ alignItems: "flex-start" }}>
				<span className="av agent">AI</span>
				<div className="rb">
					<span className="rt">Amount matches Stripe — 1 248,00 €</span>
					<span className="rm">
						agent Ada read the order and the charge. Difference 0,00 €.
					</span>
				</div>
			</div>

			<CodeSample code={PROPOSAL} mark="+4 +5" />

			<div
				style={{
					alignItems: "center",
					display: "flex",
					gap: "var(--space-3)",
					padding: "var(--space-2)",
				}}
			>
				<div className="rb">
					<span className="rt">Close the order?</span>
					<span className="rm">
						Marks it paid and sends one e-mail. Undo for 10 minutes.
					</span>
				</div>
				<span className="btn g sm">Not yet</span>
				<span className="btn p sm">Close order</span>
			</div>
		</div>
	);
}

function SharedList() {
	return (
		<div
			className="card"
			style={{
				borderRadius: "var(--radius-sheet)",
				display: "flex",
				flexDirection: "column",
				gap: "var(--spacing-gap-rows)",
			}}
		>
			<div className="row pin">
				<div className="rb">
					<span className="qp-eyebrow">From you</span>
					<span className="rt" style={{ fontWeight: "var(--weight-semibold)" }}>
						Send the November invoices by Friday, check the amounts in Stripe.
					</span>
				</div>
			</div>
			<div className="row" style={{ alignItems: "flex-start" }}>
				<span className="av agent">AI</span>
				<div className="rb">
					<span className="rt">Preparing 14 invoices</span>
					<span className="rm">agent Ada · role Accounting</span>
					<span
						style={{
							alignItems: "center",
							display: "flex",
							gap: "var(--space-3)",
							marginTop: "var(--space-3)",
						}}
					>
						<span className="meter">
							{/* 8 of 14 is 57%, so the bar stops 43% short */}
							<span style={{ right: "43%" }} />
						</span>
						<span className="count">8/14</span>
					</span>
				</div>
			</div>
			<div className="row">
				<span className="av i2">AB</span>
				<div className="rb">
					<span className="rt">Reply to the supplier e-mail</span>
					<span className="rm">Anna B. · 2 h</span>
				</div>
				<span className="chip">Waiting on Anna</span>
			</div>
			<div className="row">
				<span className="av agent">AI</span>
				<div className="rb">
					<span className="rt">Close order #4412</span>
					<span className="rm">agent proposed · waits for your yes</span>
				</div>
				<span className="chip ok">Needs you</span>
			</div>
		</div>
	);
}

function EarlyAccessForm() {
	const [email, setEmail] = useState("");

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!email) return;
		const body = `I would like early access to Autopilot.\n\nMy address: ${email}`;
		window.location.href = `mailto:${EARLY_ACCESS_EMAIL}?subject=${encodeURIComponent("Autopilot early access")}&body=${encodeURIComponent(body)}`;
	};

	return (
		<form
			onSubmit={submit}
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: "var(--space-3)",
				justifyContent: "center",
				marginTop: "var(--space-8)",
			}}
		>
			<input
				aria-label="Your e-mail address"
				onChange={(event) => setEmail(event.target.value)}
				placeholder="you@company.com"
				style={{
					background: "var(--surface-mid)",
					border: "1px solid var(--input)",
					borderRadius: "var(--radius-control)",
					color: "var(--foreground)",
					fontFamily: "var(--font-sans)",
					fontSize: "var(--type-md)",
					height: "var(--control-large)",
					padding: "0 var(--spacing-input)",
					width: 300,
				}}
				type="email"
				value={email}
			/>
			<button className="btn p lg" type="submit">
				Get early access
			</button>
		</form>
	);
}

export function AutopilotPageContent() {
	return (
		<>
			<section className="band hero">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">the work, and who has it</p>
						<h1 className="qp-display-xl">
							Agents on the team. <em className="qp-hl">Same rules.</em>
						</h1>
						<p className="qp-lead">
							Autopilot holds the work: goals, tasks, messages. An agent picks
							something up, asks when it is unsure, and hands back a proposal
							you accept in one click.
						</p>
						<div
							style={{
								display: "flex",
								flexWrap: "wrap",
								gap: "var(--space-3)",
								marginTop: "var(--space-4)",
							}}
						>
							<a className="btn p lg" href="#cta">
								Get early access
							</a>
							<a className="btn s lg" href="/docs">
								Read the docs
							</a>
						</div>
						<p className="qp-eyebrow">
							Free during the pilot · we set it up with you
						</p>
					</div>

					<ApprovalCard />
				</div>
			</section>

			<section className="band raised">
				<div
					className="wrap split"
					style={{ gridTemplateColumns: "0.86fr 1.14fr" }}
				>
					<div className="head">
						<p className="qp-aside">one list, two kinds of teammate</p>
						<h2 className="qp-display-m">People and agents, same table</h2>
						<p>
							They share the list, the roles and the log. The avatar says who
							has a task; the chip says what it waits for.
						</p>
					</div>
					<SharedList />
				</div>
			</section>

			<section className="band">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">where the limits are</p>
						<h2 className="qp-display-m">The limits are the product</h2>
					</div>
					<div
						className="grid3"
						style={{ gridAutoRows: "1fr", marginTop: "var(--space-10)" }}
					>
						{LIMITS.map((limit) => (
							<div
								className="card"
								key={limit.title}
								style={{ display: "flex", flexDirection: "column" }}
							>
								<h3>{limit.title}</h3>
								<p>{limit.body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section
				className="band"
				id="cta"
				style={{ paddingBottom: "var(--space-16)" }}
			>
				<div className="wrap">
					<div className="cta-block">
						<div className="head head-center">
							<p className="qp-aside">we set it up with you</p>
							<h2 className="qp-display-m">Give an agent a seat this month</h2>
							<p>
								Free during the pilot. Bring one job you would rather not do
								again.
							</p>
						</div>
						<EarlyAccessForm />
					</div>
				</div>
			</section>
		</>
	);
}
