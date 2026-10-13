# TASKS — webrelay-mvp

```toml
artifact_type = "task_file"
initiative    = "webrelay-mvp"
spec_id       = "SPEC-0001"
owner         = "rafex"
state         = "in_progress"
```

## Tareas

### TASK-0001 - Estructura del repositorio y tooling Ether

```toml
id             = "TASK-0001"
title          = "Estructura del repositorio y tooling Ether"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["tooling", "ci"]
dependencies   = []
expected_files = ["Makefile", "Justfile", "helpers/mk/*.mk", "helpers/shell/*.sh", "helpers/just/*.just", "containers/ci/Containerfile", "containers/frontend/Containerfile", ".github/workflows/ci.yml"]
close_criteria = "make ci pasa en contenedor y just up sirve la app en localhost"
validation     = ["make ci", "just up --port 8091"]
completion_evidence = ["make ci exit=0 (npm ci, biome, tsc+vite build, 97 tests) en ether-webrelay-ci:local", "just up --port 8091: index text/html, JS application/javascript, wasm application/wasm, /healthz ok"]
```

### TASK-0002 - Protocolo binario v1

```toml
id             = "TASK-0002"
title          = "Protocolo binario v1"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["protocol", "domain"]
dependencies   = []
expected_files = ["source/frontend/nodejs/webrelay/src/domain/protocol.ts", "docs/protocol-websocket.md"]
close_criteria = "Codec de tramas y mensajes del puente con round-trip y rechazo de tramas inválidas"
validation     = ["make test-unit"]
completion_evidence = ["tests/unit/protocol.test.ts verde (round-trip, offsets big-endian, rechazos, base64)"]
```

### TASK-0003 - Reloj de sesión, timeline de audio y keyframes

```toml
id             = "TASK-0003"
title          = "Reloj de sesión, timeline de audio y keyframes"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["sync", "domain"]
dependencies   = []
expected_files = ["source/frontend/nodejs/webrelay/src/domain/media-clock.ts", "source/frontend/nodejs/webrelay/src/domain/audio-timeline.ts", "source/frontend/nodejs/webrelay/src/domain/keyframe-scheduler.ts"]
close_criteria = "Timestamps monótonos, audio contiguo sin solapes, GOP fijo y keyframes bajo demanda"
validation     = ["make test-unit"]
completion_evidence = ["tests/unit/timing.test.ts verde", "E2E manual: audio contiguo (0 huecos >1 ms) y video monótono en 4 s de stream"]
```

### TASK-0004 - Políticas de reconexión y contrapresión

```toml
id             = "TASK-0004"
title          = "Políticas de reconexión y contrapresión"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["resilience", "domain"]
dependencies   = []
expected_files = ["source/frontend/nodejs/webrelay/src/domain/reconnect-policy.ts", "source/frontend/nodejs/webrelay/src/domain/backpressure.ts"]
close_criteria = "Backoff con jitter y límite; gate que espera keyframe, re-pide keyframes perdidos y protege el audio"
validation     = ["make test-unit"]
completion_evidence = ["tests/unit/policies.test.ts verde"]
```

### TASK-0005 - Selección de códec, validación y layout

```toml
id             = "TASK-0005"
title          = "Selección de códec, validación y layout"
state          = "done"
priority       = "p1"
owner          = "rafex"
labels         = ["domain"]
dependencies   = []
expected_files = ["source/frontend/nodejs/webrelay/src/domain/codec-selection.ts", "source/frontend/nodejs/webrelay/src/domain/relay-settings.ts", "source/frontend/nodejs/webrelay/src/domain/layout.ts"]
close_criteria = "Nivel H.264 correcto por resolución/fps, preferencias H.264/AAC, validación de wss/rtmps (CA1)"
validation     = ["make test-unit"]
completion_evidence = ["tests/unit/codec-and-settings.test.ts verde", "Navegador: formulario vacío muestra error de URL y no captura"]
```

### TASK-0006 - BridgeLink y RelaySession

```toml
id             = "TASK-0006"
title          = "BridgeLink y RelaySession"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["application"]
dependencies   = ["TASK-0002", "TASK-0003", "TASK-0004"]
expected_files = ["source/frontend/nodejs/webrelay/src/application/bridge-link.ts", "source/frontend/nodejs/webrelay/src/application/relay-session.ts"]
close_criteria = "Handshake, heartbeat, reconexión con resume, error fatal y BYE (CA2–CA5) con reloj manual"
validation     = ["make test-unit"]
completion_evidence = ["tests/unit/relay-session.test.ts verde (20 casos)"]
```

### TASK-0007 - Adaptadores de navegador: captura, compositor, audio y WebCodecs

```toml
id             = "TASK-0007"
title          = "Adaptadores de navegador: captura, compositor, audio y WebCodecs"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["infrastructure", "webcodecs"]
dependencies   = ["TASK-0006"]
expected_files = ["source/frontend/nodejs/webrelay/src/infrastructure/capture/*", "source/frontend/nodejs/webrelay/src/infrastructure/audio/*", "source/frontend/nodejs/webrelay/src/infrastructure/encoding/*", "source/frontend/nodejs/webrelay/src/infrastructure/browser-media-pipeline.ts"]
close_criteria = "Encoders reales producen H.264 AVCC + avcC y AAC + ASC aceptables para remux FLV (CA6)"
validation     = ["prueba manual en navegador contra puente de diagnóstico"]
completion_evidence = ["Chromium 152: avc1.64001E CBR + mp4a.40.2; avcC 0164001eff…, ASC 1190; 94 frames video, 186 AAC, 4 keyframes, 0 descartes, RTT 1.3 ms, secuencia contigua"]
```

Nota: la captura real de cámara/pantalla requiere permiso del usuario y no se
automatizó; el pipeline se ejerció con fuentes sintéticas (canvas + seno).

### TASK-0008 - Transporte WebSocket e integración con puente simulado

```toml
id             = "TASK-0008"
title          = "Transporte WebSocket e integración con puente simulado"
state          = "done"
priority       = "p0"
owner          = "rafex"
labels         = ["transport", "testing"]
dependencies   = ["TASK-0006"]
expected_files = ["source/frontend/nodejs/webrelay/src/infrastructure/transport/websocket-transport.ts", "source/frontend/nodejs/webrelay/tests/support/mock-bridge.ts", "source/frontend/nodejs/webrelay/tests/integration/relay-flow.test.ts"]
close_criteria = "Flujo completo sobre WebSocket real: streaming, RTT, reconexión con resume, rechazo fatal, BYE"
validation     = ["make test-integration"]
completion_evidence = ["tests/integration/relay-flow.test.ts verde (5 casos)"]
```

### TASK-0009 - UI Pug, grabación local y exportación OGV

```toml
id             = "TASK-0009"
title          = "UI Pug, grabación local y exportación OGV"
state          = "done"
priority       = "p1"
owner          = "rafex"
labels         = ["ui", "ffmpeg-wasm"]
dependencies   = ["TASK-0007"]
expected_files = ["source/frontend/nodejs/webrelay/build/vite-plugin-pug.ts", "source/frontend/nodejs/webrelay/src/templates/**/*.pug", "source/frontend/nodejs/webrelay/src/ui/*", "source/frontend/nodejs/webrelay/src/infrastructure/recording/*"]
close_criteria = "Página renderizada desde Pug sin errores de consola; OGV válido desde una grabación (CA7)"
validation     = ["make test-integration", "prueba manual en navegador"]
completion_evidence = ["tests/integration/pug-templates.test.ts verde", "Navegador: página sin errores de consola (dev y contenedor)", "WebM vp8,opus 49 KB → OGV OggS/theora 50 KB en 4.7 s con ffmpeg.wasm self-hosted"]
```

### TASK-0010 - Documentación y contexto SpecNative

```toml
id             = "TASK-0010"
title          = "Documentación y contexto SpecNative"
state          = "done"
priority       = "p1"
owner          = "rafex"
labels         = ["docs"]
dependencies   = []
expected_files = ["docs/*.md", ".config/mkdocs/mkdocs.yml", "spec-native/*.md", "README.md"]
close_criteria = "make docs --strict sin errores; PRODUCT/ARCHITECTURE/STACK/CONVENTIONS/COMMANDS/DECISIONS completos"
validation     = ["make docs"]
completion_evidence = ["make docs: Documentation built (strict)", "4 ARCH, 8 DEC, 5 CONV registrados vía funciones del MCP de SpecNative"]
```

### TASK-0011 - Prueba de interoperabilidad con el puente real

```toml
id             = "TASK-0011"
title          = "Prueba de interoperabilidad con el puente real"
state          = "blocked"
priority       = "p0"
owner          = "rafex"
labels         = ["integration", "bridge"]
dependencies   = ["TASK-0008"]
expected_files = []
close_criteria = "Transmisión visible en una ingesta RTMPS a través del puente real, incluida una reconexión reanudada"
validation     = ["prueba manual con el puente"]
completion_evidence = []
```

Bloqueada: continúa como TASK-0110 (SPEC-0002) sobre la señalización v2,
contra `ether-streaming-culerin`.

### TASK-0012 - E2E automatizado en navegador con dispositivos falsos

```toml
id             = "TASK-0012"
title          = "E2E automatizado en navegador con dispositivos falsos"
state          = "done"
priority       = "p2"
owner          = "rafex"
labels         = ["testing", "e2e"]
dependencies   = ["TASK-0007"]
expected_files = ["source/frontend/nodejs/webrelay/tests/e2e/*"]
close_criteria = "Un test en CI arranca Chromium con dispositivos falsos y verifica la llamada contra un puente simulado"
validation     = ["make e2e-ci"]
completion_evidence = ["Cubierto por TASK-0109 (SPEC-0002): Playwright con WebRTC real contra el puente de desarrollo; make e2e-ci 5 passed"]
```
