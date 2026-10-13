# STACK.md

Fuente de verdad de la base tecnológica del proyecto.

## Runtime

- Lenguaje: TypeScript 7.0.2 (`strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- Navegador objetivo: Chromium, Safari y Firefox recientes con WebRTC
  (`RTCPeerConnection`); el modo alternativo `websocket` requiere además
  WebCodecs y `AudioWorklet`. Contexto seguro obligatorio (HTTPS o `localhost`).
- Node.js 24 LTS (`.nvmrc`) solo para build y tests.

## Frameworks y librerías

| Componente | Versión | Uso |
|------------|---------|-----|
| Vite | 8.3.4 | dev server y bundle de producción |
| Pug | 3.0.4 | plantillas HTML, renderizadas en build vía `build/vite-plugin-pug.ts` |
| @ffmpeg/ffmpeg · @ffmpeg/util · @ffmpeg/core | 0.12.15 · 0.12.2 · 0.12.10 | exportar grabación local a OGV; self-hosted, carga diferida |
| @mediapipe/tasks-vision | 1.0.1 | segmentación para desenfoque/fondo virtual; wasm empaquetado, carga diferida |
| @playwright/test | 1.62.1 | **solo tests**: E2E de navegador |
| werift | 0.24.4 | **solo tests/desarrollo**: mini SFU del puente de desarrollo |
| Vitest + @vitest/coverage-v8 | 5.0.4 | tests unitarios, integración, arquitectura y cobertura |
| ws | 8.22.0 | **solo tests**: puente simulado |
| Biome | 2.5.15 | lint + formato |

APIs de plataforma: WebRTC (`RTCPeerConnection`, `setParameters`),
`getUserMedia`, `getDisplayMedia`, `enumerateDevices`, `setSinkId`, Web Audio
(`AudioWorklet`, `AnalyserNode`, `GainNode`), Canvas 2D, `MediaRecorder`,
WebCodecs, `WebSocket`, Web Workers, `localStorage`.

## Infraestructura

- Base de datos: ninguna.
- Hosting: sitio estático. Imagen `containers/frontend/Containerfile`
  (nginx-unprivileged 1.29 Alpine, puerto 8080); `config.json` se genera al
  arrancar desde `WEBRELAY_*`. TLS se termina delante.
- E2E: `containers/e2e/Containerfile` (imagen oficial de Playwright
  v1.62.1-noble por digest; excepción a Alpine porque Chromium requiere glibc).
- CI/CD: `make ci` en contenedor (`containers/ci/Containerfile`, Node 24
  Alpine); GitHub Actions como wrapper (`.github/workflows/ci.yml`).
- Contenedores: Podman (preferido) → Docker con aviso. `Containerfile`,
  imágenes fijadas por digest de índice multi-arch.
- Documentación: Markdown + MermaidJS + MkDocs Material (`.config/mkdocs/`).
- Orquestación: GNU Make, just, bash.

## Integraciones

- **Puente** (externo, crítico; repositorio `ether-streaming-culerin`):
  señalización v2 (`docs/signaling.md`), SFU WebRTC, composición y
  publicación RTMPS. En modo alternativo recibe el protocolo binario v1
  (`docs/protocol-websocket.md`).
- **Modelo de efectos** (opcional): selfie segmenter de MediaPipe en
  `storage.googleapis.com` por defecto, autoalojable con `effectsModelUrl`.
- **Ingesta RTMPS** (YouTube/Twitch/propia): indirecta, vía el puente.

## Restricciones

- Sin backend ni dependencias de runtime de servidor en este repositorio.
- Sin ESLint/typescript-eslint (incompatibles con la API de TS 7); usar Biome.
- Sin `Dockerfile`; sin imágenes `:latest`.
- `ws`, `werift`, Playwright y cualquier código Node solo en `tests/` y `build/`.
- Ningún SDK propietario de SFU en el cliente (DEC-0009).
- El puente debe exponerse por `wss://` (excepto `localhost` en desarrollo).
