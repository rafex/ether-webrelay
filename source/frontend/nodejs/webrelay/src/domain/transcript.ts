/**
 * Cleans what a speech engine returns before it becomes a caption. Small engines invent text on
 * noise and silence ("Subtítulos realizados por la comunidad de Amara.org", "Thanks for watching")
 * or loop on one word; those are dropped here so the broadcast never shows them. Plain short
 * answers ("Gracias.") are real speech and are kept.
 */

const ANNOTATIONS = /\[[^\]]*\]|\([^)]*\)|\*[^*]*\*|[♪♫]+/gu;

const HALLUCINATIONS: readonly RegExp[] = [
  /^subt[ií]tulos?\b.*$/iu,
  /^subtitles?\b.*$/iu,
  /^(la )?traducci[oó]n\b.*$/iu,
  /\bamara\.org\b/iu,
  /^gracias por (ver|mirar|escuchar)\b.*$/iu,
  /^(thanks|thank you) for (watching|listening)\b.*$/iu,
  /^suscr[ií]bete\b.*$/iu,
  /^(please )?subscribe\b.*$/iu,
  /^(m[uú]sica|music|applause|aplausos)[.!\s]*$/iu,
];

/** A word said five times in a row is a decoding loop, not speech: keep it twice. */
const LOOP = /(^|\s)(\p{L}[\p{L}\p{N}'’-]*[.,!?¿¡]*)(?:\s+\2){4,}(?=\s|$)/giu;

export function cleanTranscript(raw: string): string {
  let text = raw.replace(ANNOTATIONS, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(LOOP, (_match, lead: string, word: string) => `${lead}${word} ${word}`);
  if (!/[\p{L}\p{N}]/u.test(text)) return '';
  for (const pattern of HALLUCINATIONS) {
    if (pattern.test(text)) return '';
  }
  return text;
}
