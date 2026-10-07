import { cp, mkdir, access } from 'node:fs/promises';
await access(new URL('../public/index.html', import.meta.url));
await mkdir(new URL('../dist/public/', import.meta.url), { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('../dist/public/', import.meta.url), { recursive: true });
console.log('Built server and local browser assets. No deployment performed.');
