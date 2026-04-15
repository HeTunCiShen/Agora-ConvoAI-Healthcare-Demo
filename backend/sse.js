// backend/sse.js
const clients = new Set();

function addClient(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.on('close', () => clients.delete(res));
}

function broadcast(eventType, payload) {
  const data = JSON.stringify({ type: eventType, ...payload });
  for (const client of clients) {
    client.write(`data: ${data}\n\n`);
  }
}

function getClientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, getClientCount };
