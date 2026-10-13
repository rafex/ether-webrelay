# SPEC — webrelay-mvp

```toml
artifact_type = "spec"
id            = "SPEC-0001"
state         = "active"
owner         = "rafex"
created_at    = "2026-10-12"
updated_at    = "2026-10-12"
replaces      = "none"
related_tasks       = ["TASK-0001", "TASK-0002", "TASK-0003", "TASK-0004", "TASK-0005", "TASK-0006", "TASK-0007", "TASK-0008", "TASK-0009", "TASK-0010", "TASK-0011", "TASK-0012"]
related_decisions   = ["DEC-0001", "DEC-0002", "DEC-0003", "DEC-0004", "DEC-0005", "DEC-0006", "DEC-0007", "DEC-0008"]
artifacts           = ["source/frontend/nodejs/webrelay/*", "helpers/*", "containers/*", "docs/protocol.md"]
validation          = ["make ci", "make coverage", "prueba manual en navegador"]
```

## Resumen

Primera versión funcional del webrelay: una página (TypeScript + Vite + Pug)
que captura cámara, micrófono, pantalla y audio del sistema, codifica con
WebCodecs y transmite por WebSocket a un puente externo según un protocolo
versionado, con reconexión, contrapresión y exportación local a OGV.

## Problema

Ver `../../PRODUCT.md`. No existe una pieza de navegador reutilizable que
entregue un stream sincronizado y resistente a la infraestructura RTMPS
propia del portal.

## Objetivo

Que un usuario, desde un navegador moderno en contexto seguro, pueda
transmitir cámara + pantalla + audio a un puente que publique en RTMPS, y que
el equipo del puente tenga un contrato probado para implementarlo.

## Alcance

### Incluye

- Captura con `getUserMedia` y `getDisplayMedia` (pestaña/ventana/pantalla a
  elección del usuario, audio del sistema opcional).
- Composición pantalla + cámara PiP; mezcla de audio con Web Audio.
- Codificación WebCodecs (H.264/AAC preferidos; VP8/Opus de respaldo).
- Protocolo binario v1 sobre `wss://` con timestamps compartidos.
- Reconexión con reanudación, heartbeat, contrapresión, estadísticas.
- UI con plantillas Pug; grabación local y exportación OGV con ffmpeg.wasm.
- Tests unitarios, de integración y de arquitectura; CI en contenedor;
  imagen servible; documentación (MkDocs + Mermaid + manuales).

### Excluye

- El servidor puente y la publicación RTMPS (DEC-0001).
- E2E automatizado en navegador (TASK-0012, iniciativa posterior).
- Despliegue a ambientes remotos (CD.md por definir).

## Requisitos funcionales

1. RF1 — El usuario elige fuentes (cámara, micrófono, pantalla, audio del
   sistema) y parámetros (resolución, fps, bitrates, códecs, intervalo de
   keyframes); la configuración se valida antes de capturar.
2. RF2 — La URL del puente debe ser `wss://` (o `ws://` solo en loopback);
   el destino RTMPS opcional debe ser `rtmps://` con clave.
3. RF3 — Video y audio se estampan con un mismo reloj de sesión en µs.
4. RF4 — Cada trama sigue el protocolo v1 (`docs/protocol.md`).
5. RF5 — Tras una caída, el cliente reconecta con backoff, reanuda el mismo
   `streamId`, reenvía CONFIG y reanuda el video desde un keyframe marcado.
6. RF6 — Bajo congestión se descartan frames de video completos hasta un
   keyframe; el audio solo en congestión crítica.
7. RF7 — La UI muestra estado y estadísticas (bitrate, frames, descartes,
   keyframes, reconexiones, RTT, buffer).
8. RF8 — La grabación local puede exportarse a OGV con ffmpeg.wasm.

## Requisitos no funcionales

- Contexto seguro obligatorio; sin backend.
- Codificación por hardware cuando exista (`prefer-hardware`), latencia
  acotada (cola del encoder ≤ 3 frames).
- ffmpeg.wasm fuera del bundle principal (carga diferida).
- Cobertura ≥ 80 % en dominio, aplicación y transporte.
- Imágenes de contenedor Alpine fijadas por digest; Podman preferido.

## Criterios de aceptación

- **CA1** — Dado un formulario con URL `ws://bridge.example.com`, cuando el
  usuario inicia, entonces se muestra el error de `wss://` y no se captura.
- **CA2** — Dado un puente que responde `welcome`, cuando el pipeline emite
  configs y chunks, entonces el puente recibe HELLO, CONFIG y MEDIA con
  secuencia contigua y timestamps monótonos por pista.
- **CA3** — Dado un stream en vivo, cuando el socket cae, entonces el cliente
  reconecta, envía HELLO `resume:true` con el mismo `streamId`, y el primer
  MEDIA de video es `KEYFRAME|DISCONTINUITY`.
- **CA4** — Dado un puente que responde `error` fatal, cuando llega, entonces
  la sesión pasa a `failed` sin reintentos y libera los dispositivos.
- **CA5** — Dado `bufferedAmount` sobre la marca alta, cuando llegan frames
  delta, entonces se descartan y se pide un keyframe una sola vez.
- **CA6** — Dado Chromium con WebCodecs, cuando se transmite, entonces el
  video es H.264 AVCC con `avcC` válido y el audio AAC-LC con ASC.
- **CA7** — Dada una grabación local, cuando se exporta, entonces se obtiene
  un archivo Ogg/Theora.
- **CA8** — `make ci` pasa en contenedor y `just up` sirve la app.

## Dependencias y riesgos

- Puente externo aún no disponible para pruebas conjuntas (TASK-0011).
- Soporte desigual de `getDisplayMedia` con audio de sistema entre
  navegadores/SO (degradación: sin audio de sistema).
- Firefox puede rechazar `AudioContext` a 48 kHz con fuentes a otra
  frecuencia: el mezclador cae a la frecuencia del dispositivo.

## Plan de ejecución

Ver `../../tasks/webrelay-mvp/TASKS.md`.

## Plan de validación

- `make ci` (lint, typecheck, build, 97 tests) en contenedor.
- `make coverage` (umbral 80 %).
- Prueba manual en navegador: sesión real WebCodecs → puente de diagnóstico,
  inspección de tramas; exportación OGV.
