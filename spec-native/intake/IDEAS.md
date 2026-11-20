# Intake

Ideas pendientes de triage. No son tareas ejecutables ni aparecen en el
tablero de entrega hasta que se promueven a una spec y sus tareas derivadas.

### IDEA-0001 - Subtítulos en vivo con Whisper (tiny) en el navegador

```toml
id = "IDEA-0001"
title = "Subtítulos en vivo con Whisper (tiny) en el navegador"
state = "promoted"
promoted_to = "SPEC-0004"
priority = "p2"
owner = "rafex"
created_at = '2026-11-20T04:18:08Z'
```

Transcribir el micrófono del invitado en el cliente (Whisper tiny en WASM, modelo ~40 MB autoalojado en la imagen) y enviar el texto al puente para rotularlo en la emisión con drawtext (contrato de señalización nuevo: CONV-0006 / docs/signaling.md, y planificador del puente). Primero un spike de viabilidad: medir latencia y CPU en el navegador sin COEP (WASM de un solo hilo) y decidir idioma/modelo. Riesgo: CPU del cliente; COEP require-corp desbloquearía WASM multihilo pero exige revisar img-src https: y Safari. Privacidad: la transcripción nunca sale del navegador salvo el texto final.

### IDEA-0002 - Mejor recorte de fondo (matting) sin halo, con WebGPU

```toml
id = "IDEA-0002"
title = "Mejor recorte de fondo (matting) sin halo, con WebGPU"
state = "triaged"
priority = "p3"
owner = "rafex"
created_at = '2026-11-20T04:18:11Z'
```

Sustituir o complementar el selfie segmenter de MediaPipe por un modelo de matting (p. ej. Robust Video Matting) para reducir los bordes con halo en fondos virtuales. El usuario pidió hacerlo SIN WASM. Matiz importante: ONNX Runtime Web con el proveedor WebGPU sigue cargando un .wasm pequeño de soporte; un camino realmente sin WASM sería TensorFlow.js con backend WebGPU o shaders WGSL propios. Decidir antes de implementar. Requiere WebGPU (Chrome/Edge; Safari y Firefox según versión), con respaldo al segmentador actual. Modelo mayor que el actual: autoalojarlo con SHA-256 como selfie_segmenter. Medir coste por fotograma antes de adoptarlo. Complementa a la tarea de mover los efectos a un Worker/OffscreenCanvas.

### IDEA-0003 - Detección de quién habla (VAD) para pasar el foco al orador

```toml
id = "IDEA-0003"
title = "Detección de quién habla (VAD) para pasar el foco al orador"
state = "triaged"
priority = "p3"
owner = "rafex"
created_at = '2026-11-20T04:18:14Z'
```

Que el layout 'speaker' (y opcionalmente 'auto') ponga en foco a quien habla, sin WASM: bastan niveles de audio. El mosaico de la emisión lo compone el puente, así que la decisión debe vivir en su planificador (domain.PlanComposition). Opción preferida: el puente deduce quién habla del nivel de audio RTP (extensión urn:ietf:params:rtp-hdrext:ssrc-audio-level, RFC 6464) que el SFU ya ve, con histéresis (~1 s) para evitar saltos; no cambia el contrato con el webrelay. Alternativa: el cliente envía speaking en self.update (cambia docs/signaling.md y CONV-0006, y confía en el cliente). Interactúa con el recomponer: cada cambio de foco arranca una ejecución de FFmpeg (corte ~2 s), por lo que hace falta límite de frecuencia y/o resolver antes el rediseño de recomposición.

