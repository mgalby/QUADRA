// Rigenera src/lib/iconNames.ts dall'elenco delle icone Phosphor installate.
import fs from 'node:fs';
const sel = JSON.parse(fs.readFileSync('node_modules/@phosphor-icons/web/src/regular/selection.json', 'utf8'));
const names = sel.icons.map((i) => i.properties.name.split(',')[0].trim()).sort();
fs.writeFileSync(
  'src/lib/iconNames.ts',
  `// Generato da scripts/make_icon_names.mjs: non modificare a mano.\nexport const ICON_NAMES: readonly string[] = ${JSON.stringify(names.join(' '))}.split(' ');\n`,
);
console.log(names.length, 'icone');
