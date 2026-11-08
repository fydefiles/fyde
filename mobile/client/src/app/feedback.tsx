import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Link } from "expo-router";
import { call, restoreSession } from "../api";
import { Button, Choices, Field, Toggle, styles } from "../ui";
type Item = { id: string; title: string; body: string; visibility: string };
export default function Feedback() {
  const [token, setToken] = useState<string | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [visibility, setVisibility] = useState("private"),
    [consent, setConsent] = useState(false),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    restoreSession()
      .then(async (value) => {
        if (!value)
          throw new Error("Sign in to send feedback or contact support.");
        setToken(value);
        setItems(
          (await call<{ items: Item[] }>("/api/v1/feedback/", value)).items,
        );
      })
      .catch((e) => setMessage(e.message));
  }, []);
  async function submit() {
    if (busy || !token) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await call<{ message: string }>(
        "/api/v1/feedback/",
        token,
        "POST",
        { title, body, visibility, consent },
      );
      setMessage(result.message);
      setTitle("");
      setBody("");
      setConsent(false);
      setItems(
        (await call<{ items: Item[] }>("/api/v1/feedback/", token)).items,
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>FEEDBACK AND SUPPORT</Text>
      <Text style={styles.heading}>Tell us what happened.</Text>
      <Text style={styles.sub}>
        Leave out passwords, document text and other private details. Private
        support stays private.
      </Text>
      {!!message && (
        <Text style={styles.fine} accessibilityRole="alert">
          {message}
        </Text>
      )}
      {token && (
        <>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            maxLength={140}
          />
          <Field
            label="Your feedback"
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={5000}
          />
          <Choices
            label="Visibility"
            value={visibility}
            onChange={setVisibility}
            items={[
              { id: "private", name: "Private support" },
              { id: "public", name: "Public feature request" },
            ]}
          />
          {visibility === "public" && (
            <Toggle
              label="I approve public use of this feedback after review"
              value={consent}
              onChange={setConsent}
            />
          )}
          <Button
            title={busy ? "Saving…" : "Submit feedback"}
            disabled={
              busy ||
              !title.trim() ||
              !body.trim() ||
              (visibility === "public" && !consent)
            }
            onPress={submit}
          />
          {items.map((item) => (
            <View key={item.id} style={styles.card}>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.fine}>{item.visibility}</Text>
              <Text style={styles.sub}>{item.body}</Text>
              {item.visibility !== "withdrawn" && (
                <Button
                  title="Withdraw feedback"
                  secondary
                  onPress={async () => {
                    try {
                      await call(
                        `/api/v1/feedback/${item.id}/withdraw/`,
                        token,
                        "POST",
                        {},
                      );
                      setItems(
                        (
                          await call<{ items: Item[] }>(
                            "/api/v1/feedback/",
                            token,
                          )
                        ).items,
                      );
                    } catch (e) {
                      setMessage((e as Error).message);
                    }
                  }}
                />
              )}
            </View>
          ))}
        </>
      )}
      <Link href="/" style={styles.fine}>
        Back to Fyde →
      </Link>
    </ScrollView>
  );
}
