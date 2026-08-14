const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

module.exports = withNativeWind(config, { input: './global.css' });
