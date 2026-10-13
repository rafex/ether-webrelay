# dev

## Nombre

dev — servidor de desarrollo Vite

## Sinopsis

```
just dev [--port 5173] [--man]
make man TARGET=dev
```

## Descripción

Levanta Vite en `http://localhost:<port>` con recarga en caliente (entra por `/join/<sala>?t=<token>`; combínalo con `just bridge-dev`); los cambios en `.pug` recargan la página completa. `localhost` es contexto seguro, así que la captura de cámara/pantalla funciona sin HTTPS.

## Ejemplos

```bash
just dev
just dev --port 3000
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
