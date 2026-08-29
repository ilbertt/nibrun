-- What each app was spending when a host last measured it, beside how full its filesystem was.
--
-- `volume_usage` becomes `app_usage` rather than gaining a table beside it: both readings are
-- taken in the same pass, over the same connection into the same guest, and they live and die
-- with the same app. Two tables would be two joins and two deletes to say one thing.
--
-- Each family keeps its own `measured_at` because each is its own exchange, and a guest whose
-- image predates one verb answers the other — which is what every host looks like between an
-- agent release and the guest image release behind it. One shared moment would have to claim a
-- reading was taken when the reading beside it was, which for the older half is a lie about the
-- only thing that says what a reading is worth. That is also why every measured column is now
-- nullable: a row exists once anything has been measured, not once everything has.
--
-- `cpu_share` is a rate where everything else here is a level, so it is the one column that can
-- be null while its own `measured_at` is not: a share is the difference between two readings, and
-- the first one taken after an agent starts has no reading behind it.

ALTER TABLE nibrun.volume_usage RENAME TO app_usage;
ALTER TABLE nibrun.app_usage RENAME COLUMN total_bytes TO volume_total_bytes;
ALTER TABLE nibrun.app_usage RENAME COLUMN used_bytes TO volume_used_bytes;
ALTER TABLE nibrun.app_usage RENAME COLUMN measured_at TO volume_measured_at;
ALTER TABLE nibrun.app_usage RENAME CONSTRAINT volume_usage_app_id_key TO app_usage_app_id_key;
ALTER TABLE nibrun.app_usage RENAME CONSTRAINT volume_usage_pkey TO app_usage_pkey;

ALTER TABLE nibrun.app_usage
  ALTER COLUMN volume_total_bytes DROP NOT NULL,
  ALTER COLUMN volume_used_bytes DROP NOT NULL,
  ALTER COLUMN volume_measured_at DROP NOT NULL,
  ADD COLUMN memory_total_bytes bigint,
  ADD COLUMN memory_used_bytes bigint,
  ADD COLUMN cpu_share double precision,
  ADD COLUMN compute_measured_at timestamptz,
  -- A half-written reading is worse than none: whoever reads one of these columns reads all
  -- three, so the schema is what makes that safe rather than every caller remembering to check.
  ADD CONSTRAINT app_usage_volume_whole
    CHECK (num_nonnulls(volume_total_bytes, volume_used_bytes, volume_measured_at) IN (0, 3)),
  ADD CONSTRAINT app_usage_compute_whole
    CHECK (num_nonnulls(memory_total_bytes, memory_used_bytes, compute_measured_at) IN (0, 3)),
  -- Every vCPU the app was given, busy, is 1. Two saturated vCPUs is not 2.
  ADD CONSTRAINT app_usage_cpu_share_is_a_share CHECK (cpu_share BETWEEN 0 AND 1);

COMMENT ON TABLE nibrun.app_usage IS 'The last readings a host took of an app. No row until one has been taken.';
COMMENT ON COLUMN nibrun.app_usage.volume_total_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.app_usage.volume_used_bytes IS 'A Postgres bigint, so it arrives as a string; the wire type is a number.';
COMMENT ON COLUMN nibrun.app_usage.volume_measured_at IS 'When the guest was asked how full its filesystem was, not when the report carrying it arrived.';
COMMENT ON COLUMN nibrun.app_usage.memory_total_bytes IS 'MemTotal, which reads under the memory the app was allocated. A bigint, so it arrives as a string.';
COMMENT ON COLUMN nibrun.app_usage.memory_used_bytes IS 'MemTotal less MemAvailable, so cache the kernel would hand back is not counted as spent.';
COMMENT ON COLUMN nibrun.app_usage.cpu_share IS 'The mean share of the vCPUs spent computing over the interval ending at compute_measured_at.';
COMMENT ON COLUMN nibrun.app_usage.compute_measured_at IS 'When the guest was asked what it was spending, not when the report carrying it arrived.';
