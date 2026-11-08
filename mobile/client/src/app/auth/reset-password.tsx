import React, { useState } from "react";
import { ScrollView, Text } from "react-native";
import { Link } from "expo-router";
import { call } from "../../api";
import { Button, Field, styles } from "../../ui";

export default function ResetPassword() {
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [password, setPassword] = useState("");
  const [sent, setSent] = useState(false),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await call(
        sent ? "/api/v1/auth/reset-password/" : "/api/v1/auth/reset-code/",
        null,
        "POST",
        sent ? { email, code, password } : { email },
      );
      if (sent) {
        setPassword("");
        setCode("");
        setDone(true);
        setMessage("Password updated. Sign in again.");
      } else {
        setSent(true);
        setMessage(
          "If this account can reset its password, a code is on its way.",
        );
      }
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ScrollView
      contentContainerStyle={[
        styles.body,
        { maxWidth: 500, width: "100%", alignSelf: "center", paddingTop: 44 },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.eyebrow}>FYDE ACCOUNT</Text>
      <Text style={styles.heading}>Reset your password.</Text>
      <Text style={styles.sub}>
        Enter your email to receive a verification code.
      </Text>
      {!!message && (
        <Text style={styles.fine} accessibilityRole="alert">
          {message}
        </Text>
      )}
      {!done && (
        <>
          <Field
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
          {sent && (
            <>
              <Field
                label="Verification code"
                value={code}
                onChangeText={setCode}
                autoComplete="one-time-code"
                keyboardType="number-pad"
              />
              <Field
                label="New password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
              />
            </>
          )}
          <Button
            title={
              busy
                ? "Connecting…"
                : sent
                  ? "Update password →"
                  : "Send verification code →"
            }
            disabled={
              busy || !email || (sent && (!code || password.length < 10))
            }
            onPress={submit}
          />
        </>
      )}
      <Link href="/" style={styles.fine}>
        Return to sign in →
      </Link>
    </ScrollView>
  );
}
