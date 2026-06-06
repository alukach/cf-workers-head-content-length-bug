/**
 * Cloudflare Worker POC: return a fixed response that advertises Content-Length
 * on both GET and HEAD.
 *
 * There is no upstream and no proxying — the body and its byte length are
 * hard-coded here, so the Worker unambiguously sets `Content-Length` itself.
 * Over HTTP/2 both responses carry the header; over HTTP/3 Cloudflare's edge
 * strips it from the HEAD response. See the README.
 */

const BODY = "Hello from a Cloudflare Worker.\n";
const CONTENT_LENGTH = String(new TextEncoder().encode(BODY).byteLength);

export default {
  async fetch(request: Request): Promise<Response> {
    const headers = {
      "content-type": "text/plain; charset=utf-8",
      "content-length": CONTENT_LENGTH,
    };

    // HEAD carries no body but still advertises the size.
    if (request.method === "HEAD") {
      return new Response(null, { headers });
    }

    return new Response(BODY, { headers });
  },
};
