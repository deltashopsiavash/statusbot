const { Buffer } = require('buffer');

function extractUuid(text) {
  const m = text.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}/);
  return m ? m[0] : null;
}

function parseVmess(text) {
  // vmess://BASE64(JSON)
  const m = text.trim().match(/^vmess:\/\/(.+)$/i);
  if (!m) return null;
  const b64 = m[1].trim();
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    // Common field: id
    if (obj && obj.id) return { uuid: String(obj.id) };
  } catch (_) {}
  return null;
}

function parseTrojan(text) {
  // trojan://password@host:port?....
  const m = text.trim().match(/^trojan:\/\/([^@]+)@/i);
  if (!m) return null;
  return { trojanPassword: m[1] };
}

function parseVless(text) {
  // vless://uuid@host:port?....
  const m = text.trim().match(/^vless:\/\/([^@]+)@/i);
  if (!m) return null;
  const maybe = m[1];
  const uuid = extractUuid(maybe) || maybe;
  return { uuid };
}

function parseAnySubscriptionLink(text) {
  // If it's a "subscription URL" we likely can't fetch it (might need outbound internet),
  // but often it contains uuid inside. We'll just attempt extraction.
  const uuid = extractUuid(text);
  if (uuid) return { uuid };

  return parseVmess(text) || parseVless(text) || parseTrojan(text) || null;
}

module.exports = {
  extractUuid,
  parseAnySubscriptionLink
};
