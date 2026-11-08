import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { call, restoreSession } from "../api";
import { Button, styles } from "../ui";

type Receipt = {
  id: string;
  title: string;
  recipient: string;
  endpoint: string;
  status: string;
  sha256: string;
  number: number;
  expires_at: string;
  accepted_at: string | null;
  accessed_at: string | null;
  revoked_at: string | null;
};
type Item = { id: string; title: string; status: string };
export default function Receipts() {
  const { id } = useLocalSearchParams<{ id?: string }>(),
    router = useRouter();
  const [token, setToken] = useState<string | null>(null),
    [receipt, setReceipt] = useState<Receipt | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    restoreSession()
      .then(async (value) => {
        if (!value) throw new Error("Sign in to view your sharing receipts.");
        if (!active) return;
        setToken(value);
        if (id) {
          const data = await call<Receipt>(`/api/v1/transfers/${id}/`, value);
          if (active) setReceipt(data);
        } else {
          const data = await call<{ transfers: Item[] }>(
            "/api/v1/transfers/",
            value,
          );
          if (active) setItems(data.transfers);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  async function revoke() {
    if (!receipt || busy) return;
    setBusy(true);
    try {
      await call(`/api/v1/transfers/${receipt.id}/revoke/`, token, "POST", {});
      setReceipt(
        await call<Receipt>(`/api/v1/transfers/${receipt.id}/`, token),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.eyebrow}>SHARING ACTIVITY</Text>
      <Text style={styles.heading}>
        {receipt ? receipt.title : "Your sharing receipts."}
      </Text>
      {!!error && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {receipt ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>To {receipt.recipient}</Text>
          <Text selectable style={styles.fine}>
            {receipt.endpoint}
            {"\n"}Version {receipt.number} · {receipt.status}
            {"\n"}Expires {new Date(receipt.expires_at).toLocaleString()}
            {"\n\n"}SHA-256: {receipt.sha256}
            {"\n\n"}
            {receipt.accessed_at
              ? "Recipient download recorded."
              : receipt.accepted_at
                ? "Available in the recipient’s inbox."
                : "No delivery recorded."}
          </Text>
          {!receipt.revoked_at && (
            <Button
              title={busy ? "Revoking…" : "Revoke future downloads"}
              secondary
              disabled={busy}
              onPress={revoke}
            />
          )}
          <Text style={styles.fine}>
            Revoking stops future downloads. A copy already downloaded cannot be
            recalled.
          </Text>
        </View>
      ) : (
        items.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.fine}>{item.status}</Text>
            <Button
              title="View receipt →"
              secondary
              onPress={() =>
                router.push({ pathname: "/receipts", params: { id: item.id } })
              }
            />
          </View>
        ))
      )}
      {!id && !items.length && !error && (
        <Text style={styles.sub}>
          Your sharing history will appear here after you send a file.
        </Text>
      )}
      <Link href="/" style={styles.fine}>
        Back to Fyde →
      </Link>
    </ScrollView>
  );
}
