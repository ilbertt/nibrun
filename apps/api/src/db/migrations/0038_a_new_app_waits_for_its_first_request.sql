-- `0035` defaulted this to `always`, which is what every app had before an app could sleep at all.
-- Now that one can, waiting to be asked is the better default: an app nobody has visited holds no
-- memory, and the first visitor after a quiet spell pays a snapshot restore rather than a boot.
--
-- The default only reaches rows inserted after it. Every app already here keeps what it has —
-- changing how a running app comes up is its owner's to ask for, not a migration's to do.
ALTER TABLE nibrun.apps
  ALTER COLUMN activation SET DEFAULT 'on-request';
