import { useEffect, useState, useRef } from "react";
import { Platform, Text, View } from "react-native";
import { Link } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { styles } from "../../ui";
import { completeWebGoogleSignIn } from "../../auth";

export default function AuthCallback() {
  const started = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (Platform.OS === "web") completeWebGoogleSignIn().catch((e) => setError(e.message));
    else WebBrowser.maybeCompleteAuthSession();
  }, []);
  return (
    <View style={styles.body}>
      <Text>
        {error || "Completing sign-in…"}
      </Text>
      {!!error && <Link href="/" style={styles.fine}>Return to sign-in →</Link>}
    </View>
  );
}
