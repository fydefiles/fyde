import React from "react";
import { View, StyleSheet, Text } from "react-native";
import { C } from "./ui";

export function ChatIcon({ color = C.ink }: { color?: string }) {
  return (
    <View accessible={false} style={[s.bubble, { borderColor: color }]}>
      <View style={[s.tail, { borderColor: color }]} />
    </View>
  );
}
export function SearchIcon({ color = C.muted }: { color?: string }) {
  return (
    <View accessible={false} style={s.search}>
      <View style={[s.lens, { borderColor: color }]} />
      <View style={[s.handle, { backgroundColor: color }]} />
    </View>
  );
}
export function ReceivedIcon({ color = C.muted }: { color?: string }) {
  return (
    <View accessible={false} style={s.received}>
      <Text style={{ color, fontSize: 24, lineHeight: 25 }}>↓</Text>
      <View style={[s.tray, { borderColor: color }]} />
    </View>
  );
}
const s = StyleSheet.create({
  bubble: { width: 24, height: 19, borderWidth: 2, borderRadius: 6 },
  tail: {
    width: 6,
    height: 6,
    borderLeftWidth: 2,
    position: "absolute",
    bottom: -6,
    left: 2,
    transform: [{ skewY: "-35deg" }],
  },
  search: { width: 17, height: 18, transform: [{ scale: 1.25 }] },
  lens: {
    width: 12,
    height: 12,
    borderWidth: 1.6,
    borderColor: C.muted,
    borderRadius: 6,
  },
  handle: {
    width: 7,
    height: 1.6,
    backgroundColor: C.muted,
    position: "absolute",
    left: 9,
    top: 12,
    transform: [{ rotate: "45deg" }],
  },
  received: { width: 26, height: 25, alignItems: "center" },
  tray: {
    position: "absolute",
    bottom: 0,
    width: 24,
    height: 8,
    borderWidth: 1.5,
    borderTopWidth: 0,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
  },
});
