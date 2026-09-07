import fs from 'node:fs';

const envLocalPath = '.env.local';
const targetFile = 'src/environments/environment.local.ts';

let url = '';
let key = '';

if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (k === 'SUPABASE_URL') {
        url = v;
      } else if (k === 'SUPABASE_ANON_KEY') {
        key = v;
      }
    }
  }
}

const content = `export const environment = {
  production: false,
  supabaseUrl: '${url}',
  supabaseAnonKey: '${key}',
};
`;

fs.writeFileSync(targetFile, content, 'utf8');
console.log(`Local environment prepared: url=${url ? 'configured' : 'empty'}, key=${key ? 'configured' : 'empty'}`);
