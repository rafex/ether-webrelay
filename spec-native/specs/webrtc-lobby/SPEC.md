# SPEC — webrtc-lobby

```toml
artifact_type = "spec"
id            = "SPEC-0002"
state         = "done"
owner         = "rafex"
created_at    = "2026-10-13"
updated_at    = "2026-10-14"
replaces      = "none"
related_tasks       = ["TASK-0101", "TASK-0102", "TASK-0103", "TASK-0104", "TASK-0105", "TASK-0106", "TASK-0107", "TASK-0108", "TASK-0109", "TASK-0110"]
related_decisions   = ["DEC-0009", "DEC-0010", "DEC-0011", "DEC-0012", "DEC-0013", "DEC-0014"]
artifacts           = ["source/frontend/nodejs/webrelay/src/*", "source/frontend/nodejs/webrelay/tests/*", "docs/signaling.md", "containers/*"]
validation          = ["make ci", "make e2e", "make e2e-ci", "prueba manual en navegador"]
```

## Resumen

Sustituir el formulario técnico por una antesala tipo "Ready to join?" y una
videollamada WebRTC multi-participante. El invitado entra por enlace,
configura dispositivos y efectos, y sus medios van al puente
(`ether-streaming-culerin`), que publica en RTMPS. El cliente no conoce RTMPS.

## Problema

La UI de SPEC-0001 exponía URL del puente, destino y clave RTMPS, códecs y
bitrates; no permitía ver a otros participantes. Ver `../../PRODUCT.md`.

## Objetivo

Que un invitado, desde un enlace, entre a una sala, vea y oiga a los demás, y
pueda cambiar dispositivos, efectos y vista sin conocimientos técnicos.

## Alcance

### Incluye

- Enlace `/join/<sala>?t=<token>` y `config.json` (o `WEBRELAY_*`).
- Lobby: info de sala por señalización, vista previa, dispositivos, medidor,
  nombre/título; modal de ajustes (video, audio, fondo virtual, perfil,
  atajos).
- Señalización v2 propia + WebRTC publish/subscribe; perfil de calidad del
  puente; reconexión.
- Llamada con tres vistas conmutables, pantalla compartida en caliente,
  silencio/cámara, estadísticas.
- Modo alternativo `websocket` (pipeline WebCodecs existente).
- Efectos con MediaPipe; grabación local WebM/OGV.
- Puente de desarrollo y E2E de navegador; contenedor con config en runtime.

### Excluye

- Implementación del puente (vive en `ether-streaming-culerin`).
- Controles de anfitrión, chat.

## Requisitos funcionales

1. RF1 — Sin sala o token en la URL se muestra una pantalla explicativa.
2. RF2 — El lobby muestra anfitrión, título y canales de `room.info`; un error
   fatal (token, sala) se explica y bloquea la entrada.
3. RF3 — La vista previa (espejo) y el medidor funcionan antes de entrar; cada
   dispositivo aparece en cuanto se concede su permiso.
4. RF4 — El nombre es obligatorio (≤ 60) y el título opcional (≤ 80); se
   recuerdan en el navegador junto con dispositivos y preferencias.
5. RF5 — Al entrar, el participante publica sus pistas y recibe las de los
   demás, mapeadas por participante y fuente.
6. RF6 — Micrófono, cámara y pantalla se activan/desactivan en caliente; el
   estado se refleja en los demás.
7. RF7 — Las vistas escenario, mínima y estadísticas se cambian en caliente y
   se recuerdan.
8. RF8 — Ajustes en llamada (dispositivo, resolución, efecto, altavoz) se
   aplican sin salir.
9. RF9 — La grabación local produce un WebM reproducible y puede exportarse a
   OGV.
10. RF10 — Ningún texto ni configuración del cliente expone RTMPS.

## Requisitos no funcionales

- Hexágono intacto (test de arquitectura); cobertura ≥ 80 %.
- Bundle inicial pequeño; MediaPipe y ffmpeg.wasm bajo demanda.
- CSP estricta; contenedor sin root; imágenes por digest.

## Criterios de aceptación

- **CA1** — Dado `/join/sala` sin `t`, entonces se muestra "Enlace no válido".
- **CA2** — Dado un token rechazado, entonces el lobby muestra "El enlace de
  invitación no es válido o ha caducado." y no permite entrar.
- **CA3** — Dados dos invitados en la misma sala, entonces cada uno decodifica
  el video del otro y tiene su audio conectado.
- **CA4** — Cuando un invitado silencia el micrófono, entonces los demás lo
  ven silenciado.
- **CA5** — Cuando un invitado comparte pantalla, entonces todos la ven en
  foco; al dejar de compartir el foco desaparece.
- **CA6** — Cuando un invitado sale, entonces desaparece de la sala de los
  demás y él ve "Has salido de la sala".
- **CA7** — Dado el permiso de micrófono pendiente, entonces la vista previa
  de cámara ya es visible.
- **CA8** — `make ci`, `make e2e` y `make e2e-ci` pasan.

## Dependencias y riesgos

- El puente real (`ether-streaming-culerin`, Go + Pion) ya implementa el
  contrato: el mismo E2E corre contra él con `E2E_BRIDGE_URL` (5/5); el
  puente de desarrollo sigue siendo el doble por defecto.
- Chromium headless en macOS no entrega audio del dispositivo falso: el E2E
  usa un micrófono sintético.

## Plan de ejecución

Ver `../../tasks/webrtc-lobby/TASKS.md`.

## Plan de validación

- `make ci` (lint, typecheck, build, 185 tests).
- `make e2e` / `make e2e-ci` (5 escenarios con WebRTC real).
- Prueba manual en navegador con `just bridge-dev` + `just dev` y en
  contenedor con `just up --bridge-url …`.
