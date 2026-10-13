# CD.md

Entrega continua del proyecto.

## Plataforma

- Artefacto: imagen OCI `ether-webrelay` construida desde
  `containers/frontend/Containerfile` (sitio estático en nginx sin
  privilegios, puerto 8080, `/healthz`).
- Hoy no hay despliegue automatizado: la publicación de la imagen y el
  despliegue se definirán siguiendo la regla 16 (CD portable, sops + age)
  cuando exista un ambiente destino.

## Ambientes

| Ambiente | Cómo se obtiene | Notas |
| --- | --- | --- |
| local | `just dev` / `just up` | `http://localhost` es contexto seguro |
| staging / producción | por definir | requieren TLS delante del contenedor |

## Proceso de release

1. Rama `release/vX.Y.Z` desde `develop`; CI verde.
2. Tag `vX.Y.Z` (SemVer) y versión en `package.json`.
3. `make app-image` y publicación de la imagen etiquetada con la versión y el
   digest (por definir registro).

## Gates de promoción

- `make ci` verde en el commit etiquetado.
- Prueba manual contra un puente del ambiente (captura → RTMPS visible).
- `docs/protocol-websocket.md` sin cambios incompatibles no coordinados con el puente.

## Rollback

Redesplegar la imagen anterior por digest. El webrelay no tiene estado
persistente; las transmisiones activas se reconectan solas al volver el
servicio.
