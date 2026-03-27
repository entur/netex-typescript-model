# Schema Viewer Codegen Flow

How each tab renders its output — from user click to formatted code.

```mermaid
flowchart TB
    entry[renderExplorer] --> flatProps[flattenAllOf]

    flatProps --> TS1
    flatProps --> MAP
    flatProps --> SAMPLE

    subgraph TS1["TypeScript tab"]
        direction TB
        ri[renderInterfaceHtml] --> gi[generateInterface]
        gi --> ts1out["TS interface + JSDoc"]
        gi --> chip["N subtypes chip"]
        chip --> cdt[collectDependencyTree]
        cdt --> crd[collectRenderableDeps]
        crd --> gi2["generateInterface per dep"]
        gi2 --> ts2out["TS interface per dep"]
    end

    subgraph COPY_TS["Copy - Interface tab"]
        direction TB
        copybtn[Copy] --> gi["generateInterface.text"]
        copybtn --> gstb[generateSubTypesBlock]
        gi --> merge["root + subtypes"]
        gstb --> merge
        merge --> clipboard["plain TypeScript"]
    end

    subgraph MAP["Mapping tab"]
        direction TB
        rmg[renderMappingGuide] --> bes[buildExclSet]
        bes --> micb[makeInlineCodeBlock]
        micb --> cat[collectAllTargets BFS]
        cat --> dispatch[reshapeComplex dispatch]
        cat --> rootfn["makeInlinedToXmlShape root"]
        cat --> childfn["makeInlinedToXmlShape children"]
        dispatch --> mapout["TS serialize functions"]
        rootfn --> mapout
        childfn --> mapout
    end

    subgraph SAMPLE["Sample Data tab"]
        direction TB
        rsd[renderSampleData] --> fake[fake]
        fake --> ff[flattenFake]
        ff --> pill1["Flat: JSON.stringify"]
        ff --> txs[toXmlShape]
        txs --> pill2["XmlShaped: JSON.stringify"]
        txs --> bxml[buildXml]
        pill1 --> json1out["JSON flat object"]
        pill2 --> json2out["JSON XMLBuilder shape"]
        bxml --> xmlout["XML formatted NeTEx"]
    end

    style TS1 fill:#e8f0f8,stroke:#48a
    style COPY_TS fill:#e8f0f8,stroke:#48a
    style MAP fill:#e8f4e8,stroke:#4a4
    style SAMPLE fill:#f8f0e8,stroke:#a84
```

## Output Summary

| Output | Format | Tab | Codegen Function |
|--------|--------|-----|-----------------|
| Main interface | TypeScript | TypeScript | `generateInterface` |
| Subtypes | TypeScript | TypeScript | `generateInterface` + `generateSubTypesBlock` |
| Serialize functions | TypeScript | Mapping | `makeInlineCodeBlock` / `makeInlinedToXmlShape` |
| Flat stem object | JSON | Sample Data | `flattenFake` (via `fake`) |
| XMLBuilder shape | JSON | Sample Data | `toXmlShape` |
| Formatted NeTEx | XML | Sample Data | `buildXml` |
