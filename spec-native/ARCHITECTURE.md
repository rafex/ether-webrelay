# ARCHITECTURE.md

Índice de arquitectura. Los componentes, límites y flujos canónicos viven en
`architecture/ARCH-XXXX-<slug>.md`.

## Debe responder

- Cuales son los modulos o bounded contexts principales.
- Que responsabilidad tiene cada modulo.
- Donde estan los limites entre capas.
- Que dependencias estan permitidas o prohibidas.
- Cuales son los puntos de integracion externos.

## Vista general

Aplicación de navegador única (`source/frontend/nodejs/webrelay`) con
arquitectura hexagonal. Integración externa: el **puente** por WebSocket
(`docs/protocol-websocket.md`), que publica en RTMPS. Detalle y diagramas de flujo y
estados en `docs/architecture.md`.

```mermaid
flowchart LR
    subgraph webrelay[ether-webrelay · navegador]
        UI[ui · Pug] --> APP
        subgraph APP[application]
            RS[RelaySession] --> BL[BridgeLink]
        end
        APP --> DOM[domain<br/>protocolo · reloj · políticas]
        APP --> PORTS[[ports]]
        INFRA[infrastructure<br/>captura · canvas · Web Audio · WebCodecs · WebSocket · ffmpeg.wasm] -.implementa.-> PORTS
    end
    BL == "wss:// protocolo v1" ==> BRIDGE[(Puente externo)]
    BRIDGE == RTMPS ==> INGEST[(YouTube / Twitch / propio)]
```

| Módulo | Responsabilidad | Puede depender de |
|--------|-----------------|-------------------|
| `domain/` | Protocolo, reloj de sesión, timeline de audio, keyframes, contrapresión, reconexión, códecs, layout, validación | nada |
| `ports/` | Contratos: `MediaPipelinePort`, `TransportPort`, `Timer`/`TimeSource`, `TranscoderPort` | `domain/` |
| `application/` | `RelaySession`, `BridgeLink` (handshake, heartbeat, reconexión, framing) | `domain/`, `ports/` |
| `infrastructure/` | Adaptadores de navegador | `domain/`, `ports/` |
| `ui/` | Adaptador de entrada sobre la página Pug | todos |

Restricción verificada por `tests/architecture/layers.test.ts`: `domain/` y
`application/` no usan APIs del navegador ni paquetes npm.

> El CLI o MCP pueden generar esta sección desde `architecture/`. No escribir texto entre el encabezado y la tabla.

## Componentes

| ID | Estado | Componente | Tags |
| --- | --- | --- | --- |
| [ARCH-0001](./architecture/ARCH-0001-capas-hexagonales-del-webrelay.md) | active | Capas hexagonales del webrelay | component/frontend, concern/architecture, pattern/hexagonal |
| [ARCH-0002](./architecture/ARCH-0002-pipeline-de-medios-del-navegador.md) | active | Pipeline de medios del navegador | component/media-pipeline, concern/sync, tech/webcodecs |
| [ARCH-0003](./architecture/ARCH-0003-enlace-con-el-puente-y-m-quina-de-estados.md) | active | Enlace con el puente y máquina de estados | component/bridge-link, concern/resilience, concern/protocol |
| [ARCH-0004](./architecture/ARCH-0004-estructura-del-repositorio-y-tooling.md) | active | Estructura del repositorio y tooling | component/tooling, concern/build, rule/ether-best-practice |
