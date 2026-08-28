-- How full each app's filesystem was when a host last measured it, so the question is one an
-- operator can ask in SQL rather than one only a dashboard knows how to ask.
--
-- A table of its own rather than columns on `apps`, because a reading arrives on every host
-- report and `apps` carries a `set_updated_at` trigger: written there, every report would look
-- to an owner like somebody had just changed their app.
--
-- One row per app, because an app has one filesystem and the two never differ — the same reason
-- `desired_volumes` is a view over apps rather than a table in its own right. Unique on `app_id`
-- rather than keyed on it, so the row keeps the uuidv7 identity and the two timestamps every
-- other table here carries.
--
-- `total_bytes` is stored beside `used_bytes` even though the api sizes every volume the same,
-- because what a filesystem holds is not what its device is: ext4 spends part of the device
-- describing the rest, and a share computed against the device would be wrong by that much
-- forever.

CREATE TABLE nibrun.volume_usage (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  app_id      uuid NOT NULL REFERENCES nibrun.apps (id) ON DELETE CASCADE,
  total_bytes bigint NOT NULL,
  used_bytes  bigint NOT NULL,
  measured_at timestamptz NOT NULL,
  created_at  timestamptz GENERATED ALWAYS AS (uuid_extract_timestamp(id)) VIRTUAL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT volume_usage_app_id_key UNIQUE (app_id)
);

COMMENT ON TABLE nibrun.volume_usage IS 'The last reading a host took of an app filesystem. No row until one has been taken.';
COMMENT ON COLUMN nibrun.volume_usage.app_id IS $c$@type import('@repo/protocol').AppId$c$;
COMMENT ON COLUMN nibrun.volume_usage.total_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.volume_usage.used_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.volume_usage.measured_at IS 'When the guest was asked, which is not when the report carrying it arrived.';
COMMENT ON COLUMN nibrun.volume_usage.created_at IS 'Derived from the uuidv7 id; the moment the row was created. @notNull';

CREATE TRIGGER set_updated_at BEFORE UPDATE ON nibrun.volume_usage
  FOR EACH ROW EXECUTE FUNCTION nibrun.set_updated_at();
