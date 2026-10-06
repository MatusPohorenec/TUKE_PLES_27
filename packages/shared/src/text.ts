/** Lowercase, strip diacritics and punctuation: "Košice-Šaca" -> "kosice saca". Used for place search on both sides. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[łŁ]/g, 'l')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
