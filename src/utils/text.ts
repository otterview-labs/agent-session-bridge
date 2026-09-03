export function truncateDigest(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '(empty)';
  }

  if (normalized.length <= 120) {
    return normalized;
  }

  return `${normalized.slice(0, 117)}...`;
}
