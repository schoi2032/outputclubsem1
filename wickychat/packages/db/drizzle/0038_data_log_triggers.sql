-- WickyChat data log: every change to the economy is copied into data_log by these triggers,
-- so nothing that edits these tables can skip it.
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
    coalesce(r->>'user_id', r->>'holder_id', r->>'seller_id', r->>'from_id', r->>'challenger_id', r->>'creator_id'),
    o,
    n
  );
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Accounts: only the economy columns (never passwords or emails).
CREATE OR REPLACE FUNCTION wicky_log_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb;
  n jsonb;
BEGIN
  o := jsonb_build_object('coins', OLD.coins, 'decoration', OLD.decoration, 'app_theme', OLD.app_theme, 'profile_effect', OLD.profile_effect, 'name_plate', OLD.name_plate, 'showcase', OLD.showcase, 'daily_streak', OLD.daily_streak, 'best_streak', OLD.best_streak);
  n := jsonb_build_object('coins', NEW.coins, 'decoration', NEW.decoration, 'app_theme', NEW.app_theme, 'profile_effect', NEW.profile_effect, 'name_plate', NEW.name_plate, 'showcase', NEW.showcase, 'daily_streak', NEW.daily_streak, 'best_streak', NEW.best_streak);
  IF o = n THEN RETURN NULL; END IF;
  INSERT INTO data_log (tbl, op, user_id, old, new) VALUES ('users', 'UPDATE', NEW.id::text, o, n);
  RETURN NULL;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON user_items;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON user_items FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON holdings;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON holdings FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON person_shares;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON person_shares FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON market_supply;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON market_supply FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON user_crates;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON user_crates FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON trades;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON trades FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON auctions;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON auctions FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON duels;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON duels FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON market_listings;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON market_listings FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON cosmetics;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON cosmetics FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON custom_crates;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON custom_crates FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON custom_bundles;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON custom_bundles FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON sticker_packs;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON sticker_packs FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON user_sticker_packs;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON user_sticker_packs FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON achievement_claims;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON achievement_claims FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON wishlist;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON wishlist FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON user_badges;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT OR UPDATE OR DELETE ON user_badges FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON coin_transactions;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER INSERT ON coin_transactions FOR EACH ROW EXECUTE FUNCTION wicky_log_change();
--> statement-breakpoint
DROP TRIGGER IF EXISTS wicky_log ON users;
--> statement-breakpoint
CREATE TRIGGER wicky_log AFTER UPDATE OF coins, decoration, app_theme, profile_effect, name_plate, showcase, daily_streak, best_streak ON users FOR EACH ROW EXECUTE FUNCTION wicky_log_user();
