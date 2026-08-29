#!/bin/sh
# Installs `nib`, the nibrun CLI. Served from https://nibrun.com/install.sh, so the usual
#
#   curl -fsSL https://nibrun.com/install.sh | sh
#
# reaches it. POSIX sh rather than the bash the repo's own build scripts use: this one runs on
# whatever machine an owner happens to have, and `sh` is the shell that is always there.
#
# Nothing here is nibrun-aware. It resolves a platform to one of the assets `release-cli.yml`
# publishes, fetches it, checks it against the checksums that release publishes, and asks the
# result which version it is. Running it again is how an owner upgrades, so it is written to be run
# any number of times.
set -eu

REPO="ilbertt/nibrun"
# The CLI is tagged apart from anything else this repo may come to release, so the newest release
# is not necessarily the newest *CLI* release.
TAG_PREFIX="cli-v"
CHECKSUMS_FILE="checksums.txt"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"

# Styling is for a terminal to read: a pipe, a log file or NO_COLOR gets the same lines unadorned.
if [ -t 2 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != dumb ]; then
  BOLD=$(printf '\033[1m')
  DIM=$(printf '\033[2m')
  RED=$(printf '\033[31m')
  GREEN=$(printf '\033[32m')
  YELLOW=$(printf '\033[33m')
  RESET=$(printf '\033[0m')
else
  BOLD='' DIM='' RED='' GREEN='' YELLOW='' RESET=''
fi

# Asked of the locale rather than of $TERM, which says nothing about encoding: under LC_ALL=C these
# arrive as mojibake, and a broken glyph in the first line an owner sees costs more than it buys.
case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
  *[Uu][Tt][Ff]8* | *[Uu][Tt][Ff]-8*) DOWN='↓' ARROW='→' TICK='✓' ;;
  *) DOWN='>' ARROW='->' TICK='*' ;;
esac

main() {
  target=$(resolve_target)

  # The one thing worth asking without installing: it is what the tests assert on.
  if [ "${1:-}" = "--print-target" ]; then
    echo "$target"
    return 0
  fi

  version=${NIB_VERSION:-$(latest_version)}
  install_dir=${NIB_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}
  binary="$install_dir/nib"
  installed=$(installed_version "$binary")
  # The tag carries the prefix and `nib --version` does not, so one is stripped to the other
  # before they are compared — the whole point of this check is that they can be equal.
  wanted=${version#"$TAG_PREFIX"}

  if [ "$installed" = "$wanted" ]; then
    ok "nib ${BOLD}${wanted}${RESET} is already installed at ${DIM}${binary}${RESET}"
    report_path "$install_dir"
    return 0
  fi

  if [ -n "$installed" ]; then
    step "Updating nib ${BOLD}${installed}${RESET} $ARROW ${BOLD}${wanted}${RESET} ${DIM}($target)${RESET}"
  else
    step "Installing nib ${BOLD}${wanted}${RESET} ${DIM}($target)${RESET}"
  fi

  mkdir -p "$install_dir"
  # Staged inside the install dir rather than in /tmp, so the move below is a rename on one
  # filesystem — a half-written download is never something called nib, and replacing a binary
  # that is currently running is a rename rather than a write.
  staged=$(mktemp "$install_dir/.nib.XXXXXX")
  trap 'rm -f "$staged"' EXIT

  url="https://github.com/$REPO/releases/download/$version/nib-$target"
  curl --fail --silent --show-error --location "$url" --output "$staged" ||
    die "Could not download $url"

  verify_checksum "$staged" "nib-$target" "$version"

  # Explicit rather than +x: mktemp creates it 600, so +x would leave a binary nobody but its
  # owner can read — surprising in a shared install dir.
  chmod 755 "$staged"
  mv "$staged" "$binary"

  # The version comes from the binary rather than from the tag, so this line is also the proof that
  # what was just downloaded runs on this machine.
  ok "nib ${BOLD}$(nib_version "$binary")${RESET} is installed at ${DIM}${binary}${RESET}"
  report_path "$install_dir"
}

# One of the assets a release carries. Anything else is a platform the CLI is not built for, and
# saying so is better than a download that 404s.
resolve_target() {
  os=$(uname -s)
  arch=$(uname -m)

  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "Unsupported operating system: $os" ;;
  esac

  case "$arch" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) die "Unsupported architecture: $arch" ;;
  esac

  case "$os-$arch" in
    darwin-arm64 | linux-x64 | linux-arm64) echo "$os-$arch" ;;
    *) die "There is no nib build for $os-$arch" ;;
  esac
}

latest_version() {
  found=$(newest_from_feed)
  if [ -z "$found" ]; then
    found=$(newest_from_api)
  fi

  [ -n "$found" ] ||
    die "No ${TAG_PREFIX}* release found — GitHub may be unreachable or rate-limiting this address. Set NIB_VERSION to install a specific one."
  echo "$found"
}

# github.com rather than api.github.com, because the API allows sixty unauthenticated requests an
# hour per address — and an address shared by an office or a CI runner can have spent them before
# an owner runs this at all.
newest_from_feed() {
  body=$(curl --fail --silent --location "https://github.com/$REPO/releases.atom") || return 0
  printf "%s\n" "$body" | grep -o "releases/tag/${TAG_PREFIX}[^\"]*" | head -n 1 | sed "s|.*/||"
}

# The feed carries only the ten newest releases of anything, so this is what still answers once the
# repo's other release trains have pushed the CLI's off the end of it.
newest_from_api() {
  body=$(curl --fail --silent --location "https://api.github.com/repos/$REPO/releases?per_page=100") ||
    return 0
  printf "%s\n" "$body" |
    grep -o "\"tag_name\": *\"${TAG_PREFIX}[^\"]*\"" |
    head -n 1 |
    sed "s/.*\"\(${TAG_PREFIX}[^\"]*\)\"/\1/"
}

# The checksum is fetched from the same release over the same TLS as the binary, so what it catches
# is a download that arrived wrong — truncated, or answered by a cache that had no business
# answering — rather than a github.com handing out assets someone else put there. The build
# provenance attestation linked from every release is what speaks to that second question.
#
# Only a checksum that is published and disagrees is fatal: releases cut before this file existed
# publish none, and a machine with no sha256 tool on it still gets an install that works.
verify_checksum() {
  downloaded=$1 asset=$2 release=$3

  expected=$(published_checksum "$asset" "$release")
  if [ -z "$expected" ]; then
    warn "$release publishes no checksum for $asset, so it was not verified."
    return 0
  fi

  actual=$(sha256 "$downloaded")
  if [ -z "$actual" ]; then
    warn "This machine has no sha256sum, shasum or openssl, so $asset was not verified."
    return 0
  fi

  [ "$actual" = "$expected" ] ||
    die "$asset is not what $release publishes: expected $expected, got $actual."
}

# The name is the second field of a `sha256sum` line and the checksum the first, so a release that
# stops carrying one — or never did — reads as no line rather than as a wrong answer.
published_checksum() {
  curl --fail --silent --location "https://github.com/$REPO/releases/download/$2/$CHECKSUMS_FILE" |
    awk -v asset="$1" '$2 == asset { print $1 }'
}

# Whichever of the three this machine has: macOS ships shasum and no sha256sum, a Linux ships the
# reverse, and openssl is what is left on an image too small for either.
sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v openssl > /dev/null 2>&1; then
    openssl dgst -sha256 "$1" | awk '{ print $NF }'
  fi
}

# Empty when nothing is installed there yet, which is what tells an install from an upgrade.
installed_version() {
  if [ -x "$1" ]; then
    nib_version "$1"
  fi
}

nib_version() {
  "$1" --version 2>/dev/null || echo unknown
}

report_path() {
  case ":$PATH:" in
    *":$1:"*)
      # On PATH is not the same as reached: an older nib earlier in it still wins.
      reached=$(command -v nib || true)
      if [ -n "$reached" ] && [ "$reached" != "$1/nib" ]; then
        warn "$reached comes first on your PATH and will be used instead."
      fi
      ;;
    *)
      warn "$1 is not on your PATH. Add it with:"
      say "    ${BOLD}export PATH=\"$1:\$PATH\"${RESET}"
      ;;
  esac
}

say() { echo "$*" >&2; }
step() { say "${DIM}${DOWN}${RESET} $*"; }
ok() { say "${GREEN}${TICK}${RESET} $*"; }
warn() { say "${YELLOW}!${RESET} $*"; }
die() { echo "${RED}install.sh:${RESET} $*" >&2; exit 1; }

main "$@"
