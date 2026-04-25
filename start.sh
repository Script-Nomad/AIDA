#!/usr/bin/env bash
# ==============================================================================
# AIDA - Startup Script
# ==============================================================================
# Single entry point for all modes:
#   ./start.sh            Production (Nginx on localhost:31337)
#   ./start.sh --lan      Production + LAN accessible (0.0.0.0:31337)
#   ./start.sh --dev      Development (Vite hot reload on localhost:5173)
# ==============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; }
section() { echo -e "\n${BLUE}══════════════════════════════════════${NC}\n${BLUE}  $*${NC}\n${BLUE}══════════════════════════════════════${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ==============================================================================
# PARSE ARGUMENTS
# ==============================================================================

MODE="prod"
BIND="127.0.0.1"
SKIP_CHECKS=false

for arg in "$@"; do
    case $arg in
        --dev|-d)     MODE="dev" ;;
        --lan|-l)     BIND="0.0.0.0" ;;
        --fast|-f)    SKIP_CHECKS=true ;;
        --help|-h)
            echo "Usage: ./start.sh [OPTIONS]"
            echo ""
            echo "Modes:"
            echo "  (default)      Production — Nginx on localhost:31337"
            echo "  --lan, -l      Production + LAN accessible (0.0.0.0:31337)"
            echo "  --dev, -d      Development — Vite hot reload on localhost:5173"
            echo "  --dev --lan    Development + LAN (hot reload accessible from network)"
            echo ""
            echo "Options:"
            echo "  --fast, -f     Skip dependency checks (faster startup)"
            echo "  --help, -h     Show this help"
            exit 0
            ;;
    esac
done

# ==============================================================================
# MODE-SPECIFIC CONFIG
# ==============================================================================

AIDA_PORT=31337

if [[ "$MODE" == "dev" ]]; then
    COMPOSE_FILES=""
    FRONTEND_PORT=5173
    FRONTEND_URL="http://localhost:5173"
    if [[ "$BIND" == "0.0.0.0" ]]; then
        MODE_LABEL="Development+LAN"
    else
        MODE_LABEL="Development"
    fi
else
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
    FRONTEND_PORT=$AIDA_PORT
    FRONTEND_URL="http://localhost:${AIDA_PORT}"
    MODE_LABEL="Production"
    export FRONTEND_BIND="$BIND"
fi

section "AIDA - ${MODE_LABEL} Mode"

# ==============================================================================
# QUICK CHECKS
# ==============================================================================

if ! command -v docker &> /dev/null; then
    error "Docker not installed. Get it from: https://docker.com/products/docker-desktop"
    exit 1
fi

if ! docker info &> /dev/null; then
    error "Docker daemon not running. Start Docker Desktop first."
    exit 1
fi

# Docker Compose: prefer plugin, fallback to standalone (Kali)
if docker compose version &>/dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
else
    error "Docker Compose not found. Install: sudo apt install docker-compose"
    exit 1
fi

# Build the full compose command for this mode
if [[ -n "$COMPOSE_FILES" ]]; then
    COMPOSE="$COMPOSE_CMD $COMPOSE_FILES"
else
    COMPOSE="$COMPOSE_CMD"
fi

# ==============================================================================
# TEAR DOWN OTHER MODE (if switching)
# ==============================================================================

# If we're starting prod and dev containers are running (or vice versa), stop them first.
if [[ "$MODE" == "dev" ]]; then
    # Check if prod stack is running (port 31337 mapped)
    if $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml ps --format "{{.Ports}}" 2>/dev/null | grep -q "31337"; then
        warn "Prod stack running — tearing down to switch to dev mode..."
        $COMPOSE_CMD -f docker-compose.yml -f docker-compose.prod.yml down --timeout 15
        log "Prod stack stopped — data preserved"
        sleep 1
    fi
else
    # Check if dev stack is running (port 5173 mapped)
    if $COMPOSE_CMD ps --format "{{.Ports}}" 2>/dev/null | grep -q "5173"; then
        warn "Dev stack running — tearing down to switch to prod mode..."
        $COMPOSE_CMD down --timeout 15
        log "Dev stack stopped — data preserved"
        sleep 1
    fi
fi

# ==============================================================================
# CHECK PORT CONFLICTS
# ==============================================================================

check_port() {
    local port=$1
    local service=$2
    # Docker runtimes (OrbStack, Docker Desktop) forward container ports through
    # their own process — they will always show up on our ports. Not a conflict.
    local docker_runtimes="OrbStack|com.docker|dockerd|Docker"

    if command -v lsof &>/dev/null; then
        local process
        process=$(lsof -iTCP:"$port" -sTCP:LISTEN -P -n 2>/dev/null | awk 'NR==2 {print $1}')
        if [[ -n "$process" ]] && ! echo "$process" | grep -qE "$docker_runtimes"; then
            warn "Port $port ($service) is already in use by: $process"
            return 1
        fi
    elif command -v ss &>/dev/null; then
        local process
        process=$(ss -tlnp 2>/dev/null | grep ":$port " | sed 's/.*users:(("\([^"]*\)".*/\1/')
        if [[ -n "$process" ]] && ! echo "$process" | grep -qE "$docker_runtimes"; then
            warn "Port $port ($service) is already in use by: $process"
            return 1
        fi
    fi
    return 0
}

PORT_CONFLICT=false
check_port 5432           "PostgreSQL" || PORT_CONFLICT=true
check_port 8000           "Backend"    || PORT_CONFLICT=true
check_port $FRONTEND_PORT "Frontend"   || PORT_CONFLICT=true

if [[ "$PORT_CONFLICT" == "true" ]]; then
    echo ""
    warn "Port conflict detected!"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        error "Aborted due to port conflict"
        exit 1
    fi
fi

# ==============================================================================
# CONTAINER MODE (aida-pentest or exegol)
# ==============================================================================

CONTAINER_PREFS_FILE="$SCRIPT_DIR/.aida/container-preference"
mkdir -p "$SCRIPT_DIR/.aida"
CONTAINER_MODE=$(cat "$CONTAINER_PREFS_FILE" 2>/dev/null || echo "aida-pentest")

# Default to aida-pentest on first run (no interactive prompt)
if [[ ! -f "$CONTAINER_PREFS_FILE" ]]; then
    echo "aida-pentest" > "$CONTAINER_PREFS_FILE"
fi

# ==============================================================================
# CHECK IF ALREADY RUNNING (same mode)
# ==============================================================================

CONTAINERS_RUNNING=$($COMPOSE ps --status running -q 2>/dev/null | wc -l | tr -d ' ')

if [[ "$CONTAINERS_RUNNING" -ge 3 ]]; then
    log "AIDA is already running! (${MODE_LABEL})"
    echo ""
    $COMPOSE ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    log "Frontend: $FRONTEND_URL"
    log "Backend:  http://localhost:8000"
    echo ""
    exit 0
fi

# ==============================================================================
# ENVIRONMENT FILES (Quick)
# ==============================================================================

if [[ ! -f backend/.env ]]; then
    if [[ -f backend/.env.docker ]]; then
        cp backend/.env.docker backend/.env
        log "Created backend/.env"
    elif [[ -f backend/.env.example ]]; then
        cp backend/.env.example backend/.env
        log "Created backend/.env from example"
    fi
fi

if [[ "$MODE" == "dev" ]] && [[ "$BIND" != "0.0.0.0" ]]; then
    # Always (re)write so a previous --lan run doesn't leave a stale LAN IP
    echo "VITE_API_URL=http://localhost:8000/api" > frontend/.env
    log "Created/updated frontend/.env"
fi

# ==============================================================================
# PYTHON ENVIRONMENTS (Only if missing — needed for MCP server on host)
# ==============================================================================

if [[ "$SKIP_CHECKS" == "false" ]]; then
    # Find Python 3.10+
    PYTHON_CMD="python3"
    for py in python3.13 python3.12 python3.11 python3.10; do
        if command -v $py &> /dev/null; then
            PYTHON_CMD=$py
            break
        fi
    done

    # CLI venv
    if [[ ! -f ".venv/bin/python" ]]; then
        log "Creating CLI virtual environment..."
        $PYTHON_CMD -m venv .venv
        .venv/bin/pip install -q --upgrade pip
        [[ -f requirements.txt ]] && .venv/bin/pip install -q -r requirements.txt
        log "CLI environment ready"
    fi

    # Backend venv (for MCP server)
    if [[ ! -f "backend/venv/bin/python" ]]; then
        log "Creating backend virtual environment..."
        $PYTHON_CMD -m venv backend/venv
        backend/venv/bin/pip install -q --upgrade pip
        [[ -f backend/requirements.txt ]] && backend/venv/bin/pip install -q -r backend/requirements.txt
        log "Backend environment ready"
    fi
fi

# ==============================================================================
# LAN MODE — detect IP and set CORS
# ==============================================================================

HOST_IP=""
if [[ "$BIND" == "0.0.0.0" ]]; then
    # macOS: try common interfaces
    if command -v ipconfig &>/dev/null; then
        for iface in en0 en1 en2 en3; do
            candidate=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
            if [[ -n "$candidate" ]]; then
                HOST_IP="$candidate"
                break
            fi
        done
    fi
    # Linux fallback
    if [[ -z "$HOST_IP" ]] && command -v hostname &>/dev/null; then
        HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    fi
    # Manual fallback
    if [[ -z "$HOST_IP" ]]; then
        warn "Could not auto-detect LAN IP."
        read -rp "Enter your machine's LAN IP (e.g. 192.168.1.10): " HOST_IP
    fi

    log "LAN IP: $HOST_IP"

    if [[ "$MODE" == "dev" ]]; then
        # Dev + LAN: expose backend and Vite on the network
        export BACKEND_BIND_HOST="0.0.0.0"
        export FRONTEND_BIND_HOST="0.0.0.0"
        # Write .env so Vite picks up the correct API URL (env file, not process env)
        echo "VITE_API_URL=http://${HOST_IP}:8000/api" > frontend/.env
        log "Updated frontend/.env for LAN (API → http://${HOST_IP}:8000/api)"
        export BACKEND_CORS_ORIGINS="http://${HOST_IP}:5173,http://localhost:5173,http://127.0.0.1:5173"
        FRONTEND_URL="http://${HOST_IP}:${FRONTEND_PORT}"
    else
        export BACKEND_CORS_ORIGINS="http://${HOST_IP}:${AIDA_PORT},http://localhost:${AIDA_PORT},http://127.0.0.1:${AIDA_PORT}"
        FRONTEND_URL="http://${HOST_IP}:${AIDA_PORT}"
    fi
fi

# ==============================================================================
# DOCKER — Smart Build
# ==============================================================================

section "Docker Containers"

# Check for orphan containers from other projects with same names
ORPHAN_POSTGRES=$(docker ps -a --format "{{.Names}}" | grep "^aida_postgres$" || true)
ORPHAN_BACKEND=$(docker ps -a --format "{{.Names}}" | grep "^aida_backend$" || true)
ORPHAN_FRONTEND=$(docker ps -a --format "{{.Names}}" | grep "^aida_frontend$" || true)

OUR_CONTAINERS=$($COMPOSE ps -a -q 2>/dev/null | wc -l | tr -d ' ')

if [[ -n "$ORPHAN_POSTGRES" || -n "$ORPHAN_BACKEND" || -n "$ORPHAN_FRONTEND" ]] && [[ "$OUR_CONTAINERS" -eq 0 ]]; then
    warn "Found containers from another project with same names"
    log "Removing orphan containers..."
    docker rm -f aida_postgres aida_backend aida_frontend 2>/dev/null || true
    log "Orphan containers removed"
fi

# Dev mode: always build from source (hot reload needs local code)
# Prod mode: pull pre-built images from Docker Hub (instant start)
#            fall back to local build if pull fails (Hub not set up yet)
if [[ "$MODE" == "dev" ]]; then
    log "Building Docker images from source..."
    if [[ "$CONTAINER_MODE" == "aida-pentest" ]]; then
        $COMPOSE build --quiet
    else
        $COMPOSE build --quiet backend frontend
    fi
else
    log "Pulling Docker images..."
    if $COMPOSE pull --quiet 2>/dev/null; then
        log "Images pulled from Docker Hub"
    else
        warn "Pull failed — building from source (first run may take a few minutes)..."
        if [[ "$CONTAINER_MODE" == "aida-pentest" ]]; then
            $COMPOSE build --quiet
        else
            $COMPOSE build --quiet backend frontend
        fi
    fi
fi

# ==============================================================================
# START CONTAINERS
# ==============================================================================

RUNNING_CONTAINERS=$($COMPOSE ps --status running -q 2>/dev/null | wc -l | tr -d ' ')

if [[ "$RUNNING_CONTAINERS" -ge 3 ]]; then
    log "Containers already running"
else
    log "Starting containers..."
    if [[ "$MODE" == "dev" ]]; then
        # Dev mode — set ENVIRONMENT so backend uses --reload
        ENVIRONMENT=development $COMPOSE up -d --remove-orphans 2>&1 | grep -v "already exists but was created for project" || true
    else
        if [[ "$CONTAINER_MODE" == "aida-pentest" ]]; then
            $COMPOSE up -d --remove-orphans 2>&1 | grep -v "already exists but was created for project" || true
        else
            $COMPOSE up -d --remove-orphans postgres backend frontend 2>&1 | grep -v "already exists but was created for project" || true
        fi
    fi
fi

# ==============================================================================
# WAIT FOR SERVICES
# ==============================================================================

section "Waiting for Services"

wait_for_service() {
    local name=$1
    local check_cmd=$2
    local max_wait=${3:-30}
    local i=0

    printf "  %-12s " "$name..."
    while ! eval "$check_cmd" &>/dev/null; do
        ((i++))
        if [[ $i -ge $max_wait ]]; then
            echo -e "${RED}TIMEOUT${NC}"
            return 1
        fi
        sleep 1
    done
    echo -e "${GREEN}Ready${NC}"
}

wait_for_service "PostgreSQL" "$COMPOSE exec -T postgres pg_isready -U aida" 30
wait_for_service "Backend"    "curl -sf http://localhost:8000/health"         60

if [[ "$MODE" == "dev" ]]; then
    wait_for_service "Frontend" "curl -sf http://localhost:5173" 120
else
    wait_for_service "Frontend" "curl -sf http://localhost:${AIDA_PORT}" 90
fi

# ==============================================================================
# HOST HELPER (Background)
# ==============================================================================

pkill -f "tools/helper.py" 2>/dev/null || true
pkill -f "folder_opener.py" 2>/dev/null || true
if [[ -f "$SCRIPT_DIR/tools/helper.py" ]]; then
    python3 "$SCRIPT_DIR/tools/helper.py" &>/dev/null &
fi

# ==============================================================================
# PENTEST CONTAINER STATUS
# ==============================================================================

if [[ "$CONTAINER_MODE" == "exegol" ]]; then
    EXEGOL_RUNNING=$(docker ps --format "{{.Names}}" 2>/dev/null | grep -i "^exegol-" || true)
    if [[ -n "$EXEGOL_RUNNING" ]]; then
        log "Exegol container: $EXEGOL_RUNNING"
    fi
else
    PENTEST_RUNNING=$(docker ps --format "{{.Names}}" 2>/dev/null | grep "^aida-pentest$" || true)
    if [[ -z "$PENTEST_RUNNING" ]]; then
        warn "aida-pentest not running — starting..."
        $COMPOSE up -d aida-pentest 2>&1 | grep -v "already" || true
    else
        log "Pentesting container: aida-pentest"
    fi
fi

# ==============================================================================
# SUCCESS
# ==============================================================================

section "AIDA Ready"

echo ""
log "Frontend : $FRONTEND_URL"
log "Backend  : http://localhost:8000"
log "API Docs : http://localhost:8000/docs"

if [[ "$BIND" == "0.0.0.0" && -n "$HOST_IP" ]]; then
    echo ""
    echo -e "  ${BLUE}Share with your team →${NC}  $FRONTEND_URL"
fi

echo ""
$COMPOSE ps --format "table {{.Name}}\t{{.Status}}"
echo ""
