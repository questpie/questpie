# QUESTPIE v4

QUESTPIE is a PostgreSQL-native application compiler and Runtime. One generated
App Contract connects typed direct calls, HTTP/OpenAPI, MCP and client APIs.

This branch contains the implemented **beta.2 candidate**, including native
React Query and TanStack Start SSR/hydration. Beta.2 is not published;
[its release inventory](docs/v4/beta2-release-scope.md) remains subject to
Proposed ADR-0039 acceptance.

## Use and contribute

- [Public v4 documentation](apps/docs/content/docs/v4/index.mdx) describes
  version availability and the supported API.
- [Public agent skill](skills/questpie/SKILL.md) teaches the checked package
  surface.
- [Team Support Desk](fixtures/team-support-desk/README.md) is the reference
  application.
- [Contributing](CONTRIBUTING.md) covers repository scripts and local work.
- [Handoff](HANDOFF.md) names the current task and release prerequisites.
- [Internal document map](docs/v4/README.md) routes architecture and evidence.

The public packages are `questpie` (including `questpie/react-query`) and
`questpie-opentelemetry`. Other repository packages are private.
