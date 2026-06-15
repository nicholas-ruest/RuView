import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  commissionMatter,
  configureEcosystems,
  getStatus,
  pairApple,
  setPrivacy,
} from "./ecosystems";

function mockFetchOnce(status: number, body: unknown) {
  const json = typeof body === "string" ? body : JSON.stringify(body);
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    text: () => Promise.resolve(json),
  } as unknown as Response);
}

describe("ecosystems API client", () => {
  beforeEach(() => {
    configureEcosystems({ baseUrl: "http://test.local:8123", token: "tok-123" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok data on 200 GET /status and sends the bearer token", async () => {
    const fetchMock = mockFetchOnce(200, {
      ecosystems: [{ id: "apple_home", protocol: "hap-1.1", pairing: "paired" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getStatus();

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.ecosystems[0].id).toBe("apple_home");
    }
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://test.local:8123/api/v1/ecosystems/status");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok-123",
    });
  });

  it("maps a 409 hap_server_disabled body to a typed error (does not throw)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(409, {
        error: "hap_server_disabled",
        message: "homecore-hap built without the hap-server feature",
      }),
    );

    const res = await pairApple();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.status).toBe(409);
      expect(res.error.error).toBe("hap_server_disabled");
      expect(res.error.message).toContain("hap-server");
    }
  });

  it("maps a 409 matter_sdk_unavailable body for commission", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce(409, {
        error: "matter_sdk_unavailable",
        message: "Matter commissioning unavailable until v0.7.1",
      }),
    );

    const res = await commissionMatter("google_home");

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.error).toBe("matter_sdk_unavailable");
      expect(res.error.status).toBe(409);
    }
  });

  it("maps a 422 class_below_floor body for setPrivacy", async () => {
    const fetchMock = mockFetchOnce(422, {
      error: "class_below_floor",
      message: "consumer ecosystems may not drop below class 2 (anonymous)",
    });
    vi.stubGlobal("fetch", fetchMock);

    // 1 is not a valid PrivacyClass at the type level, but the API still rejects it.
    const res = await setPrivacy("google_home", 3);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.error).toBe("class_below_floor");
      expect(res.error.status).toBe(422);
    }
    // verify request shape
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/google_home/privacy");
    expect((init as RequestInit).method).toBe("PUT");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ privacy_class: 3 });
  });

  it("surfaces a network failure as a typed network_error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connection refused")),
    );

    const res = await getStatus();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.error).toBe("network_error");
      expect(res.error.status).toBe(0);
    }
  });
});
