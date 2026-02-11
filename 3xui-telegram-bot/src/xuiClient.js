const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

function normalizeBaseUrl(input) {
  // input: http(s)://IP:PORT
  return input.replace(/\/+$/, '');
}

function buildUrl(baseUrl, webBasePath, path) {
  const base = normalizeBaseUrl(baseUrl);
  const wbp = (webBasePath || '').trim();
  if (!wbp) return base + path;
  const p = wbp.startsWith('/') ? wbp : '/' + wbp;
  return base + p.replace(/\/+$/, '') + path;
}

class XUI {
  constructor({ baseUrl, webBasePath, username, password, timeoutMs = 15000 }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.webBasePath = (webBasePath || '').trim();
    this.username = username;
    this.password = password;
    this.jar = new CookieJar();
    this.http = wrapper(axios.create({
      timeout: timeoutMs,
      jar: this.jar,
      withCredentials: true,
      validateStatus: (s) => s >= 200 && s < 500
    }));
  }

  async login() {
    const url = buildUrl(this.baseUrl, this.webBasePath, '/login');
    const res = await this.http.post(url, { username: this.username, password: this.password }, {
      headers: { 'Content-Type': 'application/json' }
    });

    // Many 3x-ui responses: {success:true,msg:""} or status 200 with cookie set.
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
    // common shapes:
    // {success:true,obj:[...]}
    // or direct array
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.obj)) return data.obj;
    return [];
  }

  /**
   * Find client by:
   * - uuid (vless/vmess): client.id or client.uuid
   * - trojan password: client.password
   */
  async findClient({ uuid, trojanPassword }) {
    const inbounds = await this.listInbounds();

    for (const inbound of inbounds) {
      // Parse clients from inbound.settings (json string) if present
      let clients = [];
      try {
        if (inbound && inbound.settings) {
          const settings = typeof inbound.settings === 'string' ? JSON.parse(inbound.settings) : inbound.settings;
          if (settings && Array.isArray(settings.clients)) clients = settings.clients;
        }
      } catch (_) {}

      // Some versions include clients directly
      if (!clients.length && inbound && Array.isArray(inbound.clients)) clients = inbound.clients;

      // Try match
      let matched = null;
      for (const c of clients) {
        const cid = (c && (c.id || c.uuid)) ? String(c.id || c.uuid).toLowerCase() : '';
        const cpass = (c && c.password) ? String(c.password) : '';
        if (uuid && cid === uuid.toLowerCase()) { matched = c; break; }
        if (trojanPassword && cpass === trojanPassword) { matched = c; break; }
      }
      if (!matched) continue;

      // Traffic stats: usually inbound.clientStats array with email/up/down/total
      let stat = null;
      const email = matched.email ? String(matched.email) : null;
      if (inbound && Array.isArray(inbound.clientStats) && email) {
        stat = inbound.clientStats.find(s => String(s.email) === email) || null;
      }

      return { inbound, client: matched, stat };
    }

    return null;
  }
}

module.exports = { XUI };
