// Penyaring kata kasar sederhana untuk nama & chat.
const BAD = [
  'anjing', 'anjir', 'anjg', 'bangsat', 'bajingan', 'babi', 'kontol', 'memek', 'ngentot', 'entot', 'jancok',
  'jancuk', 'cok', 'asu', 'goblok', 'goblog', 'tolol', 'kampret', 'tai', 'taik', 'pantek', 'pepek', 'perek',
  'lonte', 'pelacur', 'bego', 'idiot', 'keparat', 'brengsek', 'sialan', 'fuck', 'shit', 'bitch', 'asshole',
  'dick', 'pussy', 'bastard',
];
const RE = new RegExp(`(^|[^a-z])(${BAD.join('|')})(?=[^a-z]|$)`, 'gi');

export function filterText(input: string): string {
  return input.replace(RE, (_m, pre: string, word: string) => pre + '*'.repeat(word.length));
}

export function cleanName(input: unknown, max = 16): string {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return filterText(s);
}
