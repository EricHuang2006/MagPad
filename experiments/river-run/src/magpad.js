// Wire format is shared with firmware/live.c (USB, 115200 8N1).
export function parseFrame(line) {
  const parts = line.trim().split(',');
  if (parts.length !== 9 || parts[0] !== 'P' ||
      !parts.slice(1).every(value => /^-?\d+$/.test(value))) return null;
  const [, , , token, state, x, y] = parts.map(Number);
  if (token < 0 || token > 255 || state < 0 || state > 4) return null;
  return {token, state, x: x / 100, y: y / 100};
}

export class MagPad {
  constructor() {
    this.port = null;
    this.status = '';
    this.reset();
  }

  reset() {
    this.token = null;
    this.seenToken = null;
    this.state = 0;
    this.lastFrame = -Infinity;
    this.x = this.y = 0;
  }

  async connect() {
    const port = await navigator.serial.requestPort();
    await port.open({baudRate:115200});
    this.reset();
    this.port = port;
    this.status = 'Waiting for live firmware frames.';
    this.reader = port.readable.getReader();
    this.task = this.read(port);
  }

  async read(port) {
    const decoder = new TextDecoder();
    let tail = '';
    try {
      while (true) {
        const {value, done} = await this.reader.read();
        if (done) break;
        const lines = (tail + decoder.decode(value, {stream:true})).split('\n');
        tail = lines.pop();
        if (tail.length > 1024) tail = '';
        for (const line of lines) {
          const f = parseFrame(line);
          if (!f) continue;
          this.seenToken = f.token;
          if (this.token === null) {
            this.status = 'Move the magnet away, then measure background.';
            continue;
          }
          if (f.token !== this.token) {
            if (f.state === 0 && f.token === 0) {
              this.state = 0;
              this.status = 'Board needs a background. Move magnet away and measure again.';
            }
            continue;
          }
          this.state = f.state;
          this.x = f.x; this.y = f.y;
          this.lastFrame = performance.now();
          this.status = ['Measure background.', 'Measuring background. Keep the magnet away.',
            'Background ready. Place the magnet on the pad.', 'Magnet tracking.',
            'Sensor error. Check the board.'][f.state];
        }
      }
    } catch (error) {
      this.status = 'Serial connection lost. ' + error.message;
    } finally {
      this.reader.releaseLock();
      try { await port.close(); } catch { /* An unplugged port may already be closed. */ }
      this.port = null;
      this.reset();
    }
  }

  async measure() {
    if (!this.port || this.seenToken === null) return;
    const salt = crypto.getRandomValues(new Uint8Array(1))[0];
    const token = 1 + ((this.seenToken + salt % 254) % 255);
    this.state = 0; this.lastFrame = -Infinity; this.token = token;
    this.status = 'Waiting for the board. Keep the magnet away.';
    const writer = this.port.writable.getWriter();
    try { await writer.write(Uint8Array.of(token)); }
    finally { writer.releaseLock(); }
  }

  tracking(now) {
    return this.port !== null && this.state === 3 && now - this.lastFrame < 350;
  }

  async close() {
    if (!this.port) return;
    try { await this.reader.cancel(); } finally { await this.task; }
  }
}
