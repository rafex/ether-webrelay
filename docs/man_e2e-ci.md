# e2e-ci

## Nombre

e2e-ci — pruebas de navegador dentro de un contenedor

## Sinopsis

```
make e2e-ci
```

## Descripción

Construye `containers/e2e/Containerfile` (imagen oficial de Playwright alineada con `@playwright/test`, fijada por digest; Playwright requiere glibc, por eso no es Alpine) y ejecuta el E2E con el árbol de trabajo enviado por `tar`. Es lo que corre GitHub Actions.

## Ejemplos

```bash
make e2e-ci
```

## Véase también

- `spec-native/COMMANDS.md` (índice de comandos del proyecto)
- [Regla 01: Herramientas de Construcción](https://github.com/rafex/ether-my-best-practice/blob/main/rules/01-build-tooling.md)
