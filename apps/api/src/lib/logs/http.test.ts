import { describe, expect, it } from "bun:test";

import { unanswered } from "./http.ts";

// #92, E1 (docs/decisions/2026-10-10-elasticsearch.md): a self-hosted Elasticsearch 8 signs its
// own certificate, so a refused certificate says to set the CA rather than "did not answer".
describe("a call that got no answer", () => {
  it("names an untrusted certificate and its fix", () => {
    expect(
      unanswered(
        "Elasticsearch",
        "es:9200",
        "TypeError: self signed certificate in certificate chain"
      ).message
    ).toBe("Elasticsearch's certificate is not trusted: set the adapter's CA");
  });

  it("passes anything else through", () => {
    expect(unanswered("Loki", "loki:3100", "ECONNREFUSED").message).toBe(
      "Loki did not answer: ECONNREFUSED"
    );
  });
});
