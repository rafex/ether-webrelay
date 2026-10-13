+++
[session]
state = "in_progress"
agent = "claude-code"
initiative = "webrtc-lobby"
task = "TASK-0110"
intent = "Antesala + videollamada WebRTC implementadas y verificadas (make ci, make e2e, make e2e-ci, navegador). Falta interoperar con el puente real."
last_updated = "2026-10-13T20:10:49Z"
+++

# Active Session

## Current state

Antesala + videollamada WebRTC implementadas y verificadas (make ci, make e2e, make e2e-ci, navegador). Falta interoperar con el puente real.

## Next steps

1. Revisar y mergear feature/webrtc-lobby.
2. Implementar docs/signaling.md en ether-streaming-culerin (puede tomar tests/support/dev-bridge.mjs como referencia).
3. TASK-0110: correr el E2E contra el puente real y verificar la sala en un canal RTMPS.
4. Cerrar SPEC-0001 y SPEC-0002 con close_initiative y actualizar TRACEABILITY.md.

## Context for next agent

El backend vive en ../ether-streaming-culerin. Chrome headless en macOS no entrega audio del dispositivo falso: el E2E usa micrófono sintético. Podman en macOS no monta /Volumes: make ci/e2e-ci envían el árbol por tar y el contenedor genera config.json desde WEBRELAY_*. El refresco de índices de SpecNative requiere que la tabla siga al encabezado (bug upstream señalado).
