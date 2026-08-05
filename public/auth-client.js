// public/auth-client.js — client-side auth/session management

const AUTH_KEY = 'ssb_auth';

const AuthClient = {
  // ── Storage ───────────────────────────────────────────────────────────────

  save(token, tenant) {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, tenant }));
  },

  load() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    } catch {
      return null;
    }
  },

  getToken() {
    return this.load()?.token || null;
  },

  getTenant() {
    return this.load()?.tenant || null;
  },

  isLoggedIn() {
    return !!this.getToken();
  },

  logout() {
    localStorage.removeItem(AUTH_KEY);
    window.location.href = '/login.html';
  },

  // ── Headers helper ────────────────────────────────────────────────────────

  authHeaders() {
    const token = this.getToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  },

  // ── Page guards (call early in DOMContentLoaded or inline) ───────────────

  // Hard redirect to login if not logged in, subscribe if no active sub
  async guardPage() {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }

    try {
      const res = await fetch('/api/auth?action=me', {
        headers: { ...this.authHeaders() }
      });

      // 401 → token expired
      if (res.status === 401) {
        this.logout();
        return false;
      }

      const data = await res.json();
      const subStatus = data.subscription?.status;

      if (subStatus !== 'active') {
        window.location.href = '/subscribe.html';
        return false;
      }

      // Expose tenant info to window for pages that need it
      window.__tenant = data.tenant;
      return true;
    } catch {
      // Network error — still allow if token present (optimistic)
      return true;
    }
  },

  // Guard for subscribe page: redirect to app if already subscribed
  async guardSubscribePage() {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }

    try {
      const res = await fetch('/api/auth?action=me', {
        headers: { ...this.authHeaders() }
      });

      if (res.status === 401) {
        this.logout();
        return false;
      }

      const data = await res.json();
      window.__tenant = data.tenant;

      // If already active, go to app
      if (data.subscription?.status === 'active') {
        window.location.href = '/index.html';
        return false;
      }

      return true;
    } catch {
      return true;
    }
  }
};
