# ROADMAP.md

Dirección del proyecto en el tiempo.

## Cuando leer este archivo

Antes de crear una nueva spec, para confirmar que la iniciativa es coherente
con la dirección actual. Si una iniciativa listada aquí no tiene spec, crearla
antes de implementar.

## Ahora

- **webrelay-mvp** (`SPEC-0001`): captura combinada, WebCodecs, protocolo v1,
  reconexión, UI Pug, contenedor y CI. Implementado; pendiente la
  verificación contra un puente real (TASK-0011) antes de cerrarla.

## Después

- **Interoperabilidad con el puente**: prueba conjunta con la implementación
  real del puente (remux FLV, reanudación con periodo de gracia).
- **E2E en navegador**: Playwright/Vitest browser mode con dispositivos
  falsos de Chromium (`--use-fake-device-for-media-stream`) para cubrir
  captura, compositor y encoders en CI.
- **Codificación en Worker**: mover compositor + encoders a un Worker
  (`OffscreenCanvas`, `MediaStreamTrackProcessor` donde exista) para
  aislar el hilo de UI.

## Más adelante

- Bitrate adaptativo a partir de `bufferedAmount` y RTT.
- Layouts adicionales (lado a lado, solo pantalla con avatar) y controles de
  ganancia por fuente en la UI.
- Empaquetar el webrelay como librería/Web Component embebible en otros
  portales.

## No hacer por ahora

- Servidor puente en este repositorio (ver DEC-0001).
- WebRTC/WHIP como transporte alternativo.
- Soporte de navegadores sin WebCodecs.
