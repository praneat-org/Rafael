/** `--name value`; absent -> default, present without a value -> error. */
export function optArg(argv: string[], n: string, d: string): string {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`--${n} needs a value`);
  return v;
}
