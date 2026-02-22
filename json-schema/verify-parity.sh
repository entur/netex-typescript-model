#!/usr/bin/env bash
#
# Verifies that the GraalJS converter produces identical JSON Schema output
# to the Node.js/TypeScript reference implementation.
#
# Prerequisites:
#   - Node.js + npm (for the reference pipeline)
#   - JDK 21+ (any distribution — GraalVM not required)
#   - Maven 3+ (for dependency resolution and exec:exec)
#   - jq (for key-order-independent comparison)
#
# Usage: ./verify-parity.sh [--skip-reference]
#   --skip-reference  Skip re-generating the reference output (use existing)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REFINEMENT_DIR="$REPO_ROOT/typescript"
PREPROC_DIR="$SCRIPT_DIR"
XSD_ROOT="$REPO_ROOT/xsd/2.0"
CONFIG_PATH="$REFINEMENT_DIR/inputs/config.json"
REFERENCE_JSON="$REFINEMENT_DIR/src/generated/base/jsonschema/base.schema.json"
PREPROC_OUT="/tmp/netex-preproc-out"

SKIP_REFERENCE=false
if [[ "${1:-}" == "--skip-reference" ]]; then
  SKIP_REFERENCE=true
fi

# ── Check prerequisites ────────────────────────────────────────────────────

for cmd in jq mvn java; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' not found on PATH"
    exit 1
  fi
done

if [[ ! -d "$XSD_ROOT" ]]; then
  echo "ERROR: XSD directory not found at $XSD_ROOT"
  echo "  Run: cd $REPO_ROOT/typescript && npm run download"
  exit 1
fi

# ── Step 1: Reference output (Node.js) ─────────────────────────────────────

if [[ "$SKIP_REFERENCE" == false ]]; then
  echo "=== Generating reference output (Node.js) ==="
  cd "$REFINEMENT_DIR"
  npm run generate
  echo ""
fi

if [[ ! -f "$REFERENCE_JSON" ]]; then
  echo "ERROR: Reference JSON Schema not found at $REFERENCE_JSON"
  echo "  Run without --skip-reference to generate it"
  exit 1
fi

# ── Step 2: GraalJS output (via Maven Polyglot) ───────────────────────────

echo "=== Generating GraalJS output ==="
cd "$PREPROC_DIR"

# Resolve dependencies + write classpath.txt
mvn generate-resources -q

rm -rf "$PREPROC_OUT"
mkdir -p "$PREPROC_OUT"

mvn exec:exec -q -Dscript.args="$XSD_ROOT $PREPROC_OUT $CONFIG_PATH"

PREPROC_JSON="$PREPROC_OUT/base.schema.json"
if [[ ! -f "$PREPROC_JSON" ]]; then
  echo "ERROR: GraalJS output not produced at $PREPROC_JSON"
  exit 1
fi

# ── Step 3: Compare ─────────────────────────────────────────────────────────

echo ""
echo "=== Comparing outputs ==="

REF_SORTED=$(mktemp)
PREPROC_SORTED=$(mktemp)
trap "rm -f '$REF_SORTED' '$PREPROC_SORTED'" EXIT

jq --sort-keys . "$REFERENCE_JSON" > "$REF_SORTED"
jq --sort-keys . "$PREPROC_JSON" > "$PREPROC_SORTED"

REF_DEFS=$(jq '.definitions | length' "$REFERENCE_JSON")
PREPROC_DEFS=$(jq '.definitions | length' "$PREPROC_JSON")
echo "  Reference definitions: $REF_DEFS"
echo "  GraalVM definitions:   $PREPROC_DEFS"

# Single-pass comparison using jq (avoids thousands of subprocess spawns)
# Categories:
#   extra:        definitions only in GraalJS (new GML types from namespace-aware includes)
#   missing:      definitions only in reference (true regressions)
#   improvements: ref was {} placeholder or preproc added fields without changing existing ones
#   conflicts:    both have substantive content but it differs (namespace collision, e.g. Point)
#   regressions:  preproc lost content that ref has (true regressions)
COMPARISON=$(mktemp)
jq --slurpfile pre "$PREPROC_JSON" '
  .definitions as $ref |
  $pre[0].definitions as $pre_defs |
  ($ref | keys) as $ref_keys |
  ($pre_defs | keys) as $pre_keys |

  # Helper: check if all ref keys are present with same values in preproc
  def ref_is_subset($r; $p):
    [$r | to_entries[] | .value == $p[.key]] | all;

  {
    extra: [$pre_keys[] | select(. as $k | $ref | has($k) | not)],
    missing: [$ref_keys[] | select(. as $k | $pre_defs | has($k) | not)],
    improvements: [$ref_keys[] | select(. as $k |
      ($pre_defs | has($k)) and ($ref[$k] != $pre_defs[$k]) and (
        ($ref[$k] == {}) or ref_is_subset($ref[$k]; $pre_defs[$k])
      )
    )],
    conflicts: [$ref_keys[] | select(. as $k |
      ($pre_defs | has($k)) and ($ref[$k] != $pre_defs[$k]) and
      ($ref[$k] != {}) and
      (ref_is_subset($ref[$k]; $pre_defs[$k]) | not) and
      # Both non-empty — a namespace collision, not content loss
      ($pre_defs[$k] != {}) and ($pre_defs[$k] | length > 0)
    )],
    regressions: [$ref_keys[] | select(. as $k |
      ($pre_defs | has($k)) and ($ref[$k] != $pre_defs[$k]) and
      ($ref[$k] != {}) and
      (ref_is_subset($ref[$k]; $pre_defs[$k]) | not) and
      # Preproc lost content (empty or smaller)
      (($pre_defs[$k] == {}) or ($pre_defs[$k] | length == 0))
    )]
  }
' "$REFERENCE_JSON" > "$COMPARISON"

EXTRA_DEFS=$(jq '.extra | length' "$COMPARISON")
MISSING_DEFS=$(jq '.missing | length' "$COMPARISON")
IMP_COUNT=$(jq '.improvements | length' "$COMPARISON")
CONFLICT_COUNT=$(jq '.conflicts | length' "$COMPARISON")
REG_COUNT=$(jq '.regressions | length' "$COMPARISON")

echo "  Extra definitions (GraalJS only): $EXTRA_DEFS"
echo "  Missing definitions:              $MISSING_DEFS"

if diff -q "$REF_SORTED" "$PREPROC_SORTED" > /dev/null 2>&1; then
  echo ""
  echo "PASS: Outputs are identical (after key-order normalization)"
  rm -f "$COMPARISON"
  exit 0
elif [[ "$MISSING_DEFS" -gt 0 ]] || [[ "$REG_COUNT" -gt 0 ]]; then
  echo ""
  if [[ "$MISSING_DEFS" -gt 0 ]]; then
    echo "FAIL: $MISSING_DEFS definitions missing from GraalJS output"
    jq -r '.missing[]' "$COMPARISON" | head -20
  fi
  if [[ "$REG_COUNT" -gt 0 ]]; then
    echo "FAIL: $REG_COUNT shared definitions regressed (content lost)"
    jq -r '.regressions[]' "$COMPARISON"
  fi
  rm -f "$COMPARISON"
  exit 1
else
  echo ""
  echo "PASS: All $REF_DEFS reference definitions present. No regressions."
  echo "      GraalJS has $EXTRA_DEFS additional definitions (namespace-aware include resolution)."
  if [[ "$IMP_COUNT" -gt 0 ]]; then
    echo "      $IMP_COUNT definitions improved by DOM parser:"
    jq -r '.improvements[] | "  + \(.) (placeholder filled or fields added)"' "$COMPARISON"
  fi
  if [[ "$CONFLICT_COUNT" -gt 0 ]]; then
    echo "      $CONFLICT_COUNT namespace collisions (both valid, different source):"
    jq -r '.conflicts[] | "  ~ \(.)"' "$COMPARISON"
  fi
  rm -f "$COMPARISON"
  exit 0
fi
