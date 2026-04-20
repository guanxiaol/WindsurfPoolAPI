#!/usr/bin/env bash
# ─────────────────────────────────────────────────────
# WindsurfPoolAPI — Linux installer (x64 / arm64)
# Installs as a systemd service under the invoking user.
# ─────────────────────────────────────────────────────
set -e

INSTALL_DIR="$HOME/.windsurfapi"
SERVICE_NAME="windsurfpoolapi"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "╔══════════════════════════════════════════╗"
echo "║  WindsurfPoolAPI Installer (Linux)       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check Node.js ───────────────────────────────
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Please install Node.js >= 20:"
  echo "   Ubuntu/Debian:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs"
  echo "   Fedora/RHEL:    sudo dnf install -y nodejs"
  echo "   Arch:           sudo pacman -S nodejs"
  exit 1
fi

NODE_VER=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 20 ]; then
  echo "❌ Node.js >= 20 required (found v$(node --version))"
  exit 1
fi
echo "✅ Node.js $(node --version)"

# ── Detect arch ─────────────────────────────────
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)   LS_BIN_NAME="language_server_linux_x64" ;;
  aarch64|arm64) LS_BIN_NAME="language_server_linux_arm" ;;
  *)
    echo "⚠️  Unknown arch: $ARCH — defaulting to language_server_linux_x64"
    LS_BIN_NAME="language_server_linux_x64"
    ;;
esac
echo "✅ Architecture: $ARCH → $LS_BIN_NAME"

# ── Install files ───────────────────────────────
echo "📁 Installing to $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$SCRIPT_DIR/../src" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/../package.json" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/../README.md" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/../CHANGELOG.md" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/../LICENSE"      "$INSTALL_DIR/" 2>/dev/null || true

# ── Check Windsurf Language Server ──────────────
LS_PATH="/opt/windsurf/${LS_BIN_NAME}"
if [ ! -x "$LS_PATH" ]; then
  echo ""
  echo "⚠️  Windsurf Language Server not found at:"
  echo "    $LS_PATH"
  echo ""
  echo "   Install it manually:"
  echo "   1. Download the Windsurf Linux tarball from https://windsurf.com/download"
  echo "   2. Extract ${LS_BIN_NAME} to /opt/windsurf/"
  echo "   3. chmod +x $LS_PATH"
  echo ""
  read -p "   Continue anyway? [y/N] " yn
  [[ "$yn" != "y" && "$yn" != "Y" ]] && exit 1
fi

# ── systemd unit ────────────────────────────────
if [ -d /etc/systemd/system ]; then
  echo "🛠  Writing systemd unit to $SERVICE_FILE ..."
  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=WindsurfPoolAPI — multi-account pool proxy for Windsurf
After=network.target

[Service]
Type=simple
User=$USER
Group=$(id -gn)
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) $INSTALL_DIR/src/index.js
Restart=on-failure
RestartSec=5
Environment=PORT=3003
Environment=LOG_LEVEL=info
Environment=LS_BINARY_PATH=$LS_PATH
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME"

  echo ""
  echo "✅ Installed! Service is running."
  echo ""
  echo "Commands:"
  echo "  sudo systemctl status $SERVICE_NAME"
  echo "  sudo systemctl restart $SERVICE_NAME"
  echo "  sudo journalctl -u $SERVICE_NAME -f"
  echo ""
  echo "Dashboard: http://localhost:3003/dashboard"
else
  echo "⚠️  /etc/systemd/system not present — skipping service install."
  echo "   Start manually with:"
  echo "   cd $INSTALL_DIR && node src/index.js"
fi
