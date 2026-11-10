import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

MAX_REPORT_AGE_SECONDS = 60
RESOURCES = ("instances", "volumes", "checkpoints", "exports")


def assert_empty_host(state_directory):
    desired_bytes = (state_directory / "desired.json").read_bytes()
    desired = json.loads(desired_bytes)
    reported = json.loads((state_directory / "reported.json").read_bytes())
    for name, document in (("desired", desired), ("reported", reported)):
        for resource in RESOURCES:
            if document.get(resource) != []:
                raise SystemExit(f"Refusing storage reset: {name} {resource} is not empty.")
    if reported.get("acceptedDigest") != hashlib.sha256(desired_bytes).hexdigest():
        raise SystemExit("Refusing storage reset: the engine has not accepted the empty desired state.")
    if reported.get("state") not in ("ready", "draining"):
        raise SystemExit("Refusing storage reset: the engine is not healthy.")
    reported_at = datetime.fromisoformat(reported["reportedAt"].replace("Z", "+00:00"))
    age = (datetime.now(timezone.utc) - reported_at).total_seconds()
    if not 0 <= age <= MAX_REPORT_AGE_SECONDS:
        raise SystemExit("Refusing storage reset: the engine report is stale.")
    print("The engine has acknowledged an empty host.")


if __name__ == "__main__":
    assert_empty_host(Path(sys.argv[1]))
