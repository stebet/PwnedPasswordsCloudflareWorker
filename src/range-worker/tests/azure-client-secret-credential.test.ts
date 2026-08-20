import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureClientSecretCredential } from "../azure-client-secret-credential";

describe("AzureClientSecretCredential", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests and caches an Azure Storage access token", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), { status: 200 }));
    const credential = new AzureClientSecretCredential("tenant-id", "client-id", "client-secret");

    const token = await credential.getToken("https://storage.azure.com/.default");
    const cachedToken = await credential.getToken("https://storage.azure.com/.default");

    expect(token).toEqual(cachedToken);
    expect(token.token).toBe("access-token");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("retries transient token responses", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access-token", expires_in: 3600 }), { status: 200 }));
    const credential = new AzureClientSecretCredential("tenant-id", "client-id", "client-secret");

    const token = await credential.getToken("https://storage.azure.com/.default");

    expect(token.token).toBe("access-token");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
