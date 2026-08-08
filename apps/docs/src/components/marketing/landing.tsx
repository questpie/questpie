/* The landing, band for band from the accepted kit (ui_kits/marketing/index.html).
 *
 * Four bands and no more. The page it replaces ran eleven sections deep, which is
 * why nobody reached the end of it: hero, the work itself, the two doors, one ask.
 *
 * Two devices on the page are built from live DOM rather than screenshots — the
 * hero card and the Autopilot door. A capture would go stale the first time the
 * product moved, and at these sizes text in an image is unreadable anyway.
 */
import questpiePackage from "../../../../../packages/questpie/package.json";
import { CodeSample } from "./code";

const SCHEMA_SAMPLE = `collection("news")
  .fields(({ f }) => ({
    title: f.text(255).required(),
    content: f.richText(),
  }))
  .title(({ f }) => f.title);`;

const STEPS = [
	{
		body: "Goals, tasks and messages in one place, in your own words.",
		num: "01",
		title: "You write down the work",
	},
	{
		body: "It joins with a role, like any hire, and sees only what that role sees.",
		num: "02",
		title: "An agent gets a seat",
	},
	{
		body: "We log every step, and anything that matters waits for your yes.",
		num: "03",
		title: "You keep the last word",
	},
];

function HeroCard() {
	return (
		<div className="hero-card">
			<div className="hero-card-head">
				<span className="qp-eyebrow">Today's work</span>
				{/* The kit dated this Friday, 30 July. 30 July 2026 is a Thursday, and
				    the brief below is due Friday — so the day before is both the true
				    weekday and the one that makes the deadline mean something. */}
				<span className="count">Thursday, 30 July</span>
			</div>
			<div className="rows">
				<div className="row pin">
					<div className="rb">
						<span className="qp-eyebrow">From you</span>
						<span
							className="rt"
							style={{ fontWeight: "var(--weight-semibold)" }}
						>
							Send the November invoices by Friday, check the amounts in Stripe.
						</span>
					</div>
				</div>
				<div className="row" style={{ alignItems: "flex-start" }}>
					<span className="av agent">AI</span>
					<div className="rb">
						<span className="rt">Preparing 14 invoices</span>
						<span className="rm">agent Ada · role Accounting</span>
						<span className="progress">
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
		</div>
	);
}

/* The Autopilot door. The kit left a grey "product shot" box here because it had
 * no capture to put in it; neither do we, and a placeholder on a landing page is
 * just an unfinished page. Three rows say what the door claims — an agent, a
 * person, something waiting on you — in the same grammar as the hero. */
function DoorPreview() {
	return (
		<div className="frame preview">
			<div className="rows" style={{ width: "100%" }}>
				<div className="row">
					<span className="av agent">AI</span>
					<div className="rb">
						<span className="rt">Drafted the October report</span>
						<span className="rm">agent Ada · done 09:12</span>
					</div>
				</div>
				<div className="row">
					<span className="av i2">MK</span>
					<div className="rb">
						<span className="rt">Called the supplier back</span>
						<span className="rm">Martin K. · done 11:40</span>
					</div>
				</div>
				<div className="row">
					<span className="av agent">AI</span>
					<div className="rb">
						<span className="rt">Raise the price list by 4%</span>
						<span className="rm">agent proposed · waits for your yes</span>
					</div>
					<span className="chip ok">Needs you</span>
				</div>
			</div>
		</div>
	);
}

export function Landing() {
	return (
		<>
			<section className="band hero">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">
							with everything the company actually does
						</p>
						<h1 className="qp-display-xl">
							Software you <em className="qp-hl">can staff</em>
						</h1>
						<p className="qp-lead">
							An AI agent joins the way a person does: a role, permissions, and
							its own name on the work it finishes. Nobody installs anything.
							Nothing happens behind your back.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/autopilot#cta">
								Get early access
							</a>
							<a className="btn s lg" href="#how">
								See how it works
							</a>
						</div>
						<p className="qp-eyebrow">
							MIT · TypeScript · Postgres · self-hosted · v
							{questpiePackage.version}
						</p>
					</div>

					<HeroCard />
				</div>
			</section>

			<section className="band raised" id="how">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">three steps, nothing more</p>
						<h2 className="qp-display-m">How it actually works</h2>
					</div>
					<div
						className="grid3"
						style={{
							gridAutoRows: "1fr",
							marginTop: "var(--space-10)",
						}}
					>
						{STEPS.map((step) => (
							<div className="card" key={step.num}>
								<span className="step-num">{step.num}</span>
								<h3 style={{ marginTop: "var(--space-5)" }}>{step.title}</h3>
								<p>{step.body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap split lean">
					<div className="head">
						<p className="qp-aside">one system, two ways to use it</p>
						<h2 className="qp-display-m">Build the rules. Run the work.</h2>
						<p>
							The framework defines the data, permissions and workflows.
							Autopilot gives people and agents one place to use them.
						</p>
					</div>
					<div className="system-flow" role="list">
						<div className="system-step" role="listitem">
							<span className="qp-eyebrow">Define</span>
							<strong>Data, permissions, workflows</strong>
						</div>
						<div className="system-step" role="listitem">
							<span className="qp-eyebrow">Build</span>
							<strong>API, admin, jobs, client</strong>
						</div>
						<div className="system-step" role="listitem">
							<span className="qp-eyebrow">Run</span>
							<strong>People and agents at work</strong>
						</div>
					</div>
				</div>
			</section>

			<hr className="rule" />

			<section className="band" id="doors">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">two doors</p>
						<h2 className="qp-display-m">
							One for running the company, one for building it
						</h2>
					</div>
					<div
						className="grid2"
						style={{
							gridAutoRows: "1fr",
							marginTop: "var(--space-10)",
						}}
					>
						<a className="door" href="/autopilot">
							<span className="chip" style={{ alignSelf: "flex-start" }}>
								Autopilot
							</span>
							<DoorPreview />
							<div>
								<h3>For the people running the company</h3>
								<p className="door-line">
									Work arrives, someone picks it up, someone closes it. You see
									who did what.
								</p>
								<span
									className="door-cta"
									style={{ color: "var(--primary-text)" }}
								>
									Get early access →
								</span>
							</div>
						</a>
						<a className="door" href="/framework">
							<span className="chip" style={{ alignSelf: "flex-start" }}>
								Framework
							</span>
							<div className="frame code">
								<CodeSample bare code={SCHEMA_SAMPLE} />
							</div>
							<div>
								<h3>For the people building it</h3>
								<p className="door-line">
									Describe the data once. The typed API, the admin, the jobs and
									the client follow from it.
								</p>
								<span className="door-cta">Read the docs →</span>
							</div>
						</a>
					</div>
				</div>
			</section>

			<section className="band" style={{ paddingBottom: "var(--space-16)" }}>
				<div className="wrap">
					<div className="cta-block">
						<div className="head head-center">
							<p className="qp-aside">we are our own first customer</p>
							<h2 className="qp-display-l">QUESTPIE runs on QUESTPIE</h2>
							<p>
								Every goal, task and message behind this page lives in
								Autopilot.
							</p>
						</div>
						<div className="actions" style={{ justifyContent: "center" }}>
							<a className="btn p lg" href="/autopilot#cta">
								Get early access
							</a>
							<a className="btn g lg" href="/docs">
								Read the docs
							</a>
						</div>
					</div>
				</div>
			</section>
		</>
	);
}
