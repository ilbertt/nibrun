-- What nibrun holds about a person, beside what signing them in knows about them.
--
-- `auth."user"` belongs to better-auth: its shape is that library's to change, and a column we add
-- there is one a future release of it can collide with. This is the other half — the shape every
-- auth system leaves for the application to fill. Nothing better-auth already holds is copied into
-- it: a name or an email read here would be a second copy to go stale, and the join is one key
-- away.
--
-- Empty of its own fields on purpose. What goes here arrives with whatever first needs it, and a
-- column added now would be one nothing reads.
--
-- `nibrun.owners` was the other candidate and is the wrong name: `apps.owner_id` references
-- `auth."user" (id)`, so a table of *owners* carrying an `id` of its own is one every reader would
-- take that column to point at. A profile is plainly a thing about a person rather than the
-- person, which is what makes it safe to put beside them.
--
-- A field here that has a platform default should be nullable and mean it when null, rather than
-- storing a copy: a stored default is a snapshot taken the day somebody signed up, and moving it
-- afterwards reaches nobody who is already here.

CREATE TABLE nibrun.profiles (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id   text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE,
  created_at timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_owner_id_key UNIQUE (owner_id)
);

COMMENT ON TABLE nibrun.profiles IS 'What nibrun holds about an owner, as against what better-auth holds.';
COMMENT ON COLUMN nibrun.profiles.owner_id IS $c$@type import('@repo/protocol').OwnerId$c$;
COMMENT ON COLUMN nibrun.profiles.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.profiles
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();

-- A trigger rather than a hook in the api, because this is the one way of writing the row that
-- cannot be missed: it runs in the transaction that inserts the user, so there is no moment where
-- one exists without the other and no crash that leaves a signed-up person half made. It also
-- covers every path a user arrives by — better-auth's own admin calls, a seed, a test fixture —
-- where an application hook covers only the one it is wired into.
--
-- `DO NOTHING` so that a row somebody made first is not an error: this asserts the row exists,
-- which is a weaker and more useful thing to say than that this statement created it.
--
-- Nothing is backfilled and nothing here writes to a table that already has rows. Whatever reads a
-- profile joins it, so an owner from before this migration has none and reads exactly like one
-- whose fields are all still unset — which is what makes the trigger an improvement rather than
-- something the reads have to wait for.
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
