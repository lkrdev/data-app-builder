# lit (3.3.1)

## Overview
Vendored `esm.sh` ES module bundle containing `lit-html@3.3.1`, `lit-element@4.2.1`, and `reactive-element@2.1.1`, imported by `runtime/data-app.js` and rewritten to hosted bundle assets on publish.

## Interface
- `[lit.mjs:CSSResult, LitElement, ReactiveElement, _$LE, _$LH, adoptStyles, css, defaultConverter, getCompatibleStyle, html, isServer, mathml, noChange, notEqual, nothing, render, supportsAdoptingStyleSheets, svg, unsafeCSS]`: Public ES module exports for Lit web component authoring and template rendering.

## Invariants
- `[lit.mjs:header]`: Authoritative bundled versions are `lit-html 3.3.1`, `lit-element 4.2.1`, and `reactive-element 2.1.1`; must be re-vendored from `esm.sh` rather than edited manually.

## Side Effects
- `[lit.mjs:T]`: Reads `globalThis.ShadowRoot` and `globalThis.ShadyCSS` at module evaluation time to detect `supportsAdoptingStyleSheets`.

## Verification
- Run: `npm test`
