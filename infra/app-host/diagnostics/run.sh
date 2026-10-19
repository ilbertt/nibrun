#!/bin/sh
set -eu
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
output_dir=${1:-$(mktemp -d /tmp/nibrun-zerofs-memory.XXXXXX)}
mkdir -p "$output_dir"
if test -f "$output_dir/run.json"; then
  echo 'Use a fresh output directory to preserve previous evidence' >&2
  exit 1
fi
output_dir=$(CDPATH='' cd -- "$output_dir" && pwd)
case $(uname -m) in
  arm64|aarch64) platform=linux/arm64; member=zerofs-linux-arm64-pgo ;;
  x86_64) platform=linux/amd64; member=zerofs-linux-amd64-pgo ;;
  *) echo 'Unsupported host architecture' >&2; exit 1 ;;
esac
archive=${REPRO_ZEROFS_ARCHIVE:-$output_dir/zerofs.tar.gz}
python3 - "$script_dir/../versions.json" "$archive" "$output_dir/zerofs" "$member" <<'PY'
import hashlib,json,sys,tarfile,urllib.request
from pathlib import Path
versions_path,archive_path,binary_path,member=sys.argv[1:]
version=json.loads(Path(versions_path).read_text())['zerofs']
archive=Path(archive_path)
if not archive.exists():
    urllib.request.urlretrieve(version['url'], archive)
if hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest()!=version['sha256']:
    raise ValueError('ZeroFS release checksum mismatch')
with tarfile.open(archive) as package:
    Path(binary_path).write_bytes(package.extractfile(member).read())
Path(binary_path).chmod(0o755)
PY
docker build --platform "$platform" -t nibrun-zerofs-memory-repro "$script_dir"
docker run --rm --platform "$platform" --network none \
  --cap-add SYS_ADMIN --device /dev/fuse --security-opt apparmor=unconfined \
  --memory 5g --memory-swap 5g --cpus 2 \
  -v "$output_dir/zerofs:/tools/zerofs:ro" -v "$output_dir:/output" \
  -e REPRO_TOTAL_MIB="${REPRO_TOTAL_MIB:-1024}" \
  -e REPRO_CYCLES="${REPRO_CYCLES:-4}" \
  -e REPRO_IDLE_SECONDS="${REPRO_IDLE_SECONDS:-60}" \
  nibrun-zerofs-memory-repro
printf 'Results: %s\n' "$output_dir"
