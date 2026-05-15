import axios from 'axios';

const DO_BASE_URL = 'https://api.digitalocean.com/v2';

/**
 * Thin axios-based wrapper around the DigitalOcean v2 REST API. Each instance
 * is bound to a single API token so it can be safely used per request.
 *
 * Docs: https://docs.digitalocean.com/reference/api/reference/
 */
export class DigitalOceanClient {
  constructor(apiToken, { timeout = 20_000 } = {}) {
    if (!apiToken) throw new Error('DigitalOceanClient: apiToken is required');
    this.http = axios.create({
      baseURL: DO_BASE_URL,
      timeout,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      validateStatus: (status) => status >= 200 && status < 500,
    });
  }

  async #request(method, url, { params, data } = {}) {
    const res = await this.http.request({ method, url, params, data });
    if (res.status >= 400) {
      const message = res.data?.message || res.data?.id || `DO API error ${res.status}`;
      const err = new Error(`DigitalOcean: ${message}`);
      err.status = res.status;
      err.body = res.data;
      throw err;
    }
    return res.data;
  }

  // ---------- Account ----------
  account() {
    return this.#request('GET', '/account');
  }

  balance() {
    return this.#request('GET', '/customers/my/balance');
  }

  // ---------- Regions / Sizes ----------
  regions() {
    return this.#request('GET', '/regions', { params: { per_page: 200 } });
  }

  sizes() {
    return this.#request('GET', '/sizes', { params: { per_page: 200 } });
  }

  // ---------- Images ----------
  distributionImages() {
    return this.#request('GET', '/images', {
      params: { type: 'distribution', per_page: 200 },
    });
  }

  applicationImages() {
    return this.#request('GET', '/images', {
      params: { type: 'application', per_page: 200 },
    });
  }

  // ---------- SSH keys ----------
  listSshKeys() {
    return this.#request('GET', '/account/keys', { params: { per_page: 200 } });
  }

  createSshKey({ name, publicKey }) {
    return this.#request('POST', '/account/keys', {
      data: { name, public_key: publicKey },
    });
  }

  // ---------- Droplets ----------
  listDroplets({ page = 1, perPage = 50 } = {}) {
    return this.#request('GET', '/droplets', {
      params: { page, per_page: perPage },
    });
  }

  getDroplet(id) {
    return this.#request('GET', `/droplets/${id}`);
  }

  createDroplet(payload) {
    return this.#request('POST', '/droplets', { data: payload });
  }

  deleteDroplet(id) {
    return this.#request('DELETE', `/droplets/${id}`);
  }

  dropletAction(id, action) {
    return this.#request('POST', `/droplets/${id}/actions`, { data: action });
  }
}

/**
 * Verifies a token by calling /account. Returns the account object on success.
 */
export async function verifyToken(token) {
  const client = new DigitalOceanClient(token);
  const data = await client.account();
  return data?.account ?? null;
}
