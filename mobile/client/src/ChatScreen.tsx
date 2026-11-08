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
import type { Channel, Choice, FileCard, Turn } from "./types";
import { Button, C, Choices, styles as ui, serif } from "./ui";

type Props = {
  turns: Turn[];
  defaultChannel: Channel;
  contextEnabled: boolean;
  send: (
    message: string,
    operation: string,
    channel: Channel,
    choice?: Choice,
  ) => Promise<void>;
  openManagement: (action: {
    section: "files" | "people" | "permissions" | "classify";
    matter_id?: string;
    contact_id?: string;
  }) => void;
  download: (file: FileCard) => Promise<void>;
};
export default function ChatScreen({
  turns,
  defaultChannel,
  contextEnabled,
  send,
  openManagement,
  download,
}: Props) {
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [channel, setChannel] = useState<Channel>(defaultChannel);
  const operation = useRef(Crypto.randomUUID()),
    scroll = useRef<React.ComponentRef<typeof ScrollView>>(null),
    pending = useRef<{
      text: string;
      choice?: Choice;
      channel: Channel;
    } | null>(null);
  useEffect(() => {
    if (!busy) scroll.current?.scrollToEnd({ animated: false });
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
    try {
      await send(message, operation.current, channel, choice);
      setText("");
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
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={s.log}
        keyboardShouldPersistTaps="handled"
      >
        {!turns.length && (
          <View style={s.welcome}>
            <View style={s.orb}>
              <Text style={{ color: C.accent, fontSize: 34 }}>✳</Text>
            </View>
            <Text style={s.title}>
              What would you like{`\n`}to take care of?
            </Text>
            <Text style={[ui.sub, { textAlign: "center" }]}>
              Find a file, send it to someone you know, or request permitted
              case documents.
            </Text>

            {[
              "Add files",
              "Find my passport",
              "Send it to my lawyer",
              "Request passport for Immigration case",
            ].map((prompt) => (
              <Pressable
                key={prompt}
                onPress={() => setText(prompt)}
                style={ui.card}
                accessibilityRole="button"
              >
                <Text style={{ color: C.ink, fontSize: 13 }}>{prompt} ↗</Text>
              </Pressable>
            ))}
          </View>
        )}
        {turns.map((turn) => (
          <View key={turn.id} style={{ gap: 18, marginBottom: 24 }}>
            <View style={s.user}>
              <Text style={ui.fine}>You</Text>
              <Text style={s.message}>{turn.message}</Text>
            </View>
            <View style={{ gap: 12 }}>
              <Text style={s.speaker}>✳ Fyde</Text>
              <Text style={s.message}>{turn.reply}</Text>
              {(turn.result.files || []).map((file) => (
                <View key={file.id} style={ui.card}>
                  <Text style={ui.cardTitle}>{file.title}</Text>
                  <Text style={ui.fine}>
                    {file.name} · v{file.number} · {file.state}
                  </Text>
                  {turn.result.kind === "clarify" ? (
                    <Button
                      title="Choose this file"
                      secondary
                      disabled={busy}
                      onPress={() =>
                        choose(
                          turn,
                          { version_id: file.id },
                          `Use ${file.title}`,
                        )
                      }
                    />
                  ) : turn.result.kind === "received" ? (
                    <Button
                      title="Download file ↓"
                      secondary
                      onPress={() =>
                        download(file).catch((e) => setError(e.message))
                      }
                    />
                  ) : turn.result.kind === "search" ? (
                    <Button
                      title="Download original ↓"
                      secondary
                      onPress={() =>
                        download({
                          ...file,
                          api_download_url: `/api/v1/files/${file.id}/download/`,
                        }).catch((e) => setError(e.message))
                      }
                    />
                  ) : null}
                </View>
              ))}
              {(turn.result.contacts || []).map((contact) => (
                <Button
                  key={contact.id}
                  title={`${contact.name} · ${contact.relationship || contact.endpoint}`}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    choose(
                      turn,
                      { contact_id: contact.id },
                      `Use ${contact.name}`,
                    )
                  }
                />
              ))}
              {(turn.result.policies || []).map((policy) => (
                <Button
                  key={policy.id}
                  title={`${policy.name} · from ${policy.from}`}
                  secondary
                  disabled={busy}
                  onPress={() =>
                    choose(turn, { policy_id: policy.id }, `Use ${policy.name}`)
                  }
                />
              ))}
              {(turn.result.transfers || []).map((transfer, index) => (
                <View key={transfer.id || index} style={ui.card}>
                  <Text style={ui.cardTitle}>{transfer.title}</Text>
                  <Text style={ui.fine}>
                    {transfer.message || transfer.state.replaceAll("_", " ")}
                  </Text>
                </View>
              ))}
              {turn.result.kind === "policy_draft" && (
                <Button
                  title="Review automatic sharing →"
                  secondary
                  onPress={() =>
                    openManagement({
                      section: "permissions",
                      matter_id: turn.result.matter_id,
                      contact_id: turn.result.contact_id,
                    })
                  }
                />
              )}
              {turn.result.kind === "workspace_action" &&
                turn.result.section && (
                  <Button
                    title={turn.result.action_label || "Review changes →"}
                    secondary
                    onPress={() =>
                      openManagement({
                        section: turn.result.section!,
                        matter_id: turn.result.matter_id,
                        contact_id: turn.result.contact_id,
                      })
                    }
                  />
                )}
              {!!turn.result.remaining_versions?.length && (
                <Button
                  title="Send next batch →"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    choose(turn, { remaining: true }, "Send the next batch")
                  }
                />
              )}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={s.composer}>
        {!!error && (
          <Text accessibilityRole="alert" style={ui.error}>
            {error}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
          <TextInput
            accessibilityLabel="Message Fyde"
            placeholder="Send my passport to my lawyer…"
            placeholderTextColor={C.muted}
            multiline
            value={text}
            onChangeText={setText}
            maxLength={2000}
            style={s.input}
          />
          <Pressable
            accessibilityLabel="Send message"
            accessibilityRole="button"
            disabled={busy || !text.trim()}
            onPress={() => submit()}
            style={[s.send, (busy || !text.trim()) && { opacity: 0.45 }]}
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ fontSize: 24, color: "white" }}>↑</Text>
            )}
          </Pressable>
        </View>
        <Choices
          label="Send via"
          value={channel}
          onChange={(value) => setChannel(value as Channel)}
          items={[
            { id: "in_app", name: "Fyde" },
            { id: "email", name: "Email" },
            { id: "phone", name: "Phone (SMS)" },
          ]}
        />
        <Text style={ui.fine}>
          {busy
            ? "Checking files and permissions…"
            : contextEnabled
              ? "Private chat · recent choices last 15 minutes"
              : "Private chat · recent choices are off"}
        </Text>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  log: { padding: 22, paddingBottom: 25 },
  welcome: { gap: 17, paddingVertical: 30 },
  orb: {
    width: 62,
    height: 62,
    alignSelf: "center",
    backgroundColor: C.warm,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: serif,
    color: C.ink,
    fontSize: 34,
    lineHeight: 40,
    textAlign: "center",
  },
  message: { fontSize: 15, lineHeight: 23, color: C.ink },
  speaker: { fontSize: 12, fontWeight: "600", color: C.accent },
  user: {
    backgroundColor: C.soft,
    borderRadius: 14,
    padding: 17,
    alignSelf: "flex-end",
    maxWidth: "92%",
    gap: 7,
  },
  composer: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.paper,
    gap: 8,
  },
  input: {
    flex: 1,
    color: C.ink,
    fontSize: 15,
    minHeight: 48,
    maxHeight: 130,
    paddingVertical: 8,
  },
  send: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.accent,
    borderRadius: 9,
  },
});
