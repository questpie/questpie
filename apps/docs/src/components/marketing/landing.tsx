import questpiePackage from "../../../../../packages/questpie/package.json";
import { CodeSample } from "./code";

const GITHUB_URL = "https://github.com/questpie/questpie";

const SHARED_FOUNDATION = [
	{
		body: "Data, relationships and validation start in one TypeScript model instead of being copied between tools.",
		title: "One application model",
	},
	{
		body: "People, APIs and agents meet the same permissions at the boundary where work is executed.",
		title: "One access model",
	},
	{
		body: "Routes, hooks, jobs and agent actions run with the context of the application they belong to.",
		title: "One execution context",
	},
];

export function Landing() {
	return (
		<>
			<section className="band hero home-hero">
				<div className="wrap split ecosystem-hero">
					<div className="head">
						<p className="qp-aside">one ecosystem for applications and work</p>
						<h1 className="qp-display-xl">
							Build the system. <em className="qp-hl">Put it to work.</em>
						</h1>
						<p className="qp-lead">
							QUESTPIE brings the application and the work happening inside it
							under one model. Framework gives developers the foundation.
							Autopilot gives people and agents a place to operate it together.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/framework">
								Explore Framework
							</a>
							<a className="btn s lg" href="/autopilot">
								Meet Autopilot
							</a>
						</div>
						<p className="qp-eyebrow">
							Open source foundation · TypeScript · PostgreSQL · v
							{questpiePackage.version}
						</p>
					</div>

					<div className="ecosystem-index" aria-label="QUESTPIE ecosystem">
						<div>
							<span className="qp-eyebrow">01 · Framework</span>
							<strong>Build the application</strong>
							<p>Model the data and rules. Derive the API, client and admin.</p>
						</div>
						<div>
							<span className="qp-eyebrow">02 · Autopilot</span>
							<strong>Run the work</strong>
							<p>
								Give people and agents shared tasks, boundaries and history.
							</p>
						</div>
						<p className="ecosystem-common">
							The same model · the same permissions · the same application
						</p>
					</div>
				</div>
			</section>

			<section className="band editorial-band" id="ecosystem">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">two products, one foundation</p>
						<h2 className="qp-display-m">
							Start with the system. Add the way of working.
						</h2>
						<p>
							Framework and Autopilot solve different parts of the same problem.
							Use the open-source framework on its own, or let Autopilot work
							with the application it defines.
						</p>
					</div>

					<div className="product-paths ecosystem-paths">
						<section>
							<p className="qp-eyebrow">Framework · available now</p>
							<h3>A foundation developers can own</h3>
							<p>
								Define collections, access, routes, hooks and jobs in
								TypeScript. Keep the code, PostgreSQL database and deployment in
								your hands.
							</p>
							<a href="/framework">See how Framework works →</a>
						</section>
						<section>
							<p className="qp-eyebrow">Autopilot · early access</p>
							<h3>A workspace for people and agents</h3>
							<p>
								Turn requests into visible work. Let agents act within explicit
								roles, pause for approval and leave a history people can
								inspect.
							</p>
							<a href="/autopilot">See what Autopilot adds →</a>
						</section>
					</div>
				</div>
			</section>

			<section className="band raised">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">the connection is the product</p>
						<h2 className="qp-display-m">The rules survive the interface</h2>
						<p>
							A screen, an API call and an agent action should not invent three
							different versions of the application. QUESTPIE keeps their shared
							contract close to the code that enforces it.
						</p>
						<p>
							That is the big picture: Framework defines what the system is.
							Autopilot helps trusted actors move work through it.
						</p>
					</div>
					<div className="generated-list">
						{SHARED_FOUNDATION.map((item, index) => (
							<div className="generated-row" key={item.title}>
								<span className="qp-eyebrow">0{index + 1}</span>
								<div>
									<strong>{item.title}</strong>
									<p>{item.body}</p>
								</div>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">open where ownership matters</p>
						<h2 className="qp-display-m">Your application remains yours</h2>
						<p>
							Framework is MIT licensed and self-hosted. Autopilot is a product
							built on top, not a requirement hidden beneath it.
						</p>
					</div>
					<div className="ownership-list" role="list">
						<div role="listitem">
							<span className="qp-eyebrow">Code</span>
							<strong>Your repository</strong>
						</div>
						<div role="listitem">
							<span className="qp-eyebrow">Data</span>
							<strong>Your PostgreSQL database</strong>
						</div>
						<div role="listitem">
							<span className="qp-eyebrow">Product</span>
							<strong>Framework alone, or Framework with Autopilot</strong>
						</div>
					</div>
				</div>
			</section>

			<section className="band launch-band">
				<div className="wrap launch-split">
					<div className="head">
						<p className="qp-aside">start from the foundation</p>
						<h2 className="qp-display-l">Build the first application</h2>
						<p>
							Create a working QUESTPIE project now, or explore how Autopilot
							will put that foundation to work.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs/learn/first-app">
								Create your first app
							</a>
							<a
								className="btn g lg"
								href={GITHUB_URL}
								rel="noreferrer"
								target="_blank"
							>
								View on GitHub
							</a>
						</div>
					</div>
					<CodeSample code="bunx create-questpie my-app" lang="bash" />
				</div>
			</section>
		</>
	);
}
