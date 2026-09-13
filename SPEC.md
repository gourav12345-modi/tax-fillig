# Tax Form Annotation (TFA) — Specification v1.0

> An annotation tells you where every value on a government tax form goes, how it
> should look when it gets there, and which value in a return it comes from.
> Nothing else. It is data, not code, and it is meant to be read by a tax analyst
> as easily as by a renderer.

**Status:** 1.0 · **Media type:** `application/vnd.tfa+json` · **File suffix:** `.tfa.json`
**Schema:** [`schema/tfa-1.0.schema.json`](schema/tfa-1.0.schema.json)
**Types:** [`types/tfa.d.ts`](types/tfa.d.ts)

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

---

## 1. Scope

### 1.1 What this specifies

An annotation document binds a **fillable government form** to a **return data set**:

| The form gives you | The annotation adds | The data gives you |
| --- | --- | --- |
| A PDF with printed boxes | Where each box is, in points | The values to print |
| Line numbers and captions | Which value belongs in which box | Nested per-taxpayer structure |
| Conventions (whole dollars, `-0-`, parentheses for losses) | How to format each value | Raw source documents and computed totals |

Applying an annotation to a data set produces a **print plan** : a flat list of
absolute, already-measured drawing instructions. An application with its own PDF,
Canvas, SVG or print-driver stack consumes that plan without knowing anything
about tax.

```
  form.pdf ─┐
            ├─► annotation (.tfa.json) ─► [ planner ] ─► print plan ─► [ your renderer ] ─► filled form
  return ───┘                                  │
                                               └─► diagnostics, statements, value trace
```

### 1.2 What this deliberately does not specify

- **Tax arithmetic.** An annotation never decides what line 15 equals. It says
  where line 15 is printed and where its value can be found. Computation belongs
  in an audited calculation engine (section 14.1).
- **PDF composition.** Merging an overlay onto a source PDF, or filling AcroForm
  fields, is a solved problem in every language. The annotation supplies the
  geometry and the field names (`refs.acroField`) for either approach.
- **The shape of the return data.** Any JSON-like document works. The annotation
  adapts to the data, never the other way round.

### 1.3 Coverage claimed by 1.0

Single-line and multi-line text · money with whole-dollar and cents columns ·
character-cell (comb) fields with irregular dividers · checkboxes · mutually
exclusive and multi-select choice groups · repeating rows and columns with
overflow to a continuation statement · conditional fields · form instances
(a Schedule C per business) · signature images · declared barcode fields ·
year-over-year inheritance · output profiles (filing / client / review copies) ·
redaction · static linting · value-level audit trace.

---

## 2. Model

```
Annotation document
├── identity        id, version, extends
├── form            what paper this is: authority, number, tax year, revision
├── instance        optional: this form is printed once per element of a collection
├── media           the artwork: URI, checksum, page sizes, units, origin
├── fonts           logical name -> concrete face
├── defaults        style and format inherited by every field
├── styles          named, composable typography
├── formats         named, composable value formatting
├── profiles        named output variants
└── fields[]        the annotation proper
    ├── id          stable, unique, survives form revisions
    ├── kind        text | mark | choice | repeat | image | barcode
    ├── page, box   where
    ├── layout      line | wrap | comb | split
    ├── style       how it looks
    ├── format      how the value becomes a string
    ├── bind        where the value comes from  (TaxPath)
    ├── when        whether it prints at all    (TaxPath predicate)
    ├── tags        selectors for profiles and redaction
    └── refs        line number, caption, AcroForm name, e-file element
```

Three orthogonal questions, three separate places to answer them: **`box`** is
where, **`style` + `format` + `layout`** is how it looks, **`bind` + `when`** is
what goes there. Any of the three can change without disturbing the other two,
which is what makes a year rollover cheap (section 4.2).

---

## 3. Document identity

```json
{
  "tfa": "1.0",
  "id": "us.irs.1040:2025",
  "version": "1.3.0"
}
```

- `tfa` — the specification version. A consumer MUST reject a document whose
  `tfa` it does not implement.
- `id` — `authority.form:edition`. Lowercase, stable forever. This is what a
  filing record cites, so it MUST NOT be reused for different artwork.
- `version` — semantic version of *the annotation*, which changes when someone
  corrects a box or repoints a binding. It is independent of `form.revision`,
  which is the authority's own marker for *the artwork*. Both appear in the
  print plan.

`form` carries the human and regulatory identity: `title`, `authority`
(`US-IRS`, `US-CA-FTB`, …), `formNumber`, `taxYear`, `revision`, `omb`,
`catalog`, `attachmentSequence`, `locale`.

---

## 4. Inheritance

### 4.1 `extends`

A document MAY extend another. Objects deep-merge with the child winning; arrays
are replaced; `fields` merge **by `id`**:

- an `id` in both is deep-merged, child wins;
- `{"id": "...", "$op": "remove"}` deletes an inherited field;
- a new `id` is appended in the order the child declares it.

Because merging is by `id` and not by position, a child can restate one box
without repeating its binding, format, style, tags or refs.

### 4.2 `adjust` — bulk geometry

Authorities reprint forms and the whole grid moves a point or two. Re-measuring
every box would be absurd, so a child MAY nudge whole pages:

```json
"adjust": { "pages": { "1": { "dx": 0, "dy": 1.5 } } }
```

The offset applies to every box on that page, including boxes nested inside
`choice` options and `repeat` templates. `adjust` is applied **after** field
merging, so a box the child restated is nudged too.

### 4.3 Completeness

A **root** document (no `extends`) MUST be complete. A **patch** document need
not be; it is validated in full only once composed. The linter is what enforces
this in practice — see section 12.

---

## 5. Media and coordinates

```json
"media": {
  "uri": "https://www.irs.gov/pub/irs-pdf/f1040.pdf",
  "sha256": "3d31c226df0d189ced80e039d01cf0f8820c1019681a0f0ca6264de277b7e982",
  "pageCount": 2,
  "units": "pt",
  "origin": "top-left",
  "pages": [{ "index": 0, "width": 612, "height": 792, "rotate": 0 }]
}
```

- **`sha256` pins the annotation to one exact artwork revision.** This is the
  single most important safety property in the format. Coordinates measured
  against one PDF are meaningless against another, and a form that silently
  changed under you prints a taxpayer's SSN into the wrong box. A renderer MUST
  refuse to stamp a PDF whose hash differs from a non-null `sha256`.
- **`origin` defaults to `top-left`**, with `y` growing downward. PDF's own user
  space is bottom-left, and every renderer already knows how to flip; annotators
  do not think in bottom-left. The origin is declared rather than assumed so
  either convention can be authored.
- **`units`** is `pt` (1/72 inch), `mm` or `in`. `pt` is the natural unit of the
  artwork and SHOULD be preferred.
- **Page sizes are declared, not assumed.** Form 941's media box is
  611.976 × 791.968, not 612 × 792.

### 5.1 Boxes

`[x, y, w, h]` — terse, and the form it takes in almost every field:

```json
"box": [504, 750, 72, 12]
```

The object form `{ "x": …, "y": …, "w": …, "h": …, "rotate": … }` is equivalent,
and required when a box is rotated.

`x, y` is the top-left corner of the box in the declared origin. `w, h` are its
extent. A box MUST have positive `w` and `h` and SHOULD lie within its page.

---

## 6. TaxPath — referencing a value in a deeply nested data set

TaxPath is how an annotation reaches into a return. It is a deliberately small,
total, side-effect-free subset of JSONPath.

### 6.1 Grammar

```
path        := root step*
root        := "$" | "@" | "#"
step        := "." name
             | "[" subscript "]"
subscript   := integer                        index; negative counts from the end
             | integer? ":" integer?          slice, end-exclusive
             | "*"                            every element
             | string                         member with an awkward name
             | "?" predicate                  filter
predicate   := disjunction
disjunction := conjunction ("||" conjunction)*
conjunction := unary ("&&" unary)*
unary       := "!" unary | "(" predicate ")" | comparison | existence | operand
comparison  := operand ("==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "nin" | "~=") operand
existence   := operand ("exists" | "missing" | "isTrue" | "isFalse" | "empty" | "notEmpty")
operand     := path | number | string | "true" | "false" | "null" | "[" literal-list "]"
```

Every path MUST name its root. A bare `wages` would be ambiguous with a literal
and would read identically at document scope and row scope while meaning
different things.

### 6.2 Roots

| Root | Means |
| --- | --- |
| `$` | The return data document. Always available, at every depth. |
| `@` | The current row inside a `repeat`; the selected form instance at document scope (sections 9.4 and 10); the whole document if neither applies. |
| `#` | Loop metadata inside a `repeat`: `#.index` (0-based), `#.number` (1-based), `#.count`, `#.first`, `#.last`. |

`$` remains available inside a row, so a Schedule C's repeating expense table can
still reach the taxpayer's name.

### 6.3 Examples, from the shipped annotations

```jsonc
"$.taxpayer.primary.name.last"                                  // plain nesting
"$.documents.formW2[*].box1.wagesTipsOtherComp"                 // fan out, then sum
"$.documents.form1099R[?@.distributionType == \"IRA\"].box1.grossDistribution"
"$.schedules.scheduleC[?@.business.ein == \"47-8829135\"]"      // pick one of several
"@.otherExpenses[8:].amount"                                    // everything past the printed rows
"@.name.first"                                                  // the current dependent
"#.number"                                                      // "row 3 of 12"
```

### 6.4 Arity

- A `text`, `mark`, `image` or `barcode` field requires **exactly one** value. A
  path that matches more than one is an error, not something to resolve by
  taking the first match — a form box holds one number, and quietly choosing
  which one is how a wrong return gets filed.
- A `repeat` field requires an **array**.
- A path used with a `transform` pipeline may match many; the pipeline reduces.

### 6.5 `bind`

The string form is shorthand for `{ "path": … }`. The object form adds:

```json
"bind": {
  "path": "$.documents.formW2[*].box1.wagesTipsOtherComp",
  "fallback": ["$.return.income.wagesOverride"],
  "default": 0,
  "required": true,
  "transform": [{ "op": "sum" }, { "op": "round", "decimals": 0 }]
}
```

- `fallback` — tried in order when `path` resolves to nothing. The path that
  actually produced the value is recorded in the trace.
- `default` — used when nothing resolved.
- `required` — a resolution failure becomes a diagnostic of severity `error`
  rather than a silently blank box.
- `literal` — a constant, mutually exclusive with `path`. Used for the
  "SEE ATTACHED STATEMENT" line the form itself does not supply.

### 6.6 Transforms

A closed, ordered pipeline. Each step is `{ "op": …, …options }`.

| Group | Operators |
| --- | --- |
| Aggregate | `sum` `count` `min` `max` `first` `last` `join` |
| Project | `pluck` |
| Arithmetic | `abs` `negate` `add` `subtract` `multiply` `divide` `round` `clamp` |
| Text | `upper` `lower` `trim` `digits` `slice` `padStart` `concat` |
| Control | `default` |

`round` takes `decimals` and `mode` (`half-up` — the IRS whole-dollar rule and
the default — `half-even`, `down`, `up`, `floor`, `ceil`).

**The operator set is closed on purpose.** See section 14.1.

### 6.7 `when`

A field renders only if its `when` condition holds. The condition is the same
predicate grammar as a filter body, so there is one expression language in the
format rather than two:

```json
"when": "$.return.filingStatus in [\"MFJ\",\"MFS\",\"QSS\"]"
"when": { "allOf": ["$.return.filingStatus in [\"HOH\",\"QSS\"]",
                    "$.return.qualifyingPerson.isDependent isFalse"] }
```

`allOf`, `anyOf` and `not` compose conditions. Inside a `repeat`, `@` is the row:
`"when": "@.fullTimeStudent isTrue"`.

---

## 7. Formatting

`format` turns a resolved value into the exact string of glyphs that belongs in
the box. Formats are named at the document level and composed with `$extends`:

```json
"formats": {
  "wholeUSD":         { "type": "number", "decimals": 0, "rounding": "half-up",
                        "grouping": true, "negative": "parens", "zero": "blank", "null": "blank" },
  "wholeUSDzeroDash": { "$extends": "wholeUSD", "zero": "dash" },
  "ssn":              { "type": "digits", "length": 9, "redactChar": "X" },
  "ssnMasked":        { "type": "digits", "length": 9, "mask": "###-##-####" }
}
```

### 7.1 `number`

| Key | Effect |
| --- | --- |
| `decimals`, `rounding` | Rounding is explicit, applied before formatting. `half-up` matches the IRS instruction to round 50 cents and over up. |
| `grouping`, `groupSeparator`, `decimalSeparator` | `189521` → `189,521`. |
| `negative` | `parens` (the IRS convention: `(3,000)`), `minus`, `trailing-minus`, `abs`. |
| `zero` | `blank` (leave the box empty), `zero`, `dash` (the `-0-` an IRS instruction sometimes demands), or any literal. Applied **after** rounding, so `$0.40` on a whole-dollar line correctly prints nothing. |
| `null` | What to print when the binding resolved to nothing. Distinct from `zero`: "no value" and "zero" are different facts. |
| `prefix`, `suffix` | Rarely needed; the form usually prints its own `$`. |

### 7.2 `digits`

For identifiers, not quantities. Non-digits are stripped, then:

- `length` — the exact count expected. A mismatch is an **error** by default
  (`onLengthMismatch`: `error` | `pad` | `ignore`). A silently truncated SSN is
  worse than a failed render.
- `mask` — `#` is a digit slot, everything else is literal: `###-##-####`,
  `##-#######`. Omit the mask for a comb field, which supplies its own dividers.
- `redact` / `redactChar` — `last4` or `full`. Normally set by an output profile
  (section 11) rather than by the format itself.

### 7.3 `date`

Parsed **textually** from ISO-8601, never through a `Date` with a timezone. A
return filed on 1 January must not print 12/31 because the renderer ran in UTC−6.
Pattern tokens: `YYYY` `YY` `MMM` `MM` `DD`.

### 7.4 `text` and `boolean`

`case` (`upper` — many paper forms are scanned, and uppercase reads better —
`lower`, `title`), `maxLength`, `truncate` (`clip` | `ellipsis`).
`boolean` renders `trueText` / `falseText`.

---

## 8. Positioning and typography

### 8.1 `style`

Named, composable via `$extends`, and merged as
`defaults.style` → named style → inline overrides.

```json
"styles": {
  "entry": { "pad": { "left": 3, "right": 3 }, "fit": { "mode": "shrink", "min": 6 } },
  "money": { "align": "right", "pad": { "right": 5 }, "fit": { "mode": "shrink", "min": 6.5 } },
  "comb":  { "align": "center", "pad": 0 }
}
```

`font` `size` `weight` `italic` `color` `align` `valign` `pad` `letterSpacing`
`lineHeight` `decimalSeparator` `decimalTab` `fit`.

**Horizontal:** `left`, `center`, `right`, `decimal`. `decimal` aligns the
decimal separator a fixed `decimalTab` from the content box's right edge, which
keeps a cents column straight when some rows have no cents.

**Vertical:** resolved to a text baseline.

| `valign` | Baseline |
| --- | --- |
| `top` | content top + ascender |
| `middle` | content centred on cap height — the default, and what looks right in a 12pt box |
| `bottom` | descenders sit inside the box |
| `baseline` | baseline exactly on the content bottom, i.e. sitting on the form's printed rule |

### 8.2 `fit` — text that does not fit

Taxpayer names and expense descriptions are not bounded by the box they go in.
A format that has no answer for this produces overprinting on real returns.

| Mode | Behaviour |
| --- | --- |
| `clip` | Draw at full size; the renderer clips. Reported as a diagnostic. |
| `shrink` | Step the point size down to `min` until it fits. |
| `condense` | Keep the size, squeeze horizontally to `minScale`. |
| `ellipsis` | Truncate with `…`. |
| `wrap` | Break into up to `maxLines` lines at `lineHeight`. |

Whatever the mode, a string that still does not fit produces a `TEXT_OVERFLOW`
diagnostic. Silence is never an option.

### 8.3 Fonts

```json
"fonts": {
  "sans": { "family": "Helvetica", "base14": "Helvetica", "bold": "Helvetica-Bold",
            "fallback": ["Arial", "Liberation Sans"], "encoding": "WinAnsi" }
}
```

Styles name a *logical* font (`"font": "sans"`); the document maps it to a
concrete face. `base14` names a standard PDF font whose metrics every renderer
already has, so a plan can be laid out identically everywhere. `encoding`
declares what the face can represent; a value containing characters outside it
produces a `GLYPH_UNSUPPORTED` diagnostic rather than a silently dropped
apostrophe in `O’Brien`.

---

## 9. Field kinds

### 9.1 `text`

The common case: a value, formatted, placed in a box.

```json
{
  "id": "line11a",
  "kind": "text",
  "page": 0,
  "box": [504, 750, 72, 12],
  "style": "money",
  "format": "wholeUSD",
  "bind": { "path": "$.computed.line11a.adjustedGrossIncome", "required": true },
  "tags": ["money"],
  "refs": { "line": "11a", "label": "Adjusted gross income",
            "acroField": "f1_75[0]", "mef": "AdjustedGrossIncomeAmt" }
}
```

`layout` chooses how the string is arranged in the box:

**`line`** (default) — one line.

**`wrap`** — several lines, `maxLines` and `lineHeight`.

**`comb`** — one character per printed cell. Government forms use these for
SSNs, EINs, routing numbers, account numbers and PINs.

```json
"layout": { "mode": "comb", "cells": 9 }
"layout": { "mode": "comb", "cells": [[0, 10.9], [10.9, 10.9], [21.8, 10.9],
                                      [32.7, 10.86], [43.56, 10.86],
                                      [54.42, 13.41], [67.83, 13.41],
                                      [81.24, 13.41], [94.65, 13.41]] }
```

`cells` as an integer divides the box evenly. The **explicit `[offset, width]`
array** exists because real forms are not even: on the 2025 Form 1040 the taxpayer SSN's three groups have cell pitches
of 10.90, 10.86 and 13.41 points, while the routing-number comb on page 2 is a
clean 14.4 throughout. `align` (`left` | `right`) decides which end a short value
packs against — an account number is left-packed in a 17-cell comb.

**`split`** — one value across several sub-boxes. Many forms print a dollars
column and a cents column with their own decimal point between them:

```json
"layout": {
  "mode": "split",
  "segments": [
    { "id": "dollars", "part": "integer",  "w": 100.8, "align": "right", "pad": { "right": 4 } },
    { "id": "point",                        "w": 7.2 },
    { "id": "cents",   "part": "fraction",  "w": 20.85, "align": "center" }
  ]
}
```

A segment with no `part` is a spacer reserving the width the form's own artwork
occupies. A segment with no `w` shares whatever width is left.

### 9.2 `mark`

A mark in a checkbox, driven by `when` (or a truthy `bind`).

```json
{ "id": "line12d.youBlind", "kind": "mark", "page": 1, "box": [311.6, 74, 8, 8],
  "when": "$.return.ageBlind.taxpayer.blind isTrue",
  "mark": { "style": "glyph", "glyph": "X", "inset": 0.5 } }
```

`mark.style` is `glyph` (a character, centred), or the vector forms `check`,
`cross`, `fill` for renderers that prefer strokes.

### 9.3 `choice`

Mutually exclusive boxes bound to one value. This is sugar over a set of marks,
and it earns its place by making the annotation read like the form and by letting
the planner catch a value with no box:

```json
{
  "id": "filingStatus", "kind": "choice",
  "bind": { "path": "$.return.filingStatus", "required": true },
  "mark": { "glyph": "X", "inset": 0.5 },
  "options": [
    { "value": "SINGLE", "box": [97.6, 206, 8, 8] },
    { "value": "MFJ",    "box": [97.6, 218, 8, 8] },
    { "value": "MFS",    "box": [97.6, 230, 8, 8] },
    { "value": "HOH",    "box": [349.6, 206, 8, 8] },
    { "value": "QSS",    "box": [349.6, 218, 8, 8] }
  ]
}
```

`exhaustive` defaults to **true**: a bound value with no matching option is an
`error`. A new filing status code arriving from an upstream system should stop
the render, not print a form with nothing ticked. A `bind` resolving to an array
ticks several boxes, for genuine multi-select groups.

### 9.4 `repeat`

A printed table with a fixed number of slots.

```json
{
  "id": "dependents", "kind": "repeat", "page": 0,
  "bind": "$.return.dependents",
  "slots": { "count": 4, "advance": { "dx": 108, "dy": 0 } },
  "template": [
    { "id": "firstName", "kind": "text", "box": [145, 309, 106.2, 12], "bind": "@.name.first" },
    { "id": "ssn",       "kind": "text", "box": [143.94, 333, 108, 12], "bind": "@.ssn",
      "layout": { "mode": "comb", "cells": 9 } },
    { "id": "livedWithYou", "kind": "mark", "box": [169.6, 359, 8, 8],
      "when": "@.livedWithYouMoreThanHalfYear isTrue" }
  ],
  "overflow": {
    "strategy": "statement",
    "statementId": "form1040-dependents-continuation",
    "onOverflow": [
      { "id": "moreThanFour", "kind": "mark", "box": [79.7, 368.5, 8, 8] }
    ]
  }
}
```

**Template boxes are absolute for slot 0**, and slot *n* adds `advance × n` to
every box in the template. The annotator reads the first row's coordinates
straight off the form instead of doing arithmetic in their head, and the grid
direction falls out of `advance`: `dy` for a row-major table (Schedule C Part V),
`dx` for the column-major dependents grid on the 2025 Form 1040.

Children may be any field kind, including nested repeats. Their ids are
suffixed with `[n]` in the plan.

**`overflow`** is mandatory in practice, because a taxpayer with five dependents
is not an edge case:

| `strategy` | Behaviour |
| --- | --- |
| `error` (default) | Refuse. Nothing silently disappears. |
| `truncate` | Print what fits, warn about the rest. |
| `statement` | Print what fits; the remaining rows are emitted in the plan's `statements` for the integrator's continuation sheet. |

`onOverflow` renders extra fields *only* when the data overflowed — the form's own
"check here if more than four dependents" box, a "see attached statement" line,
and a subtotal of the spilled rows (`"@.otherExpenses[8:].amount"` with a `sum`).

### 9.5 `image` and `barcode`

`image` stamps a bitmap — a captured signature — with `fit` of
`contain` | `cover` | `fill`. `barcode` declares a `symbology` (e.g. `PDF417`,
which several states require on paper returns) and the data to encode. Both
appear in the plan as ops; a renderer that does not implement barcode symbologies
MUST report that rather than drop the op.

---

## 10. Form instances

A return can carry several copies of the same form: a Schedule C per business, a
K-1 per partnership, a 1116 per income category. A document declares this once:

```json
"instance": { "path": "$.schedules.scheduleC", "required": true }
```

`@` at document scope then refers to the selected element, while `$` still
reaches the whole return — so a schedule's header can print the taxpayer's name
while its body reads from the business. The planner takes an instance index; if
there are several and no index was given, it renders index 0 **and says so** as
an `INSTANCE_MULTIPLE` diagnostic. A complete return renders each in turn.

---

## 11. Output profiles

The same annotation drives every copy of a return that leaves the building.

```json
"profiles": {
  "filing": { "description": "Goes to the IRS. Nothing masked, nothing stamped." },
  "client": {
    "redact": [
      { "select": "tag:pii.ssn",  "mode": "last4" },
      { "select": "tag:pii.bank", "mode": "last4" },
      { "select": "tag:pii.pin",  "mode": "full" }
    ],
    "stamp": [
      { "id": "stamp.p1", "page": 0, "box": [156, 380, 300, 32],
        "style": "stamp", "text": "CLIENT COPY — DO NOT FILE" }
    ]
  }
}
```

Selectors are `#fieldId`, `tag:name`, `*`. A profile may
also `only`/`exclude` whole sets of fields. Redaction is applied at format time,
so a masked value is never in the plan at all — there is no redacted PDF with
the real digits still in the content stream.

---

## 12. Validation

Two layers, and both matter.

**Schema** (`schema/tfa-1.0.schema.json`) — structural. A root document must be
complete; a patch document is checked in full only once composed.

**Lint** — semantic, and the part that catches real mistakes. Run it in CI.

| Code | Severity | Catches |
| --- | --- | --- |
| `CHECKSUM_MISMATCH` | error | The annotation is pinned to different artwork than the PDF you have. |
| `NO_CHECKSUM` | warning | The annotation is not pinned at all. |
| `BOX_OFF_PAGE`, `BAD_BOX` | error | Coordinates outside the page, or non-positive extents. |
| `BOX_OVERLAP` | warning | Two text boxes overlap — nearly always a copy-paste that was never re-measured. |
| `DUPLICATE_ID` | error | Field ids must be unique for inheritance and tracing to work. |
| `COMB_MISMATCH` | error | A 9-digit format in a comb with 8 cells. |
| `SPLIT_OVERFLOW`, `SPLIT_NO_INTEGER` | error | Segments wider than the box, or no segment taking the integer part. |
| `BAD_PATH`, `BAD_WHEN` | error | TaxPath that does not parse. |
| `BAD_STYLE`, `BAD_FORMAT` | error | A reference to a style or format that does not exist. |
| `NO_OVERFLOW` | warning | A repeat with slots but no answer for the *n+1*th row. |
| `DUPLICATE_ACRO` | warning | Two fields claiming the same AcroForm name. |
| `NO_LINE_REF`, `NO_LABEL` | info | Money boxes without a line number are hard to review. |

At render time the planner adds data-dependent diagnostics: `BIND_REQUIRED`,
`BIND_INVALID`, `FORMAT_FAILED`, `CHOICE_UNMATCHED`, `COMB_OVERFLOW`,
`TEXT_OVERFLOW`, `GLYPH_UNSUPPORTED`, `REPEAT_OVERFLOW`, `REPEAT_STATEMENT`,
`INSTANCE_MULTIPLE`, `INSTANCE_OUT_OF_RANGE`.

---

## 13. The print plan

The interop boundary. Everything tax-specific has already happened; what is left
is drawing.

```jsonc
{
  "printPlan": "1.0",
  "generatedAt": "2026-03-04T09:12:44.201Z",
  "source": {
    "annotation": "us.irs.1040:2025@1.0.0",
    "form": { "number": "1040", "taxYear": 2025, "revision": "2025-09-05" },
    "media": { "uri": "https://www.irs.gov/pub/irs-pdf/f1040.pdf", "sha256": "3d31c2…" }
  },
  "profile": "filing",
  "instance": null,
  "units": "pt",
  "pages": [
    {
      "index": 0, "width": 612, "height": 792, "origin": "top-left",
      "ops": [
        { "op": "text", "fieldId": "line11a", "text": "264,848",
          "x": 538.474, "baseline": 759.231, "width": 32.526,
          "font": "Helvetica", "size": 9, "scale": 1, "color": "#000000",
          "letterSpacing": 0, "align": "right", "rotate": 0 }
      ]
    }
  ],
  "statements": [ { "id": "…", "fieldId": "dependents", "items": [ /* the rows that did not fit */ ] } ],
  "diagnostics": [ { "severity": "info", "code": "REPEAT_STATEMENT", "fieldId": "dependents", "message": "…" } ],
  "trace": [ { "fieldId": "line11a", "page": 0, "line": "11a",
               "path": "$.computed.line11a.adjustedGrossIncome",
               "raw": 264848, "printed": "264,848", "redacted": false } ]
}
```

A conforming renderer needs to handle four ops:

| Op | Contract |
| --- | --- |
| `text` | Draw `text` with its **left edge at `x`** and its **baseline at `baseline`**. Alignment and fitting are already resolved. `width` is the measured advance, so a renderer can check its own metrics agree. `scale` below 1 means condensed. |
| `mark` | Stroke or fill `shape` in the given rectangle. |
| `image` | Place `href` in the rectangle with `fit`. |
| `barcode` | Encode `data` in `symbology`, or report that you cannot. |

`trace` is what makes a paper return explainable: every printed value, the line it
sits on, the path it came from, its raw value and its rendered string. Two plans
diff cleanly, so "what changed between draft 3 and the filed copy" is a question
with an exact answer.

---

## 14. Decisions, and why

### 14.1 Annotations are not programs

`transform` is a closed set of about two dozen named operators, not an expression
language. There is no `eval`, no arbitrary arithmetic, no user-defined function.

This costs some expressiveness and buys three things. **Review:** a tax analyst
who is not an engineer can read a binding and say whether it is right, which is
the actual review that has to happen before a form is filed. **Auditability:**
every value on a return traces to a path plus a fixed pipeline, and the print
plan records exactly that. **Safety:** annotations can be authored, stored and
shipped as data without becoming a code-execution surface.

The line is drawn at *presentation*. `sum` over the W-2 box 1 amounts is
presentation: the form's own caption says "total amount from Form(s) W-2, box 1".
Deciding the taxable portion of a pension is tax law, and belongs in the
calculation engine, where it can be tested and audited on its own terms.

### 14.2 Why not plain JSONPath

Recursive descent (`$..wages`) is excluded. It looks convenient and it is a trap:
it keeps matching as the data model grows, so adding an unrelated field to the
return silently changes what a form prints. Every path is explicit. For the same
reason, a single-valued field whose path matches several values is an error
rather than a first-match.

### 14.3 Why coordinates and not AcroForm field names

Filling AcroForm fields is easier when it works, and it does not work often
enough. Not every form is fillable; not every box has a widget (the 1040's
signature and date rules have none); flattening behaviour varies by producer; and
XFA forms reuse field names — on the 2025 Form 1040, `c1_8[0]` names both the
"Single" and the "Head of household" checkbox. Coordinates always work, on any
artwork, including a scan.

So TFA is coordinate-first and records `refs.acroField` alongside. An integrator
who wants to fill the fillable PDF has the names; everyone else has geometry that
does not depend on the producer's goodwill.

### 14.4 Why `refs` at all

None of `refs` affects rendering. `line` and `label` make the annotation
reviewable against the paper form and make the trace legible. `acroField` enables
the alternative fill strategy and lets a tool diff the annotation against the
PDF's own widgets. `mef` names the IRS Modernized e-File element, so a paper copy
and an e-filed return can be reconciled field by field — the same return going
out two doors should agree, and this is what makes checking that mechanical.

### 14.5 Why the print plan is a separate artifact

Because the hard, tax-specific part — resolving a value out of a nested return,
rounding it the way the IRS rounds, deciding whether the box is even printed,
measuring it against the box it has to fit — is exactly the part nobody should
reimplement. Emitting a flat list of positioned strings means an existing
rendering stack integrates in an afternoon, and it means the interesting logic
has one implementation to test.

### 14.6 Why annotations are pinned to a checksum

It is the difference between "these coordinates were correct once" and "these
coordinates are correct for this file". Forms are reissued mid-season. Without a
pin, a stale annotation against fresh artwork prints plausible-looking output in
the wrong boxes, and nothing fails.

---

## 15. Conformance

A **conforming annotation** validates against the schema, lints without errors,
and pins a non-null `media.sha256`.

A **conforming planner** MUST implement sections 6–11 and emit a plan per section 13; MUST
report every diagnostic in section 12 rather than failing silently; MUST refuse to
resolve an ambiguous single-valued path; and MUST NOT perform arithmetic beyond
the closed transform set.

A **conforming renderer** MUST verify `source.media.sha256` against the artwork
it is about to stamp when that value is non-null; MUST honour `x`/`baseline`
placement exactly; and MUST report ops it cannot draw.

---

## 16. Not in 1.0

Deliberately deferred, with the shape they would take:

- **Continuation sheets as first-class output.** 1.0 hands overflow rows back in
  `statements`. A future version could declare a statement *layout* — a generic
  ruled sheet with a header — so the plan carries the extra pages too.
- **Barcode rendering.** The field kind and symbology are declared; encoding
  PDF417 for the states that require it is left to the renderer.
- **Right-to-left and CJK.** The layout model assumes left-to-right. Puerto Rico
  and the territories are fine; a Spanish-language form is fine; a genuinely
  bidirectional form would need a direction property and a shaping step.
- **Cross-form assertions.** `refs.mef` makes it possible to check that Schedule
  C line 31 equals Schedule 1 line 3 and that both equal the e-file payload. A
  future `assert` block could state those invariants where they are visible,
  next to the boxes, rather than in engine code.
- **Visual regression as part of lint.** The measurement tools in `tools/` find
  the artwork's own rules; a linter could compare declared boxes against detected
  ones and flag drift automatically after a reissue.
- **A capture UI.** Nothing in the format assumes a text editor. `refs.label`
  and `refs.line` exist partly so a point-and-click annotator can round-trip.
