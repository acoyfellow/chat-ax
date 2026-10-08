import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
if (!fs.existsSync(root)) process.exit(0);
const visit = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.name === '.dev.vars' || entry.name.startsWith('.dev.vars.')) fs.rmSync(target);
  }
};
visit(root);
const remaining = [];
const verify = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) verify(target);
    else if (entry.name === '.dev.vars' || entry.name.startsWith('.dev.vars.')) remaining.push(target);
  }
};
verify(root);
if (remaining.length) throw new Error('development secret files remain in build output');
