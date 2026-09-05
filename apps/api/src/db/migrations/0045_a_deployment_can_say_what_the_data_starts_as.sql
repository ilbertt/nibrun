-- A deployment can name the archive the app's filesystem is created from, and the app records the
-- moment it stopped being creatable.
--
-- On the deployment rather than a bespoke endpoint: a deployment is already the operation resource
-- for a discrete recorded change to what this app runs, and it already stops the old microVM
-- before starting the new one — which is the window a format needs. Not on `app_configs`, which
-- carries standing configuration: this is a thing that happens once, not a setting.
--
-- `data_initialized_at` is what makes it once. A host formats a volume exactly once and skips a
-- device that already carries a filesystem, so a second archive would be read and thrown away with
-- nothing said about it; this is what turns that into a refused request. Stamped from the first
-- `ready` a host reports for the volume, and never rewritten — which is also why an app deployed
-- before any of this existed can never be seeded: its filesystem is already there.
--
-- Null for every app that has never had a host say so. That includes an app created after this and
-- not yet deployed, which is exactly the one an archive may still be given to.

ALTER TABLE nibrun.apps
  ADD COLUMN data_initialized_at timestamptz;

COMMENT ON COLUMN nibrun.apps.data_initialized_at IS 'When a host first reported this app''s filesystem ready. Its presence is what makes the data no longer creatable.';

ALTER TABLE nibrun.deployments
  ADD COLUMN reset_data_from_import_id uuid REFERENCES nibrun.imports (id) ON DELETE RESTRICT;

COMMENT ON COLUMN nibrun.deployments.reset_data_from_import_id IS $c$The uploaded archive this release's filesystem is created from, where one was named. @type import('@repo/protocol').ImportId$c$;

-- Not redundant with the primary key: this is the index the imports foreign key's own check reads,
-- and without it deleting an import seq-scans every deployment.
CREATE INDEX deployments_reset_data_from_idx ON nibrun.deployments (reset_data_from_import_id)
  WHERE reset_data_from_import_id IS NOT NULL;

-- Every statement resolving an app for its owner reads `live_apps` rather than the table, and
-- refusing a deployment that names an archive is one of them.
--
-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at, activation, idle_timeout_ms,
         data_initialized_at
  FROM nibrun.apps
  WHERE state <> 'deleted';

-- The view a host reads its volumes out of, now carrying what the filesystem should be created
-- holding. Read from the app's newest release rather than joined through `desired_deployments`,
-- because a volume is desired for an app whose every deployment failed and that view drops none of
-- those — but it is one row per app either way, so the seed is that row's or nothing.
--
-- `data_initialized_at IS NULL` inside the lateral, so the archive stops being sent the moment a
-- host has said the filesystem exists. The host would ignore it anyway; not sending it is what
-- keeps a gibibyte off the wire and out of a host's disk on every reconcile pass thereafter.
--
-- `digest IS NOT NULL` for the same reason it guards every other read of an upload: a row without
-- one names bytes that may never arrive. `object_key IS NOT NULL` is the other end of the same
-- sentence — the api removes the object once the archive can no longer be used — and the two
-- conditions cannot both matter at once, which is the point: neither alone is relied on.
--
-- Appended last, because CREATE OR REPLACE VIEW may only add columns at the end.
CREATE OR REPLACE VIEW nibrun.desired_volumes AS
  SELECT a.id AS app_id,
         a.state,
         seed.digest AS seed_digest,
         seed.size_bytes AS seed_size_bytes,
         seed.object_key AS seed_object_key,
         seed.original_file_name AS seed_original_file_name
  FROM nibrun.apps a
  LEFT JOIN LATERAL (
    SELECT im.digest, im.size_bytes, im.object_key, im.original_file_name
    FROM nibrun.deployments d
    JOIN nibrun.imports im ON im.id = d.reset_data_from_import_id
    WHERE d.app_id = a.id
      AND d.state <> 'superseded'
      AND im.digest IS NOT NULL
      AND im.object_key IS NOT NULL
      AND a.data_initialized_at IS NULL
    ORDER BY d.id DESC
    LIMIT 1
  ) seed ON true
  WHERE a.state <> 'deleted'
    AND EXISTS (SELECT 1 FROM nibrun.deployments d WHERE d.app_id = a.id);

-- A lateral join carries none of the column comments its columns pass through, so the types the
-- rest of this schema is read through are said again here rather than degrading to `text` at the
-- one place a host is told what to create a filesystem from.
COMMENT ON COLUMN nibrun.desired_volumes.seed_digest IS $c$@type import('@repo/protocol').Sha256Digest$c$;
COMMENT ON COLUMN nibrun.desired_volumes.seed_size_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.desired_volumes.seed_object_key IS $c$@type import('@repo/protocol').ObjectKey$c$;
COMMENT ON COLUMN nibrun.desired_volumes.seed_original_file_name IS $c$@type import('@repo/protocol').Filename$c$;
