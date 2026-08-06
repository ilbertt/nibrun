-- An app its owner deleted and a host confirmed gone is one they cannot name again, so every
-- statement resolving an app for its owner reads this rather than the table. The predicate lives
-- in one place, and a statement naming `nibrun.apps` instead is visibly reaching past it — which
-- is what the fleet's own reads and the writes that move an app between states do on purpose.
--
-- Columns rather than `*`: a view built from `*` fixes its shape when it is created, so a column
-- added to `apps` later would go missing here rather than appear.
CREATE VIEW nibrun.live_apps AS
  SELECT id, owner_id, slug, state, created_at, updated_at
  FROM nibrun.apps
  WHERE state <> 'deleted';
