const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const path = require('node:path');
const isMac = process.env.FLUSSTEXT_PLATFORM === 'macos';
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  maxWorkers: 4,
  watchFolders: [path.resolve(__dirname, '../src/shared'), path.resolve(__dirname, '../src/engine')],
  resolver: {
    resolveRequest(context, name, platform) {
      if (platform === 'macos' && (name === 'react-native' || name.startsWith('react-native/'))) name = name.replace(/^react-native/, 'react-native-macos');
      return context.resolveRequest(context, name, platform);
    },
    ...(isMac ? {extraNodeModules: {'react-native': path.resolve(__dirname, 'node_modules/react-native-macos')}} : {}),
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    blockList: [/\/ios\/Pods\/.*/, /\/macos\/Pods\/.*/, /\/engine-resources\/.*/],
  },
});
