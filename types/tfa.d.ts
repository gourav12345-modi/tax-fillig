/**
 * TypeScript definitions for the Tax Form Annotation (TFA) specification, v1.0,
 * and for the print plan a TFA renderer produces.
 *
 * These types are the same contract as schema/tfa-1.0.schema.json, expressed for
 * authors who would rather annotate a form in a typed editor than in raw JSON.
 */

// ─────────────────────────────────────────────────────────────── value refs

/**
 * A TaxPath expression.
 *
 *   `$`                 the return data root
 *   `@`                 the current row inside a `repeat`, or the form instance
 *   `#`                 loop metadata: `#.index` `#.number` `#.count` `#.first` `#.last`
 *   `.name` `["name"]`  member access
 *   `[3]` `[-1]`        index access; negative counts back from the end
 *   `[*]` `[1:4]`       every element; slice
 *   `[?<predicate>]`    filter
 *
 * @example "$.documents.formW2[*].box1.wagesTipsOtherComp"
 * @example "$.schedules.scheduleC[?@.business.ein == \"47-8829135\"].income.grossReceipts"
 */
export type TaxPath = string;

/** The body of a `[?...]` filter, reused verbatim as a `when` condition. */
export type PredicateExpr = string;

export type Predicate =
  | PredicateExpr
  | { allOf: Predicate[] }
  | { anyOf: Predicate[] }
  | { not: Predicate };

export type Transform =
  // many values in, one out
  | { op: 'sum' | 'count' | 'min' | 'max' | 'first' | 'last' }
  | { op: 'join'; separator?: string }
  | { op: 'pluck'; path: TaxPath }
  // arithmetic
  | { op: 'abs' | 'negate' }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; value: number }
  | { op: 'round'; decimals?: number; mode?: RoundingMode }
  | { op: 'clamp'; min?: number; max?: number }
  // text
  | { op: 'upper' | 'lower' | 'trim' | 'digits' }
  | { op: 'slice'; start?: number; end?: number }
  | { op: 'padStart'; length: number; char?: string }
  | { op: 'concat'; prefix?: string; suffix?: string }
  | { op: 'default'; value: unknown };

export type Bind =
  | TaxPath
  | {
      path: TaxPath;
      /** Tried in order when `path` resolves to nothing. */
      fallback?: TaxPath[];
      /** Used when nothing resolved and no fallback matched. */
      default?: unknown;
      /** Raise a planning error instead of printing a blank box. */
      required?: boolean;
      transform?: Transform[];
      $comment?: string;
    }
  | { literal: unknown };

// ───────────────────────────────────────────────────────────────── geometry

/** `[x, y, w, h]` in the document's declared units and origin. */
export type BoxArray = [x: number, y: number, w: number, h: number];
export type BoxObject = { x: number; y: number; w: number; h: number; rotate?: number };
export type Box = BoxArray | BoxObject;

export type Padding = number | { top?: number; right?: number; bottom?: number; left?: number };

export type FitPolicy =
  | { mode: 'clip' }
  | { mode: 'shrink'; min?: number; step?: number }
  | { mode: 'condense'; minScale?: number }
  | { mode: 'ellipsis' }
  | { mode: 'wrap'; maxLines?: number; lineHeight?: number };

export interface Style {
  /** Inherit another named style, then override. */
  $extends?: string;
  font?: string;
  size?: number;
  weight?: 'normal' | 'bold';
  italic?: boolean;
  /** `#rrggbb`. */
  color?: string;
  align?: 'left' | 'center' | 'right' | 'decimal';
  valign?: 'top' | 'middle' | 'bottom' | 'baseline';
  pad?: Padding;
  letterSpacing?: number;
  lineHeight?: number;
  decimalSeparator?: string;
  /** For `align: "decimal"`: distance from the content box's right edge to the point. */
  decimalTab?: number;
  fit?: FitPolicy;
}

// ──────────────────────────────────────────────────────────────── formatting

export type RoundingMode = 'half-up' | 'half-even' | 'down' | 'up' | 'floor' | 'ceil';

export interface Format {
  $extends?: string;
  type?: 'text' | 'number' | 'date' | 'digits' | 'boolean';

  case?: 'upper' | 'lower' | 'title';
  maxLength?: number;
  truncate?: 'clip' | 'ellipsis';

  decimals?: number;
  /** Defaults to `half-up`, the IRS whole-dollar rule. */
  rounding?: RoundingMode;
  grouping?: boolean;
  groupSeparator?: string;
  decimalSeparator?: string;
  /** Defaults to `parens`: IRS forms show losses in parentheses. */
  negative?: 'parens' | 'minus' | 'trailing-minus' | 'abs';
  /** `blank`, `zero`, `dash` (the "-0-" convention), or a literal string. */
  zero?: 'blank' | 'zero' | 'dash' | string;
  /** What to print when the binding resolved to nothing. */
  null?: 'blank' | 'zero' | string;
  prefix?: string;
  suffix?: string;

  /** `type: "date"` — token pattern, e.g. `MM/DD/YYYY`, `MMM DD, YYYY`. */
  pattern?: string;

  /** `type: "digits"` — exact digit count expected. */
  length?: number;
  onLengthMismatch?: 'error' | 'pad' | 'ignore';
  /** `#` is a digit slot, anything else is literal: `###-##-####`. */
  mask?: string;
  redact?: 'none' | 'last4' | 'full';
  redactChar?: string;

  trueText?: string;
  falseText?: string;
}

// ─────────────────────────────────────────────────────────────────── layout

export type Layout =
  | { mode: 'line' }
  | { mode: 'wrap'; maxLines?: number; lineHeight?: number }
  /**
   * One character per printed cell — SSNs, EINs, routing numbers, PINs.
   * `cells` as a number divides the box evenly; as an array it gives each cell's
   * `[offsetFromBoxLeft, width]`, which is what real forms need because their
   * dividers are rarely evenly spaced.
   */
  | {
      mode: 'comb';
      cells: number | Array<[offset: number, width: number]>;
      align?: 'left' | 'right';
    }
  /**
   * One value spread across sub-boxes: a dollars column and a cents column with
   * the form's own decimal point printed between them. A segment with no `part`
   * is a spacer reserving width for that artwork.
   */
  | {
      mode: 'split';
      separator?: string;
      fractionWhenAbsent?: string;
      segments: Array<{
        id?: string;
        part?: 'integer' | 'fraction';
        w?: number;
        align?: 'left' | 'center' | 'right';
        pad?: Padding;
      }>;
    };

export interface Mark {
  style?: 'glyph' | 'check' | 'cross' | 'fill';
  glyph?: string;
  size?: number;
  inset?: number;
  color?: string;
  lineWidth?: number;
}

/**
 * Cross-references. None of these affect rendering; they are what make an
 * annotation reviewable by a tax analyst and checkable against other systems.
 */
export interface Refs {
  /** The form's own line number, e.g. `"11a"`. */
  line?: string;
  /** The caption printed next to the box. */
  label?: string;
  /** AcroForm field name, for filling the fillable PDF instead of stamping it. */
  acroField?: string;
  /** IRS Modernized e-File schema element, so paper and e-file can be reconciled. */
  mef?: string;
  note?: string;
}

// ──────────────────────────────────────────────────────────────────── fields

interface FieldBase {
  /** Unique in the document and stable across form revisions. */
  id: string;
  $comment?: string;
  /** Only meaningful in a document with `extends`: deletes the inherited field. */
  $op?: 'remove';
  page?: number;
  style?: string | Style;
  when?: Predicate;
  tags?: string[];
  refs?: Refs;
  required?: boolean;
}

export interface TextField extends FieldBase {
  kind?: 'text';
  box: Box;
  format?: string | Format;
  layout?: Layout;
  bind: Bind;
}

export interface MarkField extends FieldBase {
  kind: 'mark';
  box: Box;
  mark?: Mark;
  /** Print the mark when this is truthy. Use `when` for anything more involved. */
  bind?: Bind;
}

export interface ChoiceField extends FieldBase {
  kind: 'choice';
  bind: Bind;
  mark?: Mark;
  options: Array<{ value: unknown; box: Box; mark?: Mark; label?: string }>;
  /** Default true: a bound value with no matching option is an error, not a silent blank. */
  exhaustive?: boolean;
}

export interface RepeatField extends FieldBase {
  kind: 'repeat';
  /** Must resolve to an array. */
  bind: Bind;
  /** How many printed rows or columns the form actually has, and the step between them. */
  slots: { count: number; advance: { dx?: number; dy?: number } };
  /** Fields positioned for slot 0; every later slot adds `advance` to each box. */
  template: Field[];
  overflow?: {
    strategy: 'error' | 'truncate' | 'statement';
    statementId?: string;
    title?: string;
    /** Rendered only when the data overflowed: the "check here" box, a "see attached statement" line, a subtotal. */
    onOverflow?: Field[];
  };
}

export interface ImageField extends FieldBase {
  kind: 'image';
  box: Box;
  bind: Bind;
  fit?: 'contain' | 'cover' | 'fill';
}

export interface BarcodeField extends FieldBase {
  kind: 'barcode';
  box: Box;
  bind: Bind;
  /** e.g. `PDF417` for the 2-D barcode several states require on paper returns. */
  symbology?: string;
  errorCorrection?: string | number;
}

export type Field = TextField | MarkField | ChoiceField | RepeatField | ImageField | BarcodeField;

// ───────────────────────────────────────────────────────────────── document

/** `#id` | `tag:name` | `*` */
export type Selector = string;

export interface Profile {
  description?: string;
  only?: Selector[];
  exclude?: Selector[];
  redact?: Array<{ select: Selector; mode: 'none' | 'last4' | 'full' }>;
  stamp?: Array<{ id?: string; page?: number; box: Box; text: string; style?: string | Style }>;
}

export interface Font {
  family?: string;
  base14?: 'Helvetica' | 'Helvetica-Bold' | 'Helvetica-Oblique' | 'Times-Roman' | 'Times-Bold' | 'Courier' | 'Courier-Bold';
  bold?: string;
  italic?: string;
  fallback?: string[];
  encoding?: 'WinAnsi' | 'Unicode';
  src?: string;
}

export interface Annotation {
  $schema?: string;
  $comment?: string;
  tfa: '1.0';
  /** `authority.form:edition`, e.g. `us.irs.1040:2025`. */
  id: string;
  /** Semantic version of this document, independent of the form's own revision. */
  version: string;
  /** Inherit another annotation: scalars deep-merge, `fields` merge by id. */
  extends?: string | { href: string };
  /** Bulk geometry corrections applied after inheritance, for reprints that shift a whole page. */
  adjust?: { $comment?: string; pages?: Record<string, { dx?: number; dy?: number }> };

  form: {
    title: string;
    /** e.g. `US-IRS`, `US-CA-FTB`. */
    authority: string;
    formNumber: string;
    taxYear: number;
    revision?: string;
    omb?: string;
    catalog?: string;
    attachmentSequence?: string;
    locale?: string;
    note?: string;
  };

  /** This form is printed once per element of a collection; `@` then names the element. */
  instance?: { path: TaxPath; required?: boolean; description?: string };

  media: {
    uri?: string;
    /** Pins the annotation to one exact artwork revision. */
    sha256?: string | null;
    pageCount?: number;
    units?: 'pt' | 'mm' | 'in';
    origin?: 'top-left' | 'bottom-left';
    pages: Array<{ index: number; width: number; height: number; rotate?: number }>;
  };

  fonts?: Record<string, Font>;
  defaults?: { style?: Style; format?: Format };
  styles?: Record<string, Style>;
  formats?: Record<string, Format>;
  profiles?: Record<string, Profile>;
  fields: Field[];
}

// ─────────────────────────────────────────────────────────────── print plan

export interface TextOp {
  op: 'text';
  fieldId?: string;
  text: string;
  /** Left edge; alignment is already resolved. */
  x: number;
  /** Baseline, measured from the top of the page. */
  baseline: number;
  /** Measured advance width, so a renderer can check its own metrics agree. */
  width?: number;
  font: string;
  size: number;
  /** Horizontal scale, below 1 when the string was condensed to fit. */
  scale?: number;
  color?: string;
  letterSpacing?: number;
  align?: string;
  rotate?: number;
}

export interface MarkOp {
  op: 'mark';
  fieldId?: string;
  shape: 'check' | 'cross' | 'fill';
  x: number; y: number; w: number; h: number;
  color?: string;
  lineWidth?: number;
}

export interface ImageOp {
  op: 'image';
  fieldId?: string;
  href: string;
  x: number; y: number; w: number; h: number;
  fit?: 'contain' | 'cover' | 'fill';
}

export interface BarcodeOp {
  op: 'barcode';
  fieldId?: string;
  symbology: string;
  data: string;
  errorCorrection?: string | number;
  x: number; y: number; w: number; h: number;
}

export type DrawOp = TextOp | MarkOp | ImageOp | BarcodeOp;

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  fieldId?: string | null;
  message: string;
  path?: string;
  value?: unknown;
}

export interface TraceEntry {
  fieldId: string;
  page?: number;
  line?: string;
  path?: string | null;
  raw?: unknown;
  printed?: string;
  redacted?: boolean;
}

export interface PrintPlan {
  printPlan: '1.0';
  generatedAt?: string;
  source?: {
    annotation?: string;
    inheritedFrom?: string[];
    form?: { number?: string; taxYear?: number; revision?: string };
    /** A renderer must refuse to stamp a PDF whose hash differs from a non-null `sha256`. */
    media?: { uri?: string; sha256?: string | null };
  };
  profile?: string | null;
  instance?: { path: string; index: number; count: number } | null;
  units?: 'pt' | 'mm' | 'in';
  pages: Array<{
    index: number;
    width: number;
    height: number;
    origin?: 'top-left' | 'bottom-left';
    ops: DrawOp[];
  }>;
  /** Rows that did not fit their printed slots, for the integrator's continuation sheet. */
  statements?: Array<{ id: string; title?: string; fieldId: string; items: unknown[] }>;
  diagnostics?: Diagnostic[];
  trace?: TraceEntry[];
}
