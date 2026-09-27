# Kickoff design

## Overview

Kickoff is a one-page Sepolia crowdfunding playground. A cream canvas, dark green type, a pale yellow test-token note and a compact campaign workspace make the rules and next action easy to find. Campaigns and wallet state precede the creation form in document order. The UI deliberately uses no images, custom font downloads, motion library, modal or theme switch.

The source of truth is `web/src/style.css`; `web/src/App.tsx` contains the actual component patterns. This document is in `docs/` because the assignment's overriding allowed paths exclude root `DESIGN.md`.

## Colors

The stylesheet uses hex primitives mapped to semantic roles. Reuse semantic tokens in components.

| Role token | Value | Use |
| --- | --- | --- |
| `--page` | `#f7f7ef` | Warm page background |
| `--surface` | `#ffffff` | Cards, fields, wallet panel; inverse button text |
| `--surface-muted` | `#efefe4` | Neutral badges, disabled controls, progress track |
| `--text` | `#24352a` | Primary type, logo, create button |
| `--muted` | `#5d6256` | Hints, metadata, supporting copy |
| `--border` | `#ddded2` | Card structure and separators |
| `--control-border` | `#73766a` | Input/control boundaries |
| `--accent` | `#35583c` | Connect/pledge actions, headline emphasis, progress |
| `--accent-hover`, `--focus` | `#203f2b` | Hover fill and visible focus ring |
| `--tint` | `#e6ebdb` | Creation panel, open/funded states, transaction status |
| `--note` | `#f1efb7` | Persistent test-token explanation |
| `--error`, `--error-bg` | `#943a2e`, `#fcf1eb` | Errors and their surface |

Statuses also have explicit words; color never carries campaign state alone. Actual browser-computed contrast is recorded in `docs/evidence/browser-review.json`: body/page 12.06:1, supporting text/page 5.83:1, hints/creation panel 5.16:1, white/create button 12.98:1. These are measured pairs, not a claim that every possible state was manually audited. No dark variant exists.

## Typography

System stack: `'Avenir Next', Avenir, 'Segoe UI', sans-serif`, with platform sans fallback, weights 400 and 600 for body/actions, 650 for eyebrows, 750 for the wordmark. No external font assets are needed. The exact installed system face varies by OS; browser measurements confirm CSS values, not cross-platform font identity.

- Body: 1rem / 1.55, root 16px. Inputs remain 1rem on mobile.
- Supporting UI: `--small: .8125rem`; labels: `--label: .75rem`.
- Main heading: `clamp(2.7rem, 5.3vw, 4.4rem)`, line height 1.04, weight 600, tracking −.06em; below 47rem, `clamp(2.45rem, 8vw, 3.5rem)`.
- Section headings: `--section: 1.875rem`, line height 1.2, tracking −.04em. Creation-panel heading is 2rem.
- Campaign titles: `--card: 1.375rem`, line height 1.4, tracking −.025em. Rule headings are 1.0625rem.
- Eyebrows are uppercase presentation, .12em tracking; campaign ID captions use .6875rem.

Headings use balanced wrapping, paragraphs use pretty wrapping, addresses/amounts may wrap anywhere, and numeric values use tabular figures. Body text stays selectable. Short addresses link to the explorer; full connected and contract addresses are available in deployment details. Titles use `<bdi>` and are rendered as text, never HTML.

## Layout

`.shell` is capped at 1160px, with 5rem total outer space on wide screens, 3rem below 62rem, and 2rem below 47rem. Spacing uses a small .5/.75/1/1.25/1.5/2/2.5/3rem vocabulary. Related fields/actions have smaller gaps than independent sections.

Wide hero: flexible text plus a 280px note, 4rem gap. The desktop workspace is `minmax(0, 1fr) 21.875rem` (350px at the default text size), 3rem gap; below 62rem it becomes a flexible list plus 19.375rem form (310px at the default text size), 1.5rem gap. Below 47rem it becomes one column, with creation after campaigns. Cards stay in a single column. The wallet panel wraps before its contents crowd; on narrow screens its button spans the panel width.

The rule section is a three-column grid that becomes one column below 47rem. Below 23rem, card padding decreases and the paired approval/pledge actions stack. Deployment addresses wrap. No fixed overlays or sticky elements cover content. The note's 2-degree desktop rotation is removed on mobile.

`main.shell` also establishes the named `content` inline-size container. A `47rem` container query collapses the workspace when its actual width relative to the enlarged text cannot sustain two columns, including at 200% root text size. The form column and round logo dimensions use rem units so they grow with the text.

Production screenshots and width measurements cover 1440, 820, 375 and 320 CSS pixels without horizontal overflow. 200% root-text enlargement was separately exercised; it is not browser-native zoom. The English layout is the supported variant; translated/RTL and physical-device layouts were not validated.

## Elevation & Depth

The interface is deliberately flat. Tonal surfaces group wallet, campaigns and creation; 1px borders communicate structure. It uses no shadow or blur. Errors and transactions stay in normal document flow, with transaction updates scrolled into view.

## Shapes

Panels/cards use 8px radii, buttons use 6px, inputs 5px, badges 4px, progress tracks a pill radius. The round letter-and-arrow logo is text/CSS. The yellow note uses `2px 2px 30px 2px` on desktop and 6px on mobile. Arrows and decorative marks are hidden from assistive technology; all actions retain text names.

## Components

| Source pattern | Use and behavior |
| --- | --- |
| `App`, `.wallet-panel` | Explicit connect/disconnect, chain switch, KICK balance/allowance. Missing-wallet and wrong-chain states are visible. |
| `CampaignCard`, `.campaign-card` | Title, state, creator, exact totals, native progress bar, deadline and native `<details>` for pledge/settlement controls. Never invent sample cards in production. |
| `.action-buttons` | Separate exact-amount approval and pledge steps; disabled when prerequisites fail. `.action-primary` emphasizes pledge. |
| `CreateForm`, `.create-panel` | Labeled title/goal/deadline fields, byte/amount/time validation, inline errors, first-invalid-field focus. Values are retained on failure. |
| `.primary`, `.create-button`, `.quiet` | Filled main action, dark create action and neutral utility action. All buttons are native and have a minimum 44px height. |
| `.notice`, `.field-error` | Persistent transaction status (`role=status`) and actionable errors (`role=alert`); errors never auto-dismiss. |
| `.empty` | Explains empty/loading state and links to creation when no campaigns exist. Read failures are distinct from empty data. |
| `.deployment-details` | Native disclosure for public addresses, token binding, source commit and exported manifest. |

All controls have visible labels/names and a 3px `:focus-visible` ring with 4px offset. The first focusable link skips to `<main>`. Native disclosures work with keyboard activation. There are no focus-trapping overlays. Button feedback is a 120ms background/transform transition with .96 press scale only under `prefers-reduced-motion: no-preference`; reduced motion removes it. Hover rules are gated by `(hover: hover)`. Forced-colors mode uses `Highlight` for focus.

## Do's and Don'ts

- Start new content inside `.shell`, with semantic headings and existing text/spacing roles. Prefer another native disclosure over introducing a modal.
- Keep statuses textual, token amounts exact and confirmation recipients explicit. Keep transaction gating tied to verified live reads.
- Use the existing neutral button style for utility actions. Keep fields at least 16px and controls at least 44px tall.
- Never hide a full financial value behind ellipsis, round input amounts, fabricate live campaigns, or add an independent deployment map.
- Preserve the test-token/no-off-chain-promises message and the approved absence of an in-page swap.

Design guidance attribution: Jakub Krehel's Better Interface, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` ([source](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface)). Documentation method informed by Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` ([source](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md)). The pinned input was read locally; no upstream design code or reference prose is bundled.
