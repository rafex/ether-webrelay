# scan

## Nombre

scan — vulnerabilidades corregibles en la imagen servible

## Sinopsis

```
make scan
make man TARGET=scan
```

## Descripción

Delega en `container.sh --action scan`: guarda la imagen (`ether-webrelay:local`, la
construye si no existe) y la analiza con Trivy 0.74.0 en un contenedor. Cubre los
paquetes de Alpine de la imagen de nginx. Falla (`exit 1`) si hay alguna
vulnerabilidad **HIGH o CRITICAL que ya tenga versión corregida**.

La imagen hace `apk upgrade` al construirse (la base de nginx se publica de vez en
cuando), así que reconstruir recoge los parches de Alpine posteriores a la base.

En CI es el job `scan` (y corre cada lunes). No es un check obligatorio de `main`.

## Véase también

`make app-image`, `make audit`
