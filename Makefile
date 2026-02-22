GEN      := generated-src
CONFIG   := assembly-config.json
ASSEMBLY ?= base

.PHONY: all clean

all: $(GEN)/$(ASSEMBLY)/netex-schema.html

$(GEN)/$(ASSEMBLY)/netex-schema.html: $(GEN)/$(ASSEMBLY)/$(ASSEMBLY).schema.json
	npx --prefix typescript tsx typescript/scripts/build-schema-html.ts

$(GEN)/$(ASSEMBLY)/$(ASSEMBLY).schema.json: xsd/2.0/NeTEx_publication.xsd
	cd json-schema \
	  && mvn generate-resources -q \
	  && java -Dscript.args="../xsd/2.0 ../$(GEN)/$(ASSEMBLY) ../$(CONFIG)$(if $(PARTS), --parts $(PARTS))" \
	       -cp "$$(cat target/classpath.txt)" com.oracle.truffle.js.shell.JSLauncher \
	       --experimental-options --js.ecmascript-version=2022 --engine.WarnInterpreterOnly=false \
	       xsd-to-jsonschema.js \
	  && cd ../typescript && npm run validate:jsonschema

xsd/2.0/NeTEx_publication.xsd:
	cd json-schema && mvn initialize -q

clean:
	rm -rf $(GEN) xsd json-schema/target
