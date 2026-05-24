import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Suhail",
  slug: "suhail-mobile",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "suhail",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  ios: {
    bundleIdentifier: "com.suhail.assistant.ble",
    supportsTablet: false,
    infoPlist: {
      NSBluetoothAlwaysUsageDescription:
        "Suhail uses Bluetooth to connect to your Mentra smart glasses.",
      NSBluetoothPeripheralUsageDescription:
        "Suhail uses Bluetooth to connect to your Mentra smart glasses.",
      NSMicrophoneUsageDescription:
        "Suhail uses the glasses microphone to hear your voice commands.",
      NSCameraUsageDescription:
        "Suhail uses the glasses camera to describe what's in front of you.",
      UIBackgroundModes: ["bluetooth-central", "audio"],
    },
  },
  android: {
    package: "com.suhail.assistant.ble",
    permissions: [
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.RECORD_AUDIO",
      "android.permission.FOREGROUND_SERVICE",
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#0F172A",
    },
  },
  plugins: [
    "@mentra/bluetooth-sdk",
    [
      "expo-build-properties",
      {
        ios: { deploymentTarget: "15.1" },
        android: { minSdkVersion: 28, compileSdkVersion: 35, targetSdkVersion: 35 },
      },
    ],
    "expo-localization",
    "expo-asset",
  ],
  experiments: {
    typedRoutes: false,
  },
};

export default config;
