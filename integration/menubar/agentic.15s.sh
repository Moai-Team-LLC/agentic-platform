#!/bin/bash
# <xbar.title>Agentic Platform</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>Moai Team</xbar.author>
# <xbar.desc>Menu-bar control for the Agentic Platform: live health + start/stop/console.</xbar.desc>
# <xbar.dependencies>bash,curl</xbar.dependencies>
#
# SwiftBar/xbar plugin. Refresh interval comes from the filename (15s).
# Install: agentic menubar   (copies this into the SwiftBar plugin folder)

CONSOLE="http://localhost:4600"
AG="$HOME/.local/bin/agentic"
[ -x "$AG" ] || AG="$(cd "$(dirname "$0")/../.." 2>/dev/null && pwd)/cli/agentic"

H="$(curl -fsS --max-time 2 "$CONSOLE/api/health" 2>/dev/null)"
if [ -n "$H" ]; then
  # honest count: real services only (contract/library nodes are docs, never down)
  read -r UP TOT <<< "$(printf '%s' "$H" | PYTHONIOENCODING=utf-8 python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print(0,0); raise SystemExit
svc=[v for v in d.values() if isinstance(v,dict) and v.get("kind") not in ("contract","library")]
print(sum(1 for v in svc if v.get("up")), len(svc))' 2>/dev/null)"
  if [ "$UP" = "$TOT" ] && [ "$TOT" != "0" ]; then
    echo "● $UP/$TOT | color=#3fb47f font=Menlo size=12"
  else
    echo "◐ $UP/$TOT | color=#d9a441 font=Menlo size=12"
  fi
else
  echo "○ down | color=#e0574b font=Menlo size=12"
fi

echo "---"
echo "Agentic Platform | size=11 color=#7c8798"
if [ -n "$H" ]; then
  # per-service dots (name + up/down). Contract/library nodes (the Standard) are
  # docs, not services — they can never be down, so they are noise in an ops pult.
  printf '%s' "$H" | PYTHONIOENCODING=utf-8 python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for k,v in d.items():
    if not isinstance(v,dict): continue
    if v.get("kind") in ("contract","library"): continue
    dot = "🟢" if v.get("up") else "🔴"
    print(f"{dot} {k} | font=Menlo size=11")
' 2>/dev/null
fi
echo "---"
echo "Open Console | bash='/usr/bin/open' param1='$CONSOLE' terminal=false refresh=false"
echo "---"
echo "Start platform (agentic up) | bash='$AG' param1=up terminal=true refresh=true"
echo "Stop platform | bash='$AG' param1=down terminal=true refresh=true"
echo "Doctor (end-to-end check) | bash='$AG' param1=doctor terminal=true"
echo "Backup now | bash='$AG' param1=backup terminal=true"
echo "---"
echo "Refresh | refresh=true"
