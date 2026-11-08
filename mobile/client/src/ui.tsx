import React from "react";
import {
  StyleSheet,
  Platform,
  Text,
  TextInput,
  Pressable,
  View,
  TextInputProps,
} from "react-native";
export const C = {
  bg: "#f8f9f4",
  paper: "#ffffff",
  ink: "#283022",
  muted: "#626b5c",
  accent: "#bf5135",
  line: "#dce0d3",
  soft: "#eceee4",
  warm: "#f0e5da",
};
export const serif =
  Platform.OS === "ios"
    ? "Georgia"
    : Platform.OS === "web"
      ? "Georgia, serif"
      : "serif";
export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.45 },
      ]}
    >
      <Text style={[styles.buttonText, secondary && { color: C.ink }]}>
        {title}
      </Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={C.muted}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}
export function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={styles.toggle}
    >
      <View
        style={[
          styles.box,
          value && { backgroundColor: C.accent, borderColor: C.accent },
        ]}
      >
        {value && <Text style={{ color: "white" }}>✓</Text>}
      </View>
      <Text style={styles.toggleText}>{label}</Text>
    </Pressable>
  );
}
export function Choices({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {items.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: value === item.id }}
            onPress={() => onChange(item.id)}
            style={[styles.chip, value === item.id && styles.chipSelected]}
          >
            <Text
              style={{
                color: value === item.id ? C.accent : C.ink,
                fontSize: 12,
              }}
            >
              {item.name}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: 22, paddingBottom: 40, gap: 18 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.7,
    color: C.muted,
    fontWeight: "600",
  },
  heading: { fontFamily: serif, fontSize: 38, color: C.ink, lineHeight: 43 },
  sub: { fontSize: 14, lineHeight: 22, color: C.muted },
  label: { fontSize: 12, fontWeight: "600", color: C.ink, marginBottom: 8 },
  field: { marginBottom: 15 },
  input: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    padding: 13,
    minHeight: 48,
    backgroundColor: C.paper,
    fontSize: 15,
    color: C.ink,
  },
  button: {
    backgroundColor: C.accent,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 19,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: C.line,
  },
  buttonText: { fontSize: 13, fontWeight: "600", color: "white" },
  card: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 18,
    gap: 10,
  },
  cardTitle: { fontSize: 15, color: C.ink, fontWeight: "600" },
  fine: { fontSize: 11, color: C.muted, lineHeight: 17 },
  error: { color: "#9b3424", fontSize: 13, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: C.paper,
  },
  chipSelected: { borderColor: C.accent, backgroundColor: C.warm },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    marginBottom: 10,
  },
  box: {
    width: 23,
    height: 23,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleText: { flex: 1, color: C.ink, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { height: 1, backgroundColor: C.line, marginVertical: 4 },
});
