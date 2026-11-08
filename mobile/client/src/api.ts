import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import type { FileCard } from "./types";

export const API_ROOT = (
  Platform.OS === "web" && typeof window !== "undefined"
    ? window.location.origin
    : process.env.EXPO_PUBLIC_API_URL || (!__DEV__
      ? "https://fyde-dev.mehmetuzgoren.workers.dev"
      : Platform.OS === "android" ? "http://10.0.2.2:8000" : "http://127.0.0.1:8000")
).replace(/\/$/, "");
const key = "fyde.customer.session";
function originCheck() {
  const url = new URL(API_ROOT);
  if (url.protocol !== "https:" && !(__DEV__ && url.protocol === "http:"))
    throw new Error(
      "Configure an HTTPS EXPO_PUBLIC_API_URL for this app build.",
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Configure the API origin without credentials, query parameters or a path.",
    );
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export async function restoreSession() {
  if (Platform.OS === "web") {
    const response = await fetch(API_ROOT + "/api/v1/session/", { credentials: "include" });
    if (response.status === 401 || response.status === 404) return null;
    if (!response.ok) throw new Error("Cannot restore your session. Please retry when connected.");
    return "cookie";
  }
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value.origin === API_ROOT ? (value.token as string) : null;
  } catch {
    return null;
  }
}
export async function persistSession(token: string | null) {
  if (Platform.OS === "web") return;
  if (token)
    await SecureStore.setItemAsync(
      key,
      JSON.stringify({ origin: API_ROOT, token }),
      { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
    );
  else await SecureStore.deleteItemAsync(key);
}
export async function call<T>(
  path: string,
  token: string | null,
  method = "GET",
  data?: unknown,
): Promise<T> {
  originCheck();
  if (!path.startsWith("/api/") || path.includes("://"))
    throw new Error("Invalid customer API path.");
  const multipart = data instanceof FormData;
  let response: Response;
  try {
    response = await expoFetch(API_ROOT + path, {
      method,
      credentials: Platform.OS === "web" ? "include" : "omit",
      headers: {
        ...(token && token !== "cookie" ? { Authorization: `Bearer ${token}` } : {}),
        ...(data && !multipart ? { "Content-Type": "application/json" } : {}),
      },
      body: data
        ? multipart
          ? (data as FormData)
          : JSON.stringify(data)
        : undefined,
    });
  } catch {
    throw new ApiError(
      multipart
        ? "Cannot upload this file. Check your connection and choose the file again."
        : "Cannot connect to Fyde. Your message is kept; retry when connected.",
      0,
    );
  }
  const result = await response.json().catch(() => {
    throw new ApiError(
      "Fyde returned an unreadable response. Please retry.",
      response.status,
    );
  });
  if (!response.ok)
    throw new ApiError(
      result.message || "The operation could not be completed.",
      response.status,
      result.error,
    );
  return result as T;
}
export async function download(file: FileCard, token: string) {
  originCheck();
  const path = file.api_download_url || file.download_url;
  if (
    !path ||
    (!path.startsWith("/api/v1/received/") &&
      !path.startsWith("/api/v1/files/"))
  )
    throw new Error("This file is not a received-file download.");
  const name = file.name.replace(/[^\w.()-]/g, "_").slice(0, 160);
  if (Platform.OS === "web") {
    const result = await fetch(API_ROOT + path, {
      credentials: "include",
      headers: token === "cookie" ? {} : { Authorization: `Bearer ${token}` },
    });
    if (!result.ok)
      throw new Error(
        "Access is unavailable. Refresh to check the permission.",
      );
    const url = URL.createObjectURL(await result.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const folder = FileSystem.cacheDirectory + "fyde-received/" + file.id + "/";
  await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  const destination = folder + name;
  const result = await FileSystem.downloadAsync(API_ROOT + path, destination, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (result.status !== 200) {
    await FileSystem.deleteAsync(destination, { idempotent: true });
    throw new Error("Access is unavailable. Refresh to check the permission.");
  }
  if (await Sharing.isAvailableAsync())
    await Sharing.shareAsync(result.uri, {
      dialogTitle: "Save or open your received file",
    });
}
export async function clearDownloads() {
  if (Platform.OS !== "web")
    await FileSystem.deleteAsync(FileSystem.cacheDirectory + "fyde-received/", {
      idempotent: true,
    });
}
