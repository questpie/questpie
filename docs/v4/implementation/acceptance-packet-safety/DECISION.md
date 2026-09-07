# Historical secret removal in acceptance packets

The owner approved this narrow repository-quality change on 2026-09-07 after
packet preflight rejected a database URL removed from historical documentation.
This decision changes review-input handling, not QUESTPIE product behavior,
reviewer selection, or the conditions for an acceptance PASS. Implementation and
hostile evidence must pass before the schedule candidate is submitted.

## One explicit manifest exception

A manifest may contain `historicalDatabaseUrlRedactions`, a nonempty array of
at most eight `{ path, baseLine }` entries. `path` is an unquoted, normalized
repository-relative ASCII path; `baseLine` is a positive one-based line number
in the manifest's exact `diffBase` commit. Duplicate entries fail. The caller
supplies neither replacement text nor arbitrary byte ranges or secret values.

Each entry must identify an actual removed line in the complete deterministic
diff. Its content must match the committed base blob and contain exactly one
credential-bearing database URL token. The wrapper replaces only that token
with an indexed `REDACTED_HISTORICAL_DATABASE_URL` marker. Context, additions,
missing lines, unsupported paths, binary hunks, and noncredential URL targets
cannot use this exception. All entries must be applied exactly once.

Before replacement, the wrapper checks that the exact selected URL is absent
from every tracked blob at the reviewed head, including copies and renamed
files. This proves removal of that URL representation, not credential revocation
or removal of every possible encoding. It neither contacts the database nor
prints the token. Git receives the search value only through process input,
never command arguments. Diagnostics contain categories and locations only.

All other diff bytes remain present. The normal scanner checks the transformed
diff and rejects any second secret on that line or elsewhere. Authority files,
manifest content, new code and review records gain no redaction option.

## Deterministic representation and verification

The opt-in packet labels its diff as containing manifest-bound historical URL
redactions. Metadata contains transform version
`historical-database-url-redaction-v1`, the original complete raw-diff SHA-256
and byte count, and each applied index/path/base line. There are no individual
secret hashes. The ordinary packet digest binds the rendered diff and metadata.
Opt-in redaction rejects a diff that cannot round-trip through UTF-8 losslessly;
replacement characters cannot silently change unrelated reviewed bytes.

The existing credential-free verifier reconstructs the same representation from
the reviewed commit and checks the existing record binding. No second verifier
or manually asserted PASS is introduced. Manifests without the new field retain
their exact packet format and bytes; the wrapper does not silently enable this
exception. The diff base, paths, ordering, renderer, reviewer and terminal
`NO_RESULT` rules remain pinned.

## Source syntax is not a credential value

Separately, the scanner can recognize two non-value forms in complete committed
TypeScript/TSX source: a `password` parameter with primitive `string` annotation
and no initializer, or an object-literal `password` property forwarded from an
ordinary dotted member reference ending in `password`. Existing TypeScript
syntax analysis proves these positions; arbitrary prose or YAML cannot opt in.
Calls, computed/optional access, fallbacks, templates and literal values remain
outside this exception.

The diff scanner maps the proven key-name range to its exact base/head source
line and masks only that name in a scan-only copy. Packet bytes never change.
Malformed or mismatched source receives no exemption. Quoted JSON credential
keys must also be detected; fixing a false positive must not excuse a literal.
This is syntactic recognition, not data-flow secrecy analysis.

## Required evidence

Test through real committed repositories and `prepareAcceptancePacket`, followed
by the existing credential-free record verifier. Cover missing and stale lines,
duplicates, context/addition targeting, multiple URL tokens, retained/copied
URLs, residual secrets, path controls, malformed/binary targets, deterministic
reconstruction, raw-diff binding and unchanged non-opt-in packet bytes. No test
uses the historical credential; synthetic tokens exist only in owned temporary
fixtures and are never included in failure messages.

Source-form tests must distinguish actual syntax from comments, strings, YAML,
JSON and default-value literals, including old/new/context lines and incorrect
source-side mapping. Preserve the existing URL and assignment negative controls.
Run independent Standards and Spec/security reviews before formal submission.

This supplements the original acceptance-determinism decision only for the
explicit exception above. The historical proof and its reviewed records remain
unchanged. There is no sanitized-base substitution, path exclusion, broad secret
allowlist, fallback reviewer, or automatic acceptance retry.
