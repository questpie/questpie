-- questpie-step: 00319b21afb3ddbfa8ecb127069a1d27a81cdef5df9ece1b20e738a048ebf59b
CREATE TRIGGER channels_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON collaboration.channels
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('collaboration', 'collection:channels', 'id');

CREATE TRIGGER channels_questpie_capture_truncate
AFTER TRUNCATE ON collaboration.channels
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('collaboration', 'collection:channels');

CREATE TRIGGER companies_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON collaboration.companies
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('collaboration', 'collection:companies', 'id');

CREATE TRIGGER companies_questpie_capture_truncate
AFTER TRUNCATE ON collaboration.companies
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('collaboration', 'collection:companies');

CREATE TRIGGER memberships_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON collaboration.memberships
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('collaboration', 'collection:memberships', 'company_id', 'principal_id', 'scope_key');

CREATE TRIGGER memberships_questpie_capture_truncate
AFTER TRUNCATE ON collaboration.memberships
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('collaboration', 'collection:memberships');

CREATE TRIGGER messages_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON collaboration.messages
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('collaboration', 'collection:messages', 'id');

CREATE TRIGGER messages_questpie_capture_truncate
AFTER TRUNCATE ON collaboration.messages
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('collaboration', 'collection:messages');

CREATE TRIGGER spaces_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON collaboration.spaces
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('collaboration', 'collection:spaces', 'id');

CREATE TRIGGER spaces_questpie_capture_truncate
AFTER TRUNCATE ON collaboration.spaces
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('collaboration', 'collection:spaces');
