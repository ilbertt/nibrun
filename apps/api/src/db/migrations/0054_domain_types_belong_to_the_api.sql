COMMENT ON COLUMN nibrun.apps.owner_id IS $c$@type import('@repo/api/domain').OwnerId$c$;

COMMENT ON COLUMN nibrun.apps.slug IS $c$@type import('@repo/api/domain').DnsLabel$c$;

COMMENT ON COLUMN nibrun.apps.state IS $c$@type import('@repo/api/domain').AppState$c$;

COMMENT ON COLUMN nibrun.artifacts.id IS $c$@type import('@repo/api/domain').ArtifactId$c$;

COMMENT ON COLUMN nibrun.deployments.artifact_id IS $c$@type import('@repo/api/domain').ArtifactId$c$;

COMMENT ON COLUMN nibrun.deployments.state IS $c$@type import('@repo/api/domain').DeploymentState$c$;

COMMENT ON COLUMN nibrun.exports.artifact_id IS $c$@type import('@repo/api/domain').ArtifactId$c$;

COMMENT ON COLUMN nibrun.app_hostnames.state IS $c$@type import('@repo/api/domain').AppHostnameState$c$;

COMMENT ON COLUMN nibrun.apps.activation IS $c$@type import('@repo/api/domain').AppActivation$c$;

COMMENT ON COLUMN nibrun.profiles.owner_id IS $c$@type import('@repo/api/domain').OwnerId$c$;

COMMENT ON COLUMN nibrun.imports.id IS $c$@type import('@repo/api/domain').ImportId$c$;

COMMENT ON COLUMN nibrun.deployments.initial_data_import_id IS $c$The uploaded archive this release's filesystem is created from, where one was named. @type import('@repo/api/domain').ImportId$c$;

COMMENT ON COLUMN nibrun.apps.name IS $c$What its owner calls the app, and names it by. @type import('@repo/api/domain').AppName$c$;
