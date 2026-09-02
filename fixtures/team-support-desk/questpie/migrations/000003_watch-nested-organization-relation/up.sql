-- questpie-step: f0899ade67db88dda7b993a6f05019c656cf996e2a044cb72bc63cc5debadae2
DROP TRIGGER comments_questpie_capture_row ON team_support_desk.comments;
DROP TRIGGER comments_questpie_capture_truncate ON team_support_desk.comments;

DROP TRIGGER labels_questpie_capture_row ON team_support_desk.labels;
DROP TRIGGER labels_questpie_capture_truncate ON team_support_desk.labels;

DROP TRIGGER memberships_questpie_capture_row ON team_support_desk.memberships;
DROP TRIGGER memberships_questpie_capture_truncate ON team_support_desk.memberships;

DROP TRIGGER teams_questpie_capture_row ON team_support_desk.teams;
DROP TRIGGER teams_questpie_capture_truncate ON team_support_desk.teams;

DROP TRIGGER tickets_questpie_capture_row ON team_support_desk.tickets;
DROP TRIGGER tickets_questpie_capture_truncate ON team_support_desk.tickets;

-- questpie-step: 2b92b61c1c516e10dfca0e1cc1faa0a7f29eb404f485f4802be2480f057d49c6
CREATE TRIGGER comments_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.comments
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:comments', 'id');

CREATE TRIGGER comments_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.comments
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:comments');

CREATE TRIGGER labels_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.labels
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:labels', 'id');

CREATE TRIGGER labels_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.labels
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:labels');

CREATE TRIGGER memberships_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.memberships
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:memberships', 'id');

CREATE TRIGGER memberships_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.memberships
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:memberships');

CREATE TRIGGER organizations_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.organizations
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:organizations', 'id');

CREATE TRIGGER organizations_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.organizations
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:organizations');

CREATE TRIGGER teams_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.teams
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:teams', 'id');

CREATE TRIGGER teams_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.teams
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:teams');

CREATE TRIGGER tickets_questpie_capture_row
AFTER INSERT OR UPDATE OR DELETE ON team_support_desk.tickets
FOR EACH ROW EXECUTE FUNCTION questpie_internal.capture_reactive_row('teamSupportDesk', 'collection:tickets', 'id');

CREATE TRIGGER tickets_questpie_capture_truncate
AFTER TRUNCATE ON team_support_desk.tickets
FOR EACH STATEMENT EXECUTE FUNCTION questpie_internal.capture_reactive_truncate('teamSupportDesk', 'collection:tickets');
