# DECISIONS.md

Índice de decisiones persistentes del proyecto. Las decisiones canónicas viven
en `decisions/DEC-XXXX-<slug>.md`; no agregues contenido de decisión aquí.

## Cuando registrar aqui

Registrar una decision cuando cambie algo que futuras iniciativas
o agentes deban respetar:

- la arquitectura del sistema
- una convencion de codigo o de documentacion
- una tecnologia o dependencia base
- un tradeoff que condicione trabajo futuro

Ver `AGENTS.md` para entender la separacion semantica entre este
archivo y `SPEC.md`.

## Cuando leer este archivo

Antes de iniciar una nueva iniciativa, revisar si alguna decision
registrada condiciona el diseno o la implementacion.

> El CLI o MCP regeneran esta sección desde el front matter de `decisions/`. No escribir texto entre el encabezado y la tabla.

## Decisiones

| ID | Estado | Título | Tags |
| --- | --- | --- | --- |
| [DEC-0001](./decisions/DEC-0001-alcance-solo-frontend-el-puente-rtmps-es-externo.md) | accepted | Alcance: solo frontend; el puente RTMPS es externo | concern/scope, component/bridge |
| [DEC-0002](./decisions/DEC-0002-stack-typescript-7-vite-8-pug-3-vitest-y-biome.md) | accepted | Stack: TypeScript 7 + Vite 8 + Pug 3, Vitest y Biome | concern/stack, tech/typescript, tech/vite, tech/pug |
| [DEC-0003](./decisions/DEC-0003-webcodecs-como-codificador-h-264-aac-preferidos-.md) | accepted | WebCodecs como codificador; H.264+AAC preferidos; ffmpeg.wasm solo para OGV | tech/webcodecs, tech/ffmpeg-wasm, concern/performance |
| [DEC-0004](./decisions/DEC-0004-protocolo-binario-v1-sobre-websocket.md) | accepted | Protocolo binario v1 sobre WebSocket | concern/protocol, component/bridge-link |
| [DEC-0005](./decisions/DEC-0005-reconexi-n-con-reanudaci-n-del-stream.md) | accepted | Reconexión con reanudación del stream | concern/resilience, concern/protocol |
| [DEC-0006](./decisions/DEC-0006-contrapresi-n-por-bufferedamount.md) | accepted | Contrapresión por bufferedAmount | concern/performance, concern/resilience |
| [DEC-0007](./decisions/DEC-0007-composici-n-en-canvas-con-ticks-desde-worker.md) | accepted | Composición en canvas con ticks desde Worker | component/media-pipeline, concern/sync |
| [DEC-0008](./decisions/DEC-0008-contenedores-node-24-alpine-para-ci-nginx-sin-pr.md) | accepted | Contenedores: Node 24 Alpine para CI, nginx sin privilegios para servir | concern/ci, tech/podman, concern/security |
