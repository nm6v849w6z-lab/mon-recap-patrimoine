const fs = require('fs');
const path = require('path');
const os = require('os');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');

function getLanAddresses() {
  const nets = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

// Genere (ou reutilise) un certificat auto-signe couvrant localhost, 127.0.0.1
// et les adresses IP locales detectees, pour pouvoir servir l'appli en HTTPS
// sur le reseau wifi local. Le navigateur affichera un avertissement "connexion
// non securisee" la premiere fois : c'est normal pour un certificat auto-signe
// (non reconnu par une autorite publique), pas un signe de compromission.
function getOrCreateCertificate() {
  if (fs.existsSync(CERT_PATH) && fs.existsSync(KEY_PATH)) {
    return { cert: fs.readFileSync(CERT_PATH), key: fs.readFileSync(KEY_PATH) };
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });

  const altNames = [
    { type: 2, value: 'localhost' }, // DNS
    { type: 7, ip: '127.0.0.1' }, // IP
    ...getLanAddresses().map((ip) => ({ type: 7, ip })),
  ];

  const attrs = [{ name: 'commonName', value: 'grand-livre.local' }];
  const pems = selfsigned.generate(attrs, {
    days: 825,
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });

  fs.writeFileSync(CERT_PATH, pems.cert, { mode: 0o600 });
  fs.writeFileSync(KEY_PATH, pems.private, { mode: 0o600 });

  return { cert: pems.cert, key: pems.private };
}

module.exports = { getOrCreateCertificate, getLanAddresses };
