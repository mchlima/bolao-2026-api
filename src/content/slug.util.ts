/**
 * Slug canônico: sem acento, minúsculo, só [a-z0-9-]. PRESERVA números (placar) e
 * NÃO limita o tamanho. Retorna '' se não sobrar nada (o chamador decide o fallback).
 */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
