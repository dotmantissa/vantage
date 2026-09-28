# Vantage Design Tokens

Design variance seed: `1790593893576409612` (nanosecond timestamp, rolled 2026-09-28).
Recorded so a later build in the same session does not converge on the same combination.

## The five rolls

| Axis | Roll | Why it fits Vantage |
|------|------|---------------------|
| Layout archetype | Asymmetric grid | Vantage is a two sided product. A human writes prose; the chain checks a machine predicate. A dominant left column at 62% with an offset right rail at 30% that starts lower on the baseline mirrors that imbalance: the claim is loud, the verification apparatus sits beside it. |
| Type pairing | Grotesk + slab serif | Zilla Slab for questions and headings gives the documentary, legal typewriter voice a court record needs. Archivo handles controls and body. JetBrains Mono is functional, not decorative: the product literally renders compiled predicates, fact schemas, and spec hashes. |
| Motion signature | Response to action only, nothing ambient | Nothing floats, pulses, or reveals on scroll. Motion fires when a person acts. The compile action is the one place the budget gets spent: the machine column writes itself in, character by character, because that is the moment the product exists. |
| Structural device | The Compiled Spec Sheet | One recurring document object: plain English on the left in slab serif, a vertical hairline with a seal lock at its midpoint, the compiled predicate on the right in mono. It is the market card, the detail header, and the receipt. Prose goes in, a locked machine checkable spec comes out. |
| Status language | Rule weight and fill, never new hue | The palette is four colours. Instead of bolting on alert red and warning amber, market state is carried by border weight, fill, and hatching. Void is hatched. Challenged carries a double rule. Final is filled forest. |

## Palette

Four source colours, nothing invented.

| Token | Light | Dark | Role |
|-------|-------|------|------|
| `--paper` | `#fef8f5` | `#1b1819` | Page ground, warm legal stock |
| `--paper-raised` | `#f7eee8` | `#232021` | Spec sheets, panels, table stripes |
| `--paper-sunk` | `#f2e6de` | `#151314` | Input wells, code gutters |
| `--ink` | `#231f20` | `#fef8f5` | Primary text, baselines, seals |
| `--ink-muted` | `rgba(35,31,32,.62)` | `rgba(254,248,245,.60)` | Secondary text |
| `--ink-faint` | `rgba(35,31,32,.38)` | `rgba(254,248,245,.36)` | Captions, disabled |
| `--hairline` | `rgba(35,31,32,.14)` | `rgba(254,248,245,.16)` | Every border in the system |
| `--sage` | `#729877` | `#8cb191` | Live, open, provisional |
| `--forest` | `#53745f` | `#729877` | Final, settled, confirmed |

Dark mode lifts sage and forest one step so both clear WCAG AA against the dark ground.

## Shape and depth

- Border radius: `3px` on panels, `2px` on controls, `999px` only on the theme switch knob.
- Box shadow: none. Documents do not float. Depth comes from `--paper-raised` against `--paper` and a single hairline.
- Every border is exactly `1px solid var(--hairline)`. Emphasis is a second rule or an ink rule, never a shadow.

## Type scale

| Token | Size / line | Face |
|-------|-------------|------|
| `--t-display` | `clamp(2.6rem, 6vw, 4.4rem)` / 1.02 | Zilla Slab 600 |
| `--t-question` | `clamp(1.4rem, 2.6vw, 2rem)` / 1.18 | Zilla Slab 500 |
| `--t-section` | `1.22rem` / 1.25 | Zilla Slab 600 |
| `--t-body` | `0.95rem` / 1.6 | Archivo 400 |
| `--t-control` | `0.82rem` / 1.2 | Archivo 600 |
| `--t-machine` | `0.78rem` / 1.55 | JetBrains Mono 400 |

## Motion

| Token | Value | Applied to |
|-------|-------|------------|
| `--ease-doc` | `cubic-bezier(.22,.68,.32,1)` | Panels, route shelves |
| `--ease-snap` | `cubic-bezier(.4,0,.2,1)` | Controls, toggles |
| `--dur-quick` | `140ms` | Hover and focus state changes |
| `--dur-panel` | `260ms` | Modal and drawer entry |
| `--dur-compile` | `520ms` | The compile write in |

Under `prefers-reduced-motion: reduce` every duration collapses to `1ms` and the compile write in prints its full output immediately.

## Rules this build holds itself to

- No emoji anywhere. Icons come from Lucide.
- No em dashes or en dashes in interface copy. Hyphens only inside genuine compounds such as on-chain, k-of-n, and multi-source.
- No all caps tracked eyebrow labels, no arrow glyphs bolted onto links, no decorative 01 / 02 / 03 numerals. The market lifecycle is numbered nowhere; it is a named status spine because the states are real.
- Visible focus rings on every interactive element, drawn in sage with a 2px offset.
