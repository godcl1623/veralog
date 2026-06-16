#!/usr/bin/env bash
set -euo pipefail

# Veralog 로컬 개발 DB 셋업 스크립트
#
# 흐름:
#   1) 로컬에 떠 있는 postgresql이 있으면 그걸 사용
#   2) 없으면 docker로 postgres 컨테이너를 띄워서 사용
#   3) docker도 없으면 설치 안내 후 종료 (자동 설치/기동은 OS별 신뢰도 문제로 생략)
#   4) 위 단계로 확보한 postgres에 프로젝트 전용 db/user 생성
#   5) apps/api/.env의 DATABASE_URL을 정규화해서 기록
#   6) drizzle-kit generate, migrate 실행
#
# apps/api/.env에 아래 키들을 미리 작성해두면 그 값을 그대로 사용합니다.
#   DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DBNAME   (만들고자 하는 앱 계정/DB)
#   ADMIN_USER=...                                              (DB/ROLE 생성 권한을 가진 기존 postgres 관리자 계정)
#   ADMIN_PASSWORD=...

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="$ROOT_DIR/apps/api"
ENV_FILE="$API_DIR/.env"
DOCKER_CONTAINER_NAME="veralog-postgres"

if [ ! -f "$ENV_FILE" ]; then
  echo "[setup-db] ${ENV_FILE} 파일이 없습니다. DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD를 작성해주세요." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?${ENV_FILE}에 DATABASE_URL을 작성해주세요 (postgresql://USER:PASSWORD@HOST:PORT/DBNAME)}"
: "${ADMIN_USER:?${ENV_FILE}에 ADMIN_USER를 작성해주세요}"
: "${ADMIN_PASSWORD:?${ENV_FILE}에 ADMIN_PASSWORD를 작성해주세요}"

# DATABASE_URL = postgresql://USER:PASSWORD@HOST:PORT/DBNAME 파싱
if [[ ! "$DATABASE_URL" =~ ^postgres(ql)?://([^:]+):([^@]+)@([^:/]+):([0-9]+)/([^?]+) ]]; then
  echo "[setup-db] DATABASE_URL 형식이 올바르지 않습니다: ${DATABASE_URL}" >&2
  exit 1
fi
DB_USER="${BASH_REMATCH[2]}"
DB_PASSWORD="${BASH_REMATCH[3]}"
DB_HOST="${BASH_REMATCH[4]}"
DB_PORT="${BASH_REMATCH[5]}"
DB_NAME="${BASH_REMATCH[6]}"

log() { echo "[setup-db] $*"; }

# psql/pg_isready 같은 클라이언트 바이너리가 호스트에 없을 수 있으므로
# bash 내장 /dev/tcp로 포트 응답 여부만 확인합니다.
port_is_open() {
  (exec 3<>"/dev/tcp/${DB_HOST}/${DB_PORT}") >/dev/null 2>&1
}

# 호스트에 psql이 있으면 그대로, 없으면 DB_PORT를 publish 중인 컨테이너를 찾아
# docker exec로 대신 실행합니다.
run_psql() {
  if command -v psql >/dev/null 2>&1; then
    PGPASSWORD="$ADMIN_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$ADMIN_USER" -v ON_ERROR_STOP=1 "$@"
    return
  fi

  local container
  container="$(docker ps --format '{{.Names}}\t{{.Ports}}' | awk -v port=":${DB_PORT}->" '$0 ~ port {print $1; exit}')"

  if [ -z "$container" ]; then
    log "psql이 호스트에 없고, ${DB_PORT} 포트를 publish하는 컨테이너도 찾지 못했습니다."
    exit 1
  fi

  docker exec -i -e PGPASSWORD="$ADMIN_PASSWORD" "$container" \
    psql -U "$ADMIN_USER" -v ON_ERROR_STOP=1 "$@"
}

ensure_postgres_running() {
  if port_is_open; then
    log "${DB_HOST}:${DB_PORT}에 postgresql이 이미 응답하고 있습니다. 그대로 사용합니다."
    return 0
  fi

  log "${DB_HOST}:${DB_PORT}에서 postgresql이 감지되지 않았습니다. docker를 확인합니다."

  if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
    log "docker가 설치되어 있지 않거나 실행 중이 아닙니다."
    log "Docker Desktop을 설치한 뒤 (https://www.docker.com/products/docker-desktop) 실행 상태로 둔 다음 이 스크립트를 다시 실행해주세요."
    exit 1
  fi

  if docker ps -a --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER_NAME"; then
    if ! docker ps --format '{{.Names}}' | grep -qx "$DOCKER_CONTAINER_NAME"; then
      log "기존 ${DOCKER_CONTAINER_NAME} 컨테이너를 시작합니다."
      docker start "$DOCKER_CONTAINER_NAME" >/dev/null
    else
      log "${DOCKER_CONTAINER_NAME} 컨테이너가 이미 실행 중입니다."
    fi
  else
    log "${DOCKER_CONTAINER_NAME} 컨테이너를 새로 생성합니다."
    docker run -d \
      --name "$DOCKER_CONTAINER_NAME" \
      -e POSTGRES_USER="$ADMIN_USER" \
      -e POSTGRES_PASSWORD="$ADMIN_PASSWORD" \
      -p "${DB_PORT}:5432" \
      postgres:16 >/dev/null
  fi

  log "postgres 기동 대기 중..."
  for _ in $(seq 1 30); do
    if port_is_open; then
      return 0
    fi
    sleep 1
  done

  log "postgres가 제한 시간 내에 기동되지 않았습니다."
  exit 1
}

ensure_db_and_user() {
  log "DB/사용자 존재 여부를 확인하고 없으면 생성합니다."

  run_psql <<-SQL
    DO \$\$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
        CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
      END IF;
    END
    \$\$;
SQL

  if ! run_psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" | grep -q 1; then
    run_psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
  fi
}

run_migrations() {
  log "drizzle-kit generate / migrate를 실행합니다."
  (cd "$API_DIR" && pnpm db:generate && pnpm db:migrate)
}

main() {
  ensure_postgres_running
  ensure_db_and_user
  run_migrations
  log "완료되었습니다."
}

main "$@"
