#!/bin/sh
# Two checks against the generated .config, both of which fail the build:
#
#   1. Every assignment in nibrun.config appears verbatim. kconfig drops a symbol
#      whose dependencies are unmet without failing, so a fragment is a request,
#      never a guarantee — this is what turns it into one.
#   2. Every assignment in Firecracker's base config also survived, unless its
#      symbol is in the allowlist. That config targets the Amazon Linux microVM
#      kernel, not a vanilla kernel.org tree, so some divergence is expected and
#      is enumerated once, with reasons, instead of being discovered per build.
set -eu

generated=$1
fragment=$2
base=$3
allowlist=$4

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
status=0

assignments() {
  grep -E '^(CONFIG_[A-Za-z0-9_]+=|# CONFIG_[A-Za-z0-9_]+ is not set$)' "$1" || true
}

symbol_of() {
  case "$1" in
    '# '*) set -- "${1#\# }"; printf '%s' "${1% is not set}" ;;
    *) printf '%s' "${1%%=*}" ;;
  esac
}

generated_value() {
  grep -E "^($1=|# $1 is not set)" "$generated" || echo 'absent from .config'
}

assignments "$fragment" >"$work/required"
assignments "$base" >"$work/base"

# A symbol nibrun.config sets is one we are deliberately overriding, so it can
# never count as drift from the base.
grep -E '^CONFIG_[A-Za-z0-9_]+$' "$allowlist" >"$work/exempt" || true
while IFS= read -r line; do
  symbol_of "$line" >>"$work/exempt"
  echo >>"$work/exempt"
done <"$work/required"

echo '--- required by nibrun.config ---'
while IFS= read -r line; do
  if grep -qxF -- "$line" "$generated"; then
    printf 'ok       %s\n' "$line"
  else
    printf 'DROPPED  %s -> %s\n' "$line" "$(generated_value "$(symbol_of "$line")")"
    status=1
  fi
done <"$work/required"

printf '\n--- drift from the Firecracker base config (%s assignments) ---\n' \
  "$(wc -l <"$work/base" | tr -d ' ')"
while IFS= read -r line; do
  if grep -qxF -- "$line" "$generated"; then
    continue
  fi
  symbol=$(symbol_of "$line")
  if grep -qxF -- "$symbol" "$work/exempt"; then
    printf 'allowed  %s\n' "$line"
  else
    printf 'DRIFT    %s -> %s\n' "$line" "$(generated_value "$symbol")"
    status=1
  fi
done <"$work/base"

if [ "$status" -ne 0 ]; then
  printf '\n%s\n' 'the generated .config is not the one this build asked for'
fi
exit "$status"
