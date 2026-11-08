import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import * as Crypto from "expo-crypto";
import type { Channel, Choice, Contact, FileCard, Turn } from "./types";
import { Avatar, Button, C, serif, styles as ui } from "./ui";
import { KINDS, kindOf } from "./library";
import { FileIcon, FileSheet, fileMeta } from "./FileVisuals";
import {
  ArrowUpIcon,
  BrandMark,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  SearchIcon,
} from "./Icons";

export type Draft = { text: string; file?: FileCard };
type Management = {
  section: "files" | "people" | "permissions" | "classify";
  matter_id?: string;
  contact_id?: string;
};
type Props = {
  turns: Turn[];
  defaultChannel: Channel;
  contextEnabled: boolean;
  send: (message: string, operation: string, channel: Channel, choice?: Choice) => Promise<void>;
  openManagement: (action: Management) => void;
  download: (file: FileCard) => Promise<void>;
  draft: Draft | null;
  clearDraft: () => void;
};
const CHANNELS: { id: Channel; name: string }[] = [
  { id: "in_app", name: "Fyde" },
  { id: "email", name: "Email" },
  { id: "phone", name: "SMS" },
];
const SUGGESTIONS = [
  { text: "Send my passport scan to my lawyer", hint: "Describe it — Fyde confirms the file first" },
  { text: "Find the lease I signed this year", hint: "Search by what's inside" },
  { text: "Add files", hint: "Import documents to your library" },
  { text: "Request documents for a case", hint: "Ask someone who shared a case with you" },
];

export default function ChatScreen({
  turns,
  defaultChannel,
  contextEnabled,
  send,
  openManagement,
  download,
  draft,
  clearDraft,
}: Props) {
  const [text, setText] = useState(draft?.text ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [channel, setChannel] = useState<Channel>(defaultChannel),
    [channelOpen, setChannelOpen] = useState(false),
    [attached, setAttached] = useState<FileCard | null>(draft?.file ?? null),
    [open, setOpen] = useState<FileCard | null>(null);
  const operation = useRef(Crypto.randomUUID()),
    scroll = useRef<React.ComponentRef<typeof ScrollView>>(null),
    input = useRef<React.ComponentRef<typeof TextInput>>(null),
    pending = useRef<{ text: string; choice?: Choice; channel: Channel } | null>(null);

  // A draft from Search seeds the composer when Chat opens; then focus it.
  useEffect(() => {
    if (!draft) return;
    clearDraft();
    const timer = setTimeout(() => input.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, [draft, clearDraft]);
  useEffect(() => {
    if (turns.length) setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60);
  }, [turns, busy]);

  async function submit(message = text, choice?: Choice) {
    if (busy || !message.trim()) return;
    const previous = pending.current;
    if (
      previous &&
      (previous.text !== message ||
        JSON.stringify(previous.choice) !== JSON.stringify(choice) ||
        previous.channel !== channel)
    )
      operation.current = Crypto.randomUUID();
    pending.current = { text: message, choice, channel };
    setBusy(true);
    setError("");
    setChannelOpen(false);
    try {
      await send(message, operation.current, channel, choice);
      if (!choice) {
        setText("");
        setAttached(null);
      }
      operation.current = Crypto.randomUUID();
      pending.current = null;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const choose = (turn: Turn, choice: Omit<Choice, "turn_id">, label: string) =>
    submit(label, { turn_id: turn.id, ...choice });
  const latest = turns[turns.length - 1]?.id;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={s.log}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!turns.length && (
          <View style={s.welcome}>
            <BrandMark size={52} />
            <Text style={s.title}>Describe a file.{"\n"}Fyde finds it.</Text>
            <Text style={[ui.sub, { textAlign: "center", maxWidth: 320 }]}>
              Say it the way you’d say it to a friend. Fyde shows you the exact file before anything is sent.
            </Text>
            <View style={s.suggestions}>
              {SUGGESTIONS.map((item, index) => (
                <Pressable
                  key={item.text}
                  accessibilityRole="button"
                  onPress={() => {
                    setText(item.text);
                    input.current?.focus();
                  }}
                  style={({ pressed }) => [s.suggestion, index > 0 && s.suggestionDivider, pressed && { opacity: 0.6 }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.suggestionText}>{item.text}</Text>
                    <Text style={ui.fine}>{item.hint}</Text>
                  </View>
                  <ChevronIcon size={12} color={C.faint} />
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {turns.map((turn, position) => {
          const r = turn.result;
          const answered = turns[position + 1]?.result.kind === "sent";
          const active = turn.id === latest && !busy;
          return (
            <View key={turn.id} style={{ gap: 14, marginBottom: 26 }}>
              <View style={s.user}>
                <Text style={s.userText}>{turn.message}</Text>
              </View>
              <View style={s.fyde}>
                <View style={{ paddingTop: 2 }}>
                  <BrandMark size={24} />
                </View>
                <View style={{ flex: 1, gap: 12 }}>
                  <Text style={s.reply}>{turn.reply}</Text>
                  {r.kind === "confirm" && !!r.files?.length && (
                    <ConfirmCard
                      turn={turn}
                      active={active}
                      answered={answered}
                      channel={r.channel ?? channel}
                      onOpen={setOpen}
                      onConfirm={(file, contact) =>
                        choose(
                          turn,
                          { version_id: file.id, contact_id: contact?.id, confirmed: true },
                          `Yes, send ${file.title}${contact ? ` to ${contact.name}` : ""}`,
                        )
                      }
                      onExpand={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 80)}
                      onRetry={() => {
                        setText("It’s the ");
                        input.current?.focus();
                      }}
                    />
                  )}
                  {r.kind === "clarify" && !!r.files?.length && (
                    <FileStrip
                      files={r.files}
                      label="Tap the right one"
                      onPress={(file) =>
                        active ? choose(turn, { version_id: file.id }, `Use ${file.title}`) : setOpen(file)
                      }
                    />
                  )}
                  {(r.kind === "search" || r.kind === "received") && !!r.files?.length && (
                    <FileStrip files={r.files} onPress={setOpen} />
                  )}
                  {!!r.contacts?.length && r.kind !== "confirm" && (
                    <View style={ui.chips}>
                      {r.contacts.map((contact) => (
                        <Pressable
                          key={contact.id}
                          accessibilityRole="button"
                          disabled={!active}
                          onPress={() => choose(turn, { contact_id: contact.id }, `Use ${contact.name}`)}
                          style={[s.person, !active && { opacity: 0.5 }]}
                        >
                          <Avatar name={contact.name} size={26} tone={C.bg} />
                          <Text style={s.personText}>
                            {contact.name}
                            <Text style={{ color: C.muted }}> · {contact.relationship || contact.endpoint}</Text>
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {(r.policies || []).map((policy) => (
                    <Button
                      key={policy.id}
                      compact
                      secondary
                      disabled={!active}
                      title={`${policy.name} · from ${policy.from}`}
                      onPress={() => choose(turn, { policy_id: policy.id }, `Use ${policy.name}`)}
                    />
                  ))}
                  {(r.transfers || []).map((transfer, index) => (
                    <View key={transfer.id || index} style={s.receipt}>
                      <View style={s.receiptCheck}>
                        <CheckIcon size={14} color="#FFFFFF" />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={s.receiptTitle}>{transfer.title}</Text>
                        <Text style={ui.fine}>{transfer.message || transfer.state.replaceAll("_", " ")}</Text>
                      </View>
                    </View>
                  ))}
                  {r.kind === "policy_draft" && (
                    <Button
                      compact
                      secondary
                      title="Review automatic sharing"
                      onPress={() =>
                        openManagement({ section: "permissions", matter_id: r.matter_id, contact_id: r.contact_id })
                      }
                    />
                  )}
                  {r.kind === "workspace_action" && r.section && (
                    <Button
                      compact
                      secondary
                      title={r.action_label || "Review changes"}
                      onPress={() =>
                        openManagement({ section: r.section!, matter_id: r.matter_id, contact_id: r.contact_id })
                      }
                    />
                  )}
                  {!!r.remaining_versions?.length && (
                    <Button
                      compact
                      secondary
                      title="Send next batch"
                      disabled={!active}
                      onPress={() => choose(turn, { remaining: true }, "Send the next batch")}
                    />
                  )}
                </View>
              </View>
            </View>
          );
        })}
        {busy && (
          <View style={[s.fyde, { alignItems: "center" }]}>
            <BrandMark size={24} />
            <View style={s.thinking}>
              <ActivityIndicator size="small" color={C.accent} />
              <Text style={ui.fine}>Finding the right file…</Text>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={s.composerWrap}>
        {!!error && (
          <Text accessibilityRole="alert" style={[ui.error, { paddingHorizontal: 6 }]}>
            {error}
          </Text>
        )}
        <View style={s.composer}>
          {attached && (
            <View style={s.attached}>
              <FileIcon file={attached} size={38} bg={C.bg} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={s.attachedTitle}>
                  {attached.title}
                </Text>
                <Text style={ui.fine}>Exact file attached</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove attached file"
                onPress={() => setAttached(null)}
                style={s.attachedClose}
              >
                <CloseIcon size={10} color={C.muted} />
              </Pressable>
            </View>
          )}
          <TextInput
            ref={input}
            accessibilityLabel="Message Fyde"
            placeholder="Describe a file or who to send it to…"
            placeholderTextColor={C.faint}
            multiline
            value={text}
            onChangeText={setText}
            maxLength={2000}
            style={s.input}
          />
          {channelOpen && (
            <View style={s.channelMenu}>
              {CHANNELS.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: channel === item.id }}
                  onPress={() => {
                    setChannel(item.id);
                    setChannelOpen(false);
                  }}
                  style={[s.channelOption, channel === item.id && s.channelOptionOn]}
                >
                  <Text style={[s.channelText, channel === item.id && { color: "#FFFFFF" }]}>{item.name}</Text>
                </Pressable>
              ))}
            </View>
          )}
          <View style={s.composerBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Send via ${CHANNELS.find((c) => c.id === channel)?.name}. Change delivery`}
              onPress={() => setChannelOpen(!channelOpen)}
              style={s.channelPill}
            >
              <Text style={s.channelPillText}>
                via <Text style={{ fontWeight: "600", color: C.ink }}>{CHANNELS.find((c) => c.id === channel)?.name}</Text>
              </Text>
              <ChevronIcon size={10} color={C.muted} direction={channelOpen ? "up" : "down"} />
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityLabel="Send message"
              accessibilityRole="button"
              disabled={busy || !text.trim()}
              onPress={() => submit()}
              style={[s.send, (busy || !text.trim()) && { backgroundColor: C.sunkenStrong }]}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <ArrowUpIcon size={16} />}
            </Pressable>
          </View>
        </View>
        <Text style={[ui.fine, { textAlign: "center", fontSize: 11 }]}>
          Private chat · Fyde asks before sending{contextEnabled ? "" : " · recent choices off"}
        </Text>
      </View>
      <FileSheet
        file={open}
        onClose={() => setOpen(null)}
        downloadLabel={open?.item_id ? "Download / open" : "Download original"}
        onDownload={() =>
          open
            ? download(
                open.item_id || open.api_download_url
                  ? open
                  : { ...open, api_download_url: `/api/v1/files/${open.id}/download/` },
              )
            : Promise.resolve()
        }
      />
    </View>
  );
}

function ConfirmCard({
  turn,
  active,
  answered,
  channel,
  onOpen,
  onConfirm,
  onRetry,
  onExpand,
}: {
  turn: Turn;
  active: boolean;
  answered: boolean;
  channel: Channel;
  onOpen: (file: FileCard) => void;
  onConfirm: (file: FileCard, contact?: Contact) => void;
  onRetry: () => void;
  onExpand: () => void;
}) {
  const files = turn.result.files || [];
  const contact = turn.result.contacts?.[0];
  const [index, setIndex] = useState(0),
    [alternatives, setAlternatives] = useState(false);
  const file = files[index];
  const others = files.filter((_, i) => i !== index);
  const firstName = contact?.name.split(" ")[0];
  return (
    <View style={s.confirm}>
      <Text style={[ui.eyebrow, { color: active ? C.accent : answered ? C.success : C.muted }]}>
        {active ? "Is this the right file?" : answered ? "You approved this file" : "Earlier suggestion"}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Proposed file ${file.title}. Show details`}
        onPress={() => onOpen(file)}
        style={({ pressed }) => [s.proposal, pressed && { opacity: 0.85 }]}
      >
        <View style={s.proposalArt}>
          <FileIcon file={file} size={64} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={2} style={s.proposalTitle}>
            {file.title}
          </Text>
          <Text numberOfLines={1} style={ui.fine}>
            {[KINDS[kindOf(file)].label, fileMeta(file), file.number ? `v${file.number}` : ""]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          {!!file.matter && (
            <View style={s.casePill}>
              <Text style={s.casePillText}>{file.matter}</Text>
            </View>
          )}
        </View>
      </Pressable>
      {!!file.match?.reason && (
        <View style={s.why}>
          <View style={[s.whyDot, { backgroundColor: file.match.exact ? C.success : C.faint }]}>
            {file.match.exact ? <CheckIcon size={9} color="#FFFFFF" weight={1.6} /> : <SearchIcon size={9} color="#FFFFFF" weight={1.4} />}
          </View>
          <Text style={[s.whyText, file.match.exact && { color: C.success }]}>{file.match.reason}</Text>
        </View>
      )}
      {contact && (
        <View style={s.recipient}>
          <Avatar name={contact.name} size={32} tone={C.bg} />
          <View style={{ flex: 1 }}>
            <Text style={s.recipientName}>To {contact.name}</Text>
            <Text style={ui.fine}>
              {[contact.relationship, CHANNELS.find((c) => c.id === channel)?.name === "Fyde" ? "in Fyde" : `by ${CHANNELS.find((c) => c.id === channel)?.name}`]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          {contact.verified && (
            <View style={s.verified}>
              <Text style={s.verifiedText}>Verified</Text>
            </View>
          )}
        </View>
      )}
      {active && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1.3 }}>
            <Button compact title={firstName ? `Send to ${firstName}` : "Send this file"} onPress={() => onConfirm(file, contact)} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              compact
              secondary
              style={{ backgroundColor: C.bg }}
              title={alternatives ? "Hide others" : "Not this one"}
              onPress={() => {
                if (!alternatives) onExpand();
                setAlternatives(!alternatives);
              }}
            />
          </View>
        </View>
      )}
      {active && alternatives && (
        <View style={{ gap: 10 }}>
          {others.length > 0 && (
            <>
              <Text style={ui.fine}>Did you mean one of these?</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {others.map((other) => (
                  <Pressable
                    key={other.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${other.title} instead`}
                    onPress={() => {
                      setIndex(files.indexOf(other));
                      setAlternatives(false);
                    }}
                    style={({ pressed }) => [s.alt, pressed && { opacity: 0.7 }]}
                  >
                    <FileIcon file={other} size={46} bg={C.bg} />
                    <Text numberOfLines={2} style={s.altTitle}>
                      {other.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}
          <Pressable accessibilityRole="button" onPress={onRetry} style={{ paddingVertical: 6 }}>
            <Text style={{ color: C.accent, fontWeight: "600", fontSize: 14 }}>None of these — describe it again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function FileStrip({
  files,
  label,
  onPress,
}: {
  files: FileCard[];
  label?: string;
  onPress: (file: FileCard) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {!!label && <Text style={ui.fine}>{label}</Text>}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 8 }}>
        {files.map((file) => (
          <Pressable
            key={file.id}
            accessibilityRole="button"
            accessibilityLabel={file.title}
            onPress={() => onPress(file)}
            style={({ pressed }) => [s.stripTile, pressed && { opacity: 0.7 }]}
          >
            <View style={s.stripArt}>
              <FileIcon file={file} size={56} />
            </View>
            <Text numberOfLines={2} style={s.altTitle}>
              {file.title}
            </Text>
            <Text numberOfLines={1} style={[ui.fine, { fontSize: 11 }]}>
              {file.from ? `From ${file.from}` : fileMeta(file) || `v${file.number}`}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  log: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },
  welcome: { alignItems: "center", gap: 16, paddingTop: 28, paddingBottom: 12 },
  title: { fontFamily: serif, color: C.ink, fontSize: 32, lineHeight: 38, textAlign: "center", letterSpacing: -0.5 },
  suggestions: { alignSelf: "stretch", backgroundColor: C.sunken, borderRadius: 20, marginTop: 8 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  suggestionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.sunkenStrong },
  suggestionText: { fontSize: 15, color: C.ink, fontWeight: "500" },
  user: {
    alignSelf: "flex-end",
    maxWidth: "84%",
    backgroundColor: C.ink,
    borderRadius: 22,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  userText: { color: "#FFFFFF", fontSize: 16, lineHeight: 22 },
  fyde: { flexDirection: "row", gap: 12 },
  reply: { fontSize: 16, lineHeight: 23, color: C.ink },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8 },
  confirm: { backgroundColor: C.sunken, borderRadius: 22, padding: 14, gap: 12 },
  proposal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.bg,
    borderRadius: 16,
    padding: 10,
  },
  proposalArt: {
    width: 76,
    height: 76,
    borderRadius: 12,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  proposalTitle: { fontFamily: serif, fontSize: 17, lineHeight: 21, color: C.ink },
  casePill: {
    alignSelf: "flex-start",
    backgroundColor: C.accentSoft,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 2,
  },
  casePillText: { fontSize: 11, fontWeight: "600", color: C.accent },
  why: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 2 },
  whyDot: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 1 },
  whyText: { flex: 1, fontSize: 13, lineHeight: 18, color: C.muted },
  recipient: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 2 },
  recipientName: { fontSize: 14, fontWeight: "600", color: C.ink },
  verified: { backgroundColor: C.successSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  verifiedText: { fontSize: 11, fontWeight: "600", color: C.success },
  alt: { width: 104, backgroundColor: C.bg, borderRadius: 14, padding: 8, alignItems: "center", gap: 4 },
  altTitle: { fontSize: 12, lineHeight: 15, color: C.ink, textAlign: "center", fontWeight: "500" },
  stripTile: { width: 112, alignItems: "center", gap: 4 },
  stripArt: {
    width: 112,
    height: 92,
    borderRadius: 14,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  person: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.sunken,
    borderRadius: 999,
    paddingLeft: 5,
    paddingRight: 14,
    paddingVertical: 5,
  },
  personText: { fontSize: 14, color: C.ink, fontWeight: "500" },
  receipt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.successSoft,
    borderRadius: 18,
    padding: 14,
  },
  receiptCheck: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.success,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptTitle: { fontSize: 15, fontWeight: "600", color: C.ink },
  composerWrap: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6, gap: 6, backgroundColor: C.bg },
  composer: {
    backgroundColor: C.sunken,
    borderRadius: 24,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 4,
  },
  attached: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.bg,
    borderRadius: 14,
    padding: 6,
    paddingRight: 8,
    marginBottom: 2,
  },
  attachedTitle: { fontSize: 13, fontWeight: "600", color: C.ink },
  attachedClose: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.sunken,
    alignItems: "center",
    justifyContent: "center",
  },
  input: { color: C.ink, fontSize: 16, lineHeight: 22, minHeight: 40, maxHeight: 130, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6 },
  composerBar: { flexDirection: "row", alignItems: "center", gap: 8 },
  channelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: C.bg,
  },
  channelPillText: { fontSize: 13, color: C.muted },
  channelMenu: { flexDirection: "row", gap: 6, paddingHorizontal: 4, paddingBottom: 4 },
  channelOption: { paddingHorizontal: 14, height: 32, borderRadius: 16, backgroundColor: C.bg, justifyContent: "center" },
  channelOptionOn: { backgroundColor: C.ink },
  channelText: { fontSize: 13, fontWeight: "500", color: C.ink },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
