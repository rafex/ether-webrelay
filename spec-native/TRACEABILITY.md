# TRACEABILITY.md

Mapa de relaciones entre specs, tareas, decisiones y validacion.

## Objetivo

Permitir que una persona o agente pueda reconstruir rapidamente:

- que spec origino un cambio
- que tareas ejecutaron esa spec
- que decisiones condicionaron el trabajo
- que evidencia valida el resultado

## Cuando actualizar este archivo

Actualizar al cerrar una iniciativa, no durante la ejecucion.
El momento correcto es cuando la spec pasa a estado `done` o `blocked`.

Si una decision cambia el alcance de una spec activa, registrar
la relacion antes de continuar.

## Formato sugerido

| Spec | Estado | Tareas | Decisiones | Archivos principales | Validacion | Observaciones |
| --- | --- | --- | --- | --- | --- | --- |
| SPEC-0001 webrelay-mvp | done | TASK-0001…TASK-0010, TASK-0012 (done); TASK-0011 (blocked) | DEC-0001…DEC-0008 | `source/frontend/nodejs/webrelay/*`, `helpers/*`, `containers/*`, `docs/protocol-websocket.md` | `make ci`, `make e2e`, `make e2e-ci` | Cerrada el 2026-10-14. TASK-0011 sigue bloqueada con justificación: continúa como TASK-0110 (SPEC-0002) sobre la señalización v2. El pipeline WebCodecs + WebSocket sobrevive como modo alternativo `websocket`. |
| SPEC-0002 webrtc-lobby | done | TASK-0101…TASK-0110 (done) | DEC-0009…DEC-0014, ARCH-0005, CONV-0006 | `source/frontend/nodejs/webrelay/*`, `docs/signaling.md`, `containers/*` | `make ci` (185 tests), `make e2e` y `make e2e-ci` (5/5, también contra `ether-streaming-culerin`), CI de GitHub en verde, emisión a YouTube confirmada, despliegue en k3s Server 2 con llamada WebRTC real | Cerrada el 2026-10-14. Despliegue: `rafex/ether-streaming-gitops` (streaming.rafex.app). |
