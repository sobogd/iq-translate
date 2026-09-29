import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(root, '..', 'lib', 'languages.ts'), 'utf8');

const match = source.match(/export const LANGUAGES: Language\[\] = \[([\s\S]*?)\n\];/);
if (!match) throw new Error('LANGUAGES array not found in lib/languages.ts');

const arraySource = `[${match[1]}]`;
// The array body is valid JavaScript: TS types live on the interface above it.
const languages = eval(arraySource); // eslint-disable-line no-eval

const out = path.join(root, '..', 'flutter', 'assets', 'languages.json');
writeFileSync(out, JSON.stringify(languages, null, 2) + '\n');
console.log(`wrote ${out} (${languages.length} languages)`);
