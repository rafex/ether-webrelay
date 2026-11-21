import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The effects model ships inside the image so the page needs no third-party origin (CSP) and
// does not tell Google who visits. These guard the three pieces that make that true.
const ROOT = resolve(__dirname, '../../../../../..');
const containerfile = readFileSync(resolve(ROOT, 'containers/frontend/Containerfile'), 'utf8');
const nginx = readFileSync(resolve(ROOT, 'containers/frontend/nginx.conf'), 'utf8');

describe('self-hosted effects model', () => {
  it('is downloaded at build time against a pinned SHA-256', () => {
    expect(containerfile).toMatch(/ARG EFFECTS_MODEL_SHA256=[0-9a-f]{64}\b/);
    expect(containerfile).toMatch(/sha256sum -c -/);
    expect(containerfile).toMatch(/dist\/models\/selfie_segmenter\.tflite/);
  });

  it('is what the image configures the client to load', () => {
    expect(containerfile).toMatch(
      /^ENV WEBRELAY_EFFECTS_MODEL_URL=\/models\/selfie_segmenter\.tflite$/m,
    );
  });

  it('does the same for the face detector of the automatic framing', () => {
    expect(containerfile).toMatch(/ARG FACE_MODEL_SHA256=[0-9a-f]{64}\b/);
    expect(containerfile).toMatch(
      /sha256sum -c -[\s\S]*dist\/models\/blaze_face_short_range\.tflite/,
    );
    expect(containerfile).toMatch(
      /^ENV WEBRELAY_FACE_MODEL_URL=\/models\/blaze_face_short_range\.tflite$/m,
    );
  });

  it('is served by nginx from /models/ and /captions/ with the security headers', () => {
    const block =
      /location ~ \^\/\(models\|captions\)\/ \{([\s\S]*?)\n {4}\}/.exec(nginx)?.[1] ?? '';
    expect(block).toContain('security-headers.conf');
    expect(block).toContain('/tmp/webrelay-csp.conf');
    expect(block).toContain('try_files $uri =404');
  });

  describe('captions speech model', () => {
    const checksums = readFileSync(resolve(ROOT, 'containers/frontend/whisper-tiny.sha256'), 'utf8')
      .trim()
      .split('\n');

    it('is fetched at a pinned revision, never from "main"', () => {
      expect(containerfile).toMatch(/^ARG WHISPER_REVISION=[0-9a-f]{40}$/m);
      expect(containerfile).not.toMatch(/resolve\/main/);
    });

    it('is verified file by file, and every file is hashed', () => {
      expect(containerfile).toContain('sha256sum -c /tmp/whisper-tiny.sha256');
      expect(checksums.length).toBeGreaterThanOrEqual(10);
      for (const line of checksums) expect(line).toMatch(/^[0-9a-f]{64} {2}\S+$/);
      const files = checksums.map((line) => line.split(/ +/)[1]);
      expect(files).toContain('onnx/encoder_model_quantized.onnx');
      expect(files).toContain('onnx/decoder_model_merged_quantized.onnx');
      expect(files).toContain('config.json');
    });

    it('is advertised to the page, so the option is offered, from this same site', () => {
      expect(containerfile).toMatch(/^ENV WEBRELAY_CAPTIONS_URL=\/captions\/$/m);
    });
  });
});
