# cf-workers-head-content-length-bug

A minimal Cloudflare Worker that returns a **fixed** response advertising
`Content-Length` on both GET and HEAD. There is no upstream and no proxying — the
body (`"Hello from a Cloudflare Worker.\n"`, 32 bytes) and its length are
hard-coded:

- **GET** returns the 32-byte body with `content-length: 32`.
- **HEAD** returns no body but the same `content-length: 32` header.

Because the Worker sets `Content-Length` itself, with nothing else in the path,
any time it goes missing it is unambiguously Cloudflare's doing — see below.

## The bug this repros

The Worker sets `Content-Length` on its HEAD response. But Cloudflare **drops
`Content-Length` from HEAD responses served over HTTP/3** — the same request
over HTTP/2 keeps it. The bug is in Cloudflare's HTTP/3 edge layer, not the
Worker (the value clearly survives over h2).

The cleanest way to see it is to hit the same deployed Worker twice, forcing a
different protocol each time. We use the `ymuski/curl-http3` image because it
ships a curl built with HTTP/3 support:

### HTTP/3 — `content-length` is MISSING

```console
$ docker run --rm --platform linux/amd64 ymuski/curl-http3 \
    curl --http3 -sI https://cf-parquet-stream-poc.alukach.workers.dev
HTTP/3 200
content-type: text/plain; charset=utf-8
server: cloudflare
...
```

### HTTP/2 — `content-length` is PRESENT

```console
$ docker run --rm --platform linux/amd64 ymuski/curl-http3 \
    curl --http2 -sI https://cf-parquet-stream-poc.alukach.workers.dev
HTTP/2 200
content-type: text/plain; charset=utf-8
content-length: 32
server: cloudflare
...
```

Same Worker, same URL, same `HEAD` method — the only difference is `--http3` vs
`--http2`, and only the h3 response is missing `content-length`.

> The h3/h2 outputs above are the expected shape. They were originally captured
> against an S3-proxying version of this Worker (which reported
> `content-length: 4873129725`); after switching to the fixed 32-byte response,
> redeploy and re-run the two commands to capture fresh output.

## Why this is a bug, per spec

HTTP semantics are defined in [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110),
and they are the same regardless of the wire protocol:

> All three major versions of HTTP rely on the semantics defined by this document.
>
> — RFC 9110, [Abstract](https://www.rfc-editor.org/rfc/rfc9110#name-abstract)

So a HEAD response must mean the same thing over HTTP/3 as over HTTP/2 — the edge
isn't free to drop a header just because the transport changed.

**[§9.3.2, HEAD](https://www.rfc-editor.org/rfc/rfc9110#section-9.3.2)** says a
HEAD response should carry the same headers as the equivalent GET:

> The server SHOULD send the same header fields in response to a HEAD request as
> it would have sent if the request method had been GET. However, a server MAY
> omit header fields for which a value is determined only while generating the
> content.

This Worker's GET returns `content-length: 32`, so the HEAD should too. The "MAY
omit" escape hatch does not apply: the length is a hard-coded constant, not a
value "determined only while generating the content."

**[§8.6, Content-Length](https://www.rfc-editor.org/rfc/rfc9110#section-8.6)**
explicitly sanctions `Content-Length` on a HEAD response and pins its value:

> A server MAY send a Content-Length header field in a response to a HEAD
> request; a server MUST NOT send Content-Length in such a response unless its
> field value equals the decimal number of octets that would have been sent in
> the content of a response if the same request had used the GET method.

The HTTP/2 response does exactly this — `content-length: 32` equals the GET
body's size. The HTTP/3 response, for the identical request, omits it. Dropping
the header isn't itself a hard violation of a `MUST`, but doing it on h3 while
honoring it on h2 contradicts the version-independence the spec is built on, and
defeats the entire purpose of HEAD: cheaply learning a resource's size without
downloading it.

## Run locally

```sh
npm install
npm run dev        # wrangler dev, defaults to http://localhost:8787
```

Test it:

```sh
# Headers + size
curl -sI http://localhost:8787 | grep -i content-length

# Body
curl -s http://localhost:8787
```

> [!NOTE] 
> the `Content-Length`-on-HEAD bug only appears at Cloudflare's edge over
> HTTP/3 — `wrangler dev` on localhost won't reproduce it. See
> [The bug this repros](#the-bug-this-repros) for the deployed h3-vs-h2 commands.

## Deploy

```sh
npm run deploy
```
