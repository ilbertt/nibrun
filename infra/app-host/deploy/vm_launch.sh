#!/bin/bash
# Which Firecracker a start of nibrun-vm@%i is.
#
# The two are not one process with a flag. `--config-file` boots a fresh microVM
# the moment it is read, and a restore has to reach a process that has configured
# nothing at all — `PUT /snapshot/load` is refused by a Firecracker that has been
# given any resource but a logger. So the choice is made before exec, here,
# rather than by the agent after the fact.
#
# A launcher and not a second template unit, because the unit name is what the
# agent enumerates, stops and reads a guest's console out of: two of them would
# double every one of those questions to answer none of them better.
set -euo pipefail

instance=$1

FIRECRACKER=/opt/nibrun/bin/firecracker/firecracker
API_SOCK="/run/nibrun/vm-${instance}.sock"
CONFIG_FILE="/var/lib/nibrun/vm/${instance}/firecracker.json"
# AGENT_VM_SNAPSHOT_DIR's default in apps/agent. Nothing compares the two.
SNAPSHOT_DIR="/data/nibrun-vm/${instance}"

# The stamp is the marker, and taking it is what makes a restore happen at most
# once. The agent writes it only after the microVM is down and the two files
# beside it are complete, so its presence is the whole guarantee that there is
# something to load; removing it here means an agent that dies between this exec
# and the load leaves a microVM that cold-boots off its disk, rather than one
# that resumes into a guest whose disk has since moved on without it.
#
# At most once is also a security invariant, so this `rm` is not tidying up. The
# guest kernel has CONFIG_VMGENID=y and Linux reseeds its own CRNG on a restore,
# but nothing reseeds the PRNG state already sitting in tenant memory — an
# OpenSSL RAND buffer, a runtime's generator, a nonce already drawn. Loading one
# snapshot into two microVMs is the same randomness live in both, which is key
# reuse that nothing shows up as. Anyone turning this into a reusable warm-start
# template is trading that away, and should be doing it on purpose.
if [ -f "$SNAPSHOT_DIR/stamp.json" ]; then
  rm -f "$SNAPSHOT_DIR/stamp.json"
  exec "$FIRECRACKER" --api-sock "$API_SOCK"
fi

exec "$FIRECRACKER" --api-sock "$API_SOCK" --config-file "$CONFIG_FILE"
