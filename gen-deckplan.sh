#!/bin/sh
# Generate DeckPlan .ts files matching the NeTEx-Deckplan-Editor subselection.
# Excludes omnipresent base props and fields unused by the editor's XML export.
#
# SAMPLE:
#   ./gen-deckplan.sh                              # writes /tmp/DeckPlan.ts + /tmp/DeckPlan-mapping.ts
#   ./gen-deckplan.sh --dest-dir ./out              # custom output dir
#   ./gen-deckplan.sh --suffix=-editor              # /tmp/DeckPlan-editor.ts

# Props to strip (one per line, joined with commas below)
EXCLUDE=$(cat <<'EOF'
$changed
$compatibleWithVersionFrameVersionRef
$created
$dataSourceRef
$derivedFromObjectRef
$derivedFromVersionRef
$modification
$nameOfClass
$responsibilitySetRef
$status
alternativeTexts
BrandingRef
configurationConditions
Extensions
keyList
Orientation
privateCodes
ValidBetween
validityConditions
EOF
)

cd "$(dirname "$0")/html-ts-gen"
npx tsx scripts/ts-gen.ts --overwrite \
  --exclude "$(echo "$EXCLUDE" | tr '\n' ',')" "$@" DeckPlan
