import { type FormEvent, useState } from "react";

import { ProductMedia } from "./product-media";

const EARLY_ACCESS_EMAIL = "info@questpie.com";

const BOUNDARIES = [
	{
		body: "An agent joins with a name and a role. It works through the same permissions as the people beside it.",
		title: "A seat, not a master key",
	},
	{
		body: "Choose which actions can run and which must stop for review. The proposal shows the intended change before it happens.",
		title: "Approval where it matters",
	},
	{
		body: "Requests, decisions and results stay attached to the work, so the next person does not have to reconstruct the story.",
		title: "A record people can follow",
	},
];

function EarlyAccessForm() {
	const [email, setEmail] = useState("");

	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (!email) return;
		const body = `I would like early access to Autopilot.\n\nMy address: ${email}`;
		window.location.href = `mailto:${EARLY_ACCESS_EMAIL}?subject=${encodeURIComponent("Autopilot early access")}&body=${encodeURIComponent(body)}`;
	};

	return (
		<form className="early-access-form" onSubmit={submit}>
			<label className="sr-only" htmlFor="autopilot-email">
				Work e-mail address
			</label>
			<input
				autoComplete="email"
				id="autopilot-email"
				onChange={(event) => setEmail(event.target.value)}
				placeholder="you@company.com"
				required
				type="email"
				value={email}
			/>
			<button className="btn p lg" type="submit">
				Request early access
			</button>
		</form>
	);
}

export function AutopilotPageContent() {
	return (
		<>
			<section className="band hero autopilot-hero">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">shared work for people and agents</p>
						<h1 className="qp-display-xl">
							Give agents real work.{" "}
							<em className="qp-hl">Keep the last word.</em>
						</h1>
						<p className="qp-lead">
							Autopilot keeps goals, tasks, messages and agent work in one
							place. Agents work through named roles, ask when context is
							missing and bring sensitive changes back for approval.
						</p>
						<div className="actions">
							<a className="btn p lg" href="#access">
								Request early access
							</a>
							<a className="btn s lg" href="#workflow">
								See the workflow
							</a>
						</div>
						<p className="qp-eyebrow">
							Private beta · guided setup · built on QUESTPIE
						</p>
					</div>

					<ProductMedia
						alt="Autopilot moving a task from assignment to an approval-ready result"
						description="A short product loop: assign work, watch the agent progress and review the result."
						eyebrow="Product GIF · 12–18 seconds"
						kind="video"
						title="One task, from request to review"
						variant="hero"
					/>
				</div>
			</section>

			<section className="band editorial-band" id="workflow">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">the work stays visible</p>
						<h2 className="qp-display-m">
							You see who has it and what happens next
						</h2>
						<p>
							People and agents share the same work queue. Ownership, progress
							and blockers are visible without opening a separate agent console.
						</p>
						<p>
							When an agent needs context, the question stays with the task.
							When it finishes, the result returns to the same place.
						</p>
					</div>
					<ProductMedia
						alt="Autopilot work queue showing tasks owned by people and agents"
						description="Show a real mixed work queue with clear owners, status and one visible blocker."
						eyebrow="Product screenshot · 1600 × 1100"
						title="A shared queue, not a second inbox"
					/>
				</div>
			</section>

			<section className="band raised">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">autonomy with explicit boundaries</p>
						<h2 className="qp-display-m">Control is part of the workflow</h2>
						<p>
							The useful question is not whether an agent can act. It is who the
							agent is, what it may do and where a person must decide.
						</p>
					</div>
					<div className="depth-list">
						{BOUNDARIES.map((boundary, index) => (
							<section key={boundary.title}>
								<span className="qp-eyebrow">0{index + 1}</span>
								<div>
									<h3>{boundary.title}</h3>
									<p>{boundary.body}</p>
								</div>
							</section>
						))}
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap product-story">
					<div className="head">
						<p className="qp-aside">a decision with the context beside it</p>
						<h2 className="qp-display-m">
							Review the change, not a vague summary
						</h2>
						<p>
							A proposal should show what the agent used, what it plans to
							change and what follows after approval. The reviewer gets a
							decision, not another investigation.
						</p>
					</div>
					<ProductMedia
						alt="Autopilot approval view with source context and proposed changes"
						description="Capture a real approval with its source context, proposed change and primary decision."
						eyebrow="Product screenshot · 1920 × 1200"
						title="The approval is the proof"
						variant="wide"
					/>
				</div>
			</section>

			<section className="band raised">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">the handoff remains readable</p>
						<h2 className="qp-display-m">
							The next person can continue the work
						</h2>
						<p>
							Autopilot keeps the request, agent activity, human decisions and
							final result together. A teammate can understand what happened
							without reading a raw model transcript.
						</p>
					</div>
					<ProductMedia
						alt="Autopilot activity history combining agent actions and human decisions"
						description="Show the activity history after completion, with both agent and human actions visible."
						eyebrow="Product screenshot · 1600 × 1100"
						title="A history written for the team"
					/>
				</div>
			</section>

			<section className="band launch-band" id="access">
				<div className="wrap">
					<div className="cta-block">
						<div className="head head-center">
							<p className="qp-aside">start with one real workflow</p>
							<h2 className="qp-display-m">
								Bring the work you want off your plate
							</h2>
							<p>
								The private beta includes guided setup. Start with one recurring
								job, the people responsible for it and the decisions that must
								stay human.
							</p>
						</div>
						<EarlyAccessForm />
					</div>
				</div>
			</section>
		</>
	);
}
