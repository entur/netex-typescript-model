#!/bin/sh
# Generate VehicleType .ts files matching the hathor subselection.
# Excludes omnipresent base props and unused fields.
#
# SAMPLE:
#   ./gen-vehicletype.sh                              # writes /tmp/VehicleType.ts + /tmp/VehicleType-mapping.ts
#   ./gen-vehicletype.sh --dest-dir ./out              # custom output dir
#   ./gen-vehicletype.sh --suffix=-hathor              # /tmp/VehicleType-hathor.ts
#   ./gen-vehicletype.sh --dest-dir ./out --suffix=-v2 # combine flags

# Props to strip (one per line, joined with commas below)
EXCLUDE=$(
  cat <<'EOF'
$changed
$compatibleWithVersionFrameVersionRef
$created
$dataSourceRef
$derivedFromObjectRef
$derivedFromVersionRef
$modification
$nameOfClass
$status
alternativeTexts
ValidBetween
validityConditions
Extensions
capacities
FuelType
TypeOfFuel
EOF
)

cd "$(dirname "$0")/html-ts-gen"
npx tsx scripts/ts-gen.ts --overwrite \
  --exclude "$(echo "$EXCLUDE" | tr '\n' ',')" "$@" VehicleType
