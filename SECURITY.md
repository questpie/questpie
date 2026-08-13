# Security policy

Do not open a public issue for a security problem.

Report it through [GitHub Security Advisories](https://github.com/questpie/questpie/security/advisories/new)
or email `dominik.repkovsky@gmail.com` with `QUESTPIE SECURITY` in the subject.

This v4 branch does not contain a released runtime. Security reports about the
released v3 product must name the affected v3 version and include a minimal
reproduction. Reports about v4 documents must identify the unsafe guarantee,
threat model, and affected specification section.

Include affected versions or commit IDs, the authority or trust seam involved,
reproduction conditions, impact, and any safe workaround. Never include live
credentials or production data.

We acknowledge reports within three working days and provide an initial
assessment within ten working days. Release automation uses GitHub OIDC/npm
provenance and repository environments; maintainers do not place publish tokens
in source, review packets, logs, or issue comments.
