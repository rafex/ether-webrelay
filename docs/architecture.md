---
title: Arquitectura
tags: [architecture, hexagonal, frontend, webrtc]
---

# Arquitectura

Ether WebRelay es **solo frontend**: una aplicación TypeScript (Vite + Pug)
donde el invitado entra a una **videollamada** desde un enlace, ve a los demás
participantes y envía su cámara, pantalla y audio al **puente**
([`ether-streaming-culerin`](https://github.com/rafex/ether-streaming-culerin)),
que compone la sala y la publica en RTMPS. El cliente nunca conoce RTMPS.

## Contexto

```mermaid
flowchart LR
    subgraph Navegadores
        A[Invitado A · webrelay]
        B[Invitado B · webrelay]
    end
    A -- "wss:// señalización v2" --> BR
    B -- "wss:// señalización v2" --> BR
    A <== "WebRTC (SFU)" ==> BR
    B <== "WebRTC (SFU)" ==> BR
    subgraph BR[Puente · ether-streaming-culerin]
        SFU[SFU] --> MIX[Composición]
    end
    MIX -- RTMPS --> CH[(YouTube / Twitch / …)]
    HOST[Consola del anfitrión] -. sale al aire .-> BR
    style BR stroke-dasharray: 5 5
```

- Contrato principal: [señalización v2](signaling.md).
- Modo alternativo "solo emisor": [protocolo binario v1](protocol-websocket.md)
  con WebCodecs.

## Flujo del invitado

```mermaid
stateDiagram-v2
    [*] --> Carga: /join/<sala>?t=<token>
    Carga --> EnlaceInvalido: sin sala o token
    Carga --> Lobby: config.json + soporte del navegador
    Lobby --> Lobby: room.peek → room.info · vista previa · ajustes
    Lobby --> Rechazado: error fatal (token, sala)
    Lobby --> Llamada: Entrar (join)
    Llamada --> Llamada: escenario ⇄ mínima ⇄ estadísticas
    Llamada --> Reconectando: caída de red
    Reconectando --> Llamada: welcome (resume)
    Llamada --> Fuera: Salir · error
    Fuera --> Lobby: Volver a entrar
```

## Hexágono

```mermaid
flowchart TB
    subgraph ui[ui · adaptadores de entrada]
        APP[WebRelayApp] --> LV[LobbyView]
        APP --> CV[CallView]
        APP --> SD[SettingsDialog]
        APP --> REC[CallRecorder]
    end
    subgraph application
        LS[LobbyService]
        SC[SignalingClient]
        WC[WebRtcCallSession]
        WSC[WebSocketCallSession]
        RS[RelaySession + BridgeLink]
    end
    subgraph domain[domain · sin dependencias]
        SIG[signaling]
        ROOM[room]
        INV[invite / app-config]
        QP[quality-profile]
        PREF[preferences / shortcuts / view-mode]
        V1[protocol v1 · políticas · reloj]
    end
    subgraph ports
        P1[[SignalingPort]]
        P2[[PeerConnectionFactory]]
        P3[[MediaDevicesPort]]
        P4[[PreferencesPort]]
        P5[[VideoEffectsPort]]
        P6[[ComposableMediaPipelinePort / TransportPort]]
    end
    subgraph infrastructure[infrastructure · adaptadores de salida]
        I1[WebSocketSignaling]
        I2[BrowserPeerConnection]
        I3[BrowserMediaDevices]
        I4[LocalPreferences]
        I5[MediaPipeEffects]
        I6[BrowserMediaPipeline · WebCodecs · WebSocketTransport]
    end
    ui --> application
    application --> domain
    application --> ports
    I1 -.-> P1
    I2 -.-> P2
    I3 -.-> P3
    I4 -.-> P4
    I5 -.-> P5
    I6 -.-> P6
    WC --> SC
    LS --> SC
    WSC --> RS
```

### Reglas de dependencia

| Capa | Puede importar | No puede importar |
|------|----------------|-------------------|
| `domain/` | nada | ports, application, infrastructure, ui, APIs del navegador |
| `ports/` | `domain/` | application, infrastructure, ui |
| `application/` | `domain/`, `ports/` | infrastructure, ui, APIs del navegador |
| `infrastructure/` | `domain/`, `ports/` | application, ui |
| `ui/` | todas | — |

`tests/architecture/layers.test.ts` hace cumplir estas reglas. Por eso la
grabación (que depende del snapshot de la llamada) vive en `ui/`.

## Llamada WebRTC

```mermaid
flowchart LR
    LOBBY[LobbyService<br/>LocalMediaProvider] -->|pistas abiertas| CALL[WebRtcCallSession]
    CALL -->|publish: cámara, mic, pantalla| PUB[(RTCPeerConnection publish)]
    SUB[(RTCPeerConnection subscribe)] -->|pistas remotas por mid| CALL
    CALL <-->|JSON v2| SIGC[SignalingClient]
    CALL -->|snapshot| VIEW[CallView]
    FX[MediaPipeEffects] -.->|cámara procesada| LOBBY
```

- **Una sola conexión de señalización** compartida por lobby y llamada
  (`SignalingClient`: backoff, heartbeat, errores fatales con mensajes
  amigables).
- Los mensajes se procesan **en orden** (cola de promesas); el ICE remoto se
  encola hasta tener descripción remota.
- Renegociación **serializada**: peticiones solapadas se agrupan; video y
  audio de la pantalla salen en una sola oferta.
- Cámara/pantalla on-off y cambios de dispositivo o efecto usan
  `replaceTrack`; silenciar solo desactiva la pista.
- El perfil del puente se aplica a los senders (bitrate escalado al área
  realmente enviada).
- Cada dispositivo de la vista previa se muestra en cuanto abre: un permiso de
  micrófono pendiente no bloquea la cámara.

## Modo alternativo `websocket`

`WebSocketCallSession` ofrece el mismo `CallController` sobre `RelaySession`:
las pistas del lobby entran a `BrowserMediaPipeline` (compositor en canvas +
mezclador Web Audio + WebCodecs), que acepta cambios de fuentes en caliente.
Se elige con `transport` en `config.json` o en `room.info`.

## Efectos y grabación

- **Efectos** (`MediaPipeEffects`): segmentación a 256 px con el selfie
  segmenter de MediaPipe; desenfoque por reducción-ampliación (sin filtros de
  canvas) o fondo procedural/subido. Wasm empaquetado y carga diferida; si
  falla, la cámara sigue sin efecto.
- **Grabación** (`CallRecorder`): mosaico igual al escenario + audio mezclado
  → WebM (MediaRecorder); exportable a OGV con ffmpeg.wasm bajo demanda.

## Configuración en tiempo de ejecución

`/config.json` (o variables `WEBRELAY_*` en el contenedor) define
`bridgeUrl`, `relayUrl`, `transport`, `defaultProfile`, `defaultView` y
`effectsModelUrl`. Ninguna credencial ni destino RTMPS forma parte de la
configuración del cliente.
