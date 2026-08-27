#!/bin/sh
# Assemble www/ — the web bundle Capacitor ships inside the iOS app.
# Sources are the exact files GitHub Pages serves; nothing is forked.
# Layout inside www/ mirrors the site so every relative path resolves
# the same way it does at stoekmedia.com/greendoor/.
set -e
cd "$(dirname "$0")"

rm -rf www
mkdir -p www/assets/css www/assets/js

cp -R app css js www/
cp terms.html privacy.html www/

# Site-level assets referenced as ../../assets/... from app pages.
cp ../assets/css/style.css www/assets/css/
cp ../assets/js/main.js   www/assets/js/

# Entry point: the dashboard. Its auth guard bounces signed-out users to login.
cat > www/index.html <<'EOF'
<!DOCTYPE html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=app/dashboard.html">
EOF

echo "www/ built: $(find www -type f | wc -l | tr -d ' ') files"
