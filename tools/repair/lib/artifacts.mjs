import { join } from 'node:path';

/* artifacts.mjs — output path helpers. All stage artifacts live in one outDir,
 * named by `<name>.report.txt`, `<name>_base.report.txt`, `<name>.prompt.txt`,
 * `<name>.req.json`, `<name>.raw.json`, `<name>.content.txt`, `<name>.usage.json`. */
export const baseReportPath = (out, name) => join(out, `${name}_base.report.txt`);
export const reportPath = (out, name) => join(out, `${name}.report.txt`);
export const promptPath = (out, name) => join(out, `${name}.prompt.txt`);
export const reqPath = (out, name) => join(out, `${name}.req.json`);
export const rawPath = (out, name) => join(out, `${name}.raw.json`);
export const contentPath = (out, name) => join(out, `${name}.content.txt`);
export const usagePath = (out, name) => join(out, `${name}.usage.json`);
