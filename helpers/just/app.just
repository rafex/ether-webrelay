# app.just — Operativas de la aplicación (frontend Ether WebRelay).
# El frontend necesita contexto seguro: http://localhost o HTTPS.
# Todas las recetas reenvían flags explícitos al helper (`--port 3000`, `--man`).

# Servidor de desarrollo Vite con recarga (`--port 5173`); recarga también las plantillas Pug
@dev *args:
    bash helpers/shell/javascript.sh --tool {{tool}} --goal dev --module {{module}} {{args}}

# Previsualizar el build de producción (`--port 4173`); construye primero
@preview *args:
    make build
    bash helpers/shell/javascript.sh --tool {{tool}} --goal preview --module {{module}} --port 4173 {{args}}

# Construir la imagen y levantar el frontend en un contenedor (`--port 8080`; podman → docker)
@up *args:
    bash helpers/shell/container.sh --action app-run --module {{module}} {{args}}

# Detener el contenedor del frontend
@down *args:
    bash helpers/shell/container.sh --action app-stop {{args}}

# Seguir los logs del contenedor del frontend
@logs *args:
    bash helpers/shell/container.sh --action app-logs {{args}}

# Puente de desarrollo local (señalización v2 + mini SFU; no publica RTMPS) en `--port 8090`
@bridge-dev *args:
    bash helpers/shell/javascript.sh --tool {{tool}} --goal bridge-dev --module {{module}} --port 8090 {{args}}
