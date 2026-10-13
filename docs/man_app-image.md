# app-image

## Nombre

app-image — construye la imagen servible del frontend

## Sinopsis

```
make app-image
make man TARGET=app-image
```

## Descripción

Construye `containers/frontend/Containerfile`: compila con Node.js 24 y sirve `dist/` con nginx sin privilegios en el puerto 8080 (CSP, Permissions-Policy, caché inmutable de assets, `/healthz`).

## Ejemplos

```bash
make app-image
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
