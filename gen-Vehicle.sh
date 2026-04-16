#!/bin/sh
# Generate Vehicle .ts files matching the hathor subselection.
# Excludes omnipresent base props and unused fields.
#
# SAMPLE:
#   ./gen-vehicle.sh
#   ./gen-vehicle.sh --dest-dir ./out
#   ./gen-vehicle.sh --suffix=-hathor
#   ./gen-vehicle.sh --dest-dir ./out --suffix=-v2

# Props to strip (one per line, joined with commas below)

cd "$(dirname "$0")/html-ts-gen"
npx tsx scripts/ts-gen.ts --overwrite \
  --collapse-collections --collapse-refs \
  Vehicle
