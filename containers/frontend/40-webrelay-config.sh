#!/bin/sh
# 40-webrelay-config.sh — writes /config.json from environment variables at
# container start (nginx image hook in /docker-entrypoint.d/).
# Without WEBRELAY_BRIDGE_URL the config.json baked into the image is kept.
set -eu

target=/usr/share/nginx/html/config.json

if [ -z "${WEBRELAY_BRIDGE_URL:-}" ]; then
	echo "webrelay: using bundled config.json"
	exit 0
fi

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

{
	printf '{\n'
	printf '  "bridgeUrl": "%s",\n' "$(json_escape "$WEBRELAY_BRIDGE_URL")"
	printf '  "relayUrl": "%s",\n' "$(json_escape "${WEBRELAY_RELAY_URL:-$WEBRELAY_BRIDGE_URL}")"
	printf '  "transport": "%s",\n' "$(json_escape "${WEBRELAY_TRANSPORT:-webrtc}")"
	if [ -n "${WEBRELAY_EFFECTS_MODEL_URL:-}" ]; then
		printf '  "effectsModelUrl": "%s",\n' "$(json_escape "$WEBRELAY_EFFECTS_MODEL_URL")"
	fi
	printf '  "defaultView": "%s"\n' "$(json_escape "${WEBRELAY_DEFAULT_VIEW:-stage}")"
	printf '}\n'
} > "$target"

echo "webrelay: config.json generated for bridge $WEBRELAY_BRIDGE_URL"
