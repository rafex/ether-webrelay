# ROADMAP.md

Dirección del proyecto en el tiempo.

## Cuando leer este archivo

Antes de crear una nueva spec, para confirmar que la iniciativa es coherente
con la dirección actual. Si una iniciativa listada aquí no tiene spec, crearla
antes de implementar.

## Ahora

- **webrtc-lobby** (`SPEC-0002`): antesala, videollamada WebRTC, ajustes,
  efectos, grabación local, despliegue con config en runtime y E2E.
  Implementado; falta la prueba contra el puente real.
- **Interoperabilidad con `ether-streaming-culerin`**: implementar allí la
  señalización v2 (`docs/signaling.md`) y verificar con el E2E apuntando al
  puente real (TASK-0011 de SPEC-0001, ahora sobre la señalización v2).

## Después

- Codificación/efectos en Worker (`OffscreenCanvas`, `MediaStreamTrackProcessor`)
  para descargar el hilo de UI.
- Simulcast en la publicación para que el SFU adapte calidad por espectador.
- Indicador de quién habla (niveles de audio remotos) y fijar participante.
- Autoalojar el modelo de efectos en la imagen por defecto.

## Más adelante

- Controles de anfitrión en un frontend aparte (salir al aire, layouts).
- Chat y reacciones por la señalización.
- Empaquetar la antesala como Web Component embebible.

## No hacer por ahora

- Servidor puente en este repositorio (DEC-0001; vive en `ether-streaming-culerin`).
- Que el cliente conozca destinos o claves RTMPS (DEC-0010).
- SDKs propietarios de SFU en el cliente (DEC-0009).
