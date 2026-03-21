const path = require('path');
// Load .env before Metro bundles the app so EXPO_PUBLIC_* are available
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { getDefaultConfig } = require('expo/metro-config');
module.exports = getDefaultConfig(__dirname);
