// Small line icons drawn with plain Views, so the existing native build needs
// no extra icon or SVG modules.
import React from "react";
import { View, Text } from "react-native";
import { C, serif } from "./ui";

type IconProps = { size?: number; color?: string; weight?: number };

export function SearchIcon({ size = 22, color = C.ink, weight = 2 }: IconProps) {
  const lens = size * 0.62,
    handle = size * 0.34;
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: size * 0.08,
          top: size * 0.08,
          width: lens,
          height: lens,
          borderRadius: lens / 2,
          borderWidth: weight,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: handle,
          height: weight,
          borderRadius: weight,
          backgroundColor: color,
          left: size * 0.73 - handle / 2,
          top: size * 0.73 - weight / 2,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

export function ChatIcon({ size = 22, color = C.ink, weight = 2 }: IconProps) {
  const tail = size * 0.2;
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: size * 0.04,
          top: size * 0.1,
          width: size * 0.92,
          height: size * 0.68,
          borderRadius: size * 0.24,
          borderWidth: weight,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.22,
          top: size * 0.1 + size * 0.68 - weight,
          width: 0,
          height: 0,
          borderTopWidth: tail,
          borderRightWidth: tail,
          borderTopColor: color,
          borderRightColor: "transparent",
        }}
      />
      {[0.3, 0.5, 0.7].map((x) => (
        <View
          key={x}
          style={{
            position: "absolute",
            left: size * x - weight * 0.75,
            top: size * 0.44 - weight * 0.75,
            width: weight * 1.5,
            height: weight * 1.5,
            borderRadius: weight,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

export function ReceivedIcon({
  size = 22,
  color = C.ink,
  weight = 2,
}: IconProps) {
  const head = size * 0.26;
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: size * 0.05,
          bottom: size * 0.06,
          width: size * 0.9,
          height: size * 0.36,
          borderWidth: weight,
          borderTopWidth: 0,
          borderBottomLeftRadius: size * 0.14,
          borderBottomRightRadius: size * 0.14,
          borderColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size / 2 - weight / 2,
          top: size * 0.04,
          width: weight,
          height: size * 0.5,
          borderRadius: weight,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size / 2 - head / 2,
          top: size * 0.54 - head * 0.707 - head / 2,
          width: head,
          height: head,
          borderRightWidth: weight,
          borderBottomWidth: weight,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

export function ChevronIcon({
  size = 14,
  color = C.ink,
  weight = 2,
  direction = "right",
}: IconProps & { direction?: "right" | "left" | "down" | "up" }) {
  const box = size * 0.55;
  const rotate = { right: "-45deg", down: "45deg", left: "135deg", up: "225deg" }[
    direction
  ];
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: box,
          height: box,
          borderRightWidth: weight,
          borderBottomWidth: weight,
          borderColor: color,
          transform: [{ rotate }],
          marginTop: direction === "down" ? -box / 2 : direction === "up" ? box / 2 : 0,
          marginLeft:
            direction === "right" ? -box / 2 : direction === "left" ? box / 2 : 0,
        }}
      />
    </View>
  );
}

export function CheckIcon({ size = 16, color = C.ink, weight = 2 }: IconProps) {
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: size * 0.32,
          height: size * 0.62,
          borderRightWidth: weight,
          borderBottomWidth: weight,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
          marginTop: -size * 0.12,
        }}
      />
    </View>
  );
}

function Cross({
  size,
  color,
  weight,
  angle,
}: Required<IconProps> & { angle: number }) {
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: `${angle}deg` }],
      }}
    >
      <View
        style={{
          position: "absolute",
          width: size * 0.78,
          height: weight,
          borderRadius: weight,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          width: weight,
          height: size * 0.78,
          borderRadius: weight,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
export const PlusIcon = ({ size = 16, color = C.ink, weight = 2 }: IconProps) => (
  <Cross size={size} color={color} weight={weight} angle={0} />
);
export const CloseIcon = ({ size = 16, color = C.ink, weight = 2 }: IconProps) => (
  <Cross size={size} color={color} weight={weight} angle={45} />
);

export function GridIcon({ size = 18, color = C.ink, weight = 1.6 }: IconProps) {
  const cell = size * 0.4;
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignContent: "space-between",
        padding: size * 0.04,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={{
            width: cell,
            height: cell,
            borderRadius: cell * 0.28,
            borderWidth: weight,
            borderColor: color,
          }}
        />
      ))}
    </View>
  );
}

export function ListIcon({ size = 18, color = C.ink, weight = 1.8 }: IconProps) {
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        justifyContent: "space-evenly",
      }}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: size * 0.14 }}>
          <View
            style={{
              width: weight * 1.4,
              height: weight * 1.4,
              borderRadius: weight,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              flex: 1,
              height: weight,
              borderRadius: weight,
              backgroundColor: color,
            }}
          />
        </View>
      ))}
    </View>
  );
}

export function SortIcon({ size = 18, color = C.ink, weight = 1.8 }: IconProps) {
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, justifyContent: "space-evenly" }}
    >
      {[1, 0.68, 0.36].map((w) => (
        <View
          key={w}
          style={{
            width: size * w,
            height: weight,
            borderRadius: weight,
            backgroundColor: color,
          }}
        />
      ))}
    </View>
  );
}

export function SlidersIcon({
  size = 18,
  color = C.ink,
  weight = 1.8,
}: IconProps) {
  const knob = size * 0.32;
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, justifyContent: "space-evenly" }}
    >
      {[0.28, 0.68].map((x) => (
        <View key={x} style={{ height: knob, justifyContent: "center" }}>
          <View
            style={{ height: weight, borderRadius: weight, backgroundColor: color }}
          />
          <View
            style={{
              position: "absolute",
              left: size * x - knob / 2,
              width: knob,
              height: knob,
              borderRadius: knob / 2,
              borderWidth: weight,
              borderColor: color,
              backgroundColor: C.bg,
            }}
          />
        </View>
      ))}
    </View>
  );
}

export function StarIcon({
  size = 18,
  color = C.ink,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <Text
      accessible={false}
      style={{
        fontSize: size,
        lineHeight: size * 1.1,
        color,
        width: size,
        textAlign: "center",
      }}
    >
      {filled ? "★" : "☆"}
    </Text>
  );
}

export function ArrowUpIcon({
  size = 18,
  color = "#FFFFFF",
  weight = 2.2,
}: IconProps) {
  const head = size * 0.46;
  return (
    <View accessible={false} style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          left: size / 2 - weight / 2,
          top: size * 0.1,
          width: weight,
          height: size * 0.82,
          borderRadius: weight,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size / 2 - head / 2,
          top: size * 0.1 + head * 0.2,
          width: head,
          height: head,
          borderLeftWidth: weight,
          borderTopWidth: weight,
          borderColor: color,
          transform: [{ rotate: "45deg" }],
        }}
      />
    </View>
  );
}

export function PaperclipIcon({
  size = 18,
  color = C.ink,
  weight = 1.8,
}: IconProps) {
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: "40deg" }],
      }}
    >
      <View
        style={{
          width: size * 0.42,
          height: size * 0.95,
          borderRadius: size * 0.21,
          borderWidth: weight,
          borderColor: color,
          alignItems: "center",
          paddingTop: size * 0.18,
        }}
      >
        <View
          style={{
            width: size * 0.16,
            height: size * 0.46,
            borderRadius: size * 0.08,
            borderWidth: weight,
            borderColor: color,
          }}
        />
      </View>
    </View>
  );
}

// Fyde's square "f" mark from the web sidebar, used as the assistant avatar.
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <View
      accessible={false}
      style={{
        width: size,
        height: size * 1.08,
        borderRadius: size * 0.3,
        backgroundColor: C.accent,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: "-6deg" }],
      }}
    >
      <Text
        style={{
          color: "#FFFFFF",
          fontFamily: serif,
          fontStyle: "italic",
          fontSize: size * 0.86,
          lineHeight: size * 1.02,
          marginTop: -size * 0.04,
        }}
      >
        f
      </Text>
    </View>
  );
}
