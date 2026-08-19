#!/bin/sh
# Installs `nib`, the nibrun CLI. Served from https://nibrun.com/install.sh, so the usual
#
#   curl -fsSL https://nibrun.com/install.sh | sh
#
# reaches it. POSIX sh rather than the bash the repo's own build scripts use: this one runs on
# whatever machine an owner happens to have, and `sh` is the shell that is always there.
#
# Nothing here is nibrun-aware. It resolves a platform to one of the assets `release-cli.yml`
# publishes, fetches it, and asks the result which version it is. Running it again is how an
# owner upgrades, so it is written to be run any number of times.
set -eu

REPO="ilbertt/nibrun"
# The CLI is tagged apart from anything else this repo may come to release, so the newest release
# is not necessarily the newest *CLI* release.
TAG_PREFIX="cli-v"
DEFAULT_INSTALL_DIR="$HOME/.local/bin"

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
    say "nib $wanted is already installed at $binary"
    report_path "$install_dir"
    return 0
  fi

  mkdir -p "$install_dir"
  # Staged inside the install dir rather than in /tmp, so the move below is a rename on one
  # filesystem — a half-written download is never something called nib, and replacing a binary
  # that is currently running is a rename rather than a write.
  staged=$(mktemp "$install_dir/.nib.XXXXXX")
  trap 'rm -f "$staged"' EXIT

  url="https://github.com/$REPO/releases/download/$version/nib-$target"
  say "Downloading nib $version ($target)"
  curl --fail --silent --show-error --location "$url" --output "$staged" ||
    die "Could not download $url"

  # Explicit rather than +x: mktemp creates it 600, so +x would leave a binary nobody but its
  # owner can read — surprising in a shared install dir.
  chmod 755 "$staged"
  mv "$staged" "$binary"

  if [ -n "$installed" ]; then
    say "Updated nib $installed -> $(nib_version "$binary")"
  else
    say "Installed nib $(nib_version "$binary") to $binary"
  fi
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
        say "Note: $reached comes first on your PATH and will be used instead."
      fi
      ;;
    *)
      say "Note: $1 is not on your PATH. Add it with:"
      say "  export PATH=\"$1:\$PATH\""
      ;;
  esac
}

say() { echo "$*" >&2; }
die() { echo "install.sh: $*" >&2; exit 1; }

main "$@"
