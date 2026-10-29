const path = require('node:path');
const mac = process.env.FLUSSTEXT_PLATFORM === 'macos';
module.exports = {
  ...(mac ? {reactNativePath: path.resolve(__dirname, 'node_modules/react-native-macos')} : {}),
  assets: ['./assets/fonts'],
  dependencies: {
    'whisper.rn': {platforms: {macos: null}},
    'onnxruntime-react-native': {platforms: {macos: null}},
    'react-native-sherpa-onnx': {platforms: {macos: null}},
    '@kesha-antonov/react-native-background-downloader': {platforms: {macos: null}},
  },
};
