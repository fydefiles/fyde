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
import {
  Avatar,
  Button,
  C,
  Choices,
  Field,
  Toggle,
  Wordmark,
  serif,
  styles as ui,
} from "./src/ui";
import type { Workspace, Turn, FileCard, Channel, Choice } from "./src/types";
import ChatScreen, { type Draft } from "./src/ChatScreen";
import SetupScreen from "./src/SetupScreen";
import SearchScreen from "./src/SearchScreen";
import ReceivedScreen from "./src/ReceivedScreen";
import { ClassificationScreen } from "./src/FilesScreen";
import { ChatIcon, SearchIcon, ReceivedIcon, ChevronIcon } from "./src/Icons";
import { resetPrefs } from "./src/prefs";
import { PREVIEW_TOKEN, resetPreview } from "./src/preview";

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

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setVisible(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setVisible(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function TabButton({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon: (color: string) => React.ReactNode;
}) {
  const color = active ? C.accent : C.muted;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={s.tab}
    >
      <View style={[s.tabIcon, active && { backgroundColor: C.accentSoft }]}>
        {icon(color)}
      </View>
      <Text style={[s.tabLabel, { color }, active && { fontWeight: "700" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {!!title && <Text style={[ui.eyebrow, { paddingHorizontal: 4 }]}>{title}</Text>}
      <View style={s.group}>{children}</View>
    </View>
  );
}

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
  const [draft, setDraft] = useState<Draft | null>(null);
  const clearDraft = useCallback(() => setDraft(null), []);
  const keyboard = useKeyboardVisible();
  const [management, setManagement] = useState<Management>({
    section: "files",
  });
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
      setDraft(null);
      setCredentials([]);
      setAgentSecret("");
      setAgentPolicy("");
      setAgentName("My case assistant");
      setManagement({ section: "files" });
      resetPrefs();
      resetPreview();
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
    if (!onboarded && tab !== "Setup" && tab !== "Account") setTab("Setup");
    if (onboarded && tab === "Setup") setTab("Chat");
  }, [onboarded, tab, setTab]);
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
  function startPreview() {
    setError("");
    activeSession.current = PREVIEW_TOKEN;
    setToken(PREVIEW_TOKEN);
    setTab("Chat");
  }
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
      activeSession.current = result.token;
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
              paddingTop: 36,
              paddingHorizontal: 24,
              maxWidth: 500,
              width: "100%",
              alignSelf: "center",
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Wordmark size={34} />
          <View style={{ gap: 10, marginTop: 28, marginBottom: 8 }}>
            <Text style={s.authTitle}>
              {signup
                ? "Make room for\nyour important files."
                : "Your files,\none sentence away."}
            </Text>
            <Text style={ui.sub}>
              {signup
                ? "Start privately. Add your files and the people you share with after creating your account."
                : "Describe any file and Fyde finds the exact one — then asks before sending it."}
            </Text>
          </View>
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
            title={busy ? "Connecting…" : signup ? "Create account" : "Sign in"}
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
          {__DEV__ && (
            <Pressable
              accessibilityRole="button"
              onPress={startPreview}
              style={s.previewEntry}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.previewTitle}>Preview with sample files</Text>
                <Text style={ui.fine}>
                  Development builds only · works offline, nothing is sent
                </Text>
              </View>
              <ChevronIcon size={12} color={C.muted} />
            </Pressable>
          )}
          <Text style={[ui.fine, { textAlign: "center" }]}>
            Server: {API_ROOT}
            {"\n"}Native sessions use device secure storage. Web preview
            sessions stay in memory.
          </Text>
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
        </View>
      ),
    };
  const preview = state.user.data_mode === "preview";
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
            style={{ flex: 1 }}
          >
            <Wordmark size={26} />
          </Pressable>
          {(preview || state.user.data_mode === "fixture") && (
            <View style={s.modePill}>
              <View style={s.modeDot} />
              <Text style={s.modeText}>
                {preview ? "Sample preview" : "Local fixture"}
              </Text>
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Profile and settings"
            onPress={() => navigate("Account")}
          >
            <Avatar
              name={state.user.name || state.user.email}
              size={34}
              tone={tab === "Account" ? C.accentSoft : C.sunken}
            />
          </Pressable>
        </View>
        {!state.user.email_verified && (
          <Pressable onPress={() => navigate("Account")} style={s.verify}>
            <Text style={s.verifyText}>
              Verify your email before sharing
            </Text>
            <ChevronIcon size={10} color="#7A5A1E" />
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
          draft={draft}
          clearDraft={clearDraft}
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
        <SearchScreen
          state={state}
          token={token}
          query={query}
          onQuery={setQuery}
          download={getFile}
          sendInChat={(file) => {
            setDraft({ text: `Send “${file.title}” to `, file });
            navigate("Chat");
          }}
          editDetails={() => openManagement({ section: "classify" })}
        />
      ) : tab === "Received" ? (
        <ReceivedScreen files={received} error={error} download={getFile} />
      ) : (
        <ScrollView contentContainerStyle={[ui.body, { gap: 22 }]}>
          <View style={s.profile}>
            <Avatar
              name={state.user.name || state.user.email}
              size={64}
              tone={C.accentSoft}
            />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={s.profileName}>{state.user.name || "Your account"}</Text>
              <Text style={ui.fine}>{state.user.email}</Text>
              <Text
                style={[
                  ui.fine,
                  { color: state.user.email_verified ? C.success : C.danger },
                ]}
              >
                {state.user.email_verified ? "Email verified" : "Email not verified"}
              </Text>
            </View>
          </View>
          {!!error && (
            <Text style={ui.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <View style={s.stats}>
            <View style={s.stat}>
              <Text style={s.statValue}>{state.files.length}</Text>
              <Text style={ui.fine}>Files</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statValue}>{state.contacts.length}</Text>
              <Text style={ui.fine}>People</Text>
            </View>
            <View style={s.stat}>
              <Text style={s.statValue}>
                {state.consumed}
                <Text style={s.statLimit}>
                  {state.plan.sends === null ? "" : ` / ${state.plan.sends}`}
                </Text>
              </Text>
              <Text style={ui.fine}>Sends used</Text>
            </View>
          </View>
          {!state.user.email_verified && (
            <View style={{ gap: 10 }}>
              <Button
                title="Send verification email"
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
            </View>
          )}
          <SettingsGroup title="Your library">
            {(
              [
                ["Files", "files"],
                ["People", "people"],
                ["Automatic sharing", "permissions"],
              ] as const
            ).map(([label, section], index) => (
              <Pressable
                key={section}
                accessibilityRole="button"
                onPress={() => openManagement({ section })}
                style={[s.groupRow, index > 0 && s.groupDivider]}
              >
                <Text style={s.groupText}>{label}</Text>
                <ChevronIcon size={12} color={C.faint} />
              </Pressable>
            ))}
          </SettingsGroup>
          <SettingsGroup title="Sharing and chat">
            <View style={{ padding: 16, paddingBottom: 6 }}>
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
            </View>
            <View style={[s.groupDivider, { paddingHorizontal: 16 }]}>
              <Toggle
                label="Use recent chat choices for follow-ups"
                value={state.user.chat_context_enabled ?? true}
                onChange={(chat_context_enabled) =>
                  mutate("/api/v1/preferences/", { chat_context_enabled }).catch(
                    (e) => setError(e.message),
                  )
                }
              />
            </View>
            <View style={[s.groupDivider, { paddingHorizontal: 16, paddingBottom: 12 }]}>
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
                Received files remain subject to their original owner’s controls.
              </Text>
            </View>
          </SettingsGroup>
          <SettingsGroup title="Recipient agent">
            <View style={{ padding: 16, gap: 12 }}>
              <Text style={ui.fine}>
                Create a credential for one case permission granted to you. It can
                request documents and download files released under that
                permission. It cannot read your uploaded files or change access
                rules.
              </Text>
              {state.received_permissions.length ? (
                <Choices
                  label="Received case permission"
                  items={state.received_permissions.map((p) => ({
                    id: p.id,
                    name: `${p.case} · from ${p.owner}`,
                  }))}
                  value={agentPolicy}
                  onChange={setAgentPolicy}
                />
              ) : (
                <Text style={ui.fine}>No one has shared a case with you yet.</Text>
              )}
              <Field
                label="Agent name"
                value={agentName}
                onChangeText={setAgentName}
                style={{ backgroundColor: C.bg }}
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
                      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
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
              <View key={key.id} style={[s.groupRow, s.groupDivider]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.groupText}>{key.name}</Text>
                  <Text style={ui.fine}>
                    Expires {new Date(key.expires_at).toLocaleString()}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    mutate(`/api/v1/credentials/${key.id}/revoke/`, {}).catch(
                      (e) => setError(e.message),
                    )
                  }
                >
                  <Text style={{ color: C.danger, fontWeight: "600" }}>Revoke</Text>
                </Pressable>
              </View>
            ))}
          </SettingsGroup>
          <Button title={preview ? "Leave preview" : "Sign out"} secondary onPress={endSession} />
          <Text style={[ui.fine, { textAlign: "center" }]}>
            The customer assistant is separate from the company’s development
            and marketing agents. They cannot read this chat or your documents.
          </Text>
        </ScrollView>
      ),
    footer:
      state.user.onboarding_complete && tab !== "Manage" && !keyboard ? (
        <View style={s.tabs} accessibilityRole="tablist">
          <TabButton
            label="Search"
            active={tab === "Search"}
            onPress={() => navigate("Search")}
            icon={(color) => <SearchIcon size={21} color={color} />}
          />
          <TabButton
            label="Chat"
            active={tab === "Chat"}
            onPress={() => navigate("Chat")}
            icon={(color) => <ChatIcon size={22} color={color} />}
          />
          <TabButton
            label="Received"
            active={tab === "Received"}
            onPress={() => navigate("Received")}
            icon={(color) => <ReceivedIcon size={21} color={color} />}
          />
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
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 10,
    gap: 10,
  },
  modePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.sunken,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  modeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
  modeText: { fontSize: 11.5, fontWeight: "600", color: C.muted },
  verify: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#F7EED8",
  },
  verifyText: { fontSize: 13, fontWeight: "600", color: "#7A5A1E" },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.line,
    backgroundColor: C.bg,
  },
  tab: { flex: 1, alignItems: "center", gap: 4, minHeight: 52 },
  tabIcon: {
    width: 58,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  tabLabel: { fontSize: 11.5, fontWeight: "600" },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    padding: 30,
  },
  authTitle: {
    fontFamily: serif,
    fontSize: 38,
    lineHeight: 44,
    color: C.ink,
    letterSpacing: -0.8,
  },
  previewEntry: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    borderStyle: "dashed",
  },
  previewTitle: { fontSize: 15, fontWeight: "600", color: C.ink },
  profile: { flexDirection: "row", alignItems: "center", gap: 16 },
  profileName: { fontFamily: serif, fontSize: 26, color: C.ink },
  stats: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    backgroundColor: C.sunken,
    borderRadius: 18,
    padding: 14,
    gap: 2,
  },
  statValue: { fontSize: 24, fontWeight: "600", color: C.ink, letterSpacing: -0.5 },
  statLimit: { fontSize: 15, fontWeight: "400", color: C.muted },
  group: { backgroundColor: C.sunken, borderRadius: 20, overflow: "hidden" },
  groupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    minHeight: 54,
    paddingVertical: 10,
  },
  groupDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.sunkenStrong,
  },
  groupText: { flex: 1, fontSize: 16, color: C.ink },
});
