# audit

## Nombre

audit — vulnerabilidades conocidas en las dependencias de producción

## Sinopsis

```
make audit
make man TARGET=audit
```

## Descripción

Delega en `javascript.sh --goal audit`: `npm audit --omit=dev --audit-level=high`.
Solo mira lo que acaba en el navegador (no las herramientas de desarrollo) y falla
con vulnerabilidades HIGH o superiores. Necesita las dependencias instaladas
(`make install`). En CI va en el job `scan`.

## Véase también

`make scan`
