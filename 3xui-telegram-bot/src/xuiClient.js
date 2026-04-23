const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

function normalizeBaseUrl(input) {
  return String(input || '').replace(/\/+$/, '');
}

function buildUrl(baseUrl, webBasePath, path) {
  const base = normalizeBaseUrl(baseUrl);
  const wbp = String(webBasePath || '').trim();
  if (!wbp) return base + path;
  const p = wbp.startsWith('/') ? wbp : '/' + wbp;
  return base + p.replace(/\/+$/, '') + path;
}

function parseInboundClients(inbound) {
  let clients = [];

  try {
    if (inbound && inbound.settings) {
      const settings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
      if (settings && Array.isArray(settings.clients)) clients = settings.clients;
    }
  } catch (_) {}

  if (!clients.length && inbound && Array.isArray(inbound.clients)) {
    clients = inbound.clients;
  }

  return Array.isArray(clients) ? clients : [];
}

function findStatForClient(inbound, client) {
  const stats = inbound && Array.isArray(inbound.clientStats) ? inbound.clientStats : [];
  if (!stats.length || !client) return null;

  const email = client.email ? String(client.email) : null;
  const clientId = client.id || client.uuid ? String(client.id || client.uuid).toLowerCase() : null;
  const password = client.password ? String(client.password) : null;

  return stats.find((item) => {
    const itemEmail = item && item.email ? String(item.email) : null;
    const itemId = item && (item.id || item.uuid) ? String(item.id || item.uuid).toLowerCase() : null;
    const itemPassword = item && item.password ? String(item.password) : null;

    if (email && itemEmail && itemEmail === email) return true;
    if (clientId && itemId && itemId === clientId) return true;
    if (password && itemPassword && itemPassword === password) return true;
    return false;
  }) || null;
}

class XUI {
  constructor({ baseUrl, webBasePath, username, password, timeoutMs = 15000 }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.webBasePath = String(webBasePath || '').trim();
    this.username = username;
    this.password = password;
    this.jar = new CookieJar();
    this.http = wrapper(axios.create({
      timeout: timeoutMs,
      jar: this.jar,
      withCredentials: true,
      validateStatus: (s) => s >= 200 && s < 500,
    }));
  }

  async login() {
    const url = buildUrl(this.baseUrl, this.webBasePath, '/login');
    const res = await this.http.post(url, { username: this.username, password: this.password }, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (res.status !== 200) {
      throw new Error(`Login failed HTTP ${res.status}`);
    }
    if (res.data && res.data.success === false) {
      throw new Error(`Login failed: ${res.data.msg || 'unknown'}`);
    }
    return true;
  }

  async listInbounds() {
    const url = buildUrl(this.baseUrl, this.webBasePath, '/xui/API/inbounds/list');
    const res = await this.http.get(url);
    if (res.status !== 200) throw new Error(`listInbounds HTTP ${res.status}`);
    const data = res.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.obj)) return data.obj;
    return [];
  }

  async listClientsDetailed() {
    const inbounds = await this.listInbounds();
    const items = [];

    for (const inbound of inbounds) {
      const clients = parseInboundClients(inbound);
      for (const client of clients) {
        items.push({
          inbound,
          client,
          stat: findStatForClient(inbound, client),
        });
      }
    }

    return items;
  }

  async findClient({ uuid, trojanPassword }) {
    const items = await this.listClientsDetailed();

    for (const item of items) {
      const c = item.client || {};
      const clientId = c.id || c.uuid ? String(c.id || c.uuid).toLowerCase() : '';
      const password = c.password ? String(c.password) : '';

      if (uuid && clientId === String(uuid).toLowerCase()) return item;
      if (trojanPassword && password === String(trojanPassword)) return item;
    }

    return null;
  }
}

module.exports = { XUI, normalizeBaseUrl, buildUrl, parseInboundClients, findStatForClient };
