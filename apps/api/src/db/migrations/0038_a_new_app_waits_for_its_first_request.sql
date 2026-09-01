-- `0035` defaulted this to `always`, which is what every app had before an app could sleep at all.
-- Now that one can, waiting to be asked is the better default: an app nobody has visited holds no
-- memory, and the first visitor after a quiet spell pays a snapshot restore rather than a boot.
--
-- Five minutes rather than the fifteen `0035` chose, for the same reason the activation moves: at
-- fifteen an app visited even four times an hour never sleeps at all, so the default collected on
-- almost none of what the feature saves. What a shorter wait costs is a restore, and a restore is
-- ~114 ms — small enough that the wait is worth spending against memory rather than hoarding.
--
-- The defaults only reach rows inserted after them. Every app already here keeps what it has —
-- changing how a running app comes up is its owner's to ask for, not a migration's to do.
ALTER TABLE nibrun.apps
  ALTER COLUMN activation SET DEFAULT 'on-request',
  ALTER COLUMN idle_timeout_ms SET DEFAULT 300000;
