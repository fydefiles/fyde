import React, { useState } from "react";
import { View, Text } from "react-native";
import type { Contact } from "./types";
import { Button, Field, styles as s } from "./ui";

type Mutate = <T>(path: string, data: unknown) => Promise<T>;

export function ContactEditor({
  person,
  mutate,
}: {
  person: Contact;
  mutate: Mutate;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState({
    name: person.name,
    relationship: person.relationship,
    email: person.email,
    phone: person.phone,
    aliases: person.aliases || "",
  });
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>
        {person.name} · {person.relationship || "Contact"}
      </Text>
      <Text style={s.fine}>
        {person.endpoint} ·{" "}
        {person.verified
          ? "Verified endpoint"
          : "Needs a verified Fyde account for automatic requests"}
      </Text>
      <Button
        title={open ? "Cancel contact changes" : "Edit contact"}
        secondary
        disabled={busy}
        onPress={() => {
          setDraft({
            name: person.name,
            relationship: person.relationship,
            email: person.email,
            phone: person.phone,
            aliases: person.aliases || "",
          });
          setError("");
          setOpen(!open);
        }}
      />
      {open && (
        <>
          <Field
            label="Contact name"
            value={draft.name}
            onChangeText={(name) => setDraft((old) => ({ ...old, name }))}
          />
          <Field
            label="Contact relationship"
            value={draft.relationship}
            onChangeText={(relationship) =>
              setDraft((old) => ({ ...old, relationship }))
            }
          />
          <Field
            label="Contact email"
            value={draft.email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={(email) => setDraft((old) => ({ ...old, email }))}
          />
          <Field
            label="Contact phone"
            value={draft.phone}
            keyboardType="phone-pad"
            onChangeText={(phone) => setDraft((old) => ({ ...old, phone }))}
          />
          <Field
            label="Other names (comma separated)"
            value={draft.aliases}
            onChangeText={(aliases) => setDraft((old) => ({ ...old, aliases }))}
          />
          <Text style={s.fine}>
            Changing an email or phone revokes existing case permissions and
            stops earlier sharing links. Verify the new recipient and review a
            new permission before automatic requests resume.
          </Text>
          {!!error && (
            <Text style={s.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Button
            title={busy ? "Saving…" : "Save contact changes"}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                await mutate(`/api/v1/contacts/${person.id}/update/`, draft);
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      )}
    </View>
  );
}

export function CaseEditor({
  item,
  mutate,
}: {
  item: { id: string; name: string };
  mutate: Mutate;
}) {
  const [open, setOpen] = useState(false),
    [name, setName] = useState(item.name),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{item.name}</Text>
      <Button
        title={open ? "Cancel case rename" : "Rename case"}
        secondary
        disabled={busy}
        onPress={() => {
          setName(item.name);
          setError("");
          setOpen(!open);
        }}
      />
      {open && (
        <>
          <Field
            label="New case name"
            value={name}
            onChangeText={setName}
            maxLength={120}
          />
          <Text style={s.fine}>
            Renaming keeps the same assigned files and permissions.
          </Text>
          {!!error && (
            <Text style={s.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Button
            title={busy ? "Saving…" : "Save case name"}
            disabled={busy || !name.trim()}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                await mutate(`/api/v1/matters/${item.id}/rename/`, { name });
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </>
      )}
    </View>
  );
}
