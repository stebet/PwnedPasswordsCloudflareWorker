interface AccessToken {
  expiresOnTimestamp: number;
  token: string;
}

export class AzureClientSecretCredential {
  private accessToken: AccessToken | undefined;

  public constructor(
    private readonly tenantId: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  public async getToken(scopes: string | string[]): Promise<AccessToken> {
    if (this.accessToken && this.accessToken.expiresOnTimestamp > Date.now() + 60_000) {
      return this.accessToken;
    }

    const tokenResponse = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
        scope: Array.isArray(scopes) ? scopes.join(" ") : scopes,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Microsoft Entra token request failed with status ${tokenResponse.status}`);
    }

    const token = (await tokenResponse.json()) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof token.access_token !== "string" || typeof token.expires_in !== "number") {
      throw new Error("Microsoft Entra token response was invalid");
    }

    this.accessToken = {
      token: token.access_token,
      expiresOnTimestamp: Date.now() + token.expires_in * 1000,
    };
    return this.accessToken;
  }
}
