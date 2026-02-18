interface SessionEnv {
  NODE_ENV: "development" | "test" | "production";
  SESSION_SECRET: string;
}

interface SecureSessionOptions {
  key: Buffer;
  cookieName: string;
  cookie: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    maxAge: number;
  };
}

export const SESSION_ID_KEY = "sid";

export const buildSecureSessionOptions = (
  runtimeEnv: SessionEnv,
): SecureSessionOptions => ({
  key: Buffer.from(runtimeEnv.SESSION_SECRET, "hex"),
  cookieName: "ac_session",
  cookie: {
    path: "/",
    httpOnly: true,
    secure: runtimeEnv.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
  },
});
