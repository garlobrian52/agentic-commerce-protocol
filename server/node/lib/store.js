'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Lightweight JSON file store for Stripe resource IDs associated with sellers.
 * Replace with your primary datastore in production.
 */
class SellerStore {
  constructor(filePath = path.join(__dirname, '..', 'data', 'sellers.json')) {
    this.filePath = filePath;
    this._ensureFile();
  }

  _ensureFile() {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ sellers: {} }, null, 2));
    }
  }

  _read() {
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  _write(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  getSeller(sellerId) {
    const data = this._read();
    return data.sellers[sellerId] || null;
  }

  upsertSeller(sellerId, fields) {
    const data = this._read();
    const existing = data.sellers[sellerId] || { id: sellerId, createdAt: new Date().toISOString() };
    data.sellers[sellerId] = {
      ...existing,
      ...fields,
      updatedAt: new Date().toISOString(),
    };
    this._write(data);
    return data.sellers[sellerId];
  }

  findByAccountId(accountId) {
    const data = this._read();
    return Object.values(data.sellers).find((seller) => seller.accountId === accountId) || null;
  }

  listSellers() {
    return Object.values(this._read().sellers);
  }
}

module.exports = { SellerStore };
