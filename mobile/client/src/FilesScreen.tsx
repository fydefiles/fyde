import React, { useState } from "react";
import { ScrollView, View, Text } from "react-native";
import type { Workspace, FileCard } from "./types";
import { Button, Choices, Toggle, styles as s } from "./ui";
type Props = {
  state: Workspace;
  save: (
    file: FileCard,
    matter: string,
    type: string,
    sensitive: boolean,
  ) => Promise<void>;
  setup: () => void;
  download: (file: FileCard) => Promise<void>;
};
function Editor({
  file,
  state,
  save,
  download,
}: {
  file: FileCard;
  state: Workspace;
  save: Props["save"];
  download: Props["download"];
}) {
  const [open, setOpen] = useState(false),
    [matter, setMatter] = useState(file.matter_id || ""),
    [type, setType] = useState(file.document_type),
    [sensitive, setSensitive] = useState(!!file.sensitive),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{file.title}</Text>
      <Text style={s.fine}>
        {file.name} · v{file.number} · {file.state} ·{" "}
        {file.matter || "Private · no case"}
      </Text>
      <Button
        title="Download original ↓"
        secondary
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setError("");
          try {
            await download({
              ...file,
              api_download_url: `/api/v1/files/${file.id}/download/`,
            });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {!!error && (
        <Text style={s.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Button
        title={open ? "Close classification" : "Classify case & type"}
        secondary
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Choices
            label="Case"
            items={[{ id: "", name: "Private · no case" }, ...state.matters]}
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
            label="Sensitive file"
            value={sensitive}
            onChange={setSensitive}
          />
          <Text style={s.fine}>
            Case assignment can make this file available under an active
            automatic sharing permission.
          </Text>
          <Button
            title="Save classification"
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              setError("");
              try {
                await save(file, matter, type, sensitive);
                setOpen(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
          {!!error && <Text style={s.error}>{error}</Text>}
        </>
      )}
    </View>
  );
}
export default function FilesScreen({ state, save, setup, download }: Props) {
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={s.eyebrow}>YOUR PRIVATE WORKSPACE</Text>
      <Text style={s.heading}>Your files.</Text>
      <Text style={s.sub}>
        {state.consumed} / {state.plan.sends ?? "∞"} sends this period.
        Receiving and repeat downloads do not add file sends.
      </Text>
      <Button title="Import more files ↑" onPress={setup} />
      {state.files.map((file) => (
        <Editor
          key={file.id}
          file={file}
          state={state}
          save={save}
          download={download}
        />
      ))}
      {!state.files.length && (
        <Text style={s.sub}>
          Choose files in setup. Your originals remain private until a
          permission allows a transfer.
        </Text>
      )}
    </ScrollView>
  );
}
