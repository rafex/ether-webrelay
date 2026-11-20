# Tareas — auto-framing

### TASK-0201 - Geometría del encuadre (pura y probada)

```toml
id             = "TASK-0201"
title          = "Geometría del encuadre (pura y probada)"
state          = "done"
priority       = "p2"
owner          = "rafex"
labels         = ["video", "domain"]
dependencies   = []
expected_files = ["source/frontend/nodejs/webrelay/src/domain/framing.ts", "source/frontend/nodejs/webrelay/tests/unit/framing.test.ts"]
close_criteria = "Recorte, suavizado, zona muerta y retorno al cuadro completo cubiertos por pruebas unitarias"
validation     = ["make ci"]
completion_evidence = ["tests/unit/framing.test.ts: 12 casos en verde"]
```

### TASK-0202 - Detector de caras en la tubería de efectos y ajuste de usuario

```toml
id             = "TASK-0202"
title          = "Detector de caras en la tubería de efectos y ajuste de usuario"
state          = "done"
priority       = "p2"
owner          = "rafex"
labels         = ["video", "ui", "container"]
dependencies   = ["TASK-0201"]
expected_files = ["source/frontend/nodejs/webrelay/src/infrastructure/effects/mediapipe-effects.ts", "source/frontend/nodejs/webrelay/src/ui/settings-dialog.ts", "containers/frontend/*"]
close_criteria = "El ajuste reconstruye la cámara; el modelo viaja en la imagen con hash fijo; la prueba E2E contra la imagen pasa sin violaciones de CSP"
validation     = ["make ci", "make e2e-ci", "make scan", "E2E_APP_URL=… playwright test tests/e2e/framing.spec.ts"]
completion_evidence = ["E2E contra la imagen: modelo servido desde /models/ (229746 B), sin violaciones de CSP, vista previa viva"]
```

### TASK-0203 - Validación con cámara real y ajuste de parámetros

```toml
id             = "TASK-0203"
title          = "Validación con cámara real y ajuste de parámetros"
state          = "todo"
priority       = "p2"
owner          = "rafex"
labels         = ["video", "manual"]
dependencies   = ["TASK-0202"]
expected_files = ["source/frontend/nodejs/webrelay/src/domain/framing.ts"]
close_criteria = "Prueba con una cámara real: cara centrada, zoom estable, retorno sin cara; parámetros ajustados si hace falta"
validation     = ["prueba manual en navegador"]
completion_evidence = []
```
