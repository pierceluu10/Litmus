#!/usr/bin/env bash
# Exports your Papiers library to one file for the Litmus upload page (needs `papiers auth login` first).
# Usage: ./scripts/export-papiers.sh [output.json]   (default: litmus-papiers.json)
set -euo pipefail
out="${1:-litmus-papiers.json}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

papiers list --kind document --limit 200 --json > "$tmp/documents.json"
for kind in highlight note; do
  papiers list --kind "$kind" --limit 200 --json > "$tmp/$kind-list.json"
  python3 -c 'import json,sys; print("\n".join(i["id"] for i in json.load(sys.stdin)["items"]))' < "$tmp/$kind-list.json" > "$tmp/$kind-ids.txt"
  if grep -q . "$tmp/$kind-ids.txt"; then papiers read @- --json < "$tmp/$kind-ids.txt" > "$tmp/$kind-read.json"; else echo '{"items":[]}' > "$tmp/$kind-read.json"; fi
done

python3 - "$tmp" "$out" <<'PY'
import json, sys, glob
tmp, out = sys.argv[1:]
items = [i for f in ["documents", "highlight-list", "note-list", "highlight-read", "note-read"] for i in json.load(open(f"{tmp}/{f}.json"))["items"]]
json.dump({"schemaVersion": "papiers.list.v1", "items": items}, open(out, "w"))
print(f"Wrote {out}: {sum(i['kind'] == 'document' for i in items)} papers, {sum(i['kind'] == 'highlight' and 'content' in i for i in items)} highlights, {sum(i['kind'] == 'note' and 'content' in i for i in items)} notes. Drop it on the upload page.")
PY
