# PRODUCT.md

Fuente de verdad del producto.

## Problema

Transmitir en vivo (YouTube, Twitch o un servidor propio) exige hoy instalar
software de escritorio (OBS y similares) o depender de estudios web cerrados.
Los portales web que quieren que sus usuarios transmitan cámara + pantalla no
tienen una pieza de navegador reutilizable que capture, codifique con
hardware y entregue un stream sincronizado a su propia infraestructura RTMPS.

## Usuarios

- **Equipos que integran un portal web** (educación, eventos, soporte):
  necesitan embeber "transmitir desde el navegador" sin instalar nada ni
  ceder el stream a terceros.
- **Personas que transmiten** desde ese portal: quieren elegir cámara,
  micrófono, pestaña/ventana/pantalla y audio del sistema, y que la
  transmisión aguante cortes breves de red.
- **Equipo del puente** (servidor externo): necesita un contrato estable y
  documentado para recibir los medios y publicarlos en RTMPS.

## Objetivos

- Capturar cámara, micrófono, pantalla y audio del sistema/pestaña con el
  selector nativo del navegador.
- Codificar en el navegador con WebCodecs (aceleración por hardware cuando
  exista) en H.264/AAC, remuxables a FLV sin transcodificar.
- Entregar por `wss://` un flujo con marcas de tiempo compartidas, resistente
  a reconexiones y con contrapresión.
- Publicar un contrato de protocolo versionado y probado para el puente.

### Métricas de éxito

- Latencia de captura a socket < 300 ms a 720p30 en hardware común.
- Reconexión transparente: una caída < 10 s no termina la transmisión y el
  primer frame tras reconectar es un keyframe.
- 0 frames corruptos bajo congestión (solo descartes marcados).
- Cobertura ≥ 80 % en dominio, aplicación y transporte; CI en contenedor verde.

## No objetivos

- Implementar el servidor puente o publicar RTMPS desde este repositorio.
- Edición, escenas complejas o efectos tipo OBS (solo pantalla + cámara PiP).
- Grabación en la nube, chat, multi-invitado o WebRTC.
- Soportar navegadores sin WebCodecs.

## Valor diferencial

Una pieza pequeña, documentada y probada que convierte cualquier portal web
en un emisor en vivo: la codificación ocurre en el cliente (sin costo de CPU
en servidor), el puente solo remuxea, y el protocolo explícito permite
implementar el puente en cualquier lenguaje.
