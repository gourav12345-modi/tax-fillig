# TFA — a data structure for annotating U.S. tax forms


An annotation says three things about every box on a tax form: **where it is**,
**how the value should look in it**, and **which value in the return goes there**.
Nothing else. Feed an annotation and a return to the planner and you get a
**print plan** — a flat list of absolute, pre-measured drawing instructions that
any rendering stack can execute without knowing what a 1040 is.

- **The specification:** **[SPEC.md](SPEC.md)** — the normative document, including
  the reasoning behind each decision.
- **The format:** [`schema/tfa-1.0.schema.json`](schema/tfa-1.0.schema.json) ·
  [`types/tfa.d.ts`](types/tfa.d.ts)
- **Worked examples:** four real IRS forms in [`annotations/`](annotations/) —
  Form 1040 and Form 941 (both pages of each), Schedule C, and Schedule B (Form 941).
- **Reference implementation:** [`src/`](src/) — resolver, formatter, planner,
  linter, PDF and SVG emitters. Zero runtime dependencies.

---

## Try it

```bash
node --version          # 18 or newer; the renderer itself has no dependencies
npm install             # dev tools: schema validation in the tests, PDF compositing in the demo
npm test                # 72 tests
./tools/demo.sh         # renders all four forms into build/
```

`tools/demo.sh` composites each overlay onto the government PDF with `pdf-lib`, a
dev dependency installed by `npm install`. Everything upstream of that step is
dependency-free.

Open `build/1040-filled.pdf`. That is the real IRS Form 1040 for tax year 2025,
downloaded from irs.gov, with the sample return printed onto it.

```bash
# where did every value come from?
node src/cli.js trace annotations/us-irs-1040-2025.tfa.json --data data/return-2025-sample.json

# the same annotation, the taxpayer's copy: identifiers masked, page stamped
node src/cli.js render annotations/us-irs-1040-2025.tfa.json \
    --data data/return-2025-sample.json --profile client --out build/client.pdf

# would this annotation still be safe to file with?
node src/cli.js lint annotations/*.tfa.json --pdf fixtures/f1040.pdf
```

---

## What one field looks like

```jsonc
{
  "id": "line11a",
  "kind": "text",
  "page": 0,
  "box": [504, 750, 72, 12],              // where — top-left origin, points
  "style": "money",                        // right aligned, shrink to fit
  "format": "wholeUSD",                    // 264848 -> "264,848"; a loss -> "(3,000)"; zero -> blank
  "bind": {                                // what
    "path": "$.computed.line11a.adjustedGrossIncome",
    "required": true
  },
  "tags": ["money"],
  "refs": {                                // for humans and for cross-checking
    "line": "11a",
    "label": "Adjusted gross income",
    "acroField": "f1_75[0]",
    "mef": "AdjustedGrossIncomeAmt"
  }
}
```

Where, how, and what are three separate keys. Any one of them can change without
touching the other two, which is what makes a year rollover a small diff instead
of a re-measure.

---

## The examples, and what each one is there to prove

The coordinates are not eyeballed. They come from the forms' own AcroForm widget
rectangles (`tools/extract-widgets.mjs`) and, for the character-cell boxes, from
measuring the printed dividers on a 600 dpi render (`tools/measure-comb.mjs`).
Each annotation is pinned by SHA-256 to the exact PDF in `fixtures/`.

### [`us-irs-1040-2025`](annotations/us-irs-1040-2025.tfa.json) — 112 fields, both pages

The whole return: identity, filing status, the dependents grid, every income and
tax line, direct deposit, signatures, the preparer block.

- **Aggregation from source documents.** Line 1a is
  `$.documents.formW2[*].box1.wagesTipsOtherComp` summed and rounded — two W-2s
  in, `189,521` on the page.
- **Filtering.** Lines 4a and 5a split one array of 1099-Rs by
  `[?@.distributionType == "IRA"]` and `[?@.distributionType == "PENSION"]`.
- **Comb fields with the form's real geometry.** The taxpayer SSN's three groups
  have cell pitches of 10.90, 10.86 and 13.41 points. Nothing about that box is
  evenly spaced, so every cell is given explicitly.
- **A column-major repeat.** The 2025 dependents grid runs across the page, not
  down it, so `advance` is `{ "dx": 108 }`. The fifth dependent overflows: four
  columns print, the form's own "more than four dependents" box is ticked, and
  the spilled row comes back in the plan's `statements`.
- **Conditions.** Spouse fields appear only for `MFJ`, `MFS` and `QSS`.
- **Profiles.** `--profile client` masks every `pii.*` box and stamps both pages,
  from the same annotation, with the real digits never entering the plan.

### [`us-irs-1040-sch-c-2025`](annotations/us-irs-1040-sch-c-2025.tfa.json) — 65 fields

A schedule, which is a different problem: there can be several of them.

- **Form instances.** The sample return has two businesses.
  `"instance": { "path": "$.schedules.scheduleC" }` makes `@` the selected one
  while `$` still reaches the taxpayer's name for the header, and the planner
  reports `INSTANCE_MULTIPLE` rather than silently rendering only the first:

  ```bash
  node src/cli.js trace annotations/us-irs-1040-sch-c-2025.tfa.json \
      --data data/return-2025-sample.json --instance 1
  ```
- **A row-major repeat that overflows onto a statement.** Part V has nine ruled
  lines and the sample has twelve expenses. Eight print, the ninth line reads
  "SEE ATTACHED STATEMENT" with the remaining four subtotalled beside it
  (`"@.otherExpenses[8:].amount"` with a `sum`), and line 48 still totals all
  twelve.
- **Slices and text transforms.** The vehicle-in-service date is sliced out of an
  ISO date into three separate month/day/year boxes.

### [`us-irs-941-2026`](annotations/us-irs-941-2026.tfa.json) — 78 fields, both pages

A different form family — employment tax, filed quarterly, by an employer rather
than an individual — against a completely different data shape. The payment
voucher on page 3 stays blank because nothing is owed.

- **Split dollars/cents columns.** Every money box on a 941 is really two boxes
  with the form's own decimal point printed between them.
  `layout.mode: "split"` spans both, and a middle segment with no `part`
  reserves the width the artwork occupies.
- **One value across two combs.** The EIN's 2-digit and 7-digit halves are two
  fields over one `$.employer.ein`, sliced by transform.
- **Declared page geometry.** This form's media box is 611.976 × 791.968, not
  612 × 792. Page sizes are declared precisely because they cannot be assumed.
- **A required choice that routes to another form.** Line 16 must be answered.
  This employer's liability makes it a semiweekly depositor, so the third box is
  ticked and the monthly lines stay empty: they print only when
  `depositSchedule == "MONTHLY"`, and daily liability goes on Schedule B.
- **Yes, No and unanswered are three states.** The designee's No box prints on an
  explicit `== false`, so a missing answer ticks neither box instead of
  defaulting to No.
- **Geometry the widgets don't give you.** The signature boxes and two of the
  three date boxes have no widget, and every date box has pre-printed slashes.
  Those positions were measured from the artwork, so one ISO date prints as
  month, day and year between the slashes. Page 2's header reuses page 1's
  widget names (`f1_1[0]`–`f1_3[0]`), so `refs.acroField` records the subform
  path to keep them unique.

### [`us-irs-941-sch-b-2026`](annotations/us-irs-941-sch-b-2026.tfa.json) — 21 fields

The daily liability report a semiweekly depositor attaches to Form 941, against
the same payroll data.

- **186 boxes, twelve repeats.** Each printed column of the day grid is a
  `repeat` over a slice of that month's day-indexed array (`days[0:8]`,
  `days[8:16]`, …) with an 18pt advance. Six semi-monthly paydays print; every
  other box stays blank.
- **Totals the captions ask for.** Each month and the quarter are `sum`
  transforms over the same arrays, not stored numbers.
- **A cross-form check.** The form says the quarter total must equal line 12 on
  Form 941, and a test renders both and compares the printed amounts.

### [`us-irs-1040-2026`](annotations/us-irs-1040-2026.tfa.json) — a rollover, on purpose incomplete

Twelve lines of JSON that inherit all 112 fields, nudge page 2 by 1.5pt, restate
one box, delete one line and repoint one binding. It is also **deliberately
broken**, and `npm run lint` says exactly how: the artwork checksum is not
pinned, and the box that moved now collides with its neighbour. That is the
linter doing the job it exists for.

---

## Repository

```
SPEC.md                     the specification
schema/                     JSON Schema for annotations and for print plans
types/tfa.d.ts              the same contract in TypeScript
annotations/                five worked examples
data/                       two sample data sets, deliberately deeply nested
fixtures/                   the exact IRS PDFs the annotations are pinned to,
                            with their provenance in fixtures/README.md
src/
  taxpath.js                the value-reference language: parser and evaluator
  transform.js              the closed transform set
  format.js                 money, dates, identifiers, masking, redaction
  text.js                   measurement, alignment, baselines, fit policies
  encoding.js               WinAnsi, so O’Brien keeps their apostrophe
  metrics.js                generated base-14 font metrics
  compose.js                loading, `extends`, `adjust`, style resolution
  plan.js                   the planner
  lint.js                   static checks
  emit/{pdf,svg}.js         two reference emitters
  cli.js                    lint · plan · trace · render
test/                       72 tests
tools/
  extract-widgets.mjs       derive boxes from a fillable PDF's own widgets
  measure-comb.mjs          find a comb's printed dividers at 600 dpi
  build-metrics.mjs         regenerate font metrics from AFM files
  stamp.mjs                 composite an overlay onto the source PDF
  demo.sh                   the whole pipeline
```

---

## Decisions worth arguing about

Full reasoning is in [SPEC.md, section 14](SPEC.md#14-decisions-and-why). The short version:

**Annotations are data, not programs.** `transform` is about two dozen named
operators — no expression language, no `eval`. It costs expressiveness and buys
three things: a tax analyst who is not an engineer can review a binding; every
printed value traces to a path plus a fixed pipeline; and annotations can be
stored and shipped without becoming a code-execution surface. The line is drawn
at presentation — summing the W-2 box 1 amounts is what the form's own caption
asks for; deciding the taxable portion of a pension is tax law and belongs in the
calculation engine.

**No recursive descent.** `$..wages` looks convenient and is a trap: it keeps
matching as the data model grows, so adding an unrelated field silently changes
what a form prints. Relatedly, a single-valued field whose path matches two
values is an error, not a first-match.

**Coordinates first, AcroForm names alongside.** Filling widgets is easier when
it works and it does not work often enough: not every box has one (the 1040's
signature and date rules have none), flattening varies by producer, and XFA forms
reuse names — on the 2025 Form 1040, `c1_8[0]` names both the "Single" and the
"Head of household" checkbox. Coordinates work on any artwork, including a scan.
`refs.acroField` is recorded so the other strategy stays available.

**Every annotation is pinned to a checksum.** It is the difference between "these
coordinates were correct once" and "these coordinates are correct for this file".
Forms get reissued mid-season; without a pin, a stale annotation prints
plausible-looking output into the wrong boxes and nothing fails.

**The print plan is a separate artifact.** The hard part — resolving a value out
of a nested return, rounding it the way the IRS rounds, deciding whether the box
prints at all, measuring it against the space it has — is exactly the part nobody
should reimplement. Handing over positioned strings means an existing rendering
stack integrates in an afternoon.

**Nothing fails silently.** A required value that will not resolve, a filing
status with no checkbox, a name too wide for its box, a character the font cannot
draw, a ninth row in an eight-row table — each is a diagnostic with a code, not a
quietly wrong form.

---

## What I would build next

- **Continuation sheets as first-class output.** Today overflow rows come back in
  `statements` and the integrator lays them out. Declaring a statement *layout*
  would let the plan carry the extra pages too.
- **Visual regression in the linter.** `tools/measure-comb.mjs` already finds the
  artwork's own rules. A linter that compares declared boxes against detected
  ones would catch a mid-season reissue automatically instead of waiting for
  someone to notice.
- **Cross-form assertions in the annotation.** A test already checks that
  Schedule B's quarter total equals Form 941 line 12. The next step is stating
  rules like that one — and, through `refs.mef`, that Schedule C line 31 equals
  Schedule 1 line 3 and the e-file payload — next to the boxes, where a reviewer
  can see them, rather than in test or engine code.
- **A capture UI.** Nothing in the format assumes a text editor; `refs.line` and
  `refs.label` exist partly so a point-and-click annotator can round-trip. Drawing
  boxes over a rendered page and having the tool propose the binding from the
  caption is a day-one productivity difference at the scale of "every form in
  every state".
- **State forms and their 2-D barcodes.** The `barcode` field kind is declared;
  encoding PDF417 is the remaining work, and it is what a multi-state rollout
  needs first.
- **Real bitmap embedding in the PDF emitter.** `image` ops render as a bitmap
  in the SVG output today; the PDF output draws a labeled "not rendered"
  placeholder instead, following the spec's rule that an op a renderer can't draw
  is reported, never silently dropped (SPEC.md section 9.5 states it for
  barcodes). Embedding a captured signature means decoding JPEG (DCTDecode is
  nearly free) or PNG (its per-scanline filtering is the part worth avoiding a
  dependency for) straight into an image XObject.
