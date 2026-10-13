# TASKS — webrtc-lobby

```toml
artifact_type = "task_file"
initiative    = "webrtc-lobby"
spec_id       = "SPEC-0002"
owner         = "rafex"
state         = "in_progress"
```

## Tareas

### TASK-0101 - Dominio de señalización, sala, invitación y configuración

```toml
id             = "TASK-0101"
title          = "Dominio de señalización, sala, invitación y configuración"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["domain", "protocol"]
dependencies   = []
expected_files = ["source/frontend/nodejs/webrelay/src/domain/signaling.ts", "source/frontend/nodejs/webrelay/src/domain/room.ts", "source/frontend/nodejs/webrelay/src/domain/invite.ts", "source/frontend/nodejs/webrelay/src/domain/app-config.ts", "source/frontend/nodejs/webrelay/src/domain/quality-profile.ts"]
close_criteria = "Tipos y parser v2, reductor de sala, enlace, config y perfil con tests; RTMPS fuera del cliente"
validation     = ["make test-unit"]
completion_evidence = ["commits 75d71a4, 688a308, b38b114", "tests/unit/signaling.test.ts y lobby-domain.test.ts verdes"]
```

### TASK-0102 - Puertos y adaptadores de navegador

```toml
id             = "TASK-0102"
title          = "Puertos y adaptadores de navegador"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["infrastructure"]
dependencies   = ["TASK-0101"]
expected_files = ["source/frontend/nodejs/webrelay/src/ports/*", "source/frontend/nodejs/webrelay/src/infrastructure/signaling/*", "source/frontend/nodejs/webrelay/src/infrastructure/webrtc/*", "source/frontend/nodejs/webrelay/src/infrastructure/devices/*", "source/frontend/nodejs/webrelay/src/infrastructure/storage/*"]
close_criteria = "Señalización por WebSocket real, RTCPeerConnection, dispositivos, preferencias y estadísticas"
validation     = ["make test"]
completion_evidence = ["commit f03e1f3", "tests/integration/signaling-flow.test.ts y adapters.test.ts verdes"]
```

### TASK-0103 - Lobby, llamada WebRTC y llamada WebSocket

```toml
id             = "TASK-0103"
title          = "Lobby, llamada WebRTC y llamada WebSocket"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["application"]
dependencies   = ["TASK-0102"]
expected_files = ["source/frontend/nodejs/webrelay/src/application/*"]
close_criteria = "Handshake, negociación serializada, ICE encolado, toggles sin renegociar, perfil, reconexión y errores fatales probados con fakes"
validation     = ["make test-unit", "make coverage"]
completion_evidence = ["commits d2ac0c3, b38b114, 2caec23", "webrtc-call, lobby-service, signaling-client y websocket-call tests verdes; cobertura application 91 %"]
```

### TASK-0104 - UI de lobby, llamada y ajustes

```toml
id             = "TASK-0104"
title          = "UI de lobby, llamada y ajustes"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["ui"]
dependencies   = ["TASK-0103"]
expected_files = ["source/frontend/nodejs/webrelay/src/ui/*", "source/frontend/nodejs/webrelay/src/templates/**/*.pug", "source/frontend/nodejs/webrelay/src/styles/main.css"]
close_criteria = "Pantallas de enlace inválido, lobby, llamada (3 vistas) y salida; modal de ajustes con 5 secciones"
validation     = ["make test-integration", "make e2e"]
completion_evidence = ["commit e4fb999", "pug-templates.test.ts verde (sin RTMPS en el HTML)", "navegador: lobby, vistas y ajustes verificados contra el puente de desarrollo"]
```

### TASK-0105 - Puente de desarrollo

```toml
id             = "TASK-0105"
title          = "Puente de desarrollo"
state          = "done"
priority       = "p1"
owner          = "rafex"
labels         = ["testing", "webrtc"]
dependencies   = ["TASK-0101"]
expected_files = ["source/frontend/nodejs/webrelay/tests/support/dev-bridge.mjs"]
close_criteria = "just bridge-dev permite a dos pestañas verse y oírse"
validation     = ["make e2e"]
completion_evidence = ["commit 1c13e0f", "E2E: video decodificado en ambos sentidos a través de werift"]
```

### TASK-0106 - Efectos de fondo

```toml
id             = "TASK-0106"
title          = "Efectos de fondo"
state          = "done"
priority       = "p1"
owner          = "rafex"
labels         = ["effects"]
dependencies   = ["TASK-0103"]
expected_files = ["source/frontend/nodejs/webrelay/src/infrastructure/effects/*"]
close_criteria = "Desenfoque y fondo procedural/subido aplicados a la cámara; degradación segura"
validation     = ["prueba manual en navegador"]
completion_evidence = ["commit 5b6a102", "navegador: modelo cargado en ~400 ms, salida 640x360, fondo Atardecer reemplaza el original"]
```

### TASK-0107 - Grabación local de la llamada

```toml
id             = "TASK-0107"
title          = "Grabación local de la llamada"
state          = "done"
priority       = "p2"
owner          = "rafex"
labels         = ["recording"]
dependencies   = ["TASK-0104"]
expected_files = ["source/frontend/nodejs/webrelay/src/ui/call-recorder.ts"]
close_criteria = "WebM reproducible del mosaico con audio mezclado; exportación OGV"
validation     = ["prueba manual en navegador"]
completion_evidence = ["commit 0eaa8d3", "navegador: 3 s → 86 KB WebM decodificable a 1280x720 (antes 0 bytes por destino de audio sin fuentes)"]
```

### TASK-0108 - Contenedor con configuración en tiempo de ejecución

```toml
id             = "TASK-0108"
title          = "Contenedor con configuración en tiempo de ejecución"
state          = "done"
priority       = "p1"
owner          = "rafex"
labels         = ["container", "deployment"]
dependencies   = ["TASK-0104"]
expected_files = ["containers/frontend/40-webrelay-config.sh", "containers/frontend/nginx.conf", "helpers/shell/container.sh"]
close_criteria = "just up --bridge-url … genera config.json y la app entra a la sala bajo la CSP"
validation     = ["just up --port 8091 --bridge-url ws://localhost:8090/signal"]
completion_evidence = ["commit 1c09a88", "config.json generado (no-store), Permissions-Policy con speaker-selection, entrada a la sala sin errores de consola"]
```

### TASK-0109 - E2E de navegador

```toml
id             = "TASK-0109"
title          = "E2E de navegador"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["testing", "e2e"]
dependencies   = ["TASK-0104", "TASK-0105"]
expected_files = ["source/frontend/nodejs/webrelay/tests/e2e/*", "source/frontend/nodejs/webrelay/playwright.config.ts", "containers/e2e/Containerfile"]
close_criteria = "CA1–CA7 automatizados, local y en contenedor"
validation     = ["make e2e", "make e2e-ci"]
completion_evidence = ["commit 4077fe3", "make e2e: 5 passed (3 ejecuciones seguidas)", "make e2e-ci: 5 passed en imagen Playwright v1.62.1-noble"]
```

### TASK-0110 - Interoperabilidad con ether-streaming-culerin

```toml
id             = "TASK-0110"
title          = "Interoperabilidad con ether-streaming-culerin"
state          = "todo"
priority       = "p0"
owner          = "rafex"
labels         = ["integration", "bridge"]
dependencies   = ["TASK-0109"]
expected_files = []
close_criteria = "El E2E pasa apuntando al puente real y la sala se ve en un canal RTMPS"
validation     = ["make e2e con bridgeUrl del puente real", "prueba manual"]
completion_evidence = []
```

Depende de que `ether-streaming-culerin` implemente `docs/signaling.md`.
