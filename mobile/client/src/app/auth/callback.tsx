import { useEffect } from "react";
import { Text, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { styles } from "../../ui";

export default function AuthCallback() {
  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);
  return (
    <View style={styles.body}>
      <Text>
        Completing sign-in. Return to the Fyde app if this window stays open.
      </Text>
    </View>
  );
}
