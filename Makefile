GEN      := generated-src
CONFIG   := assembly-config.json
ASSEMBLY ?= base
VERSION  ?= 0.0.0-dev
comma    := ,

# Parse NeTEx version and branch from assembly-config.json (no jq dependency)
NETEX_VERSION := $(shell grep '"version"' $(CONFIG) | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
NETEX_BRANCH  := $(shell grep '"branch"' $(CONFIG) | head -1 | sed 's/.*: *"\([^"]*\)".*/\1/')
TARBALL_PREFIX = netex-$(NETEX_VERSION)-$(NETEX_BRANCH)-$(ASSEMBLY)
TARBALL_NAME   = $(TARBALL_PREFIX)-v$(VERSION).tgz

# Normalize ASSEMBLY: sort '+'-separated parts alphabetically so
# timetable+network → network+timetable (matches resolveAssembly() output).
# 'override' is needed because command-line vars outrank file assignments.
ifneq ($(ASSEMBLY),base)
  override ASSEMBLY := $(shell echo '$(ASSEMBLY)' | tr '+' '\n' | sort | tr '\n' '+' | sed 's/+$$//')
  PARTS_FLAG := --parts $(subst +,$(comma),$(ASSEMBLY))
endif

.PHONY: all schema types docs tarball clean

all: $(GEN)/$(ASSEMBLY)/netex-schema.html \
	$(GEN)/$(ASSEMBLY)/docs/index.html

schema: $(GEN)/$(ASSEMBLY)/netex-schema.html

types: $(GEN)/$(ASSEMBLY)/interfaces/index.ts

docs: $(GEN)/$(ASSEMBLY)/docs/index.html

# ── Schema HTML viewer ────────────────────────────────────────────────────────

$(GEN)/$(ASSEMBLY)/netex-schema.html: $(GEN)/$(ASSEMBLY)/$(ASSEMBLY).schema.json
	npx --prefix typescript tsx typescript/scripts/build-schema-html.ts

# ── TypeScript interfaces ─────────────────────────────────────────────────────

$(GEN)/$(ASSEMBLY)/interfaces/index.ts: $(GEN)/$(ASSEMBLY)/$(ASSEMBLY).schema.json
	npx --prefix typescript tsx typescript/scripts/generate.ts $(GEN)/$(ASSEMBLY)/$(ASSEMBLY).schema.json

# ── TypeDoc documentation ─────────────────────────────────────────────────────

$(GEN)/$(ASSEMBLY)/docs/index.html: $(GEN)/$(ASSEMBLY)/interfaces/index.ts
	npx --prefix typescript tsx typescript/scripts/generate-docs.ts

# ── JSON Schema from XSD ──────────────────────────────────────────────────────

$(GEN)/$(ASSEMBLY)/$(ASSEMBLY).schema.json: xsd/2.0/NeTEx_publication.xsd
	cd json-schema \
	  && mvn generate-resources -q \
	  && java -Dscript.args="../xsd/2.0 ../$(GEN)/$(ASSEMBLY) ../$(CONFIG)$(if $(PARTS_FLAG), $(PARTS_FLAG))" \
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

$(GEN)/$(TARBALL_NAME): $(GEN)/$(ASSEMBLY)/docs/index.html
	rm -rf $(GEN)/$(TARBALL_PREFIX)
	cp -r $(GEN)/$(ASSEMBLY) $(GEN)/$(TARBALL_PREFIX)
	tar -czf $@ -C $(GEN) $(TARBALL_PREFIX)
	rm -rf $(GEN)/$(TARBALL_PREFIX)

clean:
	rm -rf $(GEN) xsd json-schema/target
