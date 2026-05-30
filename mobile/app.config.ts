import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Suhail",
  slug: "suhail-mobile",
  version: "0.1.0",
  orientation: "portrait",
  scheme: "suhail",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  // Brand mark (white star + orbital ring) baked onto the brand navy. iOS icons
  // must be opaque, so icon.png has no transparency. Regenerate with
  // `bun mobile/scripts/make-icons.ts`.
  icon: "./assets/icon.png",
  splash: {
    image: "./assets/splash.png",
    resizeMode: "contain",
    backgroundColor: "#020617",
  },
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
    // TODO: add adaptiveIcon when we have a real Android build target.
    //   adaptiveIcon: {
    //     foregroundImage: "./assets/icon.png",
    //     backgroundColor: "#0F172A",
    //   },
    // Removed for now because the file doesn't exist yet and Expo's
    // prebuild fails hard at withAndroidIcons with ENOENT. iOS prebuild
    // is unaffected (no ios.icon set either — default is fine).
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
