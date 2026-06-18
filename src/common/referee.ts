/**
 * ESPN's gameInfo officials give referee names inconsistently: some as
 * "Sobrenome, Nome" (e.g. "Martínez, Héctor") and others already as "Nome
 * Sobrenome" (e.g. "Wilton Pereira Sampaio"). Normalize the comma form to
 * "Nome Sobrenome"; leave comma-less names untouched.
 */
export function normalizeRefereeName(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const n = name.trim();
  if (!n) return null;
  const i = n.indexOf(',');
  if (i === -1) return n;
  const last = n.slice(0, i).trim();
  const first = n.slice(i + 1).trim();
  return first && last
    ? `${first} ${last}`
    : n.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}
