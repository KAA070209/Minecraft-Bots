const mc = require('minecraft-protocol');

const host = process.argv[2] || 'minesive.com';
const port = parseInt(process.argv[3] || '25565', 10);

const timer = setTimeout(() => {
  console.log('PING TIMEOUT (no status response from server)');
  process.exit(1);
}, 20000);

mc.ping({ host, port, closeTimeout: 2000 })
  .then((data) => {
    clearTimeout(timer);
    console.log('=== ' + host + ':' + port + ' ===');
    console.log(JSON.stringify(data, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    clearTimeout(timer);
    console.log('PING ERROR:', err.message);
    process.exit(1);
  });
