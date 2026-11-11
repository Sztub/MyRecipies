// `npm run dev:phone` – HTTPS dev server on the LAN for testing on a real phone.
// Self-signed certificate (the phone shows a warning once). Port: PORT env var, default 5173.
import { networkInterfaces } from 'node:os';
import { createServer } from 'vite';
import qrcode from 'qrcode-terminal';

process.env.DEV_PHONE = '1'; // makes vite.config.ts add basic-ssl + host: true

const port = Number(process.env.PORT ?? 5173);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

const server = await createServer({ server: { port, strictPort: true } });
await server.listen();

const base = server.config.base;
const ips = lanAddresses();
console.log('\nPhone dev server is running (HTTPS, self-signed certificate).');
if (ips.length === 0) {
  console.log('No LAN address found – is this PC connected to Wi-Fi/Ethernet?');
} else {
  for (const ip of ips) {
    const url = `https://${ip}:${port}${base}`;
    console.log(`\nOpen on your phone: ${url}`);
    qrcode.generate(url, { small: true });
  }
  console.log('\nPhone and PC must be on the same network. Accept the certificate warning once.');
}
console.log('Android via USB instead: see README.md, "Testing on a phone". Ctrl+C stops.\n');

const stop = () => void server.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
