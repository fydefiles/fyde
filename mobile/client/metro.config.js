const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Share only the public help and plan catalog with the website and native client.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, "../../content"),
];
module.exports = config;
