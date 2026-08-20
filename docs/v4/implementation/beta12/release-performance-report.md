# BETA-12 release performance report

All implementation slices BETA-01 through BETA-12 own at least one manifest in
`quality/performance`. BETA-12 adds the aggregate `beta12-release-gate` manual
micro scenario. It checks that BETA-01 through BETA-12 all own performance
evidence and executes the packed release dry-run. The repository performance
gate separately validates all sixteen manifests through its schema.

The measured local packed dry-run was 3,133.55 ms. Its release budget is
15,000 ms, leaving installation and filesystem variance without turning noisy
GitHub timing into authority. The tagged stable runner remains the strict
release owner. PostgreSQL correctness, load, and soak stay in their separate
lanes rather than being folded into this timing.
