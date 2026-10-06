#!/usr/bin/env bash
# Box-side deploy for the PairUX LiveKit SFU on dev2 (sfu.pairux.com).
#
# deploy-livekit.yml copies docker-compose.yml here as docker-compose.yml.new
# and runs this script. Secrets live only on the box in conf/ (livekit.yaml,
# egress.yaml), never in the repo. An unchanged compose file is a no-op, so a
# push that touches nothing here does not restart the SFU or drop live calls.
set -euo pipefail

ROOT=/home/anthony/www/sfu.pairux.com
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

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:7880/; then
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "livekit did not answer on 127.0.0.1:7880" >&2
if [ -f docker-compose.yml.prev ]; then
  echo "rolling back to docker-compose.yml.prev" >&2
  mv docker-compose.yml.prev docker-compose.yml
  docker compose up -d
fi
exit 1
