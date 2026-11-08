import React from "react";
import {
  StyleSheet,
  Platform,
  Text,
  TextInput,
  Pressable,
  View,
  Switch,
  TextInputProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

// Fyde keeps its wordmark (bold sans, terracotta dot) and Georgia display
// type. Everything else is a light, file-browser surface: white canvas,
// stone "sunken" panels instead of bordered cards, and ink for selection.
export const C = {
  bg: "#FFFFFF",
  paper: "#FFFFFF",
  sunken: "#F4F2EE",
  sunkenStrong: "#EAE6DF",
  ink: "#1C1B18",
  muted: "#78736A",
  faint: "#AAA59B",
  accent: "#BF5135",
  accentSoft: "#FBEEE8",
  line: "#ECE8E1",
  success: "#2F7D4F",
  successSoft: "#E8F3EC",
  danger: "#B4352A",
  // Older names kept so existing screens pick up the new palette.
  soft: "#F4F2EE",
  warm: "#FBEEE8",
};
export const serif =
  Platform.OS === "ios"
    ? "Georgia"
    : Platform.OS === "web"
      ? "Georgia, serif"
      : "serif";

export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Text
      accessibilityRole="header"
      accessibilityLabel="Fyde"
      style={{
        fontSize: size,
        fontWeight: "700",
        color: C.ink,
        letterSpacing: -size * 0.047,
      }}
    >
      fyde<Text style={{ color: C.accent }}>.</Text>
    </Text>
  );
}

export function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
  compact = false,
  style,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
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
        compact && styles.compact,
        style,
        pressed && { opacity: 0.8, transform: [{ scale: 0.99 }] },
        disabled && { opacity: 0.4 },
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
        placeholderTextColor={C.faint}
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
    <View style={styles.toggle}>
      <Text style={styles.toggleText}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: C.accent, false: C.sunkenStrong }}
        thumbColor="#FFFFFF"
        ios_backgroundColor={C.sunkenStrong}
      />
    </View>
  );
}
export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  role = "radio",
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  role?: "radio" | "tab" | "button";
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.chipText, selected && { color: "#FFFFFF" }]}
      >
        {label}
      </Text>
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
          <Chip
            key={item.id}
            label={item.name}
            selected={value === item.id}
            onPress={() => onChange(item.id)}
          />
        ))}
      </View>
    </View>
  );
}
export function Avatar({
  name,
  size = 36,
  tone = C.sunken,
}: {
  name: string;
  size?: number;
  tone?: string;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tone,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{ fontSize: size * 0.42, fontWeight: "600", color: C.ink }}
      >
        {(name || "?").trim().slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: 20, paddingBottom: 40, gap: 16 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.2,
    color: C.muted,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  heading: {
    fontFamily: serif,
    fontSize: 34,
    color: C.ink,
    lineHeight: 40,
    letterSpacing: -0.6,
  },
  sub: { fontSize: 15, lineHeight: 22, color: C.muted },
  label: { fontSize: 13, fontWeight: "600", color: C.ink, marginBottom: 8 },
  field: { marginBottom: 14 },
  input: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 50,
    backgroundColor: C.sunken,
    fontSize: 16,
    color: C.ink,
  },
  button: {
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: C.sunken },
  compact: { minHeight: 40, paddingVertical: 9, paddingHorizontal: 16 },
  buttonText: { fontSize: 15, fontWeight: "600", color: "#FFFFFF" },
  card: {
    backgroundColor: C.sunken,
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  cardTitle: { fontSize: 16, color: C.ink, fontWeight: "600" },
  fine: { fontSize: 12, color: C.muted, lineHeight: 17 },
  error: { color: C.danger, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 15,
    paddingVertical: 9,
    minHeight: 38,
    justifyContent: "center",
    backgroundColor: C.sunken,
  },
  chipSelected: { backgroundColor: C.ink },
  chipText: { color: C.ink, fontSize: 14, fontWeight: "500" },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
  },
  toggleText: { flex: 1, color: C.ink, fontSize: 15, lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.line },
});
