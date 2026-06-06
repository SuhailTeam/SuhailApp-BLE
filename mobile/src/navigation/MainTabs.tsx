import React from "react";
import { View, Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import ContactsScreen from "../screens/ContactsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { useTheme } from "../theme";
import { useUi } from "../i18n/ui";

const Tab = createBottomTabNavigator();

type TabIcon = { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap };

const ICONS: Record<string, TabIcon> = {
  Home: { active: "home", inactive: "home" },
  Contacts: { active: "people", inactive: "people" },
  Settings: { active: "settings", inactive: "settings" },
};
const FALLBACK_ICON: TabIcon = { active: "ellipse", inactive: "ellipse-outline" };

/** The bottom-tab navigator (themed, Ionicons + accessible tab labels). */
export function MainTabs(): React.ReactElement {
  const theme = useTheme();
  const { lang } = useUi();
  const titles = {
    Home: lang === "ar" ? "الرئيسية" : "HOME",
    Contacts: lang === "ar" ? "الأشخاص" : "CONTACTS",
    Settings: lang === "ar" ? "الإعدادات" : "SETTINGS",
  };

  const isRTL = lang === "ar";

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }) => ({
        headerTitle: () => (
          <View style={{ flexDirection: isRTL ? "row-reverse" : "row", alignItems: "center", gap: 8, justifyContent: "center" }}>
            <Text style={{ color: theme.colors.textPrimary, fontSize: 16, fontWeight: "800", letterSpacing: 1 }}>
              SUHAIL
            </Text>
          </View>
        ),
        headerTitleAlign: "center",
        headerStyle: {
          backgroundColor: theme.colors.bg,
          borderBottomColor: theme.colors.border,
          borderBottomWidth: 2,
          height: 96,
        },
        sceneStyle: { backgroundColor: theme.colors.bg },
        tabBarStyle: {
          backgroundColor: theme.colors.bg,
          borderTopColor: theme.colors.border,
          borderTopWidth: 2,
          height: 96,
          paddingBottom: 16,
          paddingTop: 12,
        },
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSecondary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: "700", marginTop: 4 },
        tabBarIcon: ({ focused, color, size }) => {
          const icon = ICONS[route.name] ?? FALLBACK_ICON;
          if (focused) {
            return (
              <View
                style={{
                  backgroundColor: theme.colors.accent,
                  width: 44,
                  height: 28,
                  justifyContent: "center",
                  alignItems: "center",
                  borderRadius: 14,
                  marginBottom: -2,
                }}
              >
                <Ionicons name={icon.active} size={18} color={theme.colors.accentText} />
              </View>
            );
          }
          return <Ionicons name={icon.inactive} size={20} color={theme.colors.textSecondary} />;
        },
      })}
    >
      {isRTL ? (
        // Arabic (RTL): register in reverse so the native mirroring puts
        // الرئيسية on the right, الأشخاص in the centre, الإعدادات on the left.
        <>
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: titles.Settings, tabBarAccessibilityLabel: titles.Settings }} />
          <Tab.Screen name="Contacts" component={ContactsScreen} options={{ title: titles.Contacts, tabBarAccessibilityLabel: titles.Contacts }} />
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: titles.Home, tabBarAccessibilityLabel: titles.Home }} />
        </>
      ) : (
        // English (LTR): HOME | CONTACTS | SETTINGS
        <>
          <Tab.Screen name="Home" component={HomeScreen} options={{ title: titles.Home, tabBarAccessibilityLabel: titles.Home }} />
          <Tab.Screen name="Contacts" component={ContactsScreen} options={{ title: titles.Contacts, tabBarAccessibilityLabel: titles.Contacts }} />
          <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: titles.Settings, tabBarAccessibilityLabel: titles.Settings }} />
        </>
      )}
    </Tab.Navigator>
  );
}
