CREATE TABLE nibrun.profiles (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id   text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_owner_id_key UNIQUE (owner_id)
);

COMMENT ON COLUMN nibrun.profiles.owner_id IS $c$@type import('@repo/protocol').OwnerId$c$;
COMMENT ON COLUMN nibrun.profiles.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.profiles
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

CREATE FUNCTION nibrun.add_profile() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  INSERT INTO nibrun.profiles (owner_id) VALUES (NEW.id) ON CONFLICT (owner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER add_profile AFTER INSERT ON auth."user"
  FOR EACH ROW EXECUTE FUNCTION nibrun.add_profile();
