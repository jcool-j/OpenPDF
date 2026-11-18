/** Parse a human page range without duplicates, preserving source page order. */
export function parsePageRange(input: string, count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("Invalid page count");
  if (!input.trim()) throw new Error("Enter a page range");
  const pages = new Set<number>();
  for (const part of input.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) throw new Error("Invalid page range");
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (first < 1 || last > count || first > last || !Number.isSafeInteger(last)) throw new Error("Page range out of bounds");
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
