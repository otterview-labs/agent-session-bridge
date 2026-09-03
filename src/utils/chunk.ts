export function chunkString(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) {
    return [value];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < value.length) {
    const next = value.slice(cursor, cursor + maxLength);
    chunks.push(next);
    cursor += maxLength;
  }

  return chunks;
}
