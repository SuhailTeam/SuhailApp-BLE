import "react-native-gesture-handler";
import React, { useMemo } from "react";
import { I18nManager } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { BluetoothSessionProvider } from "./ble/connection";
import { ThemeProvider, toNavigationTheme, useTheme } from "./theme";
import { MainTabs } from "./navigation/MainTabs";
import OnboardingScreen from "./screens/OnboardingScreen";
import UsabilityTestScreen from "./screens/UsabilityTestScreen";
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
      </Stack.Navigator>
      <StatusBar style="light" />
    </NavigationContainer>
  );
}

export default function App(): React.ReactElement {
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
