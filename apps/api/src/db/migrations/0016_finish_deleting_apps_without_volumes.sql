-- Apps left saying `deleting` forever, from before a deletion could finish itself.
--
-- Reaching `deleted` takes a host saying the filesystem is gone, and a host is only ever told
-- about a filesystem the app has been deployed onto at least once. An app deployed no times was
-- therefore waiting on a sentence nobody would ever speak — and having never had a filesystem,
-- has nothing left on any host to wait for.
--
-- Not a state a sweep should keep checking: from here on the api finishes these at the moment it
-- is asked to delete them, so this is the one-off that clears what is already stuck.

UPDATE nibrun.apps a
   SET state = 'deleted'
 WHERE a.state = 'deleting'
   AND NOT EXISTS (SELECT 1 FROM nibrun.desired_volumes v WHERE v.app_id = a.id);
