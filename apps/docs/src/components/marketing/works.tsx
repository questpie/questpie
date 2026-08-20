/* QUESTPIE Works — the services page.
 *
 * Layout is designed separately and mirrored here; keep the two in step rather
 * than editing this file first. Styles live in styles/works.css, scoped under
 * .works-page and prefixed .w-*. That is deliberate: the first implementation
 * reused .editorial-split, .generated-list and .feature-list from the other
 * marketing routes, which were built for a different content shape, and the
 * result was misaligned columns, a rule leading nowhere, and a form in three
 * different widths.
 *
 * Structure: what we are, what we do, our stack or yours, how we think, core
 * team, projects (own products first, then client work), contact.
 *
 * Client names in CLIENT below are real and are NOT yet cleared for
 * publication. Do not deploy this route until they are signed off.
 */

import { type FormEvent, useState } from "react";

const CONTACT = "#contact";
const EMAIL = "dominik@questpie.com";

const WHAT_WE_DO = [
	{
		body: "Payload and Strapi, past the point the defaults stop helping. Custom fields, access rules, and an admin your staff can work in all day.",
		title: "CMS work",
	},
	{
		body: "The tool your staff live in. It is usually the thing that used to be a spreadsheet, and it runs the business.",
		title: "Internal tools",
	},
	{
		body: "Rooms, slots, tables, staff. The hard part is never the calendar, it is making sure two people cannot take the same thing.",
		title: "Booking systems",
	},
	{
		body: "Postgres, queues, storage, and the deploy. One team from the schema to production, so nobody owns half a system.",
		title: "Full stack and servers",
	},
	{
		body: "React Native, shipped to both stores, talking to the same backend as the website. One model, not two.",
		title: "Mobile apps",
	},
	{
		body: "Taking money, refunds, and the boring parts nobody wants to get wrong. Kept in its own service where it belongs.",
		title: "Payments",
	},
	{
		body: "Agents that do real work inside your app, with their own permissions. We built a product on this and we run our company on it.",
		title: "AI that does the work",
	},
	{
		body: "Someone else's code, a cloud bill nobody understands, or a build that stopped. We take it over and move it.",
		title: "Rescue work",
	},
];

/* Two capabilities as a choice. An earlier draft was one section with a
 * disclaimer under it, which promised what we would not do instead of claiming
 * what we do. The first option also carries the braid: the product does the
 * selling inside the services pitch, where the buyer already is. */
const WAYS = [
	{
		body: "TypeScript, Postgres, and QUESTPIE, which we wrote. You get help from the people who build it, not from someone who read the docs. A new project starts in week three, not week one. The framework is open source, so you can keep it running without us.",
		num: "Option A",
		title: "We bring our stack",
	},
	{
		body: "Your repo, your rules, your review. Payload, Strapi, Next, whatever is already there, including the parts nobody wants to touch. We read the code before we quote, and we leave it the way your team writes it.",
		num: "Option B",
		title: "Or we work in yours",
	},
];

const STEPS = [
	{
		body: "Forty-five minutes on a call, then we write down what is really in there. It is often not what people think.",
		num: "01 · look",
		title: "We read the code first",
	},
	{
		body: "What we would build, and in what order. You get it before anyone signs anything.",
		num: "02 · plan",
		title: "A written plan",
	},
	{
		body: "Your branch, your review, one short update a week. No status meetings.",
		num: "03 · build",
		title: "PRs into your process",
	},
	{
		body: "The servers are part of the app, not a separate bill. You can keep all of it running after we leave.",
		num: "04 · hand over",
		title: "You keep it",
	},
];

const BELIEFS = [
	{
		body: "We use agents on client work every day, and we wrote our own tools to make that safe. Autopilot is our product: agents join a company with their own roles and permissions, instead of borrowing a human's. We are also blunt about where they are still bad.",
		num: "01",
		title: "We build with agents, and for them",
	},
	{
		body: "One schema makes the API, the admin, the jobs and the client. We wrote a framework on that idea because we kept inheriting codebases where those four had quietly drifted apart.",
		num: "02",
		title: "One model, or it drifts",
	},
	{
		body: "Postgres, not the new thing. We pick tools you can hire for in three years, and we keep the clever parts small enough that the next person can read them.",
		num: "03",
		title: "Boring where it counts",
	},
	{
		body: "We write up what did not work, including our own dead framework. If we get something wrong on your project you will hear it from us first.",
		num: "04",
		title: "We say what went wrong",
	},
];

const CORE = [
	{
		body: "Backend and servers. Wrote most of QUESTPIE, and the deploy setup under everything here.",
		href: "https://drepkovsky.com",
		name: "Dominik Repkovský",
		role: "Full stack · infrastructure",
	},
	{
		body: "Full stack and product. The part where a screen has to survive real people using it.",
		href: "https://martinrapcan.com",
		name: "Martin Rapčan",
		role: "Full stack · product",
	},
];

/* Imagery is placeholders by owner decision — the real screens get supplied
 * rather than captured. Every placeholder prints what belongs in it, so the
 * slot is unambiguous. Never substitute a mockup for a real screen: an honest
 * empty frame is better than a picture that implies something we did not ship. */
const OWN = [
	{
		addr: "questpie.com",
		body: "You write one schema. The API, the admin panel, the jobs and the typed client all come out of it. Open source, and we know it better than anyone, because we wrote it.",
		href: "https://questpie.com/framework",
		kind: "Framework · MIT · TypeScript",
		shot: null,
		need: "questpie.com, framework page or a schema-to-surfaces shot",
		base: "one schema",
		top: ["API", "admin", "jobs", "client"],
		verb: "all generated from",
		title: "QUESTPIE",
	},
	{
		addr: "questpie.com/autopilot",
		body: "AI agents with their own roles and permissions, instead of borrowing yours. Goals, tasks and channels shared by people and agents. We run our own company on it.",
		href: "https://questpie.com/autopilot",
		kind: "Product · agents as team members",
		shot: null,
		need: "Autopilot, the running app: goals, tasks, an agent in a channel",
		base: "one permission model",
		top: ["people", "agents"],
		verb: "both work under",
		title: "Autopilot",
	},
	{
		addr: "jubli.app",
		body: "Our own product, built on QUESTPIE and shipped the same way we ship for clients.",
		href: "https://jubli.app",
		kind: "Product · in pilot",
		shot: null,
		need: "Jubli, the product in use",
		base: "QUESTPIE",
		top: ["web", "admin"],
		verb: "both built on",
		title: "Jubli",
	},
	{
		addr: "github.com/drepkovsky",
		body: "drizzle-migrations, agent-board and probe. We needed them, could not find them, so we wrote them. People we have never met use them.",
		href: "https://github.com/drepkovsky",
		kind: "Open source · developer tools",
		shot: null,
		need: "a repo page, or the CLI in a terminal",
		top: ["drizzle-migrations", "agent-board", "probe"],
		title: "Tools we maintain",
	},
];

const CLIENT = [
	{
		addr: "chatacerenka.eu",
		kind: "Booking engine · operator console",
		body: "A booking system, the console the staff run the place from, and the public site. All on one schema, so the two can never disagree about a free room.",
		href: "https://chatacerenka.eu",
		shot: null,
		need: "the operator console, the strongest proof on this page",
		base: "one schema",
		top: ["booking form", "operator console"],
		verb: "both read",
		title: "One schema behind the desk and the booking form",
	},
	{
		addr: "jinejsvet.questpie.app",
		kind: "Klára pomáhá · accounts · block builder",
		body: "A place for young people who have lost someone. Accounts, their own writing, and a block builder underneath, so the charity can add pages without us.",
		href: "https://jinejsvet.questpie.app",
		shot: null,
		need: "the portal: the candles or the timeline, plus the block builder mid-edit",
		base: "typed blocks",
		top: ["pages", "posts"],
		verb: "the charity builds from",
		title: "A grief support portal the charity runs itself",
	},
	{
		addr: "nutrimeals.eu",
		kind: "React Native + Payload CMS · IoT",
		body: "A React Native app and a website on top of Payload CMS, driving smart fridges. App, database and deploy, all in one job.",
		href: "https://nutrimeals.eu",
		shot: null,
		need: "the React Native app, or a fridge in the field",
		base: "one Payload CMS",
		top: ["iOS + Android", "web", "fridges"],
		verb: "all talk to",
		title: "One codebase driving an app, a site and the fridges",
	},
	{
		addr: "byvak",
		kind: "Multi-tenant platform · four years",
		body: "A property platform with paying customers. App, API, a separate payments service and the public site, in one repo, kept running for four years.",
		href: null,
		shot: null,
		need: "byvak, the platform, any surface",
		base: "one monorepo",
		top: ["app", "API", "payments", "site"],
		verb: "all live in",
		title: "Four apps, one monorepo, four years in production",
	},
];

const FIELDS = [
	{ id: "name", label: "Name", type: "text", wide: false },
	{ id: "email", label: "Email", type: "email", wide: false },
	{ id: "company", label: "Company", type: "text", wide: true },
];

function Schematic({
	base,
	top,
	verb,
}: {
	base?: string;
	top: string[];
	verb?: string;
}) {
	return (
		<div className="w-schema">
			<div className="w-schema-row">
				{top.map((n) => (
					<span key={n}>{n}</span>
				))}
			</div>
			{base ? (
				<>
					<div className="w-schema-legs">
						{top.map((n) => (
							<i key={n} />
						))}
					</div>
					<p className="w-schema-verb">{verb}</p>
					<div className="w-schema-base">{base}</div>
				</>
			) : null}
		</div>
	);
}

function Window({
	addr,
	alt,
	base,
	href,
	need,
	shot,
	top,
	verb,
}: {
	addr: string;
	alt: string;
	base?: string;
	href: string | null;
	need?: string;
	shot: string | null;
	top?: string[];
	verb?: string;
}) {
	const inner = (
		<>
			<span className="w-chrome">
				<i />
				<i />
				<i />
				<em>{addr}</em>
			</span>
			{shot ? (
				<img alt={alt} height={900} loading="lazy" src={shot} width={1440} />
			) : top ? (
				<Schematic base={base} top={top} verb={verb} />
			) : (
				<span className="w-ph">
					<em>{need ?? alt}</em>
				</span>
			)}
		</>
	);

	return href ? (
		<a className="w" href={href} rel="noreferrer" target="_blank">
			{inner}
		</a>
	) : (
		<div className="w">{inner}</div>
	);
}

/* The house pattern, same as the Autopilot early-access form: compose a
 * mailto rather than post to a form service. Nothing to authenticate, nothing
 * to keep alive, and the message lands in the same inbox the page advertises. */
function ProjectForm() {
	const [values, setValues] = useState<Record<string, string>>({});

	const set = (id: string, v: string) =>
		setValues((prev) => ({ ...prev, [id]: v }));

	const submit = (event: FormEvent) => {
		event.preventDefault();
		const body = [
			`Name: ${values.name ?? ""}`,
			`Email: ${values.email ?? ""}`,
			`Company: ${values.company ?? ""}`,
			"",
			"The project:",
			values.project ?? "",
		].join("\n");
		window.location.href = `mailto:${EMAIL}?subject=${encodeURIComponent(
			"Project enquiry",
		)}&body=${encodeURIComponent(body)}`;
	};

	return (
		<form className="w-fields" onSubmit={submit}>
			{FIELDS.map((f) => (
				<div className={f.wide ? "w-field wide" : "w-field"} key={f.id}>
					<label htmlFor={`w-${f.id}`}>{f.label}</label>
					<input
						id={`w-${f.id}`}
						name={f.id}
						onChange={(e) => set(f.id, e.target.value)}
						type={f.type}
						value={values[f.id] ?? ""}
					/>
				</div>
			))}
			<div className="w-field wide">
				<label htmlFor="w-project">The project</label>
				<textarea
					id="w-project"
					name="project"
					onChange={(e) => set("project", e.target.value)}
					rows={5}
					value={values.project ?? ""}
				/>
			</div>
			<div className="wide">
				<button className="btn p lg" type="submit">
					Send
				</button>
			</div>
		</form>
	);
}

export function WorksPage() {
	return (
		<div className="works-page">
			<header className="w-band">
				<div className="w-page w-stack">
					<div className="w-hero-head">
						<p className="w-label">questpie works</p>
						<h1 className="w-display">
							Software for other people.
							<span>A framework of our own.</span>
						</h1>
					</div>
					<p className="w-lead">
						We are a small team of engineers in Slovakia. We wrote QUESTPIE, an
						open source framework in TypeScript. We also build for other people,
						in their code, under their name.
					</p>
					<div className="w-actions">
						<a className="btn p lg" href={CONTACT}>
							Start a conversation
						</a>
						<a className="btn s lg" href="#projects">
							See the work
						</a>
					</div>
					<p className="w-strip">
						TypeScript · Postgres · React · React Native · Payload · GitOps ·
						MIT
					</p>
				</div>
			</header>

			{/* A portfolio shows before it explains. */}
			<div className="w-band tight">
				<div className="w-page">
					<Window
						addr="chatacerenka.eu"
						alt="lead project"
						href="https://chatacerenka.eu"
						base="one schema"
						shot={null}
						top={["booking form", "operator console", "public site"]}
						verb="all read"
					/>
				</div>
			</div>

			<section className="w-band" id="what">
				<div className="w-page w-grid">
					<div className="w-rail">
						<p className="w-label">01 · what we do</p>
						<p className="w-body">Four kinds of work. We say no to the rest.</p>
					</div>
					<div className="w-col">
						<h2 className="w-title">What we are good at.</h2>
						<div className="w-two dense">
							{WHAT_WE_DO.map((item, i) => (
								<article className="w-item" key={item.title}>
									<span className="w-num">
										{String(i + 1).padStart(2, "0")}
									</span>
									<h3>{item.title}</h3>
									<p>{item.body}</p>
								</article>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="w-band raised" id="how">
				<div className="w-page w-grid">
					<div className="w-rail">
						<p className="w-label">02 · how we work</p>
						<p className="w-body">Two ways in. You pick.</p>
					</div>
					<div className="w-col wide">
						<h2 className="w-title">Our stack, or yours.</h2>
						<div className="w-two">
							{WAYS.map((way) => (
								<article className="w-item" key={way.title}>
									<span className="w-num">{way.num}</span>
									<h3>{way.title}</h3>
									<p>{way.body}</p>
								</article>
							))}
						</div>
						<hr className="w-rule" />
						<div className="w-two">
							{STEPS.map((step) => (
								<article className="w-item" key={step.title}>
									<span className="w-num">{step.num}</span>
									<h3>{step.title}</h3>
									<p>{step.body}</p>
								</article>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="w-band" id="think">
				<div className="w-page w-grid">
					<div className="w-rail">
						<p className="w-label">03 · how we think</p>
						<p className="w-body">
							Four things we believe. Each one points at something you can go
							and check.
						</p>
					</div>
					<div className="w-col">
						<h2 className="w-title">How we think about the work.</h2>
						<div className="w-two">
							{BELIEFS.map((item) => (
								<article className="w-item" key={item.title}>
									<span className="w-num">{item.num}</span>
									<h3>{item.title}</h3>
									<p>{item.body}</p>
								</article>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="w-band raised" id="team">
				<div className="w-page w-grid">
					<div className="w-rail">
						<p className="w-label">04 · core team</p>
						<p className="w-body">
							When a job needs more people, we name them before we start.
						</p>
					</div>
					<div className="w-col">
						<h2 className="w-title">Who you actually work with.</h2>
						<p className="w-lead">
							We do the work ourselves. The person who answers your email is the
							person writing your code.
						</p>
						<div className="w-two">
							{CORE.map((person) => (
								<article className="w-person" key={person.name}>
									<span className="w-num quiet">{person.role}</span>
									<h3>
										{person.href ? (
											<a href={person.href} rel="noreferrer" target="_blank">
												{person.name} →
											</a>
										) : (
											person.name
										)}
									</h3>
									<p className="w-body">{person.body}</p>
								</article>
							))}
						</div>
					</div>
				</div>
			</section>

			<section className="w-band" id="projects">
				<div className="w-page w-grid">
					<div className="w-rail">
						<p className="w-label">05 · projects</p>
						<p className="w-body">
							Some of it. Our own products come first, because they show the
							most.
						</p>
					</div>
					<h2 className="w-title">Some of what we have built.</h2>
				</div>

				<div className="w-page w-sub">
					<p className="w-label">Our own</p>
				</div>
				<div className="w-slider">
					{OWN.map((p) => (
						<article className="w-card" key={p.title}>
							<Window
								addr={p.addr}
								alt={p.title}
								base={p.base}
								href={p.href}
								need={p.need}
								shot={p.shot}
								top={p.top}
								verb={p.verb}
							/>
							<div className="w-card-body">
								<p className="w-num quiet">{p.kind}</p>
								<h3>{p.title}</h3>
								<p className="w-body">{p.body}</p>
							</div>
						</article>
					))}
				</div>

				<div className="w-page w-sub second">
					<p className="w-label">For clients</p>
				</div>
				<div className="w-slider">
					{CLIENT.map((p) => (
						<article className="w-card" key={p.title}>
							<Window
								addr={p.addr}
								alt={p.title}
								base={p.base}
								href={p.href}
								need={p.need}
								shot={p.shot}
								top={p.top}
								verb={p.verb}
							/>
							<div className="w-card-body">
								<p className="w-num quiet">{p.kind}</p>
								<h3>{p.title}</h3>
								<p className="w-body">{p.body}</p>
							</div>
						</article>
					))}
				</div>
			</section>

			<section className="w-band" id="contact">
				<div className="w-page w-grid">
					<div className="w-rail">
						<p className="w-label">06 · contact</p>
						<p className="w-body">
							We answer every message ourselves. Or write straight to{" "}
							<a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
						</p>
					</div>
					<div className="w-col">
						<h2 className="w-title">Tell us about the project.</h2>
						<p className="w-lead">
							Tell us the stack, the scope, and when you need people. If we are
							not right for it, we will say so, and say who might be.
						</p>
						<ProjectForm />
					</div>
				</div>
			</section>
		</div>
	);
}
