export function oneParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) {
    return null;
  }

  return first;
}
