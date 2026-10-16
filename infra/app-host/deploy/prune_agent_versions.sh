#!/bin/bash
set -euo pipefail

nibrun_dir=${1:-/opt/nibrun}
proc_dir=${2:-/proc}

[ -d "$nibrun_dir/versions/agent" ] || exit 0
versions_dir=$(cd "$nibrun_dir/versions/agent" && pwd -P)
active_dir=$(cd "$nibrun_dir/bin/agent" && pwd -P)
[ -d "$proc_dir" ] || exit 1

if [ "$(dirname "$active_dir")" != "$versions_dir" ]; then
  echo "Refusing to prune: active agent is not a version in $versions_dir" >&2
  exit 1
fi

installed_dirs=()
for directory in "$versions_dir"/*; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || continue
  version=${directory##*/}
  [[ "$version" =~ ^[[:xdigit:]]{40}$ ]] || continue
  [ -f "$directory/.installed" ] && [ ! -L "$directory/.installed" ] || continue
  [ -f "$directory/nibrun-agent" ] && [ ! -L "$directory/nibrun-agent" ] || continue
  [ -z "$(find "$directory" -mindepth 1 -maxdepth 1 ! -name .installed ! -name nibrun-agent -print -quit)" ] || continue
  installed_dirs+=("$directory")
done

[ "${#installed_dirs[@]}" -gt 0 ] || exit 0

running_dirs=()
for process in "$proc_dir"/[0-9]*; do
  executable=$(readlink "$process/exe" 2>/dev/null) || continue
  case "$executable" in
    "$versions_dir"/*/*)
      relative=${executable#"$versions_dir/"}
      running_dirs+=("$versions_dir/${relative%%/*}")
      ;;
  esac
done

is_running() {
  local directory
  for directory in ${running_dirs[@]+"${running_dirs[@]}"}; do
    [ "$directory" != "$1" ] || return 0
  done
  return 1
}

rollback_count=0
# SHA names have no order; installation creates the marker last and updates the directory's mtime.
while IFS= read -r directory; do
  [ "$directory" != "$active_dir" ] || continue
  if [ "$rollback_count" -lt 2 ]; then
    rollback_count=$((rollback_count + 1))
    continue
  fi
  is_running "$directory" && continue
  if [ "$(cd "$nibrun_dir/bin/agent" && pwd -P)" != "$active_dir" ]; then
    echo "Refusing to prune: active agent changed during cleanup" >&2
    exit 1
  fi
  echo "Removing obsolete agent version ${directory##*/}"
  rm -rf -- "$directory"
done < <(ls -1td -- "${installed_dirs[@]}")
