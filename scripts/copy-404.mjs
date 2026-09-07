import { copyFileSync, existsSync } from 'node:fs';

const src = 'dist/english-career-playbook/browser/index.html';
const dest = 'dist/english-career-playbook/browser/404.html';

if (existsSync(src)) {
  copyFileSync(src, dest);
}
