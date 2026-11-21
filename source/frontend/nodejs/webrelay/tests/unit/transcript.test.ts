import { describe, expect, it } from 'vitest';
import { cleanTranscript } from '../../src/domain/transcript';

describe('cleanTranscript', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanTranscript('  Hola   a todos \n')).toBe('Hola a todos');
  });

  it('removes sound annotations and music notes', () => {
    expect(cleanTranscript(' [Música] Hola (risas) *aplausos* amigos ♪')).toBe('Hola amigos');
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('');
  });

  it('drops text without letters or digits', () => {
    expect(cleanTranscript(' ... ')).toBe('');
    expect(cleanTranscript('¿?')).toBe('');
    expect(cleanTranscript('2026')).toBe('2026');
  });

  it.each([
    'Subtítulos realizados por la comunidad de Amara.org',
    'Subtitles by the Amara.org community',
    'Gracias por ver el video.',
    'Gracias por ver este vídeo, suscríbete',
    'Thanks for watching!',
    'Suscríbete al canal',
    'Música',
  ])('drops the engine invention %j', (text) => {
    expect(cleanTranscript(text)).toBe('');
  });

  it.each([
    'Gracias.',
    'Thank you.',
    'Gracias por venir hoy a la transmisión',
    'Los subtítulos ayudan a quienes nos ven',
  ])('keeps real speech %j', (text) => {
    expect(cleanTranscript(text)).toBe(text);
  });

  it('collapses a word repeated in a loop', () => {
    expect(cleanTranscript('sí sí sí sí sí sí sí vamos')).toBe('sí sí vamos');
  });

  it('leaves a short natural repetition alone', () => {
    expect(cleanTranscript('no no no, eso no')).toBe('no no no, eso no');
  });
});
