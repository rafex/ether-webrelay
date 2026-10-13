---
title: Arquitectura
tags: [architecture, hexagonal, frontend]
---

# Arquitectura

Ether WebRelay es **solo frontend**: una aplicación TypeScript (Vite + Pug)
que corre en el navegador. Captura, compone, codifica y entrega por WebSocket
a un puente externo que publica en RTMPS.

## Contexto

```mermaid
flowchart LR
    subgraph Navegador
        U[Usuario] --> UI[UI Pug + RelayApp]
        UI --> APP[RelaySession]
    end
    APP -- "wss:// tramas binarias v1" --> BR[(Puente externo)]
    BR -- RTMPS --> ING[(YouTube / Twitch / servidor propio)]
    style BR stroke-dasharray: 5 5
```

El puente (línea punteada) está fuera del alcance de este repositorio; su
contrato es [el protocolo](protocol.md).

## Hexágono

```mermaid
flowchart TB
    subgraph driving[Adaptadores de entrada]
        UI[ui/app.ts · plantillas Pug]
    end
    subgraph application[Aplicación]
        RS[RelaySession]
        BL[BridgeLink]
    end
    subgraph domain[Dominio · sin dependencias]
        P[protocol]
        MC[MediaClock]
        AT[AudioTimeline]
        KS[KeyframeScheduler]
        BP[BackpressureGate]
        RP[ReconnectPolicy]
        CS[codec-selection]
        ST[relay-settings]
        LY[layout]
    end
    subgraph ports[Puertos]
        MPP[[MediaPipelinePort]]
        TP[[TransportPort]]
        TM[[Timer / TimeSource]]
        TC[[TranscoderPort]]
    end
    subgraph infra[Adaptadores de salida]
        BMP[BrowserMediaPipeline]
        CAP[getUserMedia / getDisplayMedia]
        CMP[CanvasCompositor]
        MIX[WebAudioMixer + AudioWorklet]
        ENC[WebCodecs Video/Audio Encoder]
        WS[WebSocketTransport]
        FF[FfmpegWasmTranscoder]
    end
    UI --> RS
    RS --> BL
    RS --> MPP
    BL --> TP
    BL --> TM
    RS --> domain
    BL --> domain
    BMP -.implementa.-> MPP
    WS -.implementa.-> TP
    FF -.implementa.-> TC
    BMP --> CAP & CMP & MIX & ENC
```

### Reglas de dependencia

| Capa | Puede importar | No puede importar |
|------|----------------|-------------------|
| `domain/` | nada (solo tipos propios) | ports, application, infrastructure, ui, APIs del navegador |
| `ports/` | `domain/` | application, infrastructure, ui |
| `application/` | `domain/`, `ports/` | infrastructure, ui, APIs del navegador |
| `infrastructure/` | `domain/`, `ports/` | application, ui |
| `ui/` | todas | — |

Consecuencia: dominio y aplicación se prueban en Node sin navegador (fakes de
`MediaPipelinePort`, `TransportPort` y `Timer`).

## Flujo de medios

```mermaid
flowchart LR
    CAM[Cámara] --> CMP
    SCR[Pantalla] --> CMP[CanvasCompositor<br/>PiP, tick en Worker]
    CMP -->|VideoFrame + pts| VE[VideoEncoder<br/>H.264 AVCC / VP8]
    MIC[Micrófono] --> MIX
    SYS[Audio sistema/pestaña] --> MIX[WebAudioMixer]
    MIX -->|PCM planar| AW[AudioWorklet pcm-tap]
    AW -->|AudioTimeline pts| AE[AudioEncoder<br/>AAC / Opus]
    VE --> RS[RelaySession]
    AE --> RS
    RS -->|BackpressureGate| BL[BridgeLink]
    BL -->|tramas v1| WS[(WebSocket)]
    CMP -.captureStream.-> REC[LocalRecorder WebM]
    MIX -.MediaStream.-> REC
    REC -->|bajo demanda| FF[ffmpeg.wasm → OGV]
```

- **Un solo reloj** (`MediaClock`) estampa video y audio.
- **Ticks en Worker**: los timers del hilo principal se ralentizan en pestañas
  ocultas (habitual al compartir pantalla).
- **ffmpeg.wasm** solo para formatos que WebCodecs no produce (OGV), cargado
  bajo demanda: nunca interfiere con la transmisión en vivo.

## Máquina de estados de la sesión

```mermaid
stateDiagram-v2
    [*] --> idle
    idle --> starting: start()
    starting --> live: welcome
    live --> reconnecting: socket cerrado / heartbeat perdido
    reconnecting --> live: welcome (resume)
    reconnecting --> failed: intentos agotados
    starting --> failed: error fatal / captura denegada
    live --> failed: error fatal del puente
    live --> stopping: stop()
    stopping --> stopped: BYE
    stopped --> [*]
    failed --> [*]
```
