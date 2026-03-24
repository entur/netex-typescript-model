# NeTEx Testing & Validation Landscape

How the CEN upstream project, Entur, and the Nordic Profile ecosystem approach testing, validation, and conformance — and what that means for this project.

## CEN Upstream (NeTEx-CEN/NeTEx)

The [NeTEx-CEN/NeTEx](https://github.com/NeTEx-CEN/NeTEx) repository is a schema repository, not a software project. Its testing story is minimal:

- **`/examples` directory** — ~90+ hand-written XML files organized by functional area (fares, timetable, stopPlace, calendar, etc.). These are illustration samples, not a formal conformance test suite.
- **CI with xmllint** — validates the examples against `NeTEx_publication.xsd` on push. Catches schema-breaking regressions but only tests syntactic validity.
- **No negative tests** — no examples of intentionally invalid XML that should fail.
- **No profile-level tests** — no examples tagged by profile (Nordic, EPIP, UK, etc.).
- **No round-trip tests** — no verification that import/export produces equivalent output.
- **No Schematron or business rules** — the XSD enforces structure only, not semantic constraints like "a BUS StopPlace must have at least one Quay."

Historical context: [issue #8](https://github.com/NeTEx-CEN/NeTEx/issues/8) showed several examples failing xmllint validation, revealing that examples were written as illustrations rather than machine-verified conformance tests.

### DATA4PT Greenlight

The EU-funded [DATA4PT project](https://data4pt-project.eu/validation-tools-for-netex-and-siri-datasets/) developed **Greenlight**, an open-source validation tool that goes beyond XSD — checking schema conformance, cross-reference integrity, and profile-specific rules. This is the closest thing to a real conformance test framework at the European level.

## Nordic Profile — Entur's Ecosystem

Entur maintains a significantly richer validation ecosystem than the CEN project itself.

### 1. Profile Examples ([entur/profile-examples](https://github.com/entur/profile-examples))

Curated XML samples organized by domain:

| Directory | Coverage |
|-----------|----------|
| `stops` | Stop places, quays, multimodal stops |
| `network` | Routes, lines, journey patterns |
| `timetable` | Service journeys, passing times |
| `schedule` | Operating days, calendars |
| `fares-sales` | Fare products, pricing, sales |
| `vehicle` | Vehicle types, equipment |
| `frames` | Frame packaging, publication delivery |
| `submodels` | Reusable sub-structures |

Includes a full end-to-end example: `Full_PublicationDelivery_109_Oslo_morningbus_example.xml` — a complete PublicationDelivery document for an Oslo bus route.

Each example is documented in the [NeTEx examples catalogue](https://entur.atlassian.net/wiki/spaces/PUBLIC/pages/728891505/NeTEx+examples+catalogue) wiki with detailed descriptions of file structure and data content.

These are illustration samples rather than a conformance test suite — no negative examples, no systematic coverage matrix.

### 2. Validator Library ([entur/netex-validator-java](https://github.com/entur/netex-validator-java))

The closest thing to a formal test specification. Implements **150+ validation rules** for the Nordic Profile in three layers:

1. **XSD validation** — structural correctness (blocking — failure here stops further checks)
2. **XPath rules** — pattern checks on the raw XML
3. **JAXB rules** — semantic checks on the deserialized object model

Example rules:
- `LINE_4`: Line must have TransportMode
- `SERVICE_JOURNEY_1`: ServiceJourney must reference a JourneyPattern
- Arrival times must be after departure times
- No duplicate NeTEx IDs across files in a dataset
- Booking parameters must be consistent with transport submode

These are the **business rules** that the XSD cannot express — the actual semantic contract of the Nordic Profile.

### 3. Production Validation Service ([entur/antu](https://github.com/entur/antu))

Wraps `netex-validator-java` and adds **Norway-specific rules**:

- Cross-references against the National Stop Register (Tiamat/NSR)
- Cross-references against the Organisation Register
- Speed threshold checks (detects impossible travel times between stops)
- Flexible transport area validation
- Boarding/alighting consistency in journey patterns
- Different validation profiles per dataset type (~25 rules for standard timetables, ~15 for flexible transport)

Runs in production in Entur's Kubernetes cluster, processing every NeTEx dataset that enters the pipeline via Marduk. Results are accessible via an OAuth2-protected REST API.

## What's Still Missing

Even with Entur's ecosystem, there is no formal conformance test suite in the traditional sense:

| Gap | Description |
|-----|-------------|
| No negative examples | No XML files designed to fail specific rules, verifying validators catch them |
| No round-trip tests | No "export from Tiamat, re-import, compare" verification |
| No profile-level XSD | Unlike EPIP, the Nordic Profile has no constrained XSD — all rules are runtime checks |
| No public production samples | Real-world NeTEx from Marduk isn't published as test fixtures (though Entur's open data APIs serve the processed results) |

## Relevance for This Project

**For type validation**: The [profile-examples](https://github.com/entur/profile-examples) repo is the most practical test fixture source. Parsing example XML and checking that it satisfies the generated TypeScript interfaces would verify that the type generation pipeline produces correct types.

**For runtime validation**: The 150+ rules in [netex-validator-java](https://github.com/entur/netex-validator-java) document semantic constraints that go beyond what any type system can express. These could inform Zod refinements if runtime validation is added later.

**For the Nordic Profile specifically**: The profile doesn't change the XSD schemas — it constrains how they're used. This project generates types from the full XSD, so a Nordic Profile layer would be an additional concern: marking certain optional fields as required, restricting enum values to allowed subsets, enforcing structural patterns like "a Line must have a TransportMode."

## Links

- [NeTEx-CEN/NeTEx](https://github.com/NeTEx-CEN/NeTEx) — upstream XSD schemas
- [Nordic NeTEx Profile (wiki)](https://entur.atlassian.net/wiki/spaces/PUBLIC/pages/728891481/Norwegian+NeTEx+Profile) — profile specification
- [NeTEx examples catalogue (wiki)](https://entur.atlassian.net/wiki/spaces/PUBLIC/pages/728891505/NeTEx+examples+catalogue) — example documentation
- [entur/profile-examples](https://github.com/entur/profile-examples) — Nordic Profile XML samples
- [entur/netex-validator-java](https://github.com/entur/netex-validator-java) — 150+ validation rules
- [entur/antu](https://github.com/entur/antu) — production validation service
- [DATA4PT Greenlight](https://data4pt-project.eu/validation-tools-for-netex-and-siri-datasets/) — EU-level validation tool
- [NeTEx-CEN/NeTEx-Profile-EPIP](https://github.com/NeTEx-CEN/NeTEx-Profile-EPIP) — European Passenger Information Profile XSD
