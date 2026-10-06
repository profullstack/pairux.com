#!/usr/bin/env bash
# Box-side deploy for the PairUX coturn on dev2 (turn.pairux.com).
#
# deploy-turn.yml copies docker-compose.yml here as docker-compose.yml.new and
# runs this script. turnserver.conf (with the TURN credential) lives only on the
# box in conf/; the cert is renewed by root's acme.sh into certs/. An unchanged
# compose file is a no-op, so live relays are not cut.
set -euo pipefail

ROOT=/home/anthony/www/turn.pairux.com
cd "$ROOT"

if [ -f docker-compose.yml.new ]; then
  docker compose -f docker-compose.yml.new config -q
  if cmp -s docker-compose.yml.new docker-compose.yml; then
    rm -f docker-compose.yml.new
    echo "compose file unchanged"
  else
    cp docker-compose.yml docker-compose.yml.prev
    mv docker-compose.yml.new docker-compose.yml
    echo "compose file updated (previous kept as docker-compose.yml.prev)"
  fi
fi

docker compose pull -q
docker compose up -d

sleep 5
if [ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' pairux-coturn)" = "true 0" ]; then
  docker compose ps
  exit 0
fi

echo "coturn is not running cleanly" >&2
docker logs --tail 20 pairux-coturn >&2 || true
if [ -f docker-compose.yml.prev ]; then
  echo "rolling back to docker-compose.yml.prev" >&2
  mv docker-compose.yml.prev docker-compose.yml
  docker compose up -d
fi
exit 1
