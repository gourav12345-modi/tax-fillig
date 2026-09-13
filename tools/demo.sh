#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build && mkdir -p build

render() {
  local ann=$1 data=$2 pdf=$3 name=$4; shift 4
  echo
  echo "── $name ────────────────────────────────────────────"
  node src/cli.js render "$ann" --data "$data" \
      --plan "build/$name-plan.json" \
      --out  "build/$name-overlay.pdf" \
      --svg  "build/$name-page1.svg" "$@"
  if [ -d node_modules/pdf-lib ]; then
    node tools/stamp.mjs "$pdf" "build/$name-overlay.pdf" "build/$name-filled.pdf"
  else
    echo "  (skipping composite: run npm install to produce build/$name-filled.pdf)"
  fi
}

echo "── lint ─────────────────────────────────────────────"
node src/cli.js lint annotations/*.tfa.json --min-severity warning || true

render annotations/us-irs-1040-2025.tfa.json      data/return-2025-sample.json fixtures/f1040.pdf   1040
render annotations/us-irs-1040-sch-c-2025.tfa.json data/return-2025-sample.json fixtures/f1040sc.pdf schedule-c
render annotations/us-irs-941-2026.tfa.json        data/form941-2026q1.json     fixtures/f941.pdf    941
render annotations/us-irs-941-sch-b-2026.tfa.json  data/form941-2026q1.json     fixtures/f941sb.pdf  941-schedule-b

echo
echo "── the return's second business: same annotation, other instance ─────"
render annotations/us-irs-1040-sch-c-2025.tfa.json data/return-2025-sample.json fixtures/f1040sc.pdf schedule-c-2 --instance 1

echo
echo "── the taxpayer's copy, from the same annotation ─────"
render annotations/us-irs-1040-2025.tfa.json data/return-2025-sample.json fixtures/f1040.pdf 1040-client --profile client

echo
echo "artifacts in build/"
ls -1 build/*.pdf build/*.svg build/*-plan.json 2>/dev/null | sed 's/^/  /'
