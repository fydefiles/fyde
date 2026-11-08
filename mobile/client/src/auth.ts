import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { call } from "./api";
import type { Workspace } from "./types";

export type LoginResult = {
  token?: string;
  user?: Workspace["user"];
  verification_required?: boolean;
  sign_in_required?: boolean;
};

const pendingKey = "fyde.google.pending";
export async function googleSignIn(): Promise<LoginResult | void> {
  const verifier = (Crypto.randomUUID() + Crypto.randomUUID()).replace(
    /-/g,
    "",
  );
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const challenge = digest
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const callback =
    Platform.OS === "web"
      ? window.location.origin + "/auth/callback"
      : "fyde://auth/callback";
  const attempt = await call<{ attempt: string; url: string }>(
    "/api/v1/auth/google/start/",
    null,
    "POST",
    { code_challenge: challenge, redirect_uri: callback },
  );
  if (Platform.OS === "web") {
    window.sessionStorage.setItem(pendingKey, JSON.stringify({
      attempt: attempt.attempt, verifier, expires: Date.now() + 300_000,
    }));
    window.location.assign(attempt.url);
    return;
  }
  const result = await WebBrowser.openAuthSessionAsync(attempt.url, callback);
  if (result.type !== "success")
    throw new Error("Google sign-in was cancelled.");
  const url = new URL(result.url);
  if (
    url.searchParams.get("attempt") !== attempt.attempt ||
    !url.searchParams.get("code")
  )
    throw new Error("Google sign-in did not match this device. Please retry.");
  return call<LoginResult>("/api/v1/auth/google/exchange/", null, "POST", {
    attempt: attempt.attempt,
    code: url.searchParams.get("code"),
    code_verifier: verifier,
    device_name: `Fyde ${Platform.OS}`,
  });
}

export async function completeWebGoogleSignIn(): Promise<void> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const attempt = url.searchParams.get("attempt");
  const raw = window.sessionStorage.getItem(pendingKey);
  window.sessionStorage.removeItem(pendingKey);
  window.history.replaceState(null, "", url.pathname);
  const pending = raw ? JSON.parse(raw) : null;
  if (!pending || pending.expires < Date.now() || pending.attempt !== attempt || !code)
    throw new Error("This sign-in attempt expired or belongs to another browser. Return to Fyde and sign in again.");
  await call<LoginResult>("/api/v1/auth/google/exchange/", null, "POST", {
    attempt, code, code_verifier: pending.verifier, device_name: "Fyde web",
  });
  window.location.replace("/");
}
