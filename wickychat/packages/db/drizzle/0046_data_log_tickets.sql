-- Data log: also track spin tickets on accounts.
CREATE OR REPLACE FUNCTION wicky_log_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb;
  n jsonb;
BEGIN
  o := jsonb_build_object('coins', OLD.coins, 'decoration', OLD.decoration, 'app_theme', OLD.app_theme, 'profile_effect', OLD.profile_effect, 'name_plate', OLD.name_plate, 'showcase', OLD.showcase, 'daily_streak', OLD.daily_streak, 'best_streak', OLD.best_streak, 'spin_tickets', OLD.spin_tickets);
  n := jsonb_build_object('coins', NEW.coins, 'decoration', NEW.decoration, 'app_theme', NEW.app_theme, 'profile_effect', NEW.profile_effect, 'name_plate', NEW.name_plate, 'showcase', NEW.showcase, 'daily_streak', NEW.daily_streak, 'best_streak', NEW.best_streak, 'spin_tickets', NEW.spin_tickets);
  IF o = n THEN RETURN NULL; END IF;
  INSERT INTO data_log (tbl, op, user_id, old, new) VALUES ('users', 'UPDATE', NEW.id::text, o, n);
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON users;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER UPDATE OF coins, decoration, app_theme, profile_effect, name_plate, showcase, daily_streak, best_streak, spin_tickets ON users FOR EACH ROW EXECUTE FUNCTION wicky_log_user();
