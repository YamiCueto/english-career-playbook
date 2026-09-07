import fs from 'node:fs';

const isStrict = process.argv.includes('--strict') || process.argv.includes('--require-production');

const url = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const key = process.env.SUPABASE_ANON_KEY ? process.env.SUPABASE_ANON_KEY.trim() : '';

if (isStrict) {
  if (!url || !key) {
    console.error('Production deployment error: SUPABASE_URL and SUPABASE_ANON_KEY are required.');
    process.exit(1);
  }
}

if (url && !url.startsWith('https://') && !url.startsWith('http://')) {
  console.error('Configuration error: SUPABASE_URL must begin with http:// or https://');
  process.exit(1);
}

const content = `export const environment = {
  production: true,
  supabaseUrl: '${url}',
  supabaseAnonKey: '${key}',
};
`;

fs.writeFileSync('src/environments/environment.ts', content, 'utf8');

if (url && key) {
  console.log(`Supabase environment injected successfully: url=${url}`);
} else {
  console.log('Supabase environment generated with local-first fallback mode.');
}
