(function exposeYouTrackAuth(root) {
  "use strict";

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function randomValue(cryptoApi = root.crypto, size = 32) {
    if (!cryptoApi?.getRandomValues || !Number.isSafeInteger(size) || size < 16 || size > 96) throw new Error("Безопасный генератор недоступен");
    const bytes = new Uint8Array(size);
    cryptoApi.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function challenge(verifier, cryptoApi = root.crypto) {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(String(verifier || "")) || !cryptoApi?.subtle?.digest) throw new Error("Не удалось подготовить PKCE");
    const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  function authorizationUrl(options) {
    const endpoint = new URL(`${String(options.hubUrl || "").replace(/\/$/, "")}/api/rest/oauth2/auth`);
    const clientId = String(options.clientId || "").trim(), scope = String(options.scope || "").trim();
    if (!clientId || clientId.length > 200 || !scope || scope.length > 500) throw new Error("Нужны Client ID и scope сервиса YouTrack");
    endpoint.searchParams.set("response_type", "code");
    endpoint.searchParams.set("client_id", clientId);
    endpoint.searchParams.set("scope", scope);
    endpoint.searchParams.set("redirect_uri", String(options.redirectUri || ""));
    endpoint.searchParams.set("state", String(options.state || ""));
    endpoint.searchParams.set("request_credentials", "skip");
    endpoint.searchParams.set("access_type", "online");
    endpoint.searchParams.set("code_challenge", String(options.codeChallenge || ""));
    endpoint.searchParams.set("code_challenge_method", "S256");
    return endpoint.toString();
  }

  function readCallback(callbackUrl, redirectUri, expectedState) {
    const actual = new URL(callbackUrl), expected = new URL(redirectUri);
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) throw new Error("OAuth вернул неожиданный redirect URI");
    if (actual.searchParams.get("state") !== expectedState) throw new Error("OAuth state не совпал");
    const error = actual.searchParams.get("error");
    if (error) throw new Error(`YouTrack OAuth: ${error}`);
    const code = actual.searchParams.get("code");
    if (!code || code.length > 4096) throw new Error("YouTrack не вернул authorization code");
    return code;
  }

  function tokenRequest(options) {
    const endpoint = new URL(`${String(options.hubUrl || "").replace(/\/$/, "")}/api/rest/oauth2/token`);
    const body = new URLSearchParams({
      grant_type: "authorization_code", code: String(options.code || ""),
      redirect_uri: String(options.redirectUri || ""), code_verifier: String(options.verifier || ""),
      client_id: String(options.clientId || "")
    });
    return { endpoint:endpoint.toString(), body:body.toString() };
  }

  function parseToken(value, now = Date.now()) {
    if (!value || typeof value !== "object" || typeof value.access_token !== "string" || !value.access_token || value.access_token.length > 8192) {
      throw new Error("YouTrack вернул некорректный access token");
    }
    const expires = Number(value.expires_in);
    return { accessToken:value.access_token, expiresAt:Number.isFinite(expires) && expires > 0 ? now + Math.min(expires, 86400) * 1000 : null };
  }

  const api = Object.freeze({ base64Url, randomValue, challenge, authorizationUrl, readCallback, tokenRequest, parseToken });
  root.YouTrackAuth = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);

