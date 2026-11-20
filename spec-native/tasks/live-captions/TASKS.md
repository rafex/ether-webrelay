# Tareas — live-captions

### TASK-0301 - Contrato de señalización y lado del puente

```toml
id             = "TASK-0301"
title          = "Contrato de señalización y lado del puente"
state          = "done"
priority       = "p2"
owner          = "rafex"
labels         = ["signaling", "bridge"]
dependencies   = []
expected_files = ["docs/signaling.md", "source/frontend/nodejs/webrelay/tests/support/dev-bridge.mjs"]
close_criteria = "docs/signaling.md y el puente de desarrollo describen caption/captions; el puente real los dibuja sin recomponer"
validation     = ["make ci", "make e2e (contra el puente real)"]
completion_evidence = ["PR de subtítulos de ether-streaming-culerin con prueba de FFmpeg real; docs/signaling.md actualizado"]
```

### TASK-0302 - CaptionService, puerto del motor y ajuste del invitado

```toml
id             = "TASK-0302"
title          = "CaptionService, puerto del motor y ajuste del invitado"
state          = "done"
priority       = "p2"
owner          = "rafex"
labels         = ["captions", "ui"]
dependencies   = ["TASK-0301"]
expected_files = ["source/frontend/nodejs/webrelay/src/application/caption-service.ts", "source/frontend/nodejs/webrelay/src/ports/transcriber.ts"]
close_criteria = "El servicio decide cuándo escuchar, limita el ritmo y no reintenta en bucle; el ajuste solo se ofrece con motor"
validation     = ["make ci"]
completion_evidence = ["tests/unit/caption-service.test.ts: 18 casos; 263 tests en total"]
```

### TASK-0303 - Spike y adaptador de Whisper (WASM) en el navegador

```toml
id             = "TASK-0303"
title          = "Spike y adaptador de Whisper (WASM) en el navegador"
state          = "todo"
priority       = "p2"
owner          = "rafex"
labels         = ["captions", "wasm", "spike"]
dependencies   = ["TASK-0302"]
expected_files = ["source/frontend/nodejs/webrelay/src/infrastructure/transcription/*", "containers/frontend/*"]
close_criteria = "Medir latencia y CPU de Whisper tiny (WASM, un hilo) en un equipo de gama media; si es viable, adaptador autoalojado con hash fijo"
validation     = ["medición en navegador", "make ci", "make e2e-ci", "make scan"]
completion_evidence = []
```

### TASK-0304 - Prueba extremo a extremo con motor real

```toml
id             = "TASK-0304"
title          = "Prueba extremo a extremo con motor real"
state          = "todo"
priority       = "p3"
owner          = "rafex"
labels         = ["captions", "manual"]
dependencies   = ["TASK-0303"]
expected_files = []
close_criteria = "Una emisión de prueba muestra los subtítulos de un invitado real y desaparecen al silenciarse"
validation     = ["prueba manual con una emisión"]
completion_evidence = []
```
