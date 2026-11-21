+++
[session]
state = "in_progress"
agent = "unknown"
initiative = "live-captions"
task = "TASK-0304"
intent = "Subtítulos en vivo con Whisper tiny desplegados en streaming.rafex.app; MediaPipe 1.2.2 y todos los PR de Dependabot integrados. Falta la prueba humana (voz real, ruido, acento, equipo de gama media) y la validación con cámara real del encuadre (TASK-0203)."
last_updated = "2026-11-21T02:25:44Z"
+++

# Active Session

## Current state

Subtítulos en vivo con Whisper tiny desplegados en streaming.rafex.app; MediaPipe 1.2.2 y todos los PR de Dependabot integrados. Falta la prueba humana (voz real, ruido, acento, equipo de gama media) y la validación con cámara real del encuadre (TASK-0203).

## Next steps

1. El usuario prueba subtítulos con su voz (consola: Subtítulos en vivo; Ajustes → Audio) y el encuadre/desenfoque con cámara real; cerrar TASK-0304 y TASK-0203 con sus observaciones. 2. Detección de quién habla (IDEA-0003) en el planificador del puente, con límite de frecuencia por el corte de ~2 s al recomponer. 3. Matting (IDEA-0002): decidir antes si «sin WASM» exige TF.js/WebGPU. 4. Bajar el límite de CPU del bridge en gitops tras medir con 8 invitados.
