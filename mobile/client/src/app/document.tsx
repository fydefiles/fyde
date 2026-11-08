import React, { useEffect, useState } from "react";
import { ScrollView, Text, View, Platform } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { call, download, restoreSession } from "../api";
import type { FileCard } from "../types";
import { Button, Field, styles } from "../ui";

type Version = FileCard & {
  sha256: string;
  check_detail: string;
  extraction_state: string;
  preferred: boolean;
};
type Document = { id: string; title: string; versions: Version[] };
export default function DocumentDetails() {
  const { id } = useLocalSearchParams<{ id: string }>(),
    router = useRouter();
  const [token, setToken] = useState<string | null>(null),
    [document, setDocument] = useState<Document | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(false),
    [confirm, setConfirm] = useState("");
  useEffect(() => {
    let active = true;
    restoreSession()
      .then(async (value) => {
        if (!value) throw new Error("Sign in to view this document.");
        if (!active) return;
        setToken(value);
        const data = await call<Document>(`/api/v1/documents/${id}/`, value);
        if (active) setDocument(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setDocument(await call<Document>(`/api/v1/documents/${id}/`, token));
  }
  async function addVersion() {
    // The picker opens directly from a user action on web.
    const picked = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      base64: false,
      type: [
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    });
    if (picked.canceled) return;
    await perform(async () => {
      const asset = picked.assets[0];
      if (asset.size && asset.size > 25 * 1024 * 1024)
        throw new Error("Choose a file up to 25 MiB.");
      const form = new FormData();
      if (Platform.OS === "web") {
        if (!asset.file) throw new Error("Choose the file again.");
        form.append("file", asset.file, asset.name);
      } else
        form.append("file", {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || "application/octet-stream",
        } as unknown as Blob);
      form.append("document_id", id);
      await call("/api/v1/upload/", token, "POST", form);
      await refresh();
    });
  }
  return (
    <ScrollView
      contentContainerStyle={styles.body}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>PRIVATE DOCUMENT</Text>
      <Text style={styles.heading}>{document?.title || "Your document."}</Text>
      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {document && (
        <>
          <Button
            title="Refresh safety checks"
            secondary
            disabled={busy}
            onPress={() => perform(refresh)}
          />
          <Button
            title="Add a new version"
            disabled={busy}
            onPress={addVersion}
          />
          <Text style={styles.fine}>
            New versions upload privately and pass their own safety checks.
            Existing sharing stays bound to its exact version.
          </Text>
          {document.versions.map((v) => (
            <View key={v.id} style={styles.card}>
              <Text style={styles.cardTitle}>
                Version {v.number}
                {v.preferred ? " · preferred" : ""}
              </Text>
              <Text style={styles.fine}>
                {v.name} · {v.size} bytes · {v.state}
                {"\n"}
                {v.check_detail}
              </Text>
              <Text selectable style={styles.fine}>
                SHA-256: {v.sha256}
              </Text>
              <Button
                title="Download original ↓"
                secondary
                disabled={busy}
                onPress={() =>
                  perform(async () => {
                    if (!token) return;
                    await download(v, token);
                  })
                }
              />
              {!v.preferred && (
                <Button
                  title="Use this version in search"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    perform(async () => {
                      await call(
                        `/api/v1/documents/${id}/prefer/`,
                        token,
                        "POST",
                        { version_id: v.id },
                      );
                      await refresh();
                    })
                  }
                />
              )}
            </View>
          ))}
          <Button
            title={
              deleting
                ? "Cancel deletion"
                : "Delete this document and all versions"
            }
            secondary
            disabled={busy}
            onPress={() => setDeleting(!deleting)}
          />
          {deleting && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Permanently remove these originals?
              </Text>
              <Text style={styles.fine}>
                This revokes sharing and removes all versions and searchable
                text. Audit and usage records remain. Sign in within the last
                five minutes, then type your account email to confirm.
              </Text>
              <Field
                label="Confirm your account email"
                value={confirm}
                onChangeText={setConfirm}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Button
                title="Permanently delete originals"
                disabled={busy || !confirm}
                onPress={() =>
                  perform(async () => {
                    await call(
                      `/api/v1/documents/${id}/delete/`,
                      token,
                      "POST",
                      { confirm_email: confirm },
                    );
                    router.replace("/files");
                  })
                }
              />
            </View>
          )}
        </>
      )}
      <Link href="/files" style={styles.fine}>
        Back to files →
      </Link>
    </ScrollView>
  );
}
