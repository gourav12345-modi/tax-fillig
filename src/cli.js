#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { loadAnnotation } from './compose.js';
import { plan as makePlan } from './plan.js';
import { lint } from './lint.js';
import { toSvg } from './emit/svg.js';
import { toPdf } from './emit/pdf.js';

const USAGE = `tfa — reference tooling for the Tax Form Annotation spec.

  tfa lint   <annotation.tfa.json>... [--pdf <form.pdf>] [--min-severity info|warning|error]
             Static checks. With --pdf, also verifies the pinned media checksum.

  tfa plan   <annotation.tfa.json> --data <return.json> [--profile <name>] [--instance <n>]
             Print the plan as JSON on stdout.

  tfa trace  <annotation.tfa.json> --data <return.json> [--profile <name>]
             One line per printed value: form line, field, what was printed, where it came from.

  tfa render <annotation.tfa.json> --data <return.json>
             [--out <overlay.pdf>] [--svg <page.svg>] [--plan <plan.json>]
             [--profile <name>] [--instance <n>] [--page <n>] [--strict]
             Render. --out writes a page-sized overlay PDF to composite onto the form
             (see tools/stamp.mjs); --strict turns the first error into a non-zero exit.

Exit codes: 0 clean · 1 diagnostics of severity error · 2 the tool itself failed.`;

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', blue: '\x1b[34m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', blue: '', dim: '', bold: '', off: '' };
const TINT = { error: C.red, warning: C.yellow, info: C.blue };

const OPTIONS = {
  data: { type: 'string' }, profile: { type: 'string' }, instance: { type: 'string' },
  out: { type: 'string' }, svg: { type: 'string' }, plan: { type: 'string' },
  page: { type: 'string' }, pdf: { type: 'string' }, now: { type: 'string' },
  'min-severity': { type: 'string' }, strict: { type: 'boolean' }, stack: { type: 'boolean' },
};

const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); console.log(`  wrote ${file}`); };
const report = (issues, label, minSeverity = 'info') => {
  const floor = { error: 3, warning: 2, info: 1 }[minSeverity] ?? 1;
  for (const i of issues.filter((x) => ({ error: 3, warning: 2, info: 1 })[x.severity] >= floor)) {
    console.log(`  ${TINT[i.severity]}${i.severity.padEnd(7)}${C.off} ${C.dim}${i.code.padEnd(18)}${C.off} ${i.fieldId ?? '-'}: ${i.message}`);
  }
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  console.log(`  ${label}: ${errors} error(s), ${warnings} warning(s), ${issues.length - errors - warnings} note(s)`);
  return errors;
};

const [, , command, ...rest] = process.argv;
let positional = []; let flags = {};

try {
  ({ positionals: positional, values: flags } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true }));

  switch (command) {
    case 'lint': {
      let errors = 0;
      for (const file of positional) {
        console.log(`${C.bold}${file}${C.off}`);
        errors += report(lint(loadAnnotation(file), { pdf: flags.pdf }), 'lint', flags['min-severity'] ?? 'info');
      }
      process.exit(errors ? 1 : 0);
      break;
    }

    case 'plan':
    case 'render': {
      const doc = loadAnnotation(positional[0]);
      if (!flags.data) throw new Error('--data <return.json> is required');
      const data = JSON.parse(readFileSync(flags.data, 'utf8'));
      const printPlan = makePlan(doc, data, {
        profile: flags.profile,
        strict: Boolean(flags.strict),
        instance: flags.instance === undefined ? undefined : Number(flags.instance),
        now: flags.now,
      });

      if (command === 'plan' && !flags.plan) { console.log(JSON.stringify(printPlan, null, 2)); break; }

      const opCount = printPlan.pages.reduce((a, p) => a + p.ops.length, 0);
      console.log(`${C.bold}${doc.id}@${doc.version}${C.off} → ${opCount} draw op(s) across ${printPlan.pages.length} page(s)`
        + `${printPlan.profile ? ` [profile: ${printPlan.profile}]` : ''}`);

      if (flags.plan) write(flags.plan, JSON.stringify(printPlan, null, 2));
      if (flags.out) write(flags.out, toPdf(printPlan));
      if (flags.svg) {
        write(flags.svg, toSvg(printPlan, { pageIndex: Number(flags.page ?? 0) }));
      }
      for (const s of printPlan.statements) console.log(`  ${C.yellow}statement${C.off} ${s.id}: ${s.items.length} overflow item(s)`);
      if (printPlan.diagnostics.length) report(printPlan.diagnostics, 'render');
      process.exit(printPlan.diagnostics.some((d) => d.severity === 'error') ? 1 : 0);
      break;
    }

    case 'trace': {
      const doc = loadAnnotation(positional[0]);
      const data = JSON.parse(readFileSync(flags.data, 'utf8'));
      const printPlan = makePlan(doc, data, {
        profile: flags.profile,
        instance: flags.instance === undefined ? undefined : Number(flags.instance),
        trace: true,
      });
      const rows = printPlan.trace.filter((t) => !t.fieldId.includes('#c') || t.fieldId.endsWith('#c0'));
      console.log(`${C.bold}line   field                          printed          from${C.off}`);
      for (const t of rows) {
        console.log(`${String(t.line ?? '').padEnd(6)} ${t.fieldId.slice(0, 30).padEnd(30)} ${String(t.printed).slice(0, 16).padEnd(16)} ${C.dim}${t.path ?? ''}${C.off}`);
      }
      break;
    }

    default:
      console.log(USAGE);
      process.exit(command ? 1 : 0);
  }
} catch (e) {
  console.error(`${C.red}${e.name ?? 'Error'}${C.off}: ${e.message}`);
  if (flags.stack) console.error(e.stack);
  process.exit(2);
}
