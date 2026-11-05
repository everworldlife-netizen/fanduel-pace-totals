#!/usr/bin/env bash
# Pace Totals: one-paste installer for a Hostinger VPS (Ubuntu 22.04 / 24.04, run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/everworldlife-netizen/fanduel-pace-totals/main/deploy/vps-setup.sh | bash
#
# What it does:
#   1. Installs git and Docker if they are missing.
#   2. Clones (or updates) this repo into /opt/fanduel-pace-totals.
#   3. Builds and starts the app on 127.0.0.1:3010 (never exposed directly).
#   4. Serves https://$DOMAIN through whatever web server already owns ports 80/443:
#        nothing     -> starts a small Caddy container (automatic HTTPS)
#        nginx       -> adds a site and a Let's Encrypt certificate via certbot
#        caddy       -> adds a site block to /etc/caddy/Caddyfile
#        traefik     -> attaches the app with Docker labels
#      Anything else: the app still runs, nothing else is touched, and the script
#      prints what it found so the proxy can be wired up by hand.
#
# Safe to re-run: it pulls the latest code, rebuilds, and leaves existing proxy config alone.
# Optional overrides: DOMAIN, BRANCH, APP_DIR, APP_PORT (e.g. `... | DOMAIN=x.example.com bash`).

main() {
  set -euo pipefail

  DOMAIN="${DOMAIN:-pace.everworld.cloud}"
  BRANCH="${BRANCH:-main}"
  REPO_URL="${REPO_URL:-https://github.com/everworldlife-netizen/fanduel-pace-totals.git}"
  APP_DIR="${APP_DIR:-/opt/fanduel-pace-totals}"
  APP_PORT="${APP_PORT:-3010}"
  PROJECT=pace-totals
  STATE_DIR="$APP_DIR/.vps"
  COMPOSE_FILE="$STATE_DIR/compose.yml"

  [ "$(id -u)" -eq 0 ] || die "Please run as root (the Hostinger browser terminal already is)."

  install_prereqs
  sync_repo
  mkdir -p "$STATE_DIR"
  [ -f "$APP_DIR/.env" ] || cp "$APP_DIR/.env.example" "$APP_DIR/.env"

  detect_proxy
  log "Front door for $DOMAIN: $MODE${PROXY_DETAIL:+ ($PROXY_DETAIL)}"

  write_compose
  log "Building and starting the app (first build takes a minute or two)"
  dc up -d --build --remove-orphans </dev/null
  wait_for_app

  case "$MODE" in
    caddy-bundled) : ;;  # Caddy started with the app above
    nginx)         setup_nginx ;;
    caddy-host)    setup_caddy_host ;;
    traefik)       : ;;  # labels applied with the app above
    unsupported)   report_unsupported; return 0 ;;
  esac

  verify_https
  if docker ps -a --format '{{.Names}}' | grep -qx 'fanduel-pace-totals'; then
    log "Note: an older copy (container 'fanduel-pace-totals') is also on this server. $DOMAIN does not use it."
    echo "    Remove it any time with: docker rm -f fanduel-pace-totals"
  fi
}

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!!  %s\n' "$*" >&2; exit 1; }
dc()  { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }

install_prereqs() {
  export DEBIAN_FRONTEND=noninteractive
  local missing=()
  command -v git  >/dev/null 2>&1 || missing+=(git)
  command -v curl >/dev/null 2>&1 || missing+=(curl)
  if [ "${#missing[@]}" -gt 0 ]; then
    log "Installing ${missing[*]}"
    apt-get update -qq </dev/null
    apt-get install -y -qq "${missing[@]}" </dev/null
  fi
  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker is installed but the 'docker compose' plugin is missing (apt-get install docker-compose-plugin)."
}

sync_repo() {
  if [ -d "$APP_DIR/.git" ]; then
    log "Updating code in $APP_DIR ($BRANCH)"
    git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
    git -C "$APP_DIR" checkout --quiet -B "$BRANCH" "origin/$BRANCH"
    git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
  else
    [ -e "$APP_DIR" ] && die "$APP_DIR exists but is not a git checkout. Move it aside, or re-run with APP_DIR=/some/other/path."
    log "Downloading code into $APP_DIR ($BRANCH)"
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi
}

# Sets MODE (caddy-bundled | nginx | caddy-host | traefik | unsupported) and PROXY_DETAIL.
detect_proxy() {
  MODE=unsupported PROXY_DETAIL="" TRAEFIK_NET="" TRAEFIK_EP="" TRAEFIK_RESOLVER="" TRAEFIK_WHY=""
  local owner container image
  owner="$(port_owner 80)"
  [ -n "$owner" ] || owner="$(port_owner 443)"

  case "$owner" in
    "")    MODE=caddy-bundled; PROXY_DETAIL="ports 80/443 are free" ;;
    nginx) MODE=nginx ;;
    caddy) MODE=caddy-host ;;
    docker-proxy|traefik)
      container="$(docker ps --filter publish=80 --format '{{.Names}}' | head -n1)"
      [ -n "$container" ] || container="$(docker ps --filter publish=443 --format '{{.Names}}' | head -n1)"
      [ -n "$container" ] || container="$(docker ps --format '{{.Names}} {{.Image}}' | awk 'tolower($2) ~ /traefik/ {print $1; exit}')"
      image="$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null || true)"
      PROXY_DETAIL="container '$container', image '$image'"
      if [ "$container" = "${PROJECT}-caddy" ]; then
        MODE=caddy-bundled
      elif printf '%s' "$image" | grep -qi traefik; then
        traefik_settings "$container" && MODE=traefik || PROXY_DETAIL="$PROXY_DETAIL; $TRAEFIK_WHY"
      fi
      ;;
    *) PROXY_DETAIL="process '$owner' is using port 80" ;;
  esac
}

port_owner() {
  ss -ltnpH "( sport = :$1 )" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -n1 || true
}

# Learns the Docker network, entrypoint and certificate resolver Traefik already uses.
traefik_settings() {
  local tc="$1" labels args pair
  TRAEFIK_NET="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' "$tc" \
    | grep -vxE 'bridge|host|none|' | head -n1 || true)"
  [ -n "$TRAEFIK_NET" ] || { TRAEFIK_WHY="Traefik is not on a named Docker network"; return 1; }

  # Copy the entrypoint + resolver from a site Traefik already serves over HTTPS.
  labels="$(docker ps -q | xargs -r docker inspect -f '{{range $k, $v := .Config.Labels}}{{$k}}={{$v}}{{"\n"}}{{end}}')"
  pair="$(printf '%s\n' "$labels" | awk -F= '
    /^traefik\.http\.routers\.[^.]+\.tls\.certresolver=/ { split($1, a, "."); r[a[4]] = $2 }
    /^traefik\.http\.routers\.[^.]+\.entrypoints=/       { split($1, a, "."); e[a[4]] = $2 }
    END { for (k in r) if (k in e) { print e[k], r[k]; exit } }')"
  if [ -n "$pair" ]; then
    TRAEFIK_EP="${pair%% *}" TRAEFIK_RESOLVER="${pair#* }"
  else
    # Fall back to Traefik's own command-line flags.
    args="$(docker inspect -f '{{join .Args "\n"}}' "$tc")"
    TRAEFIK_RESOLVER="$(printf '%s\n' "$args" | grep -oP -- '--certificatesresolvers\.\K[^.]+' | head -n1 || true)"
    TRAEFIK_EP="$(printf '%s\n' "$args" | grep -oP -- '--entrypoints\.\K[^.]+(?=\.address=:443\b)' | head -n1 || true)"
  fi
  [ -n "$TRAEFIK_EP" ] && [ -n "$TRAEFIK_RESOLVER" ] && return 0
  TRAEFIK_WHY="could not tell which Traefik entrypoint / certificate resolver to use"
  return 1
}

write_compose() {
  cat >"$COMPOSE_FILE" <<YAML
# Generated by deploy/vps-setup.sh. Re-run the script instead of editing this file.
services:
  app:
    build:
      context: ..
      dockerfile: Dockerfile
    image: ${PROJECT}:latest
    container_name: ${PROJECT}
    restart: unless-stopped
    env_file: ../.env
    environment:
      PORT: "3000"
      NODE_ENV: production
    ports:
      - "127.0.0.1:${APP_PORT}:3000"
YAML

  if [ "$MODE" = traefik ]; then
    cat >>"$COMPOSE_FILE" <<YAML
    labels:
      - traefik.enable=true
      - traefik.docker.network=${TRAEFIK_NET}
      - traefik.http.routers.${PROJECT}.rule=Host(\`${DOMAIN}\`)
      - traefik.http.routers.${PROJECT}.entrypoints=${TRAEFIK_EP}
      - traefik.http.routers.${PROJECT}.tls=true
      - traefik.http.routers.${PROJECT}.tls.certresolver=${TRAEFIK_RESOLVER}
      - traefik.http.services.${PROJECT}.loadbalancer.server.port=3000
    networks: [default, proxy]
networks:
  proxy:
    external: true
    name: ${TRAEFIK_NET}
YAML
  fi

  if [ "$MODE" = caddy-bundled ]; then
    cat >"$STATE_DIR/Caddyfile" <<CADDY
${DOMAIN} {
	encode gzip
	reverse_proxy app:3000
}
CADDY
    cat >>"$COMPOSE_FILE" <<YAML
  caddy:
    image: caddy:2
    container_name: ${PROJECT}-caddy
    restart: unless-stopped
    depends_on: [app]
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
volumes:
  caddy_data:
  caddy_config:
YAML
  fi
}

wait_for_app() {
  local _
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1 && { log "App is running on this server"; return 0; }
    sleep 2
  done
  dc logs --tail 40 app || true
  die "The app did not start. The log above shows why."
}

setup_nginx() {
  local conf
  if [ -d /etc/nginx/sites-available ]; then
    conf="/etc/nginx/sites-available/${DOMAIN}"
  else
    conf="/etc/nginx/conf.d/${DOMAIN}.conf"
  fi

  if [ -e "$conf" ]; then
    log "nginx already has $conf; leaving it as is"
  else
    log "Adding nginx site $conf"
    cat >"$conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    [ -d /etc/nginx/sites-enabled ] && ln -sf "$conf" "/etc/nginx/sites-enabled/${DOMAIN}"
    if ! nginx -t >/dev/null 2>&1; then
      rm -f "$conf" "/etc/nginx/sites-enabled/${DOMAIN}"
      nginx -t || true
      die "nginx rejected the new site, so it was removed again. Your other sites are untouched."
    fi
    systemctl reload nginx
  fi

  if [ -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
    log "HTTPS certificate for $DOMAIN already exists"
    return 0
  fi
  if ! certbot plugins 2>/dev/null | grep -q nginx; then
    log "Installing certbot"
    apt-get update -qq </dev/null
    apt-get install -y -qq certbot python3-certbot-nginx </dev/null
  fi
  log "Getting an HTTPS certificate for $DOMAIN"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect </dev/null \
    || log "Certificate request failed (DNS may still be updating). The site works on http:// for now; re-run this script in a few minutes."
}

setup_caddy_host() {
  local cf=/etc/caddy/Caddyfile backup
  [ -f "$cf" ] || die "Caddy is running but $cf was not found."
  if grep -qE "^[[:space:]]*(https?://)?${DOMAIN//./\\.}([[:space:],:{]|$)" "$cf"; then
    log "$cf already has a $DOMAIN block; leaving it as is"
    return 0
  fi
  log "Adding $DOMAIN to $cf"
  backup="$cf.bak.$(date +%s)"
  cp "$cf" "$backup"
  printf '\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$APP_PORT" >>"$cf"
  if ! caddy validate --config "$cf" --adapter caddyfile >/dev/null 2>&1; then
    cp "$backup" "$cf"
    die "Caddy rejected the new block, so the file was restored. Your other sites are untouched."
  fi
  systemctl reload caddy
}

verify_https() {
  local _
  log "Checking https://$DOMAIN (certificate can take up to a minute)"
  for _ in $(seq 1 18); do
    if curl -fsS --max-time 10 --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/api/health" >/dev/null 2>&1; then
      printf '\n✅  Live: https://%s\n' "$DOMAIN"
      return 0
    fi
    sleep 5
  done
  printf '\n⚠️   The app is running, but https://%s is not answering yet.\n' "$DOMAIN"
  echo "    Usually DNS or the certificate just needs a few more minutes. Re-run this same command to finish."
}

report_unsupported() {
  printf '\n⚠️   The app is running on this server at 127.0.0.1:%s, but ports 80/443 belong to\n' "$APP_PORT"
  printf '    something this script does not configure automatically (%s).\n' "${PROXY_DETAIL:-unknown}"
  echo "    Nothing in that setup was changed. Send the lines below to Claude to finish wiring up $DOMAIN:"
  echo "    ---"
  ss -ltnp 2>/dev/null | grep -E ':(80|443)\b' || true
  docker ps --format '{{.Names}}  {{.Image}}  {{.Ports}}' 2>/dev/null || true
  echo "    ---"
}

main "$@"
