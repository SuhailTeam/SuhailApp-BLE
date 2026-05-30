import "react-native-gesture-handler";
import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";

import HomeScreen from "./screens/HomeScreen";
import ContactsScreen from "./screens/ContactsScreen";
import ActivityScreen from "./screens/ActivityScreen";
import SettingsScreen from "./screens/SettingsScreen";
import { BluetoothSessionProvider } from "./ble/connection";
import { useSettings } from "./state/settings";

const Tab = createBottomTabNavigator();

export default function App() {
  const language = useSettings((s) => s.language);
  const labels = language === "ar"
    ? { home: "الرئيسية", contacts: "الأشخاص", activity: "النشاط", settings: "الإعدادات" }
    : { home: "Home", contacts: "Contacts", activity: "Activity", settings: "Settings" };

  return (
    <SafeAreaProvider>
      <BluetoothSessionProvider>
        <NavigationContainer>
          <Tab.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: "#0F172A" },
            headerTintColor: "#F8FAFC",
            tabBarStyle: { backgroundColor: "#0F172A", borderTopColor: "#1E293B" },
            tabBarActiveTintColor: "#38BDF8",
            tabBarInactiveTintColor: "#94A3B8",
          }}
        >
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: labels.home }} />
          <Tab.Screen name="Contacts" component={ContactsScreen} options={{ title: labels.contacts }} />
          <Tab.Screen name="Activity" component={ActivityScreen} options={{ title: labels.activity }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: labels.settings }} />
        </Tab.Navigator>
        <StatusBar style="light" />
        </NavigationContainer>
      </BluetoothSessionProvider>
    </SafeAreaProvider>
  );
}
