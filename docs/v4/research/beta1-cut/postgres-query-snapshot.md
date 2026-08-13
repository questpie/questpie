# PostgreSQL snapshot for a multi-read Query

- Status: research evidence; no v4 acceptance authority
- Question: what is the smallest correct consistency contract for one
  read-only server Query that issues several Collection reads?
- Baseline: QUESTPIE Schema Projection v1 supports PostgreSQL 16 or later.

## Result

If one named Query combines reads from several Collections into one returned
value, the smallest simple contract is one framework-owned PostgreSQL
transaction declared `REPEATABLE READ READ ONLY`. Every database read performed
by that Query, including Policy reads, must use that transaction. This gives the
handler one stable database snapshot without claiming serializable business-rule
validation.

`READ COMMITTED`, even inside one transaction, is too weak for that promise:
each `SELECT` observes the snapshot at the start of that statement, and two
successive `SELECT`s can therefore see different committed states. PostgreSQL
`REPEATABLE READ` instead fixes the snapshot at the first non-transaction-control
statement and keeps it for later statements in the transaction. PostgreSQL's
read-only Repeatable Read transactions do not incur serialization conflicts.
See the PostgreSQL 16
[transaction-isolation contract](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-READ-COMMITTED)
and its
[Repeatable Read contract](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-REPEATABLE-READ).

The minimal database shape is therefore:

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- Policy reads and every Collection read for this Query use this transaction.
COMMIT;
```

The transaction must begin before the first database-backed Policy or
Collection read. Isolation cannot be changed after the first query, and the
Repeatable Read snapshot is established by that first query, not by `BEGIN`.
PostgreSQL documents both rules in
[`SET TRANSACTION`](https://www.postgresql.org/docs/16/sql-set-transaction.html).

## What this guarantee means

The returned computation observes one committed snapshot even when it issues
four separate structural reads. Concurrent commits after the first read do not
appear in later reads of the same Query. The Query can perform deterministic
application logic over those results before returning its declared output.

This is snapshot consistency, not a claim that the result is equivalent to
running all concurrent transactions one at a time. PostgreSQL explicitly notes
that Repeatable Read can still admit serialization anomalies. A future operation
whose correctness depends on serializable cross-row business invariants needs a
separate `SERIALIZABLE` decision and retry contract; it should not silently
strengthen every beta Query. PostgreSQL describes `SERIALIZABLE READ ONLY
DEFERRABLE` as suitable for long reports because it can wait for a safe snapshot,
which is a different latency contract from an ordinary application Query.
See
[`SET TRANSACTION`](https://www.postgresql.org/docs/16/sql-set-transaction.html)
and the
[`SERIALIZABLE` section](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-SERIALIZABLE).

`READ ONLY` is a useful database guard, but it is not the whole semantic proof
that a QUESTPIE Query is side-effect free. PostgreSQL disallows writes to
non-temporary tables and most schema-changing commands, while describing the
mode itself as a high-level notion that does not prevent every disk write.
QUESTPIE must still expose only the accepted read capabilities to a Query and
reserve application writes and external effects for their proper operation
boundaries. See PostgreSQL's
[read-only transaction rules](https://www.postgresql.org/docs/16/sql-set-transaction.html).

## Connection ownership and concurrency

The smallest beta implementation keeps the transaction on one checked-out
connection for the Query's lifetime. PostgreSQL's frontend/backend protocol is
a command stream. Pipelining can remove client/server round trips, but the
backend processes the queued commands in order and error recovery is defined
for the remaining queued commands. It is not parallel execution on one
connection. See the PostgreSQL 16
[protocol message flow](https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-PIPELINING)
and
[`libpq` pipeline mode](https://www.postgresql.org/docs/16/libpq-pipeline-mode.html).

Consequences for the handler contract:

- Collection reads may be written sequentially and may later be safely
  pipelined or combined behind the runtime without changing their snapshot.
- `Promise.all` must not imply independent database connections or server-side
  parallelism. A beta runtime may serialize calls on the owned connection, or
  reject concurrent use with a stable framework error.
- Opening four ordinary pool connections would not preserve one snapshot.
  PostgreSQL says independently started transactions can see different content
  if another transaction commits between their starts.

PostgreSQL can synchronize multiple sessions with `pg_export_snapshot()` and
`SET TRANSACTION SNAPSHOT`, but the exporter must remain open, import must occur
before the importing transaction's first query, and the importing transaction
must be Repeatable Read or Serializable. That machinery adds coordination and
failure modes without strengthening the beta user journey, so parallel
multi-connection execution should remain deferred. See the official
[snapshot synchronization functions](https://www.postgresql.org/docs/16/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)
and
[`SET TRANSACTION SNAPSHOT`](https://www.postgresql.org/docs/16/sql-set-transaction.html).

## Deadline, cancellation, and cleanup

The stable snapshot must be short-lived and bounded:

- PostgreSQL 16 `statement_timeout` bounds each statement, not the whole
  multi-statement transaction. The runtime can set a transaction-local value
  from the Execution's remaining deadline before reads, but it still needs one
  framework-owned overall deadline.
- PostgreSQL 16 `idle_in_transaction_session_timeout` can terminate a session
  left idle inside a transaction. PostgreSQL warns that an open idle
  transaction can prevent cleanup of dead tuples and contribute to bloat.
- The database protocol supports canceling the command currently executing,
  but successful dispatch does not prove the cancel took effect. Cancellation
  therefore cannot replace the operation deadline or guaranteed cleanup.

These facts are documented in PostgreSQL 16's
[client connection timeouts](https://www.postgresql.org/docs/16/runtime-config-client.html)
and
[cancel request protocol](https://www.postgresql.org/docs/16/protocol-flow.html#PROTOCOL-FLOW-CANCELING-REQUESTS).
PostgreSQL 18 has a transaction-wide `transaction_timeout`, but it is absent
from the accepted PostgreSQL 16 baseline, so beta.1 cannot rely on it; see the
[PostgreSQL 18 timeout documentation](https://www.postgresql.org/docs/18/runtime-config-client.html).

On deadline, cancellation, handler failure, codec failure, or Policy failure,
the runtime should stop issuing reads, roll back the transaction, release the
owned connection only after cleanup, and return the stable operation error.
No partial Query result is returned. This is a framework inference from the
database behavior, not a PostgreSQL API requirement.

## Recommended beta contract and proof

1. Every named Query Resource Execution that can access Collections owns one
   lazy or eager `REPEATABLE READ READ ONLY` transaction before its first
   database-backed read.
2. Policy evaluation and all Collection reads join that exact transaction and
   immutable Execution context.
3. The runtime exposes no second connection or snapshot-export mechanism to
   the beta Query handler.
4. One Execution deadline bounds the whole Query; per-statement timeout and
   driver cancellation are enforcement tools beneath it.
5. All exits commit an entirely successful read-only transaction or roll it
   back; a timeout or cancellation never returns a partial output.

The focused PostgreSQL proof should pause a Query after its first Collection
read, commit a related change from a second connection, resume the remaining
reads, and assert that the returned value contains only the original snapshot.
A hostile companion should run the same sequence under `READ COMMITTED` and
demonstrate the mixed result. Additional checks should cover Policy reads inside
the same snapshot, cancellation during a later statement, rollback/connection
reuse after cancellation, and rejection or deterministic serialization of
concurrent handler reads.
