import React, { useCallback, useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Linking,
  KeyboardAvoidingView,
  Keyboard,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Slot, usePathname, useRouter } from "expo-router";
import {
  API_ROOT,
  ApiError,
  call,
  persistSession,
  restoreSession,
  download,
  clearDownloads,
} from "./src/api";
import { Button, C, Choices, Field, Toggle, styles as ui } from "./src/ui";
import type { Workspace, Turn, FileCard, Channel, Choice } from "./src/types";
import ChatScreen from "./src/ChatScreen";
import SetupScreen from "./src/SetupScreen";
import FilesScreen, { ClassificationScreen } from "./src/FilesScreen";
import { ChatIcon, SearchIcon, ReceivedIcon } from "./src/NavigationIcons";
import { googleSignIn, type LoginResult } from "./src/auth";

type Tab = "Chat" | "Search" | "Setup" | "Received" | "Account" | "Manage";
type Management = {
  section: "files" | "people" | "permissions" | "classify";
  matter_id?: string;
  contact_id?: string;
};
type Frame = {
  body: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
};
const RouteContent = React.createContext<React.ReactNode>(null);
export function ClientRoute() {
  return React.useContext(RouteContent);
}
const paths = {
  Chat: "/",
  Search: "/files",
  Setup: "/setup",
  Received: "/received",
  Account: "/account",
  Manage: "/manage",
} as const;
function useClientContent(): Frame {
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab =
    (Object.keys(paths) as Tab[]).find((name) => paths[name] === pathname) ??
    "Chat";
  const setTab = useCallback(
    (name: Tab) => router.replace(paths[name]),
    [router],
  );
  const [token, setToken] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [state, setState] = useState<Workspace | null>(null),
    [turns, setTurns] = useState<Turn[]>([]),
    [received, setReceived] = useState<FileCard[]>([]);
  const activeSession = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [management, setManagement] = useState<Management>({
    section: "files",
  });
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [managedAuth, setManagedAuth] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [verification, setVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [credentials, setCredentials] = useState<
    { id: string; kind: string; name: string; expires_at: string }[]
  >([]);
  const [agentPolicy, setAgentPolicy] = useState(""),
    [agentName, setAgentName] = useState("My case assistant"),
    [agentSecret, setAgentSecret] = useState("");
  async function endSession() {
    activeSession.current = null;
    try {
      if (token) await call("/api/v1/logout/", token, "POST", {});
    } catch {
    } finally {
      try {
        await persistSession(null);
        await clearDownloads();
      } catch {
        setError("Signed out. Some local cache cleanup could not finish.");
      }
      setToken(null);
      setState(null);
      setTurns([]);
      setReceived([]);
      setQuery("");
      setCredentials([]);
      setAgentSecret("");
      setAgentPolicy("");
      setAgentName("My case assistant");
      setManagement({ section: "files" });
    }
  }
  const refresh = useCallback(
    async (activeToken = token) => {
      if (!activeToken) return;
      try {
        const [workspace, conversation, inbox, keys] = await Promise.all([
          call<Workspace>("/api/v1/state/", activeToken),
          call<{ turns: Turn[] }>("/api/v1/chat/", activeToken),
          call<{ files: FileCard[] }>("/api/v1/received/", activeToken),
          call<{
            tokens: {
              id: string;
              kind: string;
              name: string;
              expires_at: string;
            }[];
          }>("/api/v1/credentials/", activeToken),
        ]);
        if (activeSession.current !== activeToken) return;
        setState(workspace);
        setTurns(conversation.turns);
        setReceived(inbox.files);
        setCredentials(keys.tokens.filter((key) => key.kind === "agent"));
      } catch (e) {
        if (
          activeSession.current === activeToken &&
          e instanceof ApiError &&
          e.status === 401
        ) {
          activeSession.current = null;
          await persistSession(null);
          setToken(null);
          setState(null);
        }
        throw e;
      }
    },
    [token],
  );
  useEffect(() => {
    call<{ provider: string; google?: boolean }>("/api/v1/auth/config/", null)
      .then((config) => {
        setManagedAuth(config.provider === "neon");
        setGoogleEnabled(config.google === true);
      })
      .catch((e) => setError(e.message));
    restoreSession()
      .then((value) => {
        activeSession.current = value;
        setToken(value);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (token) refresh(token).catch((e) => setError(e.message));
  }, [token, refresh]);
  const onboarded = state?.user.onboarding_complete;
  useEffect(() => {
    if (onboarded === undefined) return;
    if (["/privacy", "/help", "/pricing", "/feedback", "/document", "/receipts"].includes(pathname) || pathname.startsWith("/auth/")) return;
    if (!onboarded && tab !== "Setup" && tab !== "Account") setTab("Setup");
    if (onboarded && tab === "Setup") setTab("Chat");
  }, [onboarded, tab, setTab, pathname]);
  function navigate(destination: Tab) {
    Keyboard.dismiss();
    setError("");
    setAgentSecret("");
    setTab(destination);
    if (destination === "Received" || destination === "Account")
      refresh().catch((e) => setError(e.message));
  }
  function openManagement(action: Management) {
    setManagement(action);
    navigate("Manage");
  }
  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<LoginResult>(
        verification
          ? "/api/v1/auth/verify/"
          : signup
            ? "/api/v1/signup/"
            : "/api/v1/login/",
        null,
        "POST",
        verification
          ? { email, code: verificationCode }
          : signup
            ? { name, email, password }
            : { email, password, device_name: `Fyde ${Platform.OS}` },
      );
      if (result.verification_required) {
        setVerification(true);
        setPassword("");
        return;
      }
      if (result.sign_in_required) {
        setVerification(false);
        setSignup(false);
        setVerificationCode("");
        setError("Email verified. Sign in with your password.");
        return;
      }
      await acceptLogin(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === "email_verification_required") {
        setVerification(true);
        setPassword("");
        await call("/api/v1/auth/send-code/", null, "POST", { email }).catch(
          () => {},
        );
      }
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function acceptLogin(result: LoginResult) {
    if (!result.token || !result.user)
      throw new Error("Sign-in did not finish. Please retry.");
    await persistSession(result.token);
    activeSession.current = result.token;
    setToken(result.token);
    setPassword("");
    setVerification(false);
    setVerificationCode("");
    setTab(result.user.onboarding_complete ? "Chat" : "Setup");
    await refresh(result.token);
  }
  async function loginWithGoogle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await googleSignIn();
      if (result) await acceptLogin(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function mutate<T>(path: string, data: unknown): Promise<T> {
    const result = await call<T>(path, token, "POST", data);
    await refresh();
    return result;
  }
  async function send(
    message: string,
    operation: string,
    channel: Channel,
    choice?: Choice,
  ) {
    const turn = await call<Turn>("/api/v1/chat/", token, "POST", {
      message,
      operation_id: operation,
      channel,
      choice,
    });
    setTurns((old) =>
      old.some((t) => t.id === turn.id) ? old : [...old, turn],
    );
    await refresh();
  }
  async function getFile(file: FileCard) {
    if (!token) return;
    await download(file, token);
    await refresh();
  }
  if (!ready)
    return {
      body: (
        <View style={s.loading}>
          <ActivityIndicator color={C.accent} />
        </View>
      ),
    };
  if (!token)
    return {
      body: (
        <ScrollView
          contentContainerStyle={[
            ui.body,
            {
              paddingTop: 44,
              maxWidth: 500,
              width: "100%",
              alignSelf: "center",
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.brand}>
            fyde<Text style={{ color: C.accent }}>.</Text>
          </Text>
          <Text style={ui.eyebrow}>FILES, A CONVERSATION AWAY</Text>
          <Text style={ui.heading}>
            {verification
              ? "Verify your email."
              : signup
                ? "Make room for\nyour important files."
                : "Your files are\nright here."}
          </Text>
          <Text style={ui.sub}>
            {verification
              ? `Enter the code sent to ${email}.`
              : signup
                ? "Start privately. Set up your files and relationships after creating your account."
                : "Sign in to chat with your files and receive documents."}
          </Text>
          {!!error && (
            <Text style={ui.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          {signup && !verification && (
            <Field label="Your name" value={name} onChangeText={setName} />
          )}
          {!verification && (
            <Field
              label="Email address"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          )}
          {verification ? (
            <Field
              label="Verification code"
              value={verificationCode}
              onChangeText={setVerificationCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
          ) : (
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={signup ? "new-password" : "current-password"}
            />
          )}
          <Button
            title={
              busy
                ? "Connecting…"
                : verification
                  ? "Verify email →"
                  : signup
                    ? "Create account →"
                    : "Sign in →"
            }
            disabled={
              busy ||
              (verification
                ? !verificationCode
                : !email || !password || (signup && !name))
            }
            onPress={login}
          />
          {managedAuth && !verification && (
            <>
              {googleEnabled && (
                <Button
                  title="Continue with Google"
                  secondary
                  disabled={busy}
                  onPress={loginWithGoogle}
                />
              )}
              <Button
                title="Forgot your password?"
                secondary
                disabled={busy}
                onPress={() =>
                  Linking.openURL(API_ROOT + "/auth/reset-password/").catch(
                    (e) => setError(e.message),
                  )
                }
              />
            </>
          )}
          {verification && (
            <Button
              title="Send a new code"
              secondary
              disabled={busy}
              onPress={async () => {
                setBusy(true);
                setError("");
                try {
                  await call("/api/v1/auth/send-code/", null, "POST", {
                    email,
                  });
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          <Button
            title={
              signup
                ? "Already have an account? Sign in"
                : "Create a free account"
            }
            secondary
            onPress={() => {
              setSignup(!signup);
              setVerification(false);
              setVerificationCode("");
              setError("");
            }}
          />
          <Text style={ui.fine}>Your files stay private until you choose to share them.</Text>
          <Pressable accessibilityRole="link" onPress={() => router.push("/privacy")}><Text style={ui.fine}>Privacy and resource policies →</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={() => router.push("/help")}><Text style={ui.fine}>Help →</Text></Pressable>
        </ScrollView>
      ),
    };
  if (!state)
    return {
      body: (
        <View style={s.loading}>
          <ActivityIndicator color={C.accent} />
          {!!error && <Text style={ui.error}>{error}</Text>}
          <Button
            title="Retry connection"
            secondary
            onPress={() => refresh().catch((e) => setError(e.message))}
          />
          <Button title="Sign out" secondary onPress={endSession} />
          <Button title="Sharing activity and receipts" secondary onPress={() => Linking.openURL(API_ROOT + "/receipts")} />
          <Button title="Help and feedback" secondary onPress={() => router.push("/help")} />
          <Button title="Privacy and resource policies" secondary onPress={() => router.push("/privacy")} />
          {Platform.OS === "web" && <Button title="Export account metadata" secondary onPress={async () => {
            try {
              const metadata = await call("/api/v1/export/", token);
              const url = URL.createObjectURL(new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }));
              const link = document.createElement("a"); link.href = url; link.download = "fyde-workspace.json";
              document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) { setError((e as Error).message); }
          }} />}
        </View>
      ),
    };
  return {
    header: (
      <>
        <View style={s.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat"
            onPress={() =>
              navigate(state.user.onboarding_complete ? "Chat" : "Setup")
            }
          >
            <Text style={s.brand}>
              fyde<Text style={{ color: C.accent }}>.</Text>
            </Text>
          </Pressable>
          <Text style={s.section}>
            {tab === "Chat"
              ? "Your private file assistant"
              : tab === "Search"
                ? "Find your files"
                : tab === "Manage"
                  ? "Workspace changes"
                  : tab === "Setup"
                    ? "Welcome to Fyde"
                    : tab}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
            onPress={() => navigate("Account")}
            style={s.avatar}
          >
            <Text style={s.initial}>
              {(state.user.name || state.user.email).slice(0, 1).toUpperCase()}
            </Text>
          </Pressable>
        </View>
        {state.user.data_mode === "fixture" && (
          <View style={s.banner}>
            <Text style={s.bannerText}>
              Local fixture account · no live delivery claimed
            </Text>
          </View>
        )}
        {!state.user.email_verified && (
          <Pressable onPress={() => navigate("Account")} style={s.verify}>
            <Text style={ui.fine}>
              Verify your email before sharing. Open Account →
            </Text>
          </Pressable>
        )}
      </>
    ),
    body:
      tab === "Chat" ? (
        <ChatScreen
          turns={turns}
          defaultChannel={state.user.default_channel}
          contextEnabled={state.user.chat_context_enabled ?? true}
          send={send}
          openManagement={openManagement}
          download={getFile}
        />
      ) : tab === "Setup" ? (
        <SetupScreen
          state={state}
          mutate={mutate}
          finish={() => setTab("Chat")}
        />
      ) : tab === "Manage" ? (
        management.section === "classify" ? (
          <ClassificationScreen
            state={state}
            download={getFile}
            finish={() => navigate("Chat")}
            save={async (file, matter, type, sensitive) => {
              await mutate(`/api/v1/documents/${file.document_id}/classify/`, {
                matter_id: matter || null,
                document_type: type,
                sensitive,
              });
            }}
          />
        ) : (
          <SetupScreen
            key={JSON.stringify(management)}
            state={state}
            mutate={mutate}
            onboarding={false}
            initialStep={management.section}
            initialMatter={management.matter_id}
            initialContact={management.contact_id}
            finish={() => navigate("Chat")}
          />
        )
      ) : tab === "Search" ? (
        <FilesScreen
          state={state}
          token={token}
          query={query}
          onQuery={setQuery}
          download={getFile}
        />
      ) : tab === "Received" ? (
        <ScrollView contentContainerStyle={ui.body}>
          <Text style={ui.eyebrow}>SHARED WITH YOU</Text>
          <Text style={ui.heading}>Your received{`\n`}files.</Text>
          {!!error && <Text style={ui.error}>{error}</Text>}
          {received.map((file) => (
            <View key={file.item_id} style={ui.card}>
              <Text style={ui.cardTitle}>{file.title}</Text>
              <Text style={ui.fine}>
                {file.name} · v{file.number} · From {file.from}
              </Text>
              <Button
                title={
                  file.available ? "Download / open ↓" : "Access unavailable"
                }
                secondary
                disabled={!file.available}
                onPress={() => getFile(file).catch((e) => setError(e.message))}
              />
            </View>
          ))}
          {!received.length && (
            <Text style={ui.sub}>
              No received files yet. A verified sender can use your Fyde email
              or a linked phone. Ask in chat for documents under a case
              permission.
            </Text>
          )}
          <Text style={ui.fine}>
            Owner permissions, expiry and revocation still apply. Downloads use
            the sender’s bandwidth and do not add file sends. Downloaded copies
            cannot be recalled.
          </Text>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={ui.body}>
          <Text style={ui.heading}>Your account.</Text>
          <Button
            title="Refresh account"
            secondary
            onPress={() => refresh().catch((e) => setError(e.message))}
          />
          <Button
            title={
              state.user.onboarding_complete
                ? "Back to chat"
                : "Back to onboarding"
            }
            secondary
            onPress={() =>
              navigate(state.user.onboarding_complete ? "Chat" : "Setup")
            }
          />
          <Text style={ui.sub}>
            {state.user.name}
            {"\n"}
            {state.user.email}
            {"\n"}Email{" "}
            {state.user.email_verified ? "verified" : "not verified"}
          </Text>
          {!!error && (
            <Text style={ui.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          {!state.user.email_verified && (
            <>
              <Button
                title="Send verification email"
                secondary
                onPress={() =>
                  mutate("/api/v1/verify-email/", {})
                    .then(() =>
                      setError(
                        "Verification queued. Open the email link, then refresh your account.",
                      ),
                    )
                    .catch((e) => setError(e.message))
                }
              />
              <Button
                title="Refresh verification"
                secondary
                onPress={() => refresh().catch((e) => setError(e.message))}
              />
              <Button
                title="Open web account / local outbox"
                secondary
                onPress={() => Linking.openURL(API_ROOT + "/outbox/")}
              />
            </>
          )}
          <View style={ui.card}>
            <Text style={ui.cardTitle}>Sharing and chat</Text>
            <Choices
              label="Default delivery"
              value={state.user.default_channel}
              items={[
                { id: "in_app", name: "Fyde" },
                { id: "email", name: "Email" },
                { id: "phone", name: "Phone (SMS)" },
              ]}
              onChange={(default_channel) =>
                mutate("/api/v1/preferences/", { default_channel }).catch((e) =>
                  setError(e.message),
                )
              }
            />
            <Toggle
              label="Use recent chat choices for follow-ups"
              value={state.user.chat_context_enabled ?? true}
              onChange={(chat_context_enabled) =>
                mutate("/api/v1/preferences/", { chat_context_enabled }).catch(
                  (e) => setError(e.message),
                )
              }
            />
            <Toggle
              label="Pause my outgoing sharing"
              value={state.user.sharing_paused}
              onChange={(sharing_paused) =>
                mutate("/api/v1/preferences/", { sharing_paused }).catch((e) =>
                  setError(e.message),
                )
              }
            />
            <Text style={ui.fine}>
              Pausing stops requests and future downloads of your files.
              Received files remain subject to their original owner's controls.
            </Text>
          </View>
          <View style={ui.card}>
            <Text style={ui.cardTitle}>Connect your recipient agent</Text>
            <Text style={ui.fine}>
              Create a credential for one case permission granted to you. It can
              request documents and download files released under that
              permission. It cannot read your uploaded files or change access
              rules.
            </Text>
            <Choices
              label="Received case permission"
              items={state.received_permissions.map((p) => ({
                id: p.id,
                name: `${p.case} · from ${p.owner}`,
              }))}
              value={agentPolicy}
              onChange={setAgentPolicy}
            />
            <Field
              label="Agent name"
              value={agentName}
              onChangeText={setAgentName}
            />
            <Button
              title="Create scoped credential"
              disabled={!agentPolicy}
              onPress={() =>
                mutate<{ token: string }>("/api/v1/credentials/", {
                  policy_id: agentPolicy,
                  name: agentName,
                })
                  .then((result) => {
                    if (activeSession.current === token)
                      setAgentSecret(result.token);
                  })
                  .catch((e) => setError(e.message))
              }
            />
            {!!agentSecret && (
              <>
                <Text style={ui.fine}>
                  Shown once. Copy to your agent’s secret store. The protocol is
                  /api/agents/v1/.
                </Text>
                <Text
                  selectable
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    color: C.ink,
                  }}
                >
                  {agentSecret}
                </Text>
              </>
            )}
          </View>
          {credentials.map((key) => (
            <View key={key.id} style={ui.card}>
              <Text style={ui.cardTitle}>{key.name}</Text>
              <Text style={ui.fine}>
                Expires {new Date(key.expires_at).toLocaleString()}
              </Text>
              <Button
                title="Revoke agent credential"
                secondary
                onPress={() =>
                  mutate(`/api/v1/credentials/${key.id}/revoke/`, {}).catch(
                    (e) => setError(e.message),
                  )
                }
              />
            </View>
          ))}
          <Button title="Sign out" secondary onPress={endSession} />
          <Text style={ui.fine}>
            The customer assistant is separate from the company’s development
            and marketing agents. They cannot read this chat or your documents.
          </Text>
        </ScrollView>
      ),
    footer:
      state.user.onboarding_complete && tab !== "Manage" ? (
        <View style={s.tabs}>
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Search"
            accessibilityState={{ selected: tab === "Search" }}
            onPress={() => navigate("Search")}
            style={s.searchTab}
          >
            <View
              style={[
                s.chatIcon,
                { backgroundColor: tab === "Search" ? C.warm : "transparent" },
              ]}
            >
              <SearchIcon color={tab === "Search" ? C.accent : C.muted} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Chat"
            accessibilityState={{ selected: tab === "Chat" }}
            onPress={() => navigate("Chat")}
            style={s.chatTab}
          >
            <View
              style={[
                s.chatIcon,
                tab === "Chat" && { backgroundColor: C.accent },
              ]}
            >
              <ChatIcon color={tab === "Chat" ? C.paper : C.ink} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel="Received"
            accessibilityState={{ selected: tab === "Received" }}
            onPress={() => navigate("Received")}
            style={s.receivedTab}
          >
            <ReceivedIcon color={tab === "Received" ? C.accent : C.muted} />
            <Text
              style={[s.tabLabel, tab === "Received" && { color: C.accent }]}
            >
              Received
            </Text>
          </Pressable>
        </View>
      ) : null,
  };
}

export default function App() {
  const content = useClientContent();
  return (
    <SafeAreaProvider>
      <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {content.header}
          <RouteContent.Provider value={content.body}>
            <View style={{ flex: 1 }}>
              <Slot />
            </View>
          </RouteContent.Provider>
          {content.footer}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 15,
    borderBottomWidth: 1,
    borderBottomColor: C.line,
  },
  brand: { fontSize: 30, fontWeight: "700", color: C.ink, letterSpacing: -1.4 },
  section: { flex: 1, color: C.muted, fontSize: 11 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.soft,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 16, fontWeight: "600", color: C.ink },
  banner: { backgroundColor: C.warm, padding: 9, alignItems: "center" },
  bannerText: { fontSize: 10, color: "#6d4b39" },
  verify: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#f4efd9",
  },
  tabs: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.bg,
  },
  searchTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  chatTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  chatIcon: {
    width: 50,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.soft,
  },
  receivedTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
    gap: 4,
  },
  tabLabel: { color: C.muted, fontSize: 11 },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    padding: 30,
  },
});
