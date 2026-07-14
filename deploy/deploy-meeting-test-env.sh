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

set_env_value() {
  local key="$1"
  local value="$2"
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
ensure_env_if_empty "WECOM_API_BASE_URL" "https://qyapi.weixin.qq.com/cgi-bin"
ensure_env_if_empty "WECOM_SYNC_ROOT_DEPARTMENT_ID" "1"
ensure_env "WECOM_PRESIDENT_USERID" ""
set_env_value "WECOM_USERID_FROM_EMP_ID" "0"
ensure_env "WECOM_USER_MAP_JSON" ""
ensure_env_if_empty "WECOM_USER_MAP_FILE" "config/wecom-user-map.example.json"
ensure_env "WECOM_CORP_ID" ""
ensure_env "WECOM_OAUTH_STATE_SECRET" ""
ensure_env "WECOM_CALLBACK_TOKEN" ""
ensure_env "WECOM_CALLBACK_ENCODING_AES_KEY" ""
ensure_env "WECOM_CALLBACK_RECEIVE_ID" ""
ensure_secret_env "WECOM_DEEPLINK_SECRET"
ensure_env "TENCENTCLOUD_APPID" ""
ensure_env "TENCENTCLOUD_SECRET_ID" ""
ensure_env "TENCENTCLOUD_SECRET_KEY" ""
ensure_env_if_empty "TENCENTCLOUD_REGION" "ap-guangzhou"
ensure_env_if_empty "TENCENT_ASR_ENGINE_MODEL_TYPE" "16k_zh"
ensure_env_if_empty "TENCENT_ASR_RES_TEXT_FORMAT" "3"
ensure_env_if_empty "TENCENT_ASR_CHANNEL_NUM" "1"
ensure_env_if_empty "TENCENT_ASR_POLL_TIMEOUT_MS" "45000"
ensure_env_if_empty "TENCENT_ASR_POLL_INTERVAL_MS" "2000"
ensure_env_if_empty "TENCENT_ASR_NORMALIZE_AUDIO" "1"
ensure_env_if_empty "TENCENT_ASR_AUDIO_FILTER" "dynaudnorm=f=150:g=25,volume=12dB,alimiter=limit=0.95"
ensure_env_if_empty "TENCENT_REALTIME_ASR_ENGINE_MODEL_TYPE" "16k_zh"
ensure_env_if_empty "TENCENT_REALTIME_ASR_VOICE_FORMAT" "1"
ensure_env_if_empty "TENCENT_REALTIME_ASR_NEED_VAD" "1"
ensure_env_if_empty "TENCENT_REALTIME_ASR_FILTER_EMPTY_RESULT" "1"
ensure_env_if_empty "TENCENT_REALTIME_ASR_MAX_SPEAK_TIME" "10000"
ensure_env_if_empty "TENCENT_REALTIME_ASR_SIGNATURE_TTL_SECONDS" "300"

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
