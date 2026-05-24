// Default Expo Metro config. Customise only if Metro starts complaining.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

module.exports = config;
