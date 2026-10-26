/** `--name value` or `--name=value`; absent -> default, present without a value -> error.
 * A value starting with `--` must use the `=` form (`--out=--report.md`). */
export function optArg(argv: string[], n: string, d: string): string {
  const eq = argv.find((a) => a.startsWith(`--${n}=`));
  if (eq !== undefined) {
    const v = eq.slice(n.length + 3);
    if (!v) throw new Error(`--${n} needs a value`);
    return v;
  }
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${n} needs a value`);
  return v;
}
