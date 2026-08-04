-- Attach as a BEFORE UPDATE trigger on any table with an updated_at column to
-- keep that column current on every row change.

CREATE FUNCTION nibrun.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
