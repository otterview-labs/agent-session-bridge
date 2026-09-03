export function splitCommandLine(input: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && index + 1 < input.length) {
        current += input[index + 1]!;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }

    if (char === '\\' && index + 1 < input.length) {
      current += input[index + 1]!;
      index += 1;
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Unclosed quote ${quote} in command input`);
  }

  if (current) {
    result.push(current);
  }

  return result;
}
