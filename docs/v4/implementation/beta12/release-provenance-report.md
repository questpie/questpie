# BETA-12 release provenance report

The candidate version is `4.0.0-beta.1`. Publication remains restricted to a
tag-triggered GitHub Actions run on the tagged stable runner. The release job
runs `bun ci` and `bun run quality:release` before `npm publish --provenance` in
the npm environment. A local invocation without both GitHub Actions and a tag
continues to fail closed; `--dry-run` only creates and verifies temporary
tarballs and never publishes.

The committed release-artifact manifest binds the package name, version,
filename, tarball SHA-256, and declaration SHA-256. The dry-run retry produces
the same tarball bytes and a manifest checksum mismatch is a hard failure.
Actual publication still requires the tag and environment approval; this slice
does not automate either decision.
