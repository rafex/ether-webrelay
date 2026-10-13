# PRODUCT.md

Fuente de verdad del producto.

## Problema

Invitar a personas a una transmisión en vivo (podcast, panel, clase) exige
hoy software de escritorio o estudios web cerrados. Los organizadores que
tienen su propia infraestructura de streaming no disponen de una antesala y
videollamada de navegador, simple para el invitado, que entregue los medios a
su propio puente para publicarlos en sus canales.

## Usuarios

- **Invitados**: abren un enlace, prueban cámara, micrófono y efectos, entran
  y conversan viendo a los demás; no deben configurar nada técnico ni ver
  conceptos como RTMPS o bitrate.
- **Anfitrión / producción**: controla desde el puente (u otra consola) quién
  sale al aire y la composición final; reparte enlaces de invitación.
- **Equipo del puente** (`ether-streaming-culerin`): necesita un contrato
  estable y probado (señalización v2) para implementar SFU, composición y
  publicación RTMPS.

## Objetivos

- Entrada por enlace de invitación con lobby: info de la sala, vista previa,
  dispositivos, efectos de fondo, nombre y título.
- Videollamada multi-participante por WebRTC con tres vistas (escenario,
  mínima, estadísticas), pantalla compartida en caliente y reconexión
  transparente.
- Calidad dictada por el puente; el invitado solo elige la resolución de su
  cámara.
- Un modo alternativo "solo emisor" (WebSocket + WebCodecs) para puentes sin
  SFU.

### Métricas de éxito

- Del enlace a "En la sala" en menos de 10 s con dispositivos permitidos.
- Dos invitados se ven y se oyen (verificado por E2E en cada cambio).
- Una caída de red breve no saca al invitado de la sala.
- Cobertura ≥ 80 % en dominio, aplicación y transporte; CI y E2E verdes.

## No objetivos

- Publicar RTMPS, componer la salida o grabar en servidor (lo hace el puente).
- Controles de anfitrión (salir al aire, expulsar, layouts de emisión).
- Chat, reacciones o compartir archivos en esta etapa.

## Valor diferencial

Una antesala y videollamada de navegador, documentada y probada de extremo a
extremo, que deja la publicación en manos de la infraestructura del
organizador gracias a un contrato de señalización abierto y agnóstico del SFU.
