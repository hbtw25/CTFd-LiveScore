const API_BASE = "https://adikara.online/api/v1";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

function buildAuthHeader(token) {
  if (!token) return null;
  if (/^(Token|Bearer)\s/i.test(token)) return token;
  return `Token ${token}`;
}

function buildQuery(params) {
  const search = new URLSearchParams();
  if (!params) return "";
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    search.append(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : "";
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      },
      body: "",
    };
  }

  const splat = event.pathParameters?.splat || "";
  const query = buildQuery(event.queryStringParameters);
  const url = `${API_BASE}/${splat}${query}`;

  const headers = {};
  Object.entries(event.headers || {}).forEach(([key, value]) => {
    if (!value) return;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) return;
    if (lower === "accept-encoding") return;
    headers[key] = value;
  });

  if (!headers.Authorization && !headers.authorization) {
    const token = event.queryStringParameters?.token || event.queryStringParameters?.access_token;
    const auth = buildAuthHeader(token);
    if (auth) headers.Authorization = auth;
  }

  const options = {
    method: event.httpMethod,
    headers,
  };

  if (!("GET" === event.httpMethod || "HEAD" === event.httpMethod)) {
    if (event.body) {
      options.body = event.isBase64Encoded
        ? Buffer.from(event.body, "base64")
        : event.body;
    }
  }

  try {
    const response = await fetch(url, options);
    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer).toString("base64");
    const responseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization,Content-Type",
    };
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      responseHeaders[key] = value;
    });

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
      isBase64Encoded: true,
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({
        error: "Proxy request failed",
      }),
    };
  }
};
