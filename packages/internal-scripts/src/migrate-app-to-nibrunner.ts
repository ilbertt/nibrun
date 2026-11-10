import { parseArgs } from 'node:util';
import { $ } from 'bun';
import { aws } from '#shared/aws.ts';
import { repoRoot } from '#shared/paths.ts';
import { sendCommand, waitForInvocation } from '#shared/ssm.ts';

type App = {
  id: string;
  owner: string;
  slug: string;
  hostname: string;
  deployment: string;
  host: string;
  artifact: string;
  artifactDigest: string;
  artifactBytes: number;
  artifactKey: string;
  config: string;
  state: 'active' | 'suspended';
};
type Source = { host: string; bucket: string; bytes: number };
type Destination = { host: string; bucket: string };
type Copy = { digest: string; bytes: number; compressedBytes: number };
const MIGRATION_POLL_MS = 100;
const MIGRATION_COMMAND_TIMEOUT_MS = 30_000;
const CUTOVER_BUDGET_MS = 9_000;
const HTTP_NOT_FOUND = 404;
let cutoverDeadline = Number.POSITIVE_INFINITY;

function remainingCommandTime(): number {
  const remaining = cutoverDeadline - Date.now();
  if (remaining <= 0) {
    throw new Error('Migration cutover budget exceeded');
  }
  return Math.min(remaining, MIGRATION_COMMAND_TIMEOUT_MS);
}

const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    source: { type: 'string' },
    target: { type: 'string' },
    control: { type: 'string' },
  },
});

function argument({ name, pattern }: { name: keyof typeof values; pattern: RegExp }): string {
  const value = values[name];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Invalid --${name}`);
  }
  return value;
}

const appId = argument({ name: 'app', pattern: /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/ });
const instancePattern = /^i-[a-f0-9]{17}$/;
const sourceInstance = argument({ name: 'source', pattern: instancePattern });
const targetInstance = argument({ name: 'target', pattern: instancePattern });
const controlInstance = argument({ name: 'control', pattern: instancePattern });
const instances = [sourceInstance, targetInstance, controlInstance];
if (new Set(instances).size !== instances.length) {
  throw new Error('Source, target and control instances must differ');
}
const transfer = `migrations/${appId}/${crypto.randomUUID()}.tar.gz`;

async function remote({ instance, script }: { instance: string; script: string }): Promise<string> {
  remainingCommandTime();
  const commandId = await sendCommand({
    instanceIds: [instance],
    script: `set -eu\numask 077\n${script}`,
    comment: `Migrate app ${appId}`,
  });
  console.log(`[${instance}] ${commandId}`);
  const result = await waitForInvocation({
    commandId,
    instanceId: instance,
    pollIntervalMs: MIGRATION_POLL_MS,
    timeoutMs: Math.max(1, Math.min(MIGRATION_COMMAND_TIMEOUT_MS, cutoverDeadline - Date.now())),
  });
  if (result?.Status !== 'Success') {
    await aws(['ssm', 'cancel-command', '--command-id', commandId, '--instance-ids', instance])
      .nothrow()
      .quiet();
    throw new Error(`Migration stopped: ${result?.StandardErrorContent || result?.Status}`);
  }
  return result.StandardOutputContent.trim();
}

function lastJson<T>(output: string): T {
  const line = output.split('\n').at(-1);
  if (!line) {
    throw new Error('Missing remote result');
  }
  return JSON.parse(line) as T;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sql(statement: string): Promise<string> {
  return remote({
    instance: controlInstance,
    script: `docker exec -i postgres-db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -qAt -v ON_ERROR_STOP=1' <<'MIGRATION_SQL'\n${statement}\nMIGRATION_SQL`,
  });
}

function cli(args: string[]): Promise<string> {
  remainingCommandTime();
  return runCli(args);
}

function runCli(args: string[]): Promise<string> {
  return $`bun run --filter @repo/cli nib ${args} --json`.cwd(repoRoot).quiet().text();
}

async function readApp(): Promise<App> {
  const result = await sql(`BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT json_build_object('id',a.id,'owner',a.owner_id,'slug',a.slug,
  'hostname',(SELECT hostname FROM nibrun.app_hostnames WHERE app_id=a.id AND kind='platform' AND state='active'),
  'deployment',d.id,'host',d.host_id,'artifact',d.artifact_id,'config',d.config_id,'state',a.state,
  'artifactDigest',ar.digest,'artifactBytes',ar.size_bytes,'artifactKey',ar.object_key)
FROM nibrun.live_apps a
JOIN nibrun.latest_app_deployments latest ON latest.app_id=a.id
JOIN nibrun.deployments d ON d.id=latest.deployment_id
JOIN nibrun.app_configs c ON c.id=d.config_id
JOIN nibrun.artifacts ar ON ar.id=d.artifact_id
WHERE a.id=${literal(appId)} AND a.state IN ('active','suspended') AND a.data_initialized_at IS NOT NULL
  AND a.volume_storage_migration_state IS DISTINCT FROM 'pending'
  AND NOT c.has_extra_public_port AND c.volume_storage_endpoint IS NULL
  AND d.state IN ('running','stopped');
COMMIT;`);
  const app = lastJson<App>(result);
  if (app.id !== appId) {
    throw new Error('App identity mismatch');
  }
  await cli(['apps', 'status', '--app', app.slug]);
  return app;
}

async function verifyLegacyForwarding(app: App): Promise<void> {
  const domain = app.hostname.slice(app.hostname.indexOf('.') + 1);
  const response = await fetch(`https://migration-check-${crypto.randomUUID()}.${domain}/`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(MIGRATION_COMMAND_TIMEOUT_MS),
  });
  await response.arrayBuffer();
  if (
    response.status !== HTTP_NOT_FOUND ||
    response.headers.get('via')?.includes('1.1 nibrun-legacy') !== true
  ) {
    throw new Error('Legacy ingress forwarding must be deployed before migrating apps');
  }
}

async function inspectSource(app: App): Promise<Source> {
  return lastJson<Source>(
    await remote({
      instance: sourceInstance,
      script: `python3 - <<'PY'
import json,pathlib,shlex,shutil,subprocess
app=${JSON.stringify(appId)}
assert all(shutil.which(tool) for tool in ['dmsetup','losetup','mount','umount','e2fsck','tar'])
d=json.loads(pathlib.Path('/var/lib/nibrun/desired-state.json').read_text())
i=next(i for i in d['instances'] if i['appId']==app)
assert d['hostId']==${JSON.stringify(app.host)} and i['deploymentId']==${JSON.stringify(app.deployment)}
p=pathlib.Path('/mnt/zerofs/.nbd')/app
assert p.is_file() and not p.is_symlink()
subprocess.run(['modprobe','dm_snapshot'],check=True)
env=dict(line.split('=',1) for line in pathlib.Path('/etc/nibrun/agent.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
print(json.dumps({'host':d['hostId'],'bucket':shlex.split(env['AGENT_EXPORT_BUCKET'])[0],'bytes':p.stat().st_size}))
PY`,
    }),
  );
}

async function inspectTarget(app: App): Promise<Destination> {
  return lastJson<Destination>(
    await remote({
      instance: targetInstance,
      script: `python3 - <<'PY'
import json,os,pathlib,shlex,subprocess,tempfile
app=${JSON.stringify(appId)}
d=json.loads(pathlib.Path('/var/lib/nibrunner/desired.json').read_text())
assert not any(v['appId']==app for v in d['volumes'])
assert not any(i['appId']==app for i in d['instances'])
assert not (pathlib.Path('/mnt/zerofs/.nbd')/app).exists()
assert os.path.ismount('/mnt/zerofs')
subprocess.run(['systemctl','is-active','--quiet','nibrunnerd.service','nibrunner-zerofs.service','nibrun-nibrunner-bridge.service'],check=True)
env=dict(line.split('=',1) for line in pathlib.Path('/etc/nibrunner/bridge.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
os.environ['AWS_DEFAULT_REGION']=shlex.split(env['AGENT_AWS_REGION'])[0]
store=pathlib.Path('/var/lib/nibrunner/artifact-store')
store.mkdir(parents=True,exist_ok=True,mode=0o700)
artifact=store/${JSON.stringify(app.artifactDigest)}
if not artifact.is_file():
 with tempfile.TemporaryDirectory(prefix='.migration-',dir=store) as directory:
  temporary=pathlib.Path(directory)/'artifact'
  subprocess.run(['aws','s3','cp','--only-show-errors','s3://'+shlex.split(env['AGENT_ARTIFACT_BUCKET'])[0]+'/'+${JSON.stringify(app.artifactKey)},str(temporary)],check=True)
  assert temporary.stat().st_size==${app.artifactBytes}
  assert subprocess.check_output(['sha256sum',str(temporary)],text=True).split()[0]==${JSON.stringify(app.artifactDigest)}
  os.replace(temporary,artifact)
assert artifact.stat().st_size==${app.artifactBytes} and not artifact.is_symlink()
assert subprocess.check_output(['sha256sum',str(artifact)],text=True).split()[0]==${JSON.stringify(app.artifactDigest)}
print(json.dumps({'host':d['hostId'],'bucket':shlex.split(env['AGENT_IMPORT_BUCKET'])[0]}))
PY`,
    }),
  );
}

async function copySource({ app, source }: { app: App; source: Source }): Promise<Copy> {
  return lastJson<Copy>(
    await remote({
      instance: sourceInstance,
      script: `set -a
. /etc/zerofs/zerofs.env
set +a
python3 - <<'PY'
import hashlib,json,os,pathlib,subprocess,tempfile,time,uuid
app=${JSON.stringify(appId)}
for attempt in range(60):
 d=json.loads(pathlib.Path('/var/lib/nibrun/desired-state.json').read_text())
 i=next(i for i in d['instances'] if i['appId']==app)
 assert d['hostId']==${JSON.stringify(source.host)} and i['deploymentId']==${JSON.stringify(app.deployment)}
 unit=subprocess.check_output(['systemctl','show','nibrun-vm@'+app+'.service','--property=ActiveState,MainPID,ControlPID'],text=True)
 properties=dict(line.split('=',1) for line in unit.splitlines())
 if i['desiredState']=='stopped' and properties['ActiveState'] in ['inactive','failed'] and properties['MainPID']=='0' and properties['ControlPID']=='0':break
 time.sleep(1)
else:raise RuntimeError('Source VM did not stop')
slot=json.loads(pathlib.Path('/var/lib/nibrun/slots.json').read_text())[app]
assert isinstance(slot,int) and slot>=0
subprocess.run(['blockdev','--flushbufs','/dev/nbd'+str(slot)],check=True)
image=pathlib.Path('/mnt/zerofs/.nbd')/app
assert image.stat().st_size==${source.bytes}
modified=image.stat().st_mtime_ns
directory=pathlib.Path('/var/lib/nibrun/migrations')/app
directory.mkdir(parents=True,exist_ok=True,mode=0o700)
archive=directory/${JSON.stringify(transfer.split('/').at(-1))}
device='/dev/nbd'+str(slot)
assert int(subprocess.check_output(['blockdev','--getsize64',device],text=True))==${source.bytes}
with open(device,'rb') as origin, image.open('rb') as original:
 origin.seek(1128)
 original.seek(1128)
 assert origin.read(16)==original.read(16), 'Source device identity mismatch'
with image.open('rb') as original:header=hashlib.sha256(original.read(2048)).hexdigest()
with tempfile.TemporaryDirectory(prefix='migration-snapshot-',dir=directory) as work:
 work=pathlib.Path(work)
 cow=work/'cow'
 with cow.open('xb') as output:output.truncate(256*1024*1024)
 loop=subprocess.check_output(['losetup','--find','--show',str(cow)],text=True).strip()
 name='nibrun-migration-'+uuid.uuid4().hex
 mapper='/dev/mapper/'+name
 try:
  subprocess.run(['dmsetup','create',name,'--table',f'0 {${source.bytes}//512} snapshot {device} {loop} N 8'],check=True)
  try:
   recovery=subprocess.run(['e2fsck','-p','-E','journal_only',mapper],capture_output=True,text=True)
   assert recovery.returncode in [0,1], 'Snapshot journal recovery failed'
   mounted=work/'mounted'
   mounted.mkdir()
   subprocess.run(['mount','-t','ext4','-o','ro,noload',mapper,str(mounted)],check=True)
   try:
    assert not any((mounted/'lost+found').iterdir()), 'Source recovery directory is not empty'
    with archive.open('xb') as output:
     subprocess.run(['tar','--sparse','--acls','--xattrs','--numeric-owner','--exclude=./lost+found','-czf','-','-C',str(mounted),'.'],stdout=output,check=True,timeout=10)
     output.flush()
     os.fsync(output.fileno())
   finally:subprocess.run(['umount',str(mounted)],check=True)
  finally:subprocess.run(['dmsetup','remove','--deferred',name],check=True)
 finally:subprocess.run(['losetup','--detach',loop],check=True)
with image.open('rb') as original:assert hashlib.sha256(original.read(2048)).hexdigest()==header, 'Source metadata changed'
assert image.stat().st_mtime_ns==modified, 'Source volume changed during copy'
properties=dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show','nibrun-vm@'+app+'.service','--property=ActiveState,MainPID,ControlPID'],text=True).splitlines())
assert properties['ActiveState'] in ['inactive','failed'] and properties['MainPID']=='0' and properties['ControlPID']=='0'
digest=subprocess.check_output(['sha256sum',str(archive)],text=True).split()[0]
subprocess.run(['aws','s3','cp','--only-show-errors',str(archive),${JSON.stringify(`s3://${source.bucket}/exports/${transfer}`)}],check=True)
print(json.dumps({'digest':digest,'bytes':image.stat().st_size,'compressedBytes':archive.stat().st_size}))
PY`,
    }),
  );
}

async function restoreTarget({ target, copy }: { target: Destination; copy: Copy }): Promise<void> {
  await remote({
    instance: targetInstance,
    script: `set -a
. /etc/nibrunner/host.env
set +a
python3 - <<'PY'
import hashlib,json,os,pathlib,stat,subprocess,tempfile
from itertools import chain
def manifest(root):
 entries={}
 for path in chain([root],root.rglob('*')):
  info=path.lstat()
  if stat.S_ISLNK(info.st_mode):
   contents=('symlink',os.readlink(path))
  elif stat.S_ISDIR(info.st_mode):
   contents=('directory',None)
  elif stat.S_ISREG(info.st_mode):
   digest=hashlib.sha256()
   with path.open('rb') as stream:
    while chunk:=stream.read(1024*1024):digest.update(chunk)
   contents=('file',digest.hexdigest())
  else:raise RuntimeError('Unsupported filesystem entry')
  entries[str(path.relative_to(root))]=(contents,stat.S_IMODE(info.st_mode),info.st_uid,info.st_gid,int(info.st_mtime))
 return entries
app=${JSON.stringify(appId)}
root=pathlib.Path('/mnt/zerofs/.nbd')
destination=root/app
assert os.path.ismount('/mnt/zerofs') and not destination.exists()
d=json.loads(pathlib.Path('/var/lib/nibrunner/desired.json').read_text())
assert d['hostId']==${JSON.stringify(target.host)} and not any(v['appId']==app for v in d['volumes'])
with tempfile.TemporaryDirectory(prefix='nibrun-migration-',dir='/data') as directory:
 archive=pathlib.Path(directory)/'volume.tar.gz'
 subprocess.run(['aws','s3','cp','--only-show-errors',${JSON.stringify(`s3://${target.bucket}/${transfer}`)},str(archive)],check=True)
 assert archive.stat().st_size==${copy.compressedBytes}
 assert subprocess.check_output(['sha256sum',str(archive)],text=True).split()[0]==${JSON.stringify(copy.digest)}
 layout=pathlib.Path(directory)/'layout'
 data=layout/'upper'/'app'/'data'
 data.mkdir(parents=True)
 for p in [layout,layout/'upper',data.parent]:os.chmod(p,0o755)
 subprocess.run(['bsdtar','-xpf',str(archive),'-C',str(data)],check=True)
 expected=manifest(data)
 native=root/(${JSON.stringify(`.migration-${appId}-`)}+${JSON.stringify(transfer.split('/').at(-1))})
 with native.open('xb') as image:image.truncate(${copy.bytes})
 subprocess.run(['mke2fs','-q','-F','-t','ext4','-L','nibrun-data','-E','nodiscard','-d',str(layout),str(native)],check=True)
 assert subprocess.run(['e2fsck','-fn',str(native)],capture_output=True).returncode==0, 'Destination filesystem is not clean'
 verification=pathlib.Path(directory)/'verification'
 verification.mkdir()
 result=subprocess.run(['debugfs','-R','rdump /upper/app/data '+str(verification),str(native)],capture_output=True,text=True,check=True)
 assert all(line.startswith('debugfs ') for line in result.stderr.splitlines()), 'Destination filesystem extraction failed'
 assert manifest(verification/'data')==expected, 'Destination data differs from source'
 print('File contents and metadata verified before placement')
 assert not destination.exists()
 os.link(native,destination)
 native.unlink()
 subprocess.run(['/opt/nibrunner/bin/zerofs','flush','-c','/etc/zerofs/config.toml'],check=True)
print('Volume restored and flushed')
PY`,
  });
}

async function placeDeployment({ app, target }: { app: App; target: Destination }): Promise<void> {
  const result = await sql(`BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='3s';
DO $migration$
BEGIN
  PERFORM 1 FROM nibrun.apps WHERE id=${literal(appId)} AND owner_id=${literal(app.owner)} AND state='suspended' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'App is no longer suspended'; END IF;
  PERFORM 1 FROM nibrun.latest_app_deployments WHERE app_id=${literal(appId)} AND deployment_id=${literal(app.deployment)} AND host_id=${literal(app.host)};
  IF NOT FOUND THEN RAISE EXCEPTION 'Source deployment changed'; END IF;
  PERFORM 1 FROM nibrun.deployments WHERE id=${literal(app.deployment)} AND instance_state='stopped';
  IF NOT FOUND THEN RAISE EXCEPTION 'Source stop has not been acknowledged'; END IF;
  PERFORM 1 FROM nibrun.hosts WHERE id=${literal(target.host)} AND reported_state IN ('ready','draining') AND last_seen_at>now()-interval '2 minutes' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination host is not reporting'; END IF;
  PERFORM 1 FROM nibrun.app_configs WHERE id=${literal(app.config)} AND id=(SELECT id FROM nibrun.app_configs WHERE app_id=${literal(appId)} ORDER BY id DESC LIMIT 1);
  IF NOT FOUND THEN RAISE EXCEPTION 'App configuration changed'; END IF;
  UPDATE nibrun.deployments SET state='superseded' WHERE id=${literal(app.deployment)};
  INSERT INTO nibrun.deployments (app_id,artifact_id,config_id,host_id)
  VALUES (${literal(appId)},${literal(app.artifact)},${literal(app.config)},${literal(target.host)});
END $migration$;
SELECT json_build_object('deploymentId',deployment_id,'hostId',host_id) FROM nibrun.app_hosts WHERE app_id=${literal(appId)};
COMMIT;`);
  console.log(result);
}

async function copyAndPlace({
  app,
  source,
  target,
}: {
  app: App;
  source: Source;
  target: Destination;
}): Promise<void> {
  const copy = await copySource({ app, source });
  console.log(
    `Copied app files from a ${copy.bytes}-byte volume; compressed SHA-256 ${copy.digest}`,
  );
  remainingCommandTime();
  await aws([
    's3',
    'cp',
    `s3://${source.bucket}/exports/${transfer}`,
    `s3://${target.bucket}/${transfer}`,
    '--only-show-errors',
  ]);
  await restoreTarget({ target, copy });
  await placeDeployment({ app, target });
}

const app = await readApp();
const source = await inspectSource(app);
const target = await inspectTarget(app);
if (source.host === target.host) {
  throw new Error('Source and target hosts must differ');
}
await verifyLegacyForwarding(app);
console.log(`Suspending ${app.slug}; source volume will be retained on ${source.host}`);
const stoppedAt = Date.now();
cutoverDeadline = stoppedAt + CUTOVER_BUDGET_MS;
let watchdog: ReturnType<typeof setTimeout> | undefined;
try {
  await cli(['apps', 'suspend', '--app', app.slug]);
  const { promise: expired, reject: rejectExpired } = Promise.withResolvers<never>();
  watchdog = setTimeout(
    function expire() {
      rejectExpired(new Error('Migration cutover budget exceeded'));
    },
    Math.max(0, cutoverDeadline - Date.now()),
  );
  await Promise.race([copyAndPlace({ app, source, target }), expired]);
} catch (error) {
  cutoverDeadline = 0;
  if (app.state === 'active') {
    await runCli(['apps', 'resume', '--app', app.slug]);
    console.log('App resumed after migration failure');
  }
  throw error;
} finally {
  clearTimeout(watchdog);
}
if (app.state === 'active') {
  await runCli(['apps', 'resume', '--app', app.slug]);
}
console.log(
  `Volume handoff and activation completed in ${Date.now() - stoppedAt}ms; HTTP readiness and DNS cutover remain`,
);
console.log(
  `App placed on ${target.host}; activation preserved as ${app.state}. Verify data and DNS before removing the retained source volume.`,
);
await aws(['s3', 'rm', `s3://${source.bucket}/exports/${transfer}`, '--only-show-errors']);
await aws(['s3', 'rm', `s3://${target.bucket}/${transfer}`, '--only-show-errors']);
