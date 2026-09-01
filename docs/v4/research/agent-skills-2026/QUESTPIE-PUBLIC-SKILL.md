# QUESTPIE public Agent Skill research

- Status: research only; not product or release authority
- Date: 2026-09-02
- Scope: the portable framework-authoring skill proposed for QUESTPIE
  `4.0.0-beta.2`
- Sources: Agent Skills, Anthropic, and skills.sh first-party specifications,
  documentation, and repositories only

## Conclusion

QUESTPIE should publish one portable consumer skill at
`skills/questpie/SKILL.md`. The existing `.agents/skills/questpie-v4` skill is
repository-contributor infrastructure and should remain separate. The public
skill should use progressive disclosure, contain no executable script in its
first release, refer only to released public behavior, and validate with the
official `skills-ref` grammar before release.

This recommendation is compatible with skills.sh discovery without making
skills.sh part of the Agent Skills format. The format defines the contents of a
skill directory but deliberately does not prescribe where that directory is
installed. The skills.sh CLI separately treats `skills/` as a standard
repository discovery root and installs selected skills into the target agent's
own project or user directory.

## 1. Current format contract

An Agent Skill is a directory whose only required file is `SKILL.md`. That file
contains YAML frontmatter followed by Markdown instructions. `name` and
`description` are required; optional conventional directories are `scripts/`,
`references/`, and `assets/`.
[Agent Skills specification](https://agentskills.io/specification)

The relevant strict rules are:

- `name` is 1–64 lowercase alphanumeric or hyphen characters, has no leading,
  trailing, or consecutive hyphen, and matches the parent directory;
- `description` is non-empty, at most 1,024 characters, and describes both the
  capability and when an agent should activate it;
- optional `compatibility` is at most 500 characters and should be present only
  when the environment has real requirements;
- optional `metadata` is a string-to-string map; and
- `allowed-tools` is experimental and client support varies, so it cannot be a
  portable security boundary.

The specification recommends keeping `SKILL.md` below 500 lines, resolving
paths relative to the skill root, keeping references one level deep, and
loading supporting resources only when the task requires them.
[Agent Skills progressive disclosure and file references](https://agentskills.io/specification#progressive-disclosure)

Anthropic's authoring guidance reaches the same practical result: keep the main
instructions concise, make the description specific enough for discovery,
match instruction freedom to the risk of the action, use consistent terms,
and include validation feedback loops for fragile work.
[Anthropic skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)

## 2. Discovery and installation

The cross-client convention is project- and user-level `.agents/skills/`, but
the Agent Skills specification does not require an installation path.
[Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support#where-to-scan)

For a public GitHub repository, skills.sh accepts an `owner/repo`, full GitHub
URL, direct repository tree path, arbitrary Git URL, or local path. Its CLI can
list the available skills and install one selected name. Its repository scanner
explicitly searches `skills/` and walks the catalogue deeply enough for
`skills/<name>/SKILL.md`.
[skills.sh CLI](https://github.com/vercel-labs/skills#install-a-skill),
[skills.sh discovery](https://github.com/vercel-labs/skills#skill-discovery)

The intended public flow is therefore:

```text
npx skills add <questpie-owner>/<questpie-repository> --list
npx skills add <questpie-owner>/<questpie-repository> --skill questpie
```

The exact repository owner/name should be documented only when the public
repository identity is fixed. The skill itself must not assume the target
agent's installation path. The CLI owns installation into client-specific
locations.

skills.sh reports aggregate install telemetry and permits opting out with
`DISABLE_TELEMETRY=1`; release documentation should link to that behavior
rather than implying installation is telemetry-free.
[skills.sh CLI telemetry](https://www.skills.sh/docs/cli#telemetry)

## 3. Validation boundary

The Agent Skills project supplies `skills-ref validate <skill-directory>` to
check frontmatter and naming rules. Its own repository labels `skills-ref` a
reference/demonstration implementation rather than a production runtime, which
is appropriate for a repository release gate.
[Agent Skills validation](https://agentskills.io/specification#validation),
[`skills-ref` CLI](https://github.com/agentskills/agentskills/tree/main/skills-ref#cli)

QUESTPIE already pins `skills-ref` in the workspace. The beta.2 slice should
extend the repository-owned validation command so it checks both the internal
contributor skill and `skills/questpie`; release evidence should invoke that
stable Bun script rather than an unpinned network install.

Format validation is necessary but insufficient. The release gate should also
prove that:

1. the public directory installs from a clean repository checkout using the
   skills.sh listing and selection flow;
2. every relative reference resolves inside `skills/questpie`;
3. the skill contains no repository-internal path or unreleased syntax;
4. every code example it directs an agent to use compiles against the packed
   beta.2 packages; and
5. representative supported agents activate it from its `description` and
   follow the same safe authoring path.

The final item follows Anthropic's recommendation to test skills with the
models and real workflows they will actually serve, not only inspect the
Markdown statically.
[Anthropic evaluation guidance](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices#test-with-all-models-you-plan-to-use)

## 4. Trust and security constraints

Skills are executable instructions in an agent's trust boundary, even when the
skill contains only Markdown. The Agent Skills integration guide recommends
gating project skills on repository trust because a newly cloned repository
can otherwise inject instructions into the agent context. Anthropic likewise
warns that anyone able to change a mounted repository can change the skill and
thereby influence tools with filesystem or network reach.
[Agent Skills trust considerations](https://agentskills.io/client-implementation/adding-skills-support#trust-considerations),
[Anthropic repository-skill trust boundary](https://platform.claude.com/docs/en/managed-agents/skills#load-skills-from-a-github-repository)

The first QUESTPIE public skill should consequently:

- bundle no executable scripts, hidden downloads, credential setup, publish,
  deployment, or destructive database instructions;
- never request, print, persist, or invent credentials;
- distinguish commands to run from files to read;
- use only relative in-skill references and versioned public HTTPS links;
- avoid `allowed-tools`, because its experimental allowlisting semantics are
  not portable;
- state prerequisites and side effects before any command; and
- make verification a named final step rather than relying on agent judgment.

skills.sh performs security audits but explicitly does not guarantee every
listed skill. QUESTPIE should therefore treat source review and its own release
checks as the security boundary, not directory listing status.
[skills.sh security statement](https://www.skills.sh/docs#how-are-you-securing-skills)

## 5. Recommended beta.2 tree

```text
skills/
└── questpie/
    ├── SKILL.md
    └── references/
        ├── application-authoring.md
        ├── data-policy-and-lifecycle.md
        ├── operations-http-openapi-and-mcp.md
        ├── query-resources-react-and-relations.md
        └── jobs-and-observability.md
```

`SKILL.md` should be a compact router: inspect the application's current
QUESTPIE version and generated contract, choose the one relevant reference,
prefer generated/inferred types over repeated definitions, make the smallest
change, and run the application's own Bun verification. The references should
teach jobs an application author actually performs, with complete snippets and
links to the matching versioned public guide. They should not copy internal ADR,
proof, fixture, ticket, digest, or worktree instructions.

Recommended frontmatter shape:

```yaml
---
name: questpie
description: Builds and changes QUESTPIE applications using generated contracts, Policy-aware data operations, Jobs, typed clients, and supported projections. Use when authoring, reviewing, migrating, or debugging an application on QUESTPIE 4.0.0-beta.2.
compatibility: Requires a QUESTPIE 4.0.0-beta.2 application and Bun.
metadata:
  version: "4.0.0-beta.2"
---
```

The description is intentionally about application work, not QUESTPIE
repository contribution. The compatibility field prevents the beta.2 skill
from silently teaching future or beta.1 projects the wrong surface.

## 6. Exact beta.2 applicability

The release scope remains **Proposed**, so this research must not project the
skill or beta.2 capabilities as shipped. Under the current candidate, the
public skill is one release artifact alongside the three exact-peer packages.
It becomes release-eligible only after its released syntax, public links,
packed-package examples, installation, and validation evidence pass.
The planning inputs are Proposed ADR-0039 at
`docs/adr/0039-slice-the-beta-two-dx-release.md` and its candidate table at
`docs/v4/beta2-release-scope.md`, both recorded on
`work/beta2-release-contract` at `492af7684` rather than projected into this
research branch.

If ADR-0039 is accepted without changing this row, the initial skill may cover
only the capabilities in the final beta.2 inventory: the existing core and
lifecycle, Action, Route/Auth, Job, discriminated TypeScript helpers, Query
Resource and React adapter, inverse selection, Runtime observation and its
OpenTelemetry projection, canonical Operation HTTP, OpenAPI, and basic MCP.

It must explicitly exclude Autopilot implementation, a generated
application-specific skill, polymorphic Relation or codec machinery, Workflow,
Files, Search, Studio, split Runtime roles, and every compatibility or fallback
path. Those items require later authority; mentioning them as available would
turn a guidance artifact into false product documentation.

The clean release sequence is:

1. finish and accept each capability that the candidate inventory includes;
2. author `skills/questpie` only from the resulting public docs and packed API;
3. validate format, installation, references, examples, and representative
   agent behavior on the exact aggregate candidate head; and
4. project the skill as released only with the beta.2 authority/release commit.

Until that sequence completes, this note is evidence for the eventual skill
ticket, not permission to create public beta.2 claims.
