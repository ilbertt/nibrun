export function artifactName(
  artifact: { originalFileName: string } | { repository: string },
): string {
  return 'repository' in artifact ? artifact.repository : artifact.originalFileName;
}

export function artifactProgram(
  artifact: { originalFileName: string } | { program: string },
): string {
  return 'program' in artifact ? artifact.program : artifact.originalFileName;
}
