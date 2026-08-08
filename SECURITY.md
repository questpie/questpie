# Security Policy

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through
[GitHub Security Advisories](https://github.com/questpie/questpie/security/advisories/new),
which creates a private thread with the maintainers. If you cannot use that, email
**dominik.repkovsky@gmail.com** with `QUESTPIE SECURITY` in the subject.

Please include:

- what an attacker can do, and what they need to start (unauthenticated? a valid
  session? admin rights?)
- the affected package and version, and the adapters involved if relevant
  (`pg-boss` vs BullMQ, SSE vs Pusher, S3 vs local storage — these change the
  attack surface)
- a reproduction: a failing test, a curl sequence, or a minimal app
- your assessment of impact, if you have one

You will get an acknowledgement within **3 working days** and an initial assessment
within **10**. If a report goes quiet for longer than that, escalate by email.

We will credit you in the advisory unless you ask us not to. Please give us time to
ship a fix before disclosing publicly — we aim for 90 days, sooner for anything
being exploited.

## Supported versions

QUESTPIE ships as one fixed version train across all `@questpie/*` packages.

| Version       | Supported |
| ------------- | --------- |
| 3.x (current) | Yes       |
| < 3.0         | No        |

Security fixes land on the current minor. There is no long-term-support branch;
staying current is the supported path.

## Scope

In scope, in roughly descending priority:

- **Access control** — a request reading or writing data its principal is not
  entitled to. This includes collection/global access rules, field-level access,
  Search results and facets, storage/file serving, realtime subscription routing,
  CRDT document authority, and admin actions.
- **Authentication and sessions** — session fixation or forgery, privilege
  escalation, OAuth/MCP token handling, scope enforcement (`scopes ∩ RBAC`).
- **Sandboxed execution** — escaping `@questpie/sandbox` guest isolation, or
  reaching hosts the manifest did not allow. Note the known limitation below.
- **Injection** — SQL, template, or header injection reachable from user input.
- **Data integrity** — bypassing soft-delete/purge authorization, or corrupting
  another tenant's data.

Out of scope:

- Findings that require the operator to have already misconfigured the app in a
  way the docs warn against.
- Denial of service by sheer volume against an unprotected deployment. Rate
  limiting is the operator's responsibility at the edge.
- Vulnerabilities in dependencies with no exploitable path through QUESTPIE —
  report those upstream. If you find the path, that is in scope.
- Anything in `examples/` or `design-system/`, which are demonstrations.

## Known limitations

These are documented rather than secret. Reporting them again is not necessary,
but a working exploit that goes beyond what is described here is.

- **Queue payload encryption.** Job payloads are stored unencrypted by the queue
  adapter. Do not put secrets in a job payload; pass a reference and resolve it
  inside the handler.
- **Logging boundaries.** Built-in credential/error redaction and correlation
  header validation are defense in depth, not a data-loss-prevention system. Do
  not log whole request, session or provider objects. Correlation ids supplied
  by a host through `AdapterContext` are trusted internal values and must be
  validated by that integration if they originated externally.
- **Audit and compliance.** The audit module provides private reads, field
  classification, delivery/retention policy, legal hold decisions and an event
  sink contract. It does not provide immutable storage, exactly-once delivery,
  key management, certification or a claim that an application is compliant.
  Operators must supply and validate those controls for their deployment.

## Sandbox egress model

Worth stating explicitly, because it is the question people ask first about
running untrusted code:

The guest has **no network at all** — it runs with `--allow-net=[]` and cannot
open a socket. Every request is relayed to a broker on the trusted host, which
resolves the hostname itself, validates every A and AAAA record against the
private/link-local/loopback/metadata/CGNAT policy, and **pins the socket to a
validated IP literal** while keeping the hostname for TLS SNI and the `Host`
header. Auto-follow is disabled; each redirect hop is re-parsed, re-resolved,
re-validated and re-pinned, so an open redirect on an allowlisted host cannot
reach an internal target mid-chain.

On Linux there is a second, independent boundary: a kernel-level egress drop
(network namespace + nftables) that discards packets to private ranges even if
the guest somehow obtained a socket. It is absent on macOS and Windows, where
the brokered path is the whole defense.

## Dependency advisories

CI runs `scripts/audit-gate.ts` on every PR and fails on new high or critical
advisories. Snoozed entries are listed explicitly in that file with a reason and a
follow-up — they are visible, not silent.
