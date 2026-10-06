/** Slovak plural: 1 inštitúcia, 2–4 inštitúcie, 5+ inštitúcií. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}

export const fmt = (n: number) => n.toLocaleString('sk');
