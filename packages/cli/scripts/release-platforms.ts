/**
 * Every platform a release carries an asset for. Shared rather than spelled twice: the build emits
 * one binary per entry and `install.sh` resolves a machine to one of them, so a platform added to
 * one side and not the other is either an asset nobody can install or an install that 404s.
 */
export const RELEASE_PLATFORMS = ['darwin-arm64', 'linux-x64', 'linux-arm64'] as const;

export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];
