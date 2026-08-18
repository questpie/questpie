export const internalProtocolV5Sql = `
ALTER TABLE questpie_internal.durable_maintenance_commands
  ADD COLUMN reason text;

ALTER TABLE questpie_internal.durable_maintenance_commands
  ADD CONSTRAINT durable_command_reason_bounded CHECK (
    reason IS NULL OR length(reason) BETWEEN 1 AND 256
  );

ALTER TABLE questpie_internal.durable_maintenance_commands
  DROP CONSTRAINT durable_command_rejection_known;

ALTER TABLE questpie_internal.durable_maintenance_commands
  ADD CONSTRAINT durable_command_rejection_known CHECK (
    rejection_code IS NULL OR rejection_code IN (
      'ALREADY_REQUESTED', 'ATTEMPTS_EXHAUSTED', 'AUTHORITY_DENIED',
      'NOT_AMBIGUOUS', 'REASON_INVALID', 'RUN_IS_TERMINAL',
      'RUN_NOT_FAILED', 'VERSION_MISMATCH'
    )
  );
`;
