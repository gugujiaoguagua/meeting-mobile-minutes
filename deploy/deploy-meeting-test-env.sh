#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/meeting-loop-test}"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$APP_DIR/docker-compose.yml" ]; then
  echo "Missing docker-compose.yml in $APP_DIR" >&2
  echo "Extract the meeting publish package to $APP_DIR first." >&2
  exit 1
fi

cd "$APP_DIR"

if [ ! -f "$ENV_FILE" ]; then
  cp .env.production.example "$ENV_FILE"
  echo "Created $ENV_FILE from .env.production.example"
fi

ensure_env() {
  local key="$1"
  local value="$2"
  if ! grep -q "^${key}=" "$ENV_FILE"; then
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_env_if_empty() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=[^[:space:]]" "$ENV_FILE"; then
    return
  fi
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_secret_env() {
  local key="$1"
  if grep -q "^${key}=[^[:space:]]" "$ENV_FILE"; then
    return
  fi
  local value
  value="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))')"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

ensure_env "MEETING_PUBLIC_BASE_URL" "http://localhost:3000"
ensure_env "WECOM_AGENT_ID" ""
ensure_env "WECOM_TOKEN_API_URL" ""
ensure_env "WECOM_USER_MAP_JSON" ""
ensure_env_if_empty "WECOM_USER_MAP_FILE" "config/wecom-user-map.example.json"
ensure_env "WECOM_CORP_ID" ""
ensure_env "WECOM_OAUTH_STATE_SECRET" ""
ensure_secret_env "WECOM_DEEPLINK_SECRET"

mkdir -p "$APP_DIR/.local-data"

docker compose --env-file "$ENV_FILE" config >/dev/null
docker compose --env-file "$ENV_FILE" up -d db
docker compose --env-file "$ENV_FILE" build app
docker compose --env-file "$ENV_FILE" run --rm app node scripts/apply-migrations.mjs
docker compose --env-file "$ENV_FILE" up -d app
docker compose --env-file "$ENV_FILE" ps

echo "Local service checks:"
curl -I --max-time 15 http://127.0.0.1:13000/ || true
curl -sS --max-time 15 http://127.0.0.1:13000/api/state | head -c 300 || true
echo
