#!/usr/bin/env bash
# Install root-owned on an operator-controlled host. The SSH key must have a forced command.
set -euo pipefail
image=${1:?immutable image required}
revision=${2:?revision required}
[[ "$image" =~ ^ghcr\.io/mehmetuzgoren/fyde@sha256:[a-f0-9]{64}$ ]] || exit 64
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || exit 64
cd /opt/fyde
state=/etc/fyde/image.env
previous=$(cat "$state" 2>/dev/null || true)
printf 'FYDE_IMAGE=%s\nRELEASE_SHA=%s\n' "$image" "$revision" > /etc/fyde/next-image.env
chmod 600 /etc/fyde/next-image.env
compose() { docker compose --env-file /etc/fyde/runtime.env --env-file "$state" -f /opt/fyde/compose.production.yml "$@"; }
rollback() {
  if [[ -n "$previous" ]]; then
    printf '%s\n' "$previous" > "$state"
    compose up -d --no-build
  fi
}
docker pull "$image"
observed=$(docker inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$observed" == "$revision" ]] || exit 65
cp /etc/fyde/next-image.env "$state"
trap 'rollback' ERR
# Autonomous content releases never run migrations. Initial/protected migrations need operator review.
compose up -d --no-build
healthy=0
for attempt in $(seq 1 15); do
  if curl --fail --silent --max-time 3 http://127.0.0.1:8000/health/ | python3 -c 'import json,sys; assert json.load(sys.stdin)["revision"] == sys.argv[1]' "$revision"; then
    healthy=1
    break
  fi
  sleep 2
done
[[ "$healthy" == 1 ]]
curl --fail --silent --max-time 5 http://127.0.0.1:8000/help/ > /dev/null
printf '%s\n' "$previous" > /etc/fyde/previous-image.env
trap - ERR
