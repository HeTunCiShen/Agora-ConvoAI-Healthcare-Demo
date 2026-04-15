const sse = require('../backend/sse');

function makeMockRes() {
  const written = [];
  const headers = {};
  let closeHandler = null;
  return {
    setHeader: (k, v) => { headers[k] = v; },
    flushHeaders: () => {},
    write: (data) => { written.push(data); },
    on: (event, fn) => { if (event === 'close') closeHandler = fn; },
    _written: written,
    _headers: headers,
    _close: () => { if (closeHandler) closeHandler(); }
  };
}

describe('SSE manager', () => {
  test('sets SSE headers when client connects', () => {
    const res = makeMockRes();
    sse.addClient(res);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
    expect(res._headers['Cache-Control']).toBe('no-cache');
    res._close();
  });

  test('broadcast sends formatted data to connected clients', () => {
    const res = makeMockRes();
    sse.addClient(res);
    sse.broadcast('new_summary', { id: 'sum-1' });
    expect(res._written[0]).toContain('new_summary');
    expect(res._written[0]).toContain('sum-1');
    expect(res._written[0]).toMatch(/^data: .+\n\n$/);
    res._close();
  });

  test('removes client on connection close', () => {
    const res = makeMockRes();
    const before = sse.getClientCount();
    sse.addClient(res);
    expect(sse.getClientCount()).toBe(before + 1);
    res._close();
    expect(sse.getClientCount()).toBe(before);
  });
});
