#!/bin/sh
# 40-webrelay-config.sh — at container start (nginx image hook in
# /docker-entrypoint.d/) writes:
#   * the Content-Security-Policy include, with connect-src narrowed to the
#     bridge actually configured (instead of any wss:);
#   * /config.json from WEBRELAY_* variables.
# Without WEBRELAY_BRIDGE_URL the config.json baked into the image is kept and
# the permissive local-development CSP is used.
set -eu

html_dir="${WEBRELAY_HTML_DIR:-/usr/share/nginx/html}"
csp_file="${WEBRELAY_CSP_FILE:-/tmp/webrelay-csp.conf}"
target="$html_dir/config.json"

# origin_of URL -> scheme://host[:port]; fails (and stops the container) when
# the value could do anything but name an origin, because it ends up inside a
# response header.
origin_of() {
	case "$1" in
	wss://* | ws://* | https://*) ;;
	*)
		echo "webrelay: $2 must start with wss://, ws:// or https:// (got '$1')" >&2
		exit 1
		;;
	esac
	origin=$(printf '%s' "$1" | sed -E 's#^([a-z]+://[^/?\#]+).*#\1#')
	if ! printf '%s' "$origin" | grep -Eq '^(wss|ws|https)://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'; then
		echo "webrelay: $2 does not have a valid host[:port] ('$origin')" >&2
		exit 1
	fi
	printf '%s' "$origin"
}

json_escape() {
	printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

default_model='https://storage.googleapis.com'

write_csp() {
	sources="$1"
	cat >"$csp_file" <<CSP
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src $sources; media-src 'self' blob:; img-src 'self' data: blob: https:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
CSP
}

if [ -z "${WEBRELAY_BRIDGE_URL:-}" ]; then
	# Local development / unconfigured image: any wss:// and the loopback bridge.
	write_csp "'self' wss: ws://localhost:* ws://127.0.0.1:* blob: $default_model"
	echo "webrelay: using bundled config.json (development CSP)"
	exit 0
fi

bridge_origin=$(origin_of "$WEBRELAY_BRIDGE_URL" WEBRELAY_BRIDGE_URL)
relay_origin=$(origin_of "${WEBRELAY_RELAY_URL:-$WEBRELAY_BRIDGE_URL}" WEBRELAY_RELAY_URL)
connect="'self' $bridge_origin"
[ "$relay_origin" != "$bridge_origin" ] && connect="$connect $relay_origin"
if [ -n "${WEBRELAY_EFFECTS_MODEL_URL:-}" ]; then
	case "$WEBRELAY_EFFECTS_MODEL_URL" in
	/*) ;; # served by this site: 'self'
	*) connect="$connect $(origin_of "$WEBRELAY_EFFECTS_MODEL_URL" WEBRELAY_EFFECTS_MODEL_URL)" ;;
	esac
else
	connect="$connect $default_model" # the default segmentation model
fi
write_csp "$connect blob:"

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
} >"$target"

echo "webrelay: config.json generated for bridge $WEBRELAY_BRIDGE_URL; CSP connect-src: $connect blob:"
