-- Which pinned view of the volume the bundle was read from.
--
-- The host cuts it while the tenant's filesystem is frozen and deletes it the moment the read is
-- done, because one left behind stops storage reclamation for every tenant on that host. So this
-- records which moment the bundle is of rather than handing anyone something still there to open.
--
-- No foreign key, and no checkpoints table for one to point at: a checkpoint belongs to the host,
-- is named by the host, and has never had a row this end. Nullable for the same reason every
-- other host-reported column is — an export that failed before the cut has no answer to give, and
-- during a rollout an agent that predates this reports without one.

ALTER TABLE nibrun.exports ADD COLUMN checkpoint_id text;

COMMENT ON COLUMN nibrun.exports.checkpoint_id IS $c$The pinned view the bundle was read from, named by the host that cut it. @type import('@repo/protocol').CheckpointId$c$;
