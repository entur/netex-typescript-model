#!/usr/bin/env python3
"""
Verification script for the collapseTransparent pass.

Usage:
  python3 test-collapse.py <schema.json> [<before-schema.json>]

Checks:
  1. Def count reduction (when before-schema provided)
  2. x-netex-reduced annotations — lists collapsed defs and what they absorbed
  3. No broken $refs — every $ref target exists in definitions
  4. No orphaned targets — no removed target is still referenced
  5. x-netex-collapsed count matches actual collapses
"""

import json
import sys
import os


def collect_refs(obj, refs=None):
    """Walk an object tree and collect all $ref targets."""
    if refs is None:
        refs = set()
    if isinstance(obj, dict):
        for key, val in obj.items():
            if key == "$ref" and isinstance(val, str) and val.startswith("#/definitions/"):
                refs.add(val[len("#/definitions/"):])
            else:
                collect_refs(val, refs)
    elif isinstance(obj, list):
        for item in obj:
            collect_refs(item, refs)
    return refs


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 test-collapse.py <schema.json> [<before-schema.json>]")
        sys.exit(1)

    after_path = sys.argv[1]
    before_path = sys.argv[2] if len(sys.argv) > 2 else None

    with open(after_path) as f:
        after = json.load(f)

    after_defs = after.get("definitions", {})
    after_count = len(after_defs)
    errors = []

    print(f"=== Collapse verification: {os.path.basename(after_path)} ===\n")

    # 1. Def count reduction
    if before_path:
        with open(before_path) as f:
            before = json.load(f)
        before_count = len(before.get("definitions", {}))
        removed = before_count - after_count
        print(f"1. Def count: {before_count} -> {after_count} ({removed} removed)")
        if removed < 0:
            errors.append(f"Def count increased by {-removed}")
    else:
        print(f"1. Def count: {after_count} (no before-schema for comparison)")

    # 2. x-netex-reduced annotations
    reduced_defs = {}
    for name, defn in after_defs.items():
        if isinstance(defn, dict) and "x-netex-reduced" in defn:
            reduced_defs[name] = defn["x-netex-reduced"]

    print(f"\n2. Collapsed defs ({len(reduced_defs)}):")
    for name, targets in sorted(reduced_defs.items()):
        print(f"   {name} <- {', '.join(targets)}")

    # 3. No broken $refs
    all_refs = set()
    for name, defn in after_defs.items():
        collect_refs(defn, all_refs)

    broken = all_refs - set(after_defs.keys())
    print(f"\n3. Broken $refs: {len(broken)}")
    if broken:
        for ref in sorted(broken):
            print(f"   BROKEN: {ref}")
            errors.append(f"Broken $ref: {ref}")

    # 4. No orphaned targets (targets that were removed but still referenced)
    if before_path:
        before_defs = before.get("definitions", {})
        removed_names = set(before_defs.keys()) - set(after_defs.keys())
        orphaned = removed_names & all_refs
        print(f"\n4. Orphaned targets: {len(orphaned)}")
        if orphaned:
            for name in sorted(orphaned):
                print(f"   ORPHANED: {name}")
                errors.append(f"Orphaned target: {name}")
    else:
        print("\n4. Orphaned targets: (skipped, no before-schema)")

    # 5. x-netex-collapsed count
    collapsed_annotation = after.get("x-netex-collapsed", 0)
    actual_collapsed = len(reduced_defs)
    print(f"\n5. x-netex-collapsed: {collapsed_annotation} (actual: {actual_collapsed})")
    if collapsed_annotation != actual_collapsed:
        errors.append(
            f"x-netex-collapsed mismatch: annotation={collapsed_annotation}, actual={actual_collapsed}"
        )

    # Summary
    print("\n" + "=" * 50)
    if errors:
        print(f"FAIL: {len(errors)} error(s)")
        for err in errors:
            print(f"  - {err}")
        sys.exit(1)
    else:
        print("PASS: all checks passed")


if __name__ == "__main__":
    main()
