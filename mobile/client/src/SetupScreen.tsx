import React, { useState, useRef } from "react";
import { View, Text, ScrollView, Platform } from "react-native";
import * as Picker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import type { Workspace } from "./types";
import { Button, Choices, Field, Toggle, styles as s, C } from "./ui";

type Props = {
  state: Workspace;
  mutate: <T>(path: string, data: unknown) => Promise<T>;
  finish: () => void;
};
export default function SetupScreen({ state, mutate, finish }: Props) {
  const [step, setStep] = useState("files"),
    [matter, setMatter] = useState(""),
    [matterName, setMatterName] = useState(""),
    [type, setType] = useState("general"),
    [sensitive, setSensitive] = useState(false);
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [phone, setPhone] = useState(""),
    [relationship, setRelationship] = useState(""),
    [contact, setContact] = useState("");
  const [types, setTypes] = useState(["*"]),
    [futureFiles, setFutureFiles] = useState(true),
    [futureVersions, setFutureVersions] = useState(true),
    [allowSensitive, setAllowSensitive] = useState(false),
    [consent, setConsent] = useState(false),
    [days, setDays] = useState("90"),
    [limit, setLimit] = useState("100");
  const policyAttempt = useRef<{ key: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [progress, setProgress] = useState<string[]>([]);
  async function perform(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function pickFiles() {
    const chosen = await Picker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: [
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    });
    if (chosen.canceled) return;
    await perform(async () => {
      setProgress([]);
      for (let i = 0; i < chosen.assets.length; i++) {
        const asset = chosen.assets[i];
        setNotice(`Uploading ${i + 1}/${chosen.assets.length}: ${asset.name}`);
        const data = new FormData();
        data.append(
          "file",
          asset.file ||
            ({
              uri: asset.uri,
              name: asset.name,
              type: asset.mimeType || "application/octet-stream",
            } as unknown as Blob),
        );
        data.append("matter_id", matter);
        data.append("document_type", type);
        data.append("sensitive", String(sensitive));
        try {
          await mutate("/api/v1/upload/", data);
          setProgress((old) => [
            ...old,
            `${asset.name} · uploaded privately; safety checks pending`,
          ]);
        } catch (e) {
          setProgress((old) => [
            ...old,
            `${asset.name} · ${(e as Error).message}`,
          ]);
        } finally {
          if (
            Platform.OS !== "web" &&
            FileSystem.cacheDirectory &&
            asset.uri.startsWith(FileSystem.cacheDirectory)
          ) {
            await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(
              () => {},
            );
          }
        }
      }
      setNotice(
        "Import finished. Review each result below. Ready files can be shared; quarantined files cannot.",
      );
    });
  }
  const caseItems = [{ id: "", name: "Private · no case" }, ...state.matters];
  return (
    <ScrollView
      contentContainerStyle={s.body}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={s.eyebrow}>WORKSPACE SETUP</Text>
      <Text style={s.heading}>Set up your{`\n`}workspace.</Text>
      <Choices
        label="Setup step"
        value={step}
        onChange={setStep}
        items={[
          { id: "files", name: "1 · Files" },
          { id: "people", name: "2 · People" },
          { id: "permissions", name: "3 · Automatic sharing" },
        ]}
      />
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {!!notice && (
        <Text style={s.sub} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}
      {step === "files" ? (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Create a case or project</Text>
            <Field
              label="Case name"
              placeholder="Immigration case"
              value={matterName}
              onChangeText={setMatterName}
            />
            <Button
              title="Create case"
              secondary
              disabled={busy || !matterName.trim()}
              onPress={() =>
                perform(async () => {
                  const item = await mutate<{ id: string }>(
                    "/api/v1/matters/",
                    { name: matterName },
                  );
                  setMatter(item.id);
                  setMatterName("");
                  setNotice(
                    "Case created. Assign only the documents that belong to it.",
                  );
                })
              }
            />
          </View>
          <View style={s.card}>
            <Text style={s.cardTitle}>Import your files</Text>
            <Choices
              label="Assign uploaded files to"
              items={caseItems}
              value={matter}
              onChange={setMatter}
            />
            <Choices
              label="Document type"
              items={state.document_types}
              value={type}
              onChange={setType}
            />
            <Toggle
              label="Mark these files sensitive"
              value={sensitive}
              onChange={setSensitive}
            />
            <Button
              title={busy ? "Importing…" : "Choose multiple files ↑"}
              disabled={busy}
              onPress={() => pickFiles().catch((e) => setError(e.message))}
            />
            <Text style={s.fine}>
              Up to {state.plan.file_mib} MiB per file and{" "}
              {state.plan.storage_mib} MiB stored. TXT, Markdown, CSV, PDF and
              DOCX. Uploads remain private. PDF/DOCX need the configured malware
              scanner.
            </Text>
            {progress.map((line, i) => (
              <Text key={i} style={s.fine}>
                {line}
              </Text>
            ))}
          </View>
          <Text style={s.fine}>
            Assigning a document to a case with an active permission can make it
            eligible for automatic sharing. You can classify existing files in
            Files.
          </Text>
          <Button
            title="Next: your people →"
            onPress={() => setStep("people")}
          />
        </>
      ) : step === "people" ? (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Add someone you know</Text>
            <Field label="Name" value={name} onChangeText={setName} />
            <Field
              label="Relationship"
              placeholder="Lawyer"
              value={relationship}
              onChangeText={setRelationship}
            />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <Field
              label="Phone with country code (optional)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
            <Button
              title="Save contact"
              disabled={busy || !name || (!email && !phone)}
              onPress={() =>
                perform(async () => {
                  const person = await mutate<{ id: string }>(
                    "/api/v1/contacts/",
                    { name, relationship, email, phone },
                  );
                  setContact(person.id);
                  setName("");
                  setEmail("");
                  setPhone("");
                  setNotice(
                    "Contact saved. Relationship labels help chat, and do not grant access.",
                  );
                })
              }
            />
          </View>
          {state.contacts.map((person) => (
            <View key={person.id} style={s.card}>
              <Text style={s.cardTitle}>
                {person.name} · {person.relationship || "Contact"}
              </Text>
              <Text style={s.fine}>
                {person.endpoint} ·{" "}
                {person.verified
                  ? "Verified endpoint"
                  : "Needs a verified Fyde account for automatic case requests"}
              </Text>
            </View>
          ))}
          <Button
            title="Next: automatic sharing →"
            onPress={() => setStep("permissions")}
          />
        </>
      ) : (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Give permission once</Text>
            <Text style={s.sub}>
              Matching requests go directly to the verified recipient. No
              approval is needed for each request.
            </Text>
            <Choices
              label="Who can request?"
              items={state.contacts.map((p) => ({
                id: p.id,
                name: `${p.name} · ${p.relationship || "Contact"}`,
              }))}
              value={contact}
              onChange={setContact}
            />
            <Choices
              label="For which case?"
              items={state.matters}
              value={matter}
              onChange={setMatter}
            />
            <Text style={s.label}>Allowed document types</Text>
            <Toggle
              label="Any document type in this case"
              value={types.includes("*")}
              onChange={() => setTypes(["*"])}
            />
            {state.document_types.map((kind) => (
              <Toggle
                key={kind.id}
                label={kind.name}
                value={types.includes(kind.id)}
                onChange={(selected) =>
                  setTypes((old) => {
                    const next = old.filter((t) => t !== "*" && t !== kind.id);
                    if (selected) next.push(kind.id);
                    return next.length ? next : ["*"];
                  })
                }
              />
            ))}
            <Toggle
              label="Include future files I assign to this case"
              value={futureFiles}
              onChange={setFutureFiles}
            />
            <Toggle
              label="Include future versions"
              value={futureVersions}
              onChange={setFutureVersions}
            />
            <Toggle
              label="Include files marked sensitive"
              value={allowSensitive}
              onChange={setAllowSensitive}
            />
            <Field
              label="Expires in days (1–365)"
              value={days}
              onChangeText={setDays}
              keyboardType="number-pad"
            />
            <Field
              label="Maximum requests (1–1,000)"
              value={limit}
              onChangeText={setLimit}
              keyboardType="number-pad"
            />
            <View
              style={{
                backgroundColor: C.soft,
                borderRadius: 10,
                padding: 15,
                gap: 12,
              }}
            >
              <Text style={s.sub}>
                Only files assigned to the selected case and allowed by these
                limits can leave your account. The recipient or their scoped
                agent receives the exact permitted version. Other cases and
                private files remain outside the permission.
              </Text>
              <Toggle
                label="I authorize automatic releases within these limits"
                value={consent}
                onChange={setConsent}
              />
            </View>
            <Button
              title="Enable automatic sharing →"
              disabled={busy || !matter || !contact || !consent}
              onPress={() =>
                perform(async () => {
                  const attemptKey = JSON.stringify([
                    contact,
                    matter,
                    types,
                    days,
                    limit,
                    futureFiles,
                    futureVersions,
                    allowSensitive,
                  ]);
                  if (policyAttempt.current?.key !== attemptKey)
                    policyAttempt.current = {
                      key: attemptKey,
                      id: Crypto.randomUUID(),
                    };
                  await mutate("/api/v1/policies/", {
                    operation_id: policyAttempt.current.id,
                    matter_id: matter,
                    contact_id: contact,
                    types,
                    days: Number(days),
                    max_requests: Number(limit),
                    future_files: futureFiles,
                    future_versions: futureVersions,
                    sensitive: allowSensitive,
                    confirm: consent,
                  });
                  policyAttempt.current = null;
                  setConsent(false);
                  setNotice(
                    "Automatic case sharing enabled. The verified recipient can now request permitted documents without another approval.",
                  );
                })
              }
            />
          </View>
          {state.policies.map((permission) => (
            <View style={s.card} key={permission.id}>
              <Text style={s.cardTitle}>
                {permission.case} → {permission.contact}
              </Text>
              <Text style={s.fine}>
                {permission.types.includes("*")
                  ? "Any document type"
                  : permission.types.join(", ")}{" "}
                · {permission.used}/{permission.limit} requests ·{" "}
                {permission.sensitive
                  ? "sensitive allowed"
                  : "sensitive excluded"}{" "}
                · expires {new Date(permission.expires_at).toLocaleDateString()}
              </Text>
              {permission.revoked ? (
                <Text style={s.fine}>Revoked</Text>
              ) : (
                <Button
                  title="Revoke permission"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    perform(async () => {
                      await mutate(
                        `/api/v1/policies/${permission.id}/revoke/`,
                        {},
                      );
                      setNotice(
                        "Permission revoked. Future requests and downloads are blocked.",
                      );
                    })
                  }
                />
              )}
            </View>
          ))}
          <Button
            title="Finish setup & open chat →"
            disabled={busy}
            onPress={() =>
              perform(async () => {
                await mutate("/api/v1/setup/complete/", {});
                finish();
              })
            }
          />
        </>
      )}
    </ScrollView>
  );
}
