GEN      := generated-src
CONFIG   := assembly-config.json
ASSEMBLY ?= base
VERSION  ?= 0.0.0-dev
comma    := ,

# Optional: --sub-graph <TypeName> prunes output to reachable definitions.
# Optional: COLLAPSE=1 collapses transparent wrappers (only with SUB_GRAPH).
# Usage: make schema ASSEMBLY=network SUB_GRAPH=StopPlace COLLAPSE=1
SUB_GRAPH ?=
COLLAPSE  ?=

# Parse NeTEx version and branch from assembly-config.json (no jq dependency)
NETEX_VERSION := $(shell grep '"version"' $(CONFIG) | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
NETEX_BRANCH  := $(shell grep '"branch"' $(CONFIG) | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
TARBALL_PREFIX = netex-$(NETEX_VERSION)-$(NETEX_BRANCH)-$(OUT_NAME)
TARBALL_NAME   = $(TARBALL_PREFIX)-v$(VERSION).tgz

# Normalize ASSEMBLY: sort '+'-separated parts alphabetically so
# timetable+network → network+timetable (matches resolveAssembly() output).
# 'override' is needed because command-line vars outrank file assignments.
ifneq ($(ASSEMBLY),base)
  override ASSEMBLY := $(shell echo '$(ASSEMBLY)' | tr '+' '\n' | sort | tr '\n' '+' | sed 's/+$$//')
  PARTS_FLAG := --parts $(subst +,$(comma),$(ASSEMBLY))
endif

# Output name: assembly@Root when SUB_GRAPH is set, @tiny suffix when COLLAPSE.
ifdef SUB_GRAPH
  SG_FLAG      := --sub-graph $(SUB_GRAPH)
  ifdef COLLAPSE
    OUT_NAME   := $(ASSEMBLY)@$(SUB_GRAPH)@tiny
    CL_FLAG    := --collapse
  else
    OUT_NAME   := $(ASSEMBLY)@$(SUB_GRAPH)
  endif
else
  OUT_NAME     := $(ASSEMBLY)
endif

.PHONY: all schema types docs tarball clean clean_xsd

all: $(GEN)/$(OUT_NAME)/netex-schema.html \
	$(GEN)/$(OUT_NAME)/docs/index.html

schema: $(GEN)/$(OUT_NAME)/netex-schema.html

types: $(GEN)/$(OUT_NAME)/interfaces/index.ts

docs: $(GEN)/$(OUT_NAME)/docs/index.html

# ── Schema HTML viewer ────────────────────────────────────────────────────────

SCHEMA_HTML_SRCS := typescript/scripts/build-schema-html.ts \
	typescript/scripts/lib/schema-viewer-fns.ts \
	typescript/scripts/lib/schema-viewer-host-app.js \
	typescript/scripts/lib/schema-viewer.css

$(GEN)/$(OUT_NAME)/netex-schema.html: $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json $(SCHEMA_HTML_SRCS)
	npx --prefix typescript tsx typescript/scripts/build-schema-html.ts

# ── TypeScript interfaces ─────────────────────────────────────────────────────

$(GEN)/$(OUT_NAME)/interfaces/index.ts: $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json
	npx --prefix typescript tsx typescript/scripts/generate.ts $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json

# ── TypeDoc documentation ─────────────────────────────────────────────────────

$(GEN)/$(OUT_NAME)/docs/index.html: $(GEN)/$(OUT_NAME)/interfaces/index.ts
	npx --prefix typescript tsx typescript/scripts/generate-docs.ts

# ── JSON Schema from XSD ──────────────────────────────────────────────────────

$(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json: xsd/2.0/NeTEx_publication.xsd
	cd json-schema \
	  && mvn generate-resources -q \
	  && java -Dscript.args="../xsd/2.0 ../$(GEN)/$(OUT_NAME) ../$(CONFIG)$(if $(PARTS_FLAG), $(PARTS_FLAG))$(if $(SG_FLAG), $(SG_FLAG))$(if $(CL_FLAG), $(CL_FLAG))" \
	       -cp "$$(cat target/classpath.txt)" com.oracle.truffle.js.shell.JSLauncher \
	       --experimental-options --js.ecmascript-version=2022 --engine.WarnInterpreterOnly=false \
	       xsd-to-jsonschema.js \
	  && cd ../typescript && npm run validate:jsonschema

# ── XSD download ──────────────────────────────────────────────────────────────

xsd/2.0/NeTEx_publication.xsd:
	cd json-schema && mvn initialize -q

# ── Release tarball ──────────────────────────────────────────────────────────
# Stages files into a temp dir for portable tar (works on macOS and Linux).

tarball: $(GEN)/$(TARBALL_NAME)

$(GEN)/$(TARBALL_NAME): $(GEN)/$(OUT_NAME)/docs/index.html
	rm -rf $(GEN)/$(TARBALL_PREFIX)
	mkdir -p $(GEN)/$(TARBALL_PREFIX)
	cp -r $(GEN)/$(OUT_NAME)/interfaces $(GEN)/$(TARBALL_PREFIX)/
	cp $(GEN)/$(OUT_NAME)/$(OUT_NAME).schema.json $(GEN)/$(TARBALL_PREFIX)/
	cp $(GEN)/$(OUT_NAME)/netex-schema.html $(GEN)/$(TARBALL_PREFIX)/
	cp $(GEN)/$(OUT_NAME)/README.md $(GEN)/$(TARBALL_PREFIX)/ 2>/dev/null || true
	tar -czf $@ -C $(GEN) $(TARBALL_PREFIX)
	rm -rf $(GEN)/$(TARBALL_PREFIX)

clean:
	rm -rf $(GEN) json-schema/target
clean_xsd:
	rm -rf xsd
