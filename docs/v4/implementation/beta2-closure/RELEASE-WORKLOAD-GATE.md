# Execute the beta.2 release workload gate

The release workflow must execute the existing affected workload matrix before
its publish step. `quality:release` validates performance manifests; it does not
execute them. Registering a stable runner alone therefore does not close this
gate. This repository-quality repair changes neither product authority nor any
scenario workload or budget.

## Fixed workflow boundary

The same checkout runs quality, then these existing scenarios sequentially:
`beta08-worker-contention`, `beta10-ten-instance`,
`pb05-mutation-transaction-tail`, `beta10-soak-chaos`, and
`beta12-release-gate`. The last scenario is the measured aggregate package
dry-run. The repository's `test:load`, `test:soak`, and `bench:micro` scripts
remain their execution owners. This selected matrix is not all 19 manifests.

The workflow pins checkout to the triggering commit and checks that identity
before work and before publication. Failure, cancellation, missing PostgreSQL
configuration, or missing evidence must prevent publication. Logs identify the
exact commit and run attempt. No reusable PASS file or operator-supplied success
flag authorizes publishing.

A manual `workflow_dispatch` validates the selected commit but never publishes,
including when dispatched against a tag. Only the existing tag-push event may
reach publication, after all preceding steps succeed. Dispatch and publication
still require human authority; this change invokes neither.

## Own the database instead of accepting a target

The Actions job creates a fresh PostgreSQL 17 service and owns its teardown.
There is no database URL, host, or port workflow input. The tests receive only
the job service's dynamically allocated loopback port and fixed disposable
database identity. Inherited connection aliases are removed before the matrix.
These harnesses reset schemas, so this workflow must never accept a supplied
or shared database as an alternative.

The service binds `127.0.0.1::5432`; no fixed host port or externally exposed
trust endpoint is needed. PostgreSQL data lives in the container's writable
disk layer through an explicit `PGDATA` path. An empty tmpfs covers the image's
unused default data-volume mount, preventing an anonymous volume from surviving
container removal. Database data itself does not live in that tmpfs. No host
directory or existing Docker volume is mounted or deleted.

GitHub documents fresh service creation and teardown in its
[service-container guide](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers).
Its [runner implementation](https://github.com/actions/runner/blob/main/src/Runner.Worker/Container/DockerCommandManager.cs)
passes port mappings to Docker unchanged and removes service containers without
the volume-removal flag. Docker documents
[loopback port publication](https://docs.docker.com/engine/network/port-publishing/).
These are inspected implementation facts, not evidence of an executed workflow.

## Verification and remaining prerequisites

Tests inspect the parsed executable workflow: mandatory ordering, exact checkout,
failure propagation, manual nonpublication, service-only connection ownership,
and the unchanged five scenario owners. This is the agreed repository/CI seam;
tests do not mock benchmark success or create a release PASS.

Actual validation still needs a dedicated `questpie-release` Linux x64 runner,
Docker, sufficient disk and temporary storage, and permission to dispatch the
workflow. The `npm` environment remains protected. A workload PASS on that
runner is release evidence; local workflow tests are not performance evidence.
Schedule acceptance and the subsequent beta.2 acceptance/projection remain
separate prerequisites. No new benchmark, provisioning framework, database
fallback, or publication permission is introduced.
