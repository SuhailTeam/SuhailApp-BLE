const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Required so Metro honors the "exports" field in package.json — needed for
// `@mentra/bluetooth-sdk/react` (and other subpath imports) to resolve.
// Expo SDK 52 / Metro defaults still ship with this off. Without it the app
// fails at runtime with: Unable to resolve "@mentra/bluetooth-sdk/react".
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
