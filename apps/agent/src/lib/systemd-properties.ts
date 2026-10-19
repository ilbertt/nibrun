export function parseProperties(output: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      properties[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return properties;
}

/** `systemctl show` answers for many units in one call, one blank-line-separated block each. */
export function parsePropertyBlocks(output: string): Record<string, string>[] {
  return output
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(parseProperties);
}
