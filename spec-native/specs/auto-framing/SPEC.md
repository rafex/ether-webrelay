# SPEC — auto-framing

```toml
artifact_type = "spec"
id            = "SPEC-0003"
state         = "active"
owner         = "rafex"
created_at    = "2026-11-20"
updated_at    = "2026-11-20"
replaces      = "none"
related_tasks       = ["TASK-0201", "TASK-0202", "TASK-0203"]
related_decisions   = ["DEC-0011"]
artifacts           = ["source/frontend/nodejs/webrelay/src/domain/framing.ts", "source/frontend/nodejs/webrelay/src/infrastructure/effects/*", "containers/frontend/*", "docs/media-flow.md"]
validation          = ["make ci", "make e2e-ci", "make scan", "prueba manual con una cámara real"]
```

## Resumen

Encuadre automático de la cámara: un detector de caras (MediaPipe, el mismo runtime WebAssembly que
los efectos de fondo) mueve un recorte suave para que la cara quede centrada y a buen tamaño.

## Problema

Los invitados se sientan lejos o se mueven y salen pequeños, descentrados o cortados en el mosaico de
la emisión. Corregirlo a mano es incómodo y un zoom físico no está siempre disponible.

## Alcance

### Incluye
- Ajuste opcional «Encuadre automático» (apagado por defecto) en *Ajustes → Video → Efectos*.
- Recorte con la proporción del cuadro, zoom máximo 1,8×, suavizado y zona muerta, y retorno al cuadro
  completo si la cara se pierde.
- Combinable con desenfoque/fondo virtual.
- Modelo de caras autoalojado en la imagen con SHA-256 fijo (sin terceros en la CSP).
- Degradación: si el detector no carga, se envía la cámara (o el efecto de fondo solo) y se explica el motivo.

### Excluye
- Seguir a varias personas a la vez (se encuadra la cara más grande).
- Recorte en el servidor (el mosaico lo sigue componiendo el puente).
- Moverlo a un Worker/OffscreenCanvas (iniciativa aparte, junto con el resto de efectos).

## Requisitos funcionales

1. RF1 — La geometría (recorte, suavizado, zona muerta, retorno) es pura y se prueba sin cámara.
2. RF2 — Activar/desactivar el ajuste reconstruye la cámara y libera la tubería anterior.
3. RF3 — Un fallo del detector nunca deja al invitado sin vídeo.
4. RF4 — La imagen sirve el modelo desde `/models/` y la CSP no añade orígenes de terceros.

## Criterios de aceptación

- `tests/unit/framing.test.ts`, `lobby-service.test.ts` y `effects-model-image.test.ts` en verde.
- `tests/e2e/framing.spec.ts` contra la imagen (E2E_APP_URL): sin violaciones de CSP, estado limpio y vista previa viva.
- Prueba manual con una cámara real: la cara se centra, el zoom no tiembla y vuelve al cuadro completo sin cara.

## Riesgos

- Coste de CPU del cliente (detección ~8 veces/s más el dibujado recortado): medir en equipos modestos.
- Ampliar 720p más de ~1,8× se ve blando; los parámetros (`DEFAULT_FRAMING`) se ajustan con uso real.
