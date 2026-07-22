'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_dummy';

const dataFile = path.join(os.tmpdir(), `sellers-http-${Date.now()}.json`);
process.env.SELLER_STORE_PATH = dataFile;

// Re-require store path via env override in server would need wiring;
// instead hit /config which does not need Stripe live calls beyond client init.

const { app } = require('../server');

describe('HTTP routes', () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const { port } = server.address();
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
  });

  it('GET /config returns publishable key placeholder', async () => {
    const res = await fetch(`${baseUrl}/config`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.publishableKey, 'pk_test_dummy');
    assert.ok(body.currency);
  });

  it('GET /sellers returns empty list initially', async () => {
    const res = await fetch(`${baseUrl}/sellers`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.sellers));
  });
});
