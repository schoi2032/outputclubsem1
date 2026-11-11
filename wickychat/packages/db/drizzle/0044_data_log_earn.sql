-- Data log for bounties, trivia and referrals.
DROP TRIGGER IF EXISTS wicky_log ON bounties;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON bounties FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON trivia_answers;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON trivia_answers FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON referrals;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON referrals FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
