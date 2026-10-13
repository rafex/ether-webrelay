# bridge-dev

## Nombre

bridge-dev — puente de desarrollo local (señalización v2 + mini SFU)

## Sinopsis

```
just bridge-dev [--port 8090] [--man]
```

## Descripción

Arranca `tests/support/dev-bridge.mjs`: implementa la [señalización v2](signaling.md) y reenvía RTP entre participantes con werift, para probar el lobby y la videollamada sin el puente real (`ether-streaming-culerin`). Es un doble de prueba: **no publica RTMPS**. Cualquier sala y token son válidos; `t=invalid` responde `invalid-token` y la sala `closed` responde `room-not-found`.

## Ejemplos

```bash
just bridge-dev
just dev   # y abre http://localhost:5173/join/demo?t=dev en dos ventanas
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
