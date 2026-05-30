import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import ContactsScreen from "../screens/ContactsScreen";
import ActivityScreen from "../screens/ActivityScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { useTheme } from "../theme";
import { ui, useUi } from "../i18n/ui";

const Tab = createBottomTabNavigator();

type TabIcon = { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap };

const ICONS: Record<string, TabIcon> = {
  Home: { active: "home", inactive: "home-outline" },
  Contacts: { active: "people", inactive: "people-outline" },
  Activity: { active: "time", inactive: "time-outline" },
  Settings: { active: "settings", inactive: "settings-outline" },
};
const FALLBACK_ICON: TabIcon = { active: "ellipse", inactive: "ellipse-outline" };

/** The bottom-tab navigator (themed, Ionicons + accessible tab labels). */
export function MainTabs(): React.ReactElement {
  const theme = useTheme();
  const { t } = useUi();
  const titles = {
    Home: t(ui.tabs.home),
    Contacts: t(ui.tabs.contacts),
    Activity: t(ui.tabs.activity),
    Settings: t(ui.tabs.settings),
  };

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: theme.colors.bg },
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: theme.borderWidth,
        },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: { fontSize: 12 },
        tabBarIcon: ({ focused, color, size }) => {
          const icon = ICONS[route.name] ?? FALLBACK_ICON;
          return <Ionicons name={focused ? icon.active : icon.inactive} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: titles.Home, tabBarAccessibilityLabel: titles.Home }} />
      <Tab.Screen name="Contacts" component={ContactsScreen} options={{ title: titles.Contacts, tabBarAccessibilityLabel: titles.Contacts }} />
      <Tab.Screen name="Activity" component={ActivityScreen} options={{ title: titles.Activity, tabBarAccessibilityLabel: titles.Activity }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: titles.Settings, tabBarAccessibilityLabel: titles.Settings }} />
    </Tab.Navigator>
  );
}
