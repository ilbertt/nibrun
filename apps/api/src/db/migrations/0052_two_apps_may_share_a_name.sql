-- `0050` made a name unique among an owner's apps so that it could stand for one the way the slug
-- does. It does not have to: the api names an app by its id, and which app a name means is the
-- client's to settle — the dashboard has the id from the URL, and the CLI asks when a name
-- matches more than one. So an owner may call ten apps pocketbase, and the index goes.

DROP INDEX nibrun.apps_owner_id_name_key;
