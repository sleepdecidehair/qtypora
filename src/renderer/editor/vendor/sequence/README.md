# js-sequence-diagrams browser adapter

Upstream: https://github.com/bramp/js-sequence-diagrams (BSD-2-Clause, full text in LICENSE).
Release tag: v2.0.1. Commit: a6c252b2ed0d1e6b1d16be066f582afd2895e6c9.
Source: https://github.com/bramp/js-sequence-diagrams/blob/v2.0.1/dist/sequence-diagram-raphael.js
Original source SHA-256: `bdda545025e30edf00555ca69a59d0e08e0b87f41b827a853a53b6d0785cf151`.
Adapted file SHA-256: `24cfd02ab980179bf90abf3a1bfd793c8b1b58ad32852d7433efec2ffb2e9dbc`.

The official npm name is a security placeholder, so this release is stored locally.
Only the browser integration was adapted: import the pinned Raphael and Underscore packages;
return Diagram as an ES module instead of publishing globals; remove the Node command-line
export and optional jQuery integration; remove the entire unused Daniel font payload.
Trailing line whitespace is normalized in the adapter and LICENSE; license wording is unchanged.
A small lifecycle adapter retains the generated Raphael paper and exposes clean() so rendering releases its resources. The parser, layout and drawing logic remain upstream code. The app always selects the simple
monospace theme; hand themes and externally provided options are not exposed. No WebFont,
remote font, script evaluator, document-provided JavaScript or diagram URL is loaded.

Updates must verify the upstream tag, license and hash, repeat the explicit adaptation, and run
real Electron rendering plus the diagram injection and export tests. Keep the LICENSE included
in source distributions and packaged third-party notices.
