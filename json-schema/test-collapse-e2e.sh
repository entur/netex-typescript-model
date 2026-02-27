#!/usr/bin/env bash
#
# End-to-end test for the --collapse pass.
# Generates Vehicle sub-graph with and without --collapse, then validates.
#
# Usage: cd json-schema && bash test-collapse-e2e.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

XSD_ROOT="../xsd/2.0"
CONFIG="../assembly-config.json"
OUT_DIR="/tmp/test-collapse"
SUB_GRAPH="Vehicle"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/before" "$OUT_DIR/after"

# Ensure classpath is available
mvn generate-resources -q

CP="$(cat target/classpath.txt)"

run_converter() {
  local script_args="$1"
  java "-Dscript.args=$script_args" \
    -cp "$CP" com.oracle.truffle.js.shell.JSLauncher \
    --experimental-options --js.ecmascript-version=2022 \
    --engine.WarnInterpreterOnly=false \
    xsd-to-jsonschema.js
}

echo "=== Generating without --collapse ==="
run_converter "$XSD_ROOT $OUT_DIR/before $CONFIG --sub-graph $SUB_GRAPH"

BEFORE_FILE="$OUT_DIR/before/base@${SUB_GRAPH}.schema.json"
if [ ! -f "$BEFORE_FILE" ]; then
  echo "ERROR: Expected $BEFORE_FILE not found"
  ls -la "$OUT_DIR/before/"
  exit 1
fi

echo ""
echo "=== Generating with --collapse ==="
run_converter "$XSD_ROOT $OUT_DIR/after $CONFIG --sub-graph $SUB_GRAPH --collapse"

AFTER_FILE="$OUT_DIR/after/base@${SUB_GRAPH}.schema.json"
if [ ! -f "$AFTER_FILE" ]; then
  echo "ERROR: Expected $AFTER_FILE not found"
  ls -la "$OUT_DIR/after/"
  exit 1
fi

echo ""
echo "=== Running validation ==="
python3 test-collapse.py "$AFTER_FILE" "$BEFORE_FILE"

echo ""
echo "=== Running TypeScript tests ==="
cd ../typescript && npm test

echo ""
echo "=== All tests passed ==="
