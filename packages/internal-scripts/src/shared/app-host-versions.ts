import { join } from 'node:path';
import { repoRoot } from '#shared/paths.ts';

// The committed pins, and the only place a version is chosen. CI reads this and
// must never ask S3 what the newest version is — that is what makes "what is this
// host running" answerable from git rather than from whichever job ran last.
//
// The agent is the one exception: its version is the git SHA.
export type AppHostVersions = {
  zerofs: { version: string; url: string; sha256: string; member: string };
  firecracker: { version: string; url: string; sha256: string; directory: string };
  caddy: { version: string; url: string; sha256: string };
  // Null until a guest image is adopted. Publishing one and adopting it are
  // separate commits; the adopting commit is the reviewable artifact.
  guestImage: string | null;
};

export const versionsPath = join(repoRoot, 'infra/app-host/versions.json');

export async function readAppHostVersions(): Promise<AppHostVersions> {
  return (await Bun.file(versionsPath).json()) as AppHostVersions;
}
