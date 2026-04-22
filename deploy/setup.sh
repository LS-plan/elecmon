#!/bin/bash
# ElecMon 服务器一键部署脚本
# 用法: bash deploy/setup.sh
# 需要: Ubuntu/Debian，已安装 git、python3、nginx

set -e

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_USER="${SUDO_USER:-$(whoami)}"
DATA_DIR="$REPO_DIR/data"
ENV_FILE="$REPO_DIR/.env"

echo "=== ElecMon 部署开始 ==="
echo "项目目录: $REPO_DIR"
echo "运行用户: $SERVICE_USER"

# ── 1. 安装 Python 依赖 ──────────────────────────────
echo ""
echo "[1/5] 安装 Python 依赖..."
cd "$REPO_DIR"
pip install -r requirements.txt --quiet

# ── 2. 安装 Playwright Chromium ──────────────────────
echo ""
echo "[2/5] 安装 Playwright Chromium（首次较慢）..."
python -m playwright install chromium
python -m playwright install-deps chromium

# ── 3. 初始化数据目录 ────────────────────────────────
echo ""
echo "[3/5] 初始化数据目录..."
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/history.json" ]; then
    echo "[]" > "$DATA_DIR/history.json"
    echo "    已创建空 history.json"
fi

# ── 4. 检查 .env 文件 ────────────────────────────────
echo ""
echo "[4/5] 检查 .env 配置..."
if [ ! -f "$ENV_FILE" ]; then
    cat > "$ENV_FILE" <<EOF
BUPT_USERNAME=2025010167
BUPT_PASSWORD=Nqszy@ssy616.
HISTORY_JSON=$DATA_DIR/history.json
EOF
    echo "    已生成 .env，请确认凭据正确"
else
    echo "    .env 已存在，跳过"
fi

# 更新 HISTORY_JSON 路径为绝对路径
sed -i "s|HISTORY_JSON=.*|HISTORY_JSON=$DATA_DIR/history.json|" "$ENV_FILE"

# ── 5. 安装 systemd 服务 ─────────────────────────────
echo ""
echo "[5/5] 安装 systemd 定时任务..."

# 将路径和用户名写入 service 文件
sed \
    -e "s|__REPO_DIR__|$REPO_DIR|g" \
    -e "s|__SERVICE_USER__|$SERVICE_USER|g" \
    "$REPO_DIR/deploy/elecmon.service.template" \
    > /etc/systemd/system/elecmon.service

cp "$REPO_DIR/deploy/elecmon.timer" /etc/systemd/system/elecmon.timer

systemctl daemon-reload
systemctl enable elecmon.timer
systemctl start  elecmon.timer

echo ""
echo "=== 部署完成 ==="
echo ""
echo "常用命令:"
echo "  查看定时器状态:  systemctl status elecmon.timer"
echo "  手动触发一次:    systemctl start elecmon.service"
echo "  查看采集日志:    journalctl -u elecmon.service -f"
echo "  停止定时任务:    systemctl stop elecmon.timer"
echo ""
echo "接下来请配置 Nginx（参考 deploy/nginx.conf）"
