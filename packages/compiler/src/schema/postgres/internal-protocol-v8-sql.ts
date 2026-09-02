/** Protocol v8 persists only first-acceptance trace correlation on Durable Runs. */
export const internalProtocolV8Sql = `ALTER TABLE questpie_internal.durable_runs
  ADD COLUMN trace_id bytea,
  ADD COLUMN span_id bytea,
  ADD COLUMN trace_flags smallint,
  ADD CONSTRAINT durable_run_trace_context_complete CHECK (
    (trace_id IS NULL AND span_id IS NULL AND trace_flags IS NULL)
    OR (trace_id IS NOT NULL
      AND octet_length(trace_id) = 16
      AND trace_id <> decode(repeat('00', 16), 'hex')
      AND span_id IS NOT NULL
      AND octet_length(span_id) = 8
      AND span_id <> decode(repeat('00', 8), 'hex')
      AND trace_flags IS NOT NULL
      AND trace_flags BETWEEN 0 AND 255)
  );
`;
