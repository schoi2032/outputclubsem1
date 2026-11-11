-- Data log for quests, Class vs Class, artists and commissions.
CREATE OR REPLACE FUNCTION wicky_log_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb;
  n jsonb;
  r jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN o := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN n := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND o = n THEN RETURN NULL; END IF;
  r := coalesce(n, o);
  INSERT INTO data_log (tbl, op, user_id, old, new)
  VALUES (
    TG_TABLE_NAME,
    TG_OP,
    coalesce(r->>'user_id', r->>'holder_id', r->>'seller_id', r->>'from_id', r->>'challenger_id', r->>'requester_id', r->>'creator_id'),
    o,
    n
  );
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON quest_claims;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON quest_claims FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON class_war_weeks;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON class_war_weeks FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON artists;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON artists FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON commissions;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON commissions FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
