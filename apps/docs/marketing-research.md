# QUESTPIE marketing page research

Research date: 2026-08-12. Sources are official product pages, documentation, or first-party launch material.

## Executive recommendation

- Keep both pages text-led. Use one real product artifact at a time: code and generated output for Framework; a recorded task, its activity log, approval, and final result for Autopilot.
- The opening screen must identify the category, say what the product changes, and offer one primary action. Do not make the reader decode an architecture diagram.
- Framework should prove the contract: one collection definition becomes a PostgreSQL schema, typed REST API, and typed client. Optional modules should remain explicitly optional.
- Autopilot should prove controlled execution, not generic intelligence: the source context, steps taken, approval boundary, and resulting change should all be inspectable.
- Until production captures are ready, reserve honestly labelled media slots. Do not draw speculative product UI or populate it with invented customer data.

## 1. Framework and headless backend references

| Product                            | Page hierarchy and CTA                                                                                                                                                           | Artifact used as proof                                                                                                                                                   | Trust signal                                                                                            | Lesson for QUESTPIE                                                                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Payload](https://payloadcms.com/) | Category claim, install command/demo CTA, product split for developers and editors, use cases, customer proof, ownership story.                                                  | Real config/code alongside admin and live-preview captures.                                                                                                              | Open-source ownership, production users, named customer stories.                                        | Pair the collection file with the interface it produces. Keep "own your backend" as supporting proof, not the entire hero.                                        |
| [Convex](https://www.convex.dev/)  | Memorable outcome, exact platform inventory, agent-setup prompt or create command, hard guarantees, components, founder credibility, enterprise controls, repeated build CTA.    | Copyable setup prompt, install command, named components and operational guarantees; its [AI proof page](https://www.convex.dev/ai) adds evaluations and measured tests. | ACID transactions, end-to-end types, scaling claims, SOC 2 Type II, HIPAA, RBAC/SSO.                    | Name concrete invariants. A copyable agent prompt can sit beside the normal install path without replacing docs.                                                  |
| [Supabase](https://supabase.com/)  | Outcome headline, exact Postgres platform definition, start/demo split, logos, individual products, integrations, customer stories, templates, open-source statement, final CTA. | Actual dashboard states, starter templates, code/examples, product surfaces.                                                                                             | PostgreSQL foundation, public GitHub/open-source posture, named customers and case studies.             | Explain the core in one sentence, then let visitors inspect individual capabilities. Use templates/examples as proof when adoption metrics are not yet available. |
| [Directus](https://directus.com/)  | Whole-team promise, exact outputs, free/demo CTA and command, developer/team/AI uses, concrete scenarios, governed AI, admin capabilities, quantified stories.                   | API response, real interface captures, specific team tasks with inputs and results.                                                                                      | Self-host/cloud choice, access policies shared by people and AI, downloads and named case studies.      | Show the same data through developer and operator views. The access model is a strong bridge between Framework and Autopilot.                                     |
| [Encore](https://encore.dev/)      | Exact infrastructure claim, signup plus copyable agent prompt, code declaration and terminal output, customer outcomes, mechanism, comparison, migration path, final proof.      | Source code followed immediately by real CLI runtime output and deployed infrastructure.                                                                                 | Open-source SDK, GitHub count, own AWS/GCP account, status/security/SLA links, quantified case studies. | The best Framework demo is an input/output pair. Show what QUESTPIE reads, generates, and starts; avoid abstract capability cards.                                |
| [Elysia](https://elysiajs.com/)    | Category and differentiators, create command, design principle, compact runnable code, attributed benchmark, single-source-of-truth explanation, deeper examples.                | Small runnable code samples and a benchmark with methodology/source.                                                                                                     | Reproducible API, linked TechEmpower benchmark, transparent docs/LLM documentation.                     | Use the smallest example that demonstrates the mental model. Attribute any benchmark or omit it.                                                                  |

### Recommended Framework page hierarchy

1. **Hero:** “One backend model. Every typed surface stays aligned.” One factual paragraph, `bunx create-questpie`, and “Read the first app”.
2. **Input → output proof:** a real collection file next to generated API/client use. On mobile, show them in sequence rather than connected by arrows.
3. **The contract:** fields, access, hooks, and request context explained in short prose with one code excerpt each.
4. **Core and modules:** plain two-column text. Core: collections, globals, REST, client, access, hooks, jobs, services. Optional: admin, OpenAPI, MCP, realtime, search, storage, email, queues.
5. **Runs where the app runs:** Hono/Elysia for headless use; TanStack Start/Next when using the admin runtime. State only adapters currently supported by the repository.
6. **Operational path:** local generation, migration creation/review, deploy. Never present development `push` as the production path.
7. **Proof:** example applications, public source, version/release link, and real testimonials only when available.
8. **Final CTA:** create an app; secondary CTA to architecture/docs.

### Framework capture list

- `framework-model.webp`: editor capture of a genuine `posts` collection, 1440×900 or larger.
- `framework-admin.webp`: the generated collection list/form from that exact model, same sample data.
- `framework-api.webp`: real OpenAPI/Scalar route output for the same collection.
- `framework-types.gif`: 6–10 second loop: rename a field, run generation, show the client type error/autocomplete update. No cursor circling or decorative zooms.
- `framework-terminal.webp`: successful generate/migrate/start output with secrets and local usernames removed.

## 2. Autopilot and agentic work references

| Product                                                              | Page hierarchy and CTA                                                                                                                                                                                                                                                                                                    | Artifact used as proof                                                                                            | Trust/safety treatment                                                                                                                                                                      | Lesson for QUESTPIE                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Linear for Agents](https://linear.app/agents)                       | Teammate framing, real prompt examples, delegate/automate/orchestrate explanation, agent directory, build-your-own CTA.                                                                                                                                                                                                   | Recognizable issue delegation, comments, progress, and agent contributions inside the actual work surface.        | Human stays primary assignee; agent is a contributor; changes and reasoning are inspectable. [Docs](https://linear.app/docs/agents-in-linear) add admin installation and team-level access. | Make accountability visible in the artifact. Autopilot can do work, but a person owns the outcome.                                                                                                                                                        |
| [Linear Agent](https://linear.app/docs/linear-agent)                 | Capability overview, entry points, context, chat behavior, examples, configuration and permissions.                                                                                                                                                                                                                       | Real chats tied to projects/issues and multiple concurrent work tabs.                                             | Existing user permissions bound both reading and changes; admins can disable the agent.                                                                                                     | Show the context boundary and actor identity, not just the chat response.                                                                                                                                                                                 |
| [OpenAI ChatGPT Work](https://help.openai.com/en/articles/20001275/) | Clear split between Chat, Work, and Codex; supported deliverables; availability; start flow; review and follow-up. The earlier [ChatGPT agent launch](https://openai.com/index/introducing-chatgpt-agent/) used concrete jobs, completed task replays, benchmarks, a safety section, limitations, and one direct try CTA. | Finished documents, spreadsheets, presentations, reports, Sites, plus visible progress through a multi-step task. | User can follow progress, interrupt or redirect, and approve important actions; local access requires permission.                                                                           | Lead with finished work and reviewability. Avoid “autonomous” as an unqualified promise. The older agent/Operator flow has been superseded by Work according to [OpenAI's current help page](https://help.openai.com/en/articles/11752874-chatgpt-agent). |
| [Notion Agents](https://www.notion.com/product/agents)               | 24/7 team claim, free/demo CTA, recurring-agent categories, builder, on-demand agent, integrations, enterprise controls, FAQ.                                                                                                                                                                                             | Real Agent Builder and workspace/database captures, plus concrete Q&A, routing, and report examples.              | Per-agent permissions, inherited user permissions, run logs, audit trail, reversible changes, no training on customer content, prompt-injection protection.                                 | Trust deserves a complete section before signup. Use triggers, permissions, run history, and undo as visible product features.                                                                                                                            |
| [Lindy](https://www.lindy.ai/)                                       | Broad teammate claim, free trial, customer logos, numbered toolkit, concrete jobs, work surfaces, social proof, role-based use cases.                                                                                                                                                                                     | Product UI for scheduled routines, editable memory files, skills, meetings, and channel-specific work.            | Says it asks before altering anything; memory is readable/editable; separate security page is prominent in navigation.                                                                      | A simple numbered narrative works if every claim is backed by a capture. Show editable memory/context if Autopilot genuinely exposes it.                                                                                                                  |
| [Relevance AI](https://relevanceai.com/)                             | Outcome/timeline, deployment service, catalogue of named agents, case-study ROI, platform mechanism, enterprise controls, integrations.                                                                                                                                                                                   | Named agent jobs with live-looking run data, model/eval/cost tables, traces, and quantified case studies.         | RBAC, SSO/SAML, human approvals, version control, monitoring, traces, cost visibility, residency, PII masking, no training.                                                                 | For technical buyers, evals, traceability, cost per run, and retry behavior are stronger proof than a chat mockup.                                                                                                                                        |
| [Relay.app](https://relay.app/)                                      | Not a current positioning reference: the official homepage now announces shutdown in August/September 2026.                                                                                                                                                                                                               | The wind-down page provides explicit JSON/prompt/run-history/CSV export paths.                                    | Clear deletion dates, credential removal, refunds, export and support commitments.                                                                                                          | Do not cite Relay as market momentum. Do learn from its exit UX: portable workflows, history export, credential deletion, and clear lifecycle commitments reduce platform risk.                                                                           |

### Recommended Autopilot page hierarchy

1. **Hero:** state the job and current availability precisely. Suggested structure: “Give Autopilot an outcome. Review the work, not every step.” If it is not generally available, use “Launching soon” plus an honest date/window and waitlist/demo CTA.
2. **One end-to-end run:** show a real task request, selected context, live progress, an approval boundary, and the finished artifact or recorded system change.
3. **Where it works:** name the actual QUESTPIE entities and enabled tools it can read or change. Avoid generic integration logos until each integration is functional.
4. **Control:** permissions, actor identity, approvals, audit trail, cancellation, retry behavior, and rollback/reversibility. Separate shipped behavior from roadmap.
5. **Repeatable work:** triggers/schedules only if implemented. Show a genuine recurring run and its history rather than an animated diagram.
6. **Use cases:** three narrow jobs backed by the product: for example content operations, support triage, and internal operations. Each needs trigger → work → output.
7. **Relationship to Framework:** Framework is the typed system; Autopilot operates through its contracts and access rules. Autopilot must be optional.
8. **Availability CTA:** before launch, “Join early access” or “Book a walkthrough”; after launch, “Start a run”. Do not leave an early-access CTA after GA.

### Honest media placeholders now

Use reserved `<figure>` regions with a visible label such as **Product capture coming before launch** and a caption that describes the exact planned evidence. Keep a neutral background and correct final aspect ratio so replacing the file does not alter layout. A placeholder must not look interactive and must not contain invented messages, people, company names, metrics, or completed actions.

Recommended slots:

- `autopilot-run.gif` — 12–18 seconds, 1440×900: enter one real task, show plan/progress, pause at one approval, then show completion. Capture at 1× or 2×; under 8 MB if practical.
- `autopilot-context.webp` — 1440×900: the exact records/files/tools selected for a run; redact real personal data rather than replacing it with a fake enterprise.
- `autopilot-approval.webp` — 1200×750: a consequential proposed change with approve/reject controls and a clear explanation of impact.
- `autopilot-history.webp` — 1440×900: run list with status, actor, duration, timestamp, and inspectable steps. Use real staging runs.
- `autopilot-result.webp` — 1440×900: the actual output where it lives (admin record, issue, report, email draft, etc.), not a celebratory success card.
- `autopilot-mobile.webp` — 780×1688 only if the mobile product is genuinely supported; otherwise omit it.

Recording rules:

- Seed one coherent, non-sensitive demo workspace and reuse it across every capture.
- Record at the final production theme and browser scale; hide bookmarks, extensions, tokens, localhost paths, and personal notifications.
- Prefer WebM/MP4 with controls for demonstrations longer than roughly 15 seconds; use GIF only for a short silent loop.
- Provide a static poster image and descriptive alt text. Respect reduced-motion preferences and never autoplay audio.
- Do not splice out waiting states if speed is part of the claim. It is acceptable to trim dead time when the caption says the recording is shortened.
- Caption what is real and what environment was used, for example: “Recorded in the QUESTPIE Autopilot staging build, August 2026.”

## Copy and design guardrails

- Prefer: “uses your existing access rules”, “shows every attempted change”, “asks before publishing”, “can be stopped”, “result remains editable”. Use these only when verified in the shipping build.
- Avoid: “works autonomously”, “never makes mistakes”, “secure by default”, “understands your whole company”, or quantified time savings without measured evidence.
- Avoid card walls and arrow diagrams. Use section headings, two-column prose, numbered rows, code, product captures, and thin separators.
- One section should make one argument. Do not repeat “one model powers everything” in the hero, diagram, feature cards, and CTA.
- The Framework and Autopilot pages should share typography, spacing, buttons, media frames, and footer, but use different proof: code/output versus task/activity/result.

## Source index

- [Payload homepage](https://payloadcms.com/)
- [Convex homepage](https://www.convex.dev/)
- [Supabase homepage](https://supabase.com/)
- [Directus homepage](https://directus.com/)
- [Encore homepage](https://encore.dev/)
- [Elysia homepage](https://elysiajs.com/)
- [Linear for Agents](https://linear.app/agents)
- [Linear Agent docs](https://linear.app/docs/linear-agent)
- [AI Agents in Linear docs](https://linear.app/docs/agents-in-linear)
- [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275/)
- [Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent/)
- [ChatGPT agent system card](https://openai.com/index/chatgpt-agent-system-card/)
- [ChatGPT Work release notes](https://help.openai.com/en/articles/6825453-custom-instructions-for-chatgpt)
- [Notion Agents](https://www.notion.com/product/agents)
- [Notion Agent help](https://www.notion.com/help/notion-agent)
- [Lindy homepage](https://www.lindy.ai/)
- [Relevance AI homepage](https://relevanceai.com/)
- [Relay.app shutdown notice](https://relay.app/)
