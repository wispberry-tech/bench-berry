#!/usr/bin/env bash
# Build index.html from src fragments, then screenshot every view in both themes.
set -euo pipefail
cd "$(dirname "$0")/.."

cat src/00-shell.html src/01-overview.html src/02-design.html src/03-api.html src/04-db.html src/99-footer.html > index.html
echo "index.html assembled: $(wc -c < index.html) bytes"

CHROME="${CHROME:-google-chrome-stable}"
SHOTS="${SHOTS:-/tmp/prism-shots}"
mkdir -p "$SHOTS"

# quick HTML well-formedness check
python3 - "$PWD/index.html" <<'PY'
import sys, html.parser
class P(html.parser.HTMLParser):
    VOID = {'meta','link','br','hr','img','input','use','path','circle','ellipse','rect','line','polyline','polygon','stop','col','source','track','wbr'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack=[]; self.errors=[]
    def handle_starttag(self,tag,attrs):
        if tag not in self.VOID: self.stack.append((tag,self.getpos()))
    def handle_endtag(self,tag):
        if tag in self.VOID: return
        if self.stack and self.stack[-1][0]==tag: self.stack.pop()
        else:
            # search for a matching opener
            for i in range(len(self.stack)-1,-1,-1):
                if self.stack[i][0]==tag:
                    self.errors.append(f"unclosed <{self.stack[i][0]}> opened at {self.stack[i][1]} closed at {self.getpos()}")
                    del self.stack[i:]; return
            self.errors.append(f"stray </{tag}> at {self.getpos()}")
p=P()
p.feed(open(sys.argv[1]).read())
for t,pos in p.stack: p.errors.append(f"never closed <{t}> opened at {pos}")
if p.errors:
    print("HTML ISSUES:")
    for e in p.errors[:20]: print(" ", e)
    sys.exit(1)
print("HTML well-formed ✓")
PY

fail=0
for view in overview design api db; do
  for theme in light dark; do
    out="$SHOTS/$view-$theme.png"
    if "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars \
        --window-size=1440,900 --virtual-time-budget=2500 \
        --screenshot="$out" "file://$PWD/index.html?theme=$theme#$view" >/dev/null 2>&1; then
      echo "$view/$theme: $(stat -c%s "$out") bytes"
    else
      echo "FAIL $view/$theme"; fail=1
    fi
  done
done
exit $fail