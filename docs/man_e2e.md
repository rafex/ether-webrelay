# e2e

## Nombre

e2e — pruebas de navegador con Playwright

## Sinopsis

```
make e2e
```

## Descripción

Ejecuta `npm run test:e2e`: Playwright levanta el puente de desarrollo y Vite en puertos propios, abre participantes con la cámara falsa de Chromium y un micrófono sintético, y verifica lobby, llamada con medios reales a través del SFU, silencio, vistas, pantalla compartida y salida. Usa Google Chrome si está instalado (`PW_CHANNEL=chrome`); si no, el Chromium de Playwright (`npx playwright install chromium`). Con `E2E_BRIDGE_URL=ws://…/signal` no arranca el puente de desarrollo y ejecuta los mismos escenarios contra un puente ya levantado (p. ej. `ether-streaming-culerin` en modo desarrollo, que lo hace con su propio `make e2e`).

## Ejemplos

```bash
make e2e
PW_CHANNEL= make e2e   # forzar el Chromium de Playwright
E2E_BRIDGE_URL=ws://127.0.0.1:18190/signal make e2e   # contra el puente real
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
