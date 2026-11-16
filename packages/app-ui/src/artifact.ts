export function artifactName(
  artifact: { originalFileName: string } | { repository: string },
): string {
  return 'repository' in artifact ? artifact.repository : artifact.originalFileName;
}
