import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Linking,
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
import FilesScreen from "./src/FilesScreen";

type Tab = "Chat" | "Files" | "Setup" | "Received" | "Account";
const RouteContent = React.createContext<React.ReactNode>(null);
export function ClientRoute() {
  return React.useContext(RouteContent);
}
const paths = {
  Chat: "/",
  Files: "/files",
  Setup: "/setup",
  Received: "/received",
  Account: "/account",
} as const;
function useClientContent() {
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab =
    (Object.keys(paths) as Tab[]).find((name) => paths[name] === pathname) ??
    "Chat";
  const setTab = (name: Tab) => router.replace(paths[name]);
  const [token, setToken] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [state, setState] = useState<Workspace | null>(null),
    [turns, setTurns] = useState<Turn[]>([]),
    [received, setReceived] = useState<FileCard[]>([]);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [signup, setSignup] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [credentials, setCredentials] = useState<
    { id: string; kind: string; name: string; expires_at: string }[]
  >([]);
  const [agentPolicy, setAgentPolicy] = useState(""),
    [agentName, setAgentName] = useState("My case assistant"),
    [agentSecret, setAgentSecret] = useState("");
  async function endSession() {
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
      setAgentSecret("");
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
        setState(workspace);
        setTurns(conversation.turns);
        setReceived(inbox.files);
        setCredentials(keys.tokens.filter((key) => key.kind === "agent"));
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
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
    restoreSession()
      .then((value) => {
        setToken(value);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (token) refresh(token).catch((e) => setError(e.message));
  }, [token, refresh]);
  async function login() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await call<{ token: string; user: Workspace["user"] }>(
        signup ? "/api/v1/signup/" : "/api/v1/login/",
        null,
        "POST",
        signup
          ? { name, email, password }
          : { email, password, device_name: `Fyde ${Platform.OS}` },
      );
      await persistSession(result.token);
      setToken(result.token);
      setPassword("");
      setTab(result.user.onboarding_complete ? "Chat" : "Setup");
      await refresh(result.token);
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
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  if (!token)
    return (
      <ScrollView
        contentContainerStyle={[
          ui.body,
          { paddingTop: 44, maxWidth: 500, width: "100%", alignSelf: "center" },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.brand}>
          fyde<Text style={{ color: C.accent }}>.</Text>
        </Text>
        <Text style={ui.eyebrow}>FILES, A CONVERSATION AWAY</Text>
        <Text style={ui.heading}>
          {signup
            ? "Make room for\nyour important files."
            : "Your files are\nright here."}
        </Text>
        <Text style={ui.sub}>
          {signup
            ? "Start privately. Set up your files and relationships after creating your account."
            : "Sign in to chat with your files and receive documents."}
        </Text>
        {!!error && (
          <Text style={ui.error} accessibilityRole="alert">
            {error}
          </Text>
        )}
        {signup && (
          <Field label="Your name" value={name} onChangeText={setName} />
        )}
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={signup ? "new-password" : "current-password"}
        />
        <Button
          title={
            busy ? "Connecting…" : signup ? "Create account →" : "Sign in →"
          }
          disabled={busy || !email || !password || (signup && !name)}
          onPress={login}
        />
        <Button
          title={
            signup
              ? "Already have an account? Sign in"
              : "Create a free account"
          }
          secondary
          onPress={() => {
            setSignup(!signup);
            setError("");
          }}
        />
        <Text style={ui.fine}>
          Server: {API_ROOT}
          {"\n"}Native sessions use device secure storage. Web preview sessions
          stay in memory.
        </Text>
      </ScrollView>
    );
  if (!state)
    return (
      <View style={s.loading}>
        <ActivityIndicator color={C.accent} />
        {!!error && <Text style={ui.error}>{error}</Text>}
        <Button
          title="Retry connection"
          secondary
          onPress={() => refresh().catch((e) => setError(e.message))}
        />
        <Button title="Sign out" secondary onPress={endSession} />
      </View>
    );
  return (
    <View style={{ flex: 1 }}>
      <View style={s.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open chat"
          onPress={() => setTab("Chat")}
        >
          <Text style={s.brand}>
            fyde<Text style={{ color: C.accent }}>.</Text>
          </Text>
        </Pressable>
        <Text style={s.section}>
          {tab === "Chat" ? "Your private file assistant" : tab}
        </Text>
        <Pressable
          onPress={() => refresh().catch((e) => setError(e.message))}
          accessibilityRole="button"
          accessibilityLabel="Refresh account"
          style={s.refresh}
        >
          <Text style={{ fontSize: 22, color: C.ink }}>↻</Text>
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
        <Pressable onPress={() => setTab("Account")} style={s.verify}>
          <Text style={ui.fine}>
            Verify your email before sharing. Open Account to check verification
            →
          </Text>
        </Pressable>
      )}
      {tab === "Chat" ? (
        <ChatScreen
          turns={turns}
          defaultChannel={state.user.default_channel}
          contextEnabled={state.user.chat_context_enabled ?? true}
          send={send}
          openSetup={() => setTab("Setup")}
          download={getFile}
        />
      ) : tab === "Setup" ? (
        <SetupScreen
          state={state}
          mutate={mutate}
          finish={() => setTab("Chat")}
        />
      ) : tab === "Files" ? (
        <FilesScreen
          state={state}
          download={getFile}
          setup={() => setTab("Setup")}
          save={async (file, matter, type, sensitive) => {
            await mutate(`/api/v1/documents/${file.document_id}/classify/`, {
              matter_id: matter || null,
              document_type: type,
              sensitive,
            });
          }}
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
                  .then((result) => setAgentSecret(result.token))
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
      )}
      <View style={s.tabs}>
        {(["Chat", "Files", "Setup", "Received", "Account"] as Tab[]).map(
          (item) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item }}
              accessibilityLabel={item}
              onPress={() => {
                setTab(item);
                setError("");
                setAgentSecret("");
                if (item === "Received")
                  refresh().catch((e) => setError(e.message));
              }}
              key={item}
              style={[s.tab, tab === item && { backgroundColor: C.warm }]}
            >
              <Text
                style={{
                  fontSize: 11,
                  color: tab === item ? C.accent : C.muted,
                  fontWeight: tab === item ? "600" : "400",
                }}
              >
                {item}
              </Text>
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}
export default function App() {
  const content = useClientContent();
  return (
    <SafeAreaProvider>
      <SafeAreaView style={ui.screen} edges={["top", "bottom"]}>
        <StatusBar style="dark" />
        <RouteContent.Provider value={content}>
          <Slot />
        </RouteContent.Provider>
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
  refresh: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: { backgroundColor: C.warm, padding: 9, alignItems: "center" },
  bannerText: { fontSize: 10, color: "#6d4b39" },
  verify: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: "#f4efd9",
  },
  tabs: {
    flexDirection: "row",
    padding: 9,
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.bg,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    minHeight: 45,
    paddingVertical: 12,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    padding: 30,
  },
});
