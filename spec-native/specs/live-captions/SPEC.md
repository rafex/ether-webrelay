# SPEC — live-captions

```toml
artifact_type = "spec"
id            = "SPEC-0004"
state         = "active"
owner         = "rafex"
created_at    = "2026-11-20"
updated_at    = "2026-11-21"
replaces      = "none"
related_tasks       = ["TASK-0301", "TASK-0302", "TASK-0303", "TASK-0304"]
related_decisions   = ["DEC-0001", "DEC-0010"]
artifacts           = ["docs/signaling.md", "source/frontend/nodejs/webrelay/src/application/caption-service.ts", "source/frontend/nodejs/webrelay/src/ports/transcriber.ts"]
validation          = ["make ci", "make e2e-ci", "make e2e (contra el puente)", "prueba manual con un motor real"]
```

Promueve IDEA-0001.

## Resumen

Subtítulos en vivo de la emisión: cada invitado transcribe su propia voz **en su navegador** y envía el texto al
puente, que lo dibuja en la parte baja de la emisión. El audio no sale del equipo del invitado.

## Problema

Las emisiones en directo no son accesibles sin subtítulos, y transcribir en el servidor costaría CPU en el
compositor y exigiría enviar el audio a un servicio de terceros.

## Alcance

### Incluye
- Contrato aditivo de señalización (`caption`, `captions`, `welcome.captions`; docs/signaling.md, CONV-0006).
- Doble consentimiento: el anfitrión activa los subtítulos de la sala y cada invitado elige transcribirse.
- Lado del puente (`ether-streaming-culerin`): dibujado en el sitio sin recomponer (`drawtext reload=1`), expiración,
  límites y limpieza del texto. Ver su PR de subtítulos.
- Puerto `TranscriberPort` y `CaptionService` (cuándo escuchar, limitación de ritmo, reintentos con espera).
- Motor real: Whisper tiny cuantizado en el navegador (ONNX Runtime Web, WebAssembly, Worker), autoalojado en la
  imagen con hash fijo; segmentación de voz, cola de decodificación y limpieza del texto en módulos puros probados.

### Excluye
- Guardar o exponer transcripciones.
- Traducción.
- Subtitular a quien no está en escena.

## Requisitos funcionales

1. RF1 — Un cliente o puente que no conozca los subtítulos funciona igual (mensajes desconocidos ignorados).
2. RF2 — El invitado solo transcribe si lo eligió, el anfitrión los activó, está conectado y su micrófono está activo.
3. RF3 — Al silenciarse o salir de la sala, la frase en pantalla desaparece.
4. RF4 — Un fallo del motor nunca afecta a la llamada y no se reintenta en bucle.
5. RF5 — Sin motor disponible, la opción no se ofrece.

## Criterios de aceptación

- `tests/unit/caption-service.test.ts`, `signaling.test.ts` y `webrtc-call.test.ts` en verde.
- Con un puente que los soporta, las frases del invitado aparecen en la emisión.
- Motor real (TASK-0303): latencia y CPU medidas en un equipo de gama media antes de ofrecerlo.

## Riesgos

- CPU del cliente con un motor WASM de un solo hilo (sin COEP): medido en un Mac M-series (≈1 s por 6-9 s de voz);
  falta medirlo en un equipo de gama media y con los efectos de video activos.
- Calidad del reconocimiento por idioma y modelo (Whisper tiny ≈ 44 MB, ≈70 MB con el runtime): el español de voz
  sintética sale casi exacto; falta voz humana real, con ruido y con acento.
- Primera carga: ≈70 MB por navegador; el aviso «Cargando el modelo de voz» sale en los ajustes.
- `transformers.js` baja por defecto su runtime de un CDN público y su caché lo convierte en `blob:`: ambos se
  desactivan (runtime como activo propio, `env.useWasmCache=false`) y `captions.spec.ts` comprueba que no se
  contacta a ningún tercero bajo la CSP de producción.
