#!/usr/bin/env bash
# Deploy de The Burger House (Docker). Uso:
#   ./deploy.sh                       trae origin/$REF (solo fast-forward) y despliega
#   COMMIT=<sha> ./deploy.sh          despliega ESE commit exacto (tiene que estar en origin/$REF). Lo usa GitHub Actions.
#   REF=<rama> ./deploy.sh            otra rama (default: feature/mvp-fase1, la rama de producción)
#   NO_PULL=1 ./deploy.sh             despliega lo que ya está en repo/ (sin git)
#   ALLOW_DESTRUCTIVE_MIGRATION=1     deja pasar migraciones con DROP / RENAME / SET NOT NULL (revisalas antes)
#   ./deploy.sh rollback              vuelve a la imagen anterior (theburgerhouse-app:previous)
#   ./deploy.sh rollback <sha>        vuelve a la imagen de ese commit (theburgerhouse-app:<sha>, se guardan las últimas 5)
#   ./deploy.sh status                qué commit está corriendo y si está sano
#   ./deploy.sh logs                  últimas 100 líneas de la app
#
# Orden: lock -> chequeo de migración destructiva -> backup -> migrate -> build -> cambio de imagen
#        -> /api/health 60 s (con el commit nuevo) -> si falla, vuelve sola a la imagen anterior.
# Si falla el backup, la migración o el build, la app en uso NO se toca (el build va antes del cambio de imagen).
# OJO: las migraciones corren ANTES del cambio; si la versión nueva falla, la base queda migrada y vuelve la imagen
#      vieja: las migraciones tienen que ser ADITIVAS (ver README.md).
#
# Códigos de salida:
#   0 ok | 1 frenado antes de tocar la app en uso (git, migración destructiva, backup, migrate, build)
#   2 ya hay un deploy en curso | 3 la nueva no quedó sana y volvió a la anterior (sana)
#   4 ni la anterior está sana -> intervenir a mano
# Logs: stdout + /opt/theburgerhouse/deploy.log + journald (journalctl -t theburgerhouse-deploy).
# A mano, correrlo dentro de tmux: si se corta SSH a la mitad, el deploy sigue.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

REF="${REF:-feature/mvp-fase1}"
COMMIT="${COMMIT:-}"
KEEP_IMAGES=5
IMG=theburgerhouse-app

log() {
  local line
  line="[$(date '+%F %T')] $*"
  echo "$line"
  echo "$line" >>deploy.log 2>/dev/null || true
  logger -t theburgerhouse-deploy -- "$*" 2>/dev/null || true
}
fail() { log "ERROR: $2"; exit "$1"; }

# Entradas: se validan porque las puede pasar GitHub Actions.
[[ "$REF" =~ ^[A-Za-z0-9._/-]+$ && "$REF" != *..* ]] || fail 1 "REF inválida: $REF"
[ -z "$COMMIT" ] || [[ "$COMMIT" =~ ^[0-9a-f]{7,40}$ ]] || fail 1 "COMMIT inválido (tiene que ser un sha hex): $COMMIT"
# Desde GitHub Actions (sudo por gh-runner) solo se despliega la rama de producción, salvo ramas habilitadas a mano
# por root en .allowed-refs (una por línea; p. ej. para probar el pipeline). Así un workflow de otra rama no puede
# llevar a producción código que no está en feature/mvp-fase1.
if [ "${SUDO_USER:-}" = gh-runner ] && [ "$REF" != feature/mvp-fase1 ] && ! grep -qxF -- "$REF" .allowed-refs 2>/dev/null; then
  fail 1 "REF $REF no habilitada para deploy automático (solo feature/mvp-fase1 o las de .allowed-refs)"
fi

# logs/status son de solo lectura: no toman el lock (se pueden mirar con un deploy en curso).
if [ "${1:-}" != logs ] && [ "${1:-}" != status ]; then
  exec 9>.deploy.lock
  flock -n 9 || { log "otro deploy en curso"; exit 2; }
fi

# Sano = /api/health ok Y respondiendo con el commit esperado (no la versión vieja que todavía no se apagó).
health() {
  local want="${1:-}" out
  for _ in $(seq 1 30); do
    out="$(docker compose exec -T web wget -qO- http://127.0.0.1/api/health 2>/dev/null || true)"
    if grep -q '"status":"ok"' <<<"$out" && { [ -z "$want" ] || grep -q "\"commit\":\"$want\"" <<<"$out"; }; then
      return 0
    fi
    sleep 2
  done
  return 1
}

app_logs() { log "últimas 100 líneas de la app:"; docker compose logs --no-color --tail 100 app 2>&1 | tee -a deploy.log || true; }

# switch_to <tag> <commit>: pone esa imagen como :latest y recrea app (web queda: resuelve la IP nueva por DNS).
# APP_COMMIT queda en .env para que un `docker compose up -d` a mano siga reportando el commit correcto en /api/health.
switch_to() {
  docker tag "$IMG:$1" "$IMG:latest"
  if grep -q '^APP_COMMIT=' .env; then sed -i "s/^APP_COMMIT=.*/APP_COMMIT=$2/" .env; else echo "APP_COMMIT=$2" >>.env; fi
  docker compose up -d --no-build app web
}

# Conserva las últimas $KEEP_IMAGES imágenes por commit. Si una vieja también es :running/:previous, rmi solo le
# quita el tag del commit (la imagen sigue existiendo con el otro tag).
prune_images() {
  docker images "$IMG" --format '{{.CreatedAt}}\t{{.Tag}}' | sort -r |
    awk -F'\t' '$2 ~ /^[0-9a-f]{7,40}$/' | tail -n +$((KEEP_IMAGES + 1)) |
    while IFS=$'\t' read -r _ tag; do
      docker rmi "$IMG:$tag" >/dev/null 2>&1 && log "imagen vieja borrada: $tag" || true
    done
  docker image prune -f >/dev/null 2>&1 || true
}

case "${1:-}" in
  logs)
    docker compose logs --no-color --tail 100 app
    exit 0
    ;;
  status)
    echo "corriendo: $(cat .deployed-commit 2>/dev/null || echo '?')"
    docker images "$IMG" --format '  {{.Tag}}\t{{.CreatedSince}}'
    health "" && echo "health: ok" || { echo "health: NO sano"; exit 4; }
    exit 0
    ;;
  rollback)
    TARGET="${2:-previous}"
    [[ "$TARGET" =~ ^(previous|[0-9a-f]{7,40})$ ]] || fail 1 "uso: ./deploy.sh rollback [<sha>]"
    docker image inspect "$IMG:$TARGET" >/dev/null 2>&1 || fail 4 "no hay imagen $IMG:$TARGET (docker images $IMG)"
    TCOMMIT="$(docker image inspect -f '{{index .Config.Labels "commit"}}' "$IMG:$TARGET" 2>/dev/null || true)"
    log "ROLLBACK a $TARGET (commit ${TCOMMIT:-?})"
    switch_to "$TARGET" "${TCOMMIT:-unknown}"
    if health "$TCOMMIT"; then
      docker tag "$IMG:$TARGET" "$IMG:running"
      [ -n "$TCOMMIT" ] && echo "$TCOMMIT" >.deployed-commit
      log "ROLLBACK_OK ${TCOMMIT:-$TARGET}"
      exit 0
    fi
    app_logs
    fail 4 "ROLLBACK: la versión $TARGET tampoco está sana"
    ;;
  "") ;;
  *) fail 1 "argumento desconocido: $1" ;;
esac

# ---- 1. código -----------------------------------------------------------------------------------------------
if [ "${NO_PULL:-0}" != 1 ]; then
  git -C repo fetch -q origin "+refs/heads/$REF:refs/remotes/origin/$REF" || fail 1 "git fetch de $REF falló"
  if [ -n "$COMMIT" ]; then
    git -C repo cat-file -e "$COMMIT^{commit}" 2>/dev/null || fail 1 "el commit $COMMIT no existe en el repo"
    git -C repo merge-base --is-ancestor "$COMMIT" "origin/$REF" || fail 1 "el commit $COMMIT no está en origin/$REF"
    git -C repo checkout -q --detach "$COMMIT"
  else
    git -C repo checkout -q --detach "origin/$REF"
  fi
fi
COMMIT_FULL="$(git -C repo rev-parse HEAD)"
SHORT="${COMMIT_FULL:0:12}"
OLD="$(cat .deployed-commit 2>/dev/null || true)"
log "deploy $SHORT (ref $REF; en producción: ${OLD:-nada})"

# ---- 2. migraciones destructivas ----------------------------------------------------------------------------
if [ -n "$OLD" ] && [ "${ALLOW_DESTRUCTIVE_MIGRATION:-0}" != 1 ]; then
  if git -C repo diff "$OLD" HEAD -- 'src/db/migrations/*.sql' | grep -E '^\+' | grep -Eiq 'DROP |RENAME |SET NOT NULL'; then
    log "MIGRACIÓN DESTRUCTIVA detectada (DROP/RENAME/SET NOT NULL): el rollback automático no sería seguro."
    fail 1 "revisala y, si está bien, repetí con ALLOW_DESTRUCTIVE_MIGRATION=1 (en GitHub: Run workflow con la casilla)"
  fi
fi

# ---- 3. backup ------------------------------------------------------------------------------------------------
docker compose up -d db >/dev/null 2>&1
log "backup previo"
./backup.sh >>deploy.log 2>&1 || fail 1 "falló el backup: deploy cancelado (la app en uso no se tocó)"

# ---- 4. dependencias + migración ----------------------------------------------------------------------------------
log "instalando dependencias y migrando"
docker compose build --progress=plain migrate >>deploy.log 2>&1 || fail 1 "falló la instalación de dependencias (ver deploy.log)"
if ! docker compose run --rm -T migrate 2>&1 | tail -n 3 | tee -a deploy.log; then
  fail 1 "falló la migración (la app en uso no se tocó; revisá la base)"
fi

# ---- 5. build (antes de tocar lo que corre) --------------------------------------------------------------------
log "build (pre-renderiza contra la base)"
DB_IP="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' theburgerhouse-db-1)"
DB_PASS="$(grep -E '^DB_PASSWORD=' .env | cut -d= -f2-)"
export BUILD_DATABASE_URL="postgres://burgerhause:${DB_PASS}@${DB_IP}:5432/burgerhause"
unset DB_PASS
if ! docker build --progress=plain --network host --secret id=database_url,env=BUILD_DATABASE_URL \
  --label "commit=$SHORT" --target app -t "$IMG:$SHORT" . >build.log 2>&1; then
  unset BUILD_DATABASE_URL
  tail -n 60 build.log | tee -a deploy.log
  fail 1 "falló el build: la versión en uso sigue andando sin cambios"
fi
unset BUILD_DATABASE_URL

# ---- 6. cambio de imagen + health -------------------------------------------------------------------------------
log "cambiando a $SHORT"
switch_to "$SHORT" "$SHORT"
if health "$SHORT"; then
  if docker image inspect "$IMG:running" >/dev/null 2>&1; then docker tag "$IMG:running" "$IMG:previous"; fi
  docker tag "$IMG:$SHORT" "$IMG:running"
  echo "$SHORT" >.deployed-commit
  prune_images
  log "DEPLOY_OK $SHORT"
  exit 0
fi

log "la versión nueva $SHORT NO quedó sana"
app_logs
if [ -n "$OLD" ] && docker image inspect "$IMG:running" >/dev/null 2>&1; then
  log "volviendo a $OLD"
  switch_to running "$OLD"
  if health "$OLD"; then
    log "DEPLOY_FAILED_ROLLED_BACK: volví a $OLD (sana). Ojo: la base quedó migrada a $SHORT."
    exit 3
  fi
  app_logs
fi
fail 4 "ni la versión anterior está sana: INTERVENIR A MANO (./deploy.sh status, docker compose logs app)"
