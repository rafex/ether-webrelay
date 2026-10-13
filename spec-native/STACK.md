# STACK.md

Fuente de verdad de la base tecnológica del proyecto.

## Runtime

- Lenguaje: TypeScript 7.0.2 (`strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`).
- Navegador objetivo: Chromium ≥ 94; Safari/Firefox con WebCodecs
  (`VideoEncoder`, `AudioEncoder`, `VideoFrame`, `AudioData`) y `AudioWorklet`.
  Contexto seguro obligatorio (HTTPS o `localhost`).
- Node.js 24 LTS (`.nvmrc`) solo para build y tests.

## Frameworks y librerías

| Componente | Versión | Uso |
|------------|---------|-----|
| Vite | 8.3.4 | dev server y bundle de producción |
| Pug | 3.0.4 | plantillas HTML, renderizadas en build vía `build/vite-plugin-pug.ts` |
| @ffmpeg/ffmpeg · @ffmpeg/util · @ffmpeg/core | 0.12.15 · 0.12.2 · 0.12.10 | exportar grabación local a OGV; self-hosted, carga diferida |
| Vitest + @vitest/coverage-v8 | 5.0.4 | tests unitarios, integración, arquitectura y cobertura |
| ws | 8.22.0 | **solo tests**: puente simulado |
| Biome | 2.5.15 | lint + formato |

APIs de plataforma: `getUserMedia`, `getDisplayMedia`, Web Audio
(`AudioWorklet`, `GainNode`), Canvas 2D, `MediaRecorder`, WebCodecs,
`WebSocket`, Web Workers.

## Infraestructura

- Base de datos: ninguna.
- Hosting: sitio estático. Imagen `containers/frontend/Containerfile`
  (nginx-unprivileged 1.29 Alpine, puerto 8080). TLS se termina delante.
- CI/CD: `make ci` en contenedor (`containers/ci/Containerfile`, Node 24
  Alpine); GitHub Actions como wrapper (`.github/workflows/ci.yml`).
- Contenedores: Podman (preferido) → Docker con aviso. `Containerfile`,
  imágenes fijadas por digest de índice multi-arch.
- Documentación: Markdown + MermaidJS + MkDocs Material (`.config/mkdocs/`).
- Orquestación: GNU Make, just, bash.

## Integraciones

- **Puente Ether WebRelay** (externo, crítico): recibe tramas por WebSocket
  según `docs/protocol-websocket.md` y publica en RTMPS. Fuera de este repositorio.
- **Ingesta RTMPS** (YouTube/Twitch/propia): indirecta, vía el puente.

## Restricciones

- Sin backend ni dependencias de runtime de servidor en este repositorio.
- Sin ESLint/typescript-eslint (incompatibles con la API de TS 7); usar Biome.
- Sin `Dockerfile`; sin imágenes `:latest`.
- `ws` y cualquier código Node solo en `tests/` y `build/`.
- El puente debe exponerse por `wss://` (excepto `localhost` en desarrollo).
