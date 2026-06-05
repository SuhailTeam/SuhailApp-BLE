import "react-native-gesture-handler";
import React, { useMemo } from "react";
import { I18nManager, Text, StyleSheet, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  useFonts,
  Cairo_400Regular,
  Cairo_500Medium,
  Cairo_600SemiBold,
  Cairo_700Bold,
} from "@expo-google-fonts/cairo";

import { BluetoothSessionProvider } from "./ble/connection";
import { ThemeProvider, toNavigationTheme, useTheme } from "./theme";
import { MainTabs } from "./navigation/MainTabs";
import OnboardingScreen from "./screens/OnboardingScreen";
import UsabilityTestScreen from "./screens/UsabilityTestScreen";
import ActivityScreen from "./screens/ActivityScreen";
import { useOnboarding } from "./state/onboarding";
import { getSettings } from "./state/settings";

// Typed root routes so navigate("UsabilityTest") typechecks (the navigator is
// otherwise untyped). Augments the global default useNavigation()/navigate type.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList {
      Main: undefined;
      Onboarding: undefined;
      UsabilityTest: undefined;
      Activity: undefined;
    }
  }
}

// Apply the saved layout direction once at startup. forceRTL only takes full
// effect after a reload, so the Settings language toggle prompts a restart on a
// direction change. Default language is Arabic, so a fresh install boots RTL.
const wantRTL = getSettings().language === "ar";
I18nManager.allowRTL(true);
if (I18nManager.isRTL !== wantRTL) {
  I18nManager.forceRTL(wantRTL);
}

// @ts-ignore
const originalTextRender = Text.render;
// @ts-ignore
if (originalTextRender) {
  // @ts-ignore
  Text.render = function (props: any, ref: any) {
    const language = getSettings().language;
    if (language === "ar" && props) {
      let fontWeight = "400";
      if (props.style) {
        const flatStyle = StyleSheet.flatten(props.style);
        if (flatStyle && flatStyle.fontWeight) {
          fontWeight = String(flatStyle.fontWeight);
        }
      }

      let fontFamily = "Cairo_400Regular";
      if (fontWeight === "700" || fontWeight === "800" || fontWeight === "bold") {
        fontFamily = "Cairo_700Bold";
      } else if (fontWeight === "600") {
        fontFamily = "Cairo_600SemiBold";
      } else if (fontWeight === "500") {
        fontFamily = "Cairo_500Medium";
      }

      props = {
        ...props,
        style: [{ fontFamily }, props.style],
      };
    }
    return originalTextRender.call(this, props, ref);
  };
}

const Stack = createNativeStackNavigator();

function RootNavigator(): React.ReactElement {
  const theme = useTheme();
  const navTheme = useMemo(() => toNavigationTheme(theme), [theme]);
  const hasOnboarded = useOnboarding((s) => s.hasOnboarded);

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {hasOnboarded ? (
          <Stack.Screen name="Main" component={MainTabs} />
        ) : (
          <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        )}
        {/* Testing-mode screen, reached from Settings → Testing (header shown for back). */}
        <Stack.Screen name="UsabilityTest" component={UsabilityTestScreen} options={{ headerShown: true }} />
        <Stack.Screen name="Activity" component={ActivityScreen} options={{ headerShown: true }} />
      </Stack.Navigator>
      <StatusBar style="light" />
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
  const [fontsLoaded] = useFonts({
    Cairo_400Regular,
    Cairo_500Medium,
    Cairo_600SemiBold,
    Cairo_700Bold,
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: "#020617" }} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <BluetoothSessionProvider>
          <RootNavigator />
        </BluetoothSessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
