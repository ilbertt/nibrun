#!/bin/bash
set -euo pipefail
umask 077
exec 9>/run/nibrunner-commissioning.lock
flock -w 300 9

if [ "$(id -u)" != 0 ] || [ -e /var/lib/nibrun/host-id ] ||
  [ ! -f /var/lib/nibrunner/bridge/host-id ] || [ -L /var/lib/nibrunner ] ||
  [ -L /var/lib/nibrunner/bridge ] || [ -L /var/lib/nibrunner/bridge/host-id ]; then
  echo "refusing to reset a host without an isolated nibrunner registration" >&2
  exit 1
fi

verify_empty() {
  if findmnt -rn -o TARGET | awk '/^\/var\/lib\/nibrunner(\/|-canary-)/ { found = 1 } END { exit !found }'; then
    echo "refusing to reset mounted nibrunner data" >&2
    return 1
  fi
  if pgrep -x firecracker >/dev/null; then
    echo "refusing to reset a host with running VMMs" >&2
    return 1
  fi
  python3 - <<'PY'
import json
import pathlib
import sqlite3

root = pathlib.Path('/var/lib/nibrunner')
archives = sorted(root.parent.glob('nibrunner-canary-*'))
commissioning_host_ids = {'nibrunner-commissioning', 'nibrunner-volume-probe'}
for directory in [root, *archives]:
    if directory.is_symlink():
        raise SystemExit('Refusing to reset a symlinked state directory.')
    documents = [json.loads((directory / name).read_text()) for name in ['desired.json', 'reported.json']]
    if any(document['instances'] != [] or document['volumes'] != [] for document in documents):
        raise SystemExit('Refusing to remove nonempty nibrunner state.')
    if directory == root and documents[0]['hostId'] != documents[1]['hostId']:
        raise SystemExit('Refusing to remove state with mismatched host identities.')
    if directory != root and any(document['hostId'] not in commissioning_host_ids for document in documents):
        raise SystemExit('Refusing to remove an archive that is not commissioning state.')
    connection = sqlite3.connect(f'file:{directory}/state.db?mode=ro', uri=True)
    if connection.execute('SELECT count(*) FROM instances').fetchone()[0] != 0:
        raise SystemExit('Refusing to remove a database containing instances.')
    connection.close()
PY
}

verify_empty
systemctl stop nibrun-nibrunner-bridge.service nibrunnerd.service
if ! verify_empty; then
  systemctl start nibrunnerd.service nibrun-nibrunner-bridge.service
  exit 1
fi
systemctl disable nibrun-nibrunner-bridge.service nibrunnerd.service

find /var/lib/nibrunner -mindepth 1 -maxdepth 1 ! -name bridge -exec rm -rf -- {} +
find /var/lib/nibrunner/bridge -mindepth 1 -maxdepth 1 ! -name host-id -exec rm -rf -- {} +
find /var/lib -mindepth 1 -maxdepth 1 -type d -name 'nibrunner-canary-*' -exec rm -rf -- {} +
rm -rf -- /etc/nibrunner /opt/nibrun/nibrunner-host /run/nibrunner \
  /etc/systemd/system/nibrunnerd.service /etc/systemd/system/nibrunnerd.service.d \
  /etc/systemd/system/nibrun-nibrunner-bridge.service
rm -f -- /usr/local/bin/nibrunnerd \
  /tmp/nibrunner-invalid-tls.log /tmp/nibrunner-canary-refusal.log /tmp/nibrunner-data-stat
systemctl daemon-reload
echo "Removed empty commissioning state; persisted registration retained for CI deployment."
