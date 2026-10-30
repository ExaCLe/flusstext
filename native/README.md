# Flusstext in React Native

Native iPhone and macOS apps using Flusstext's existing design, German interface, model catalog and JSON transcript format. The Electron target remains separate.

## Version 0.1.3: QuickTime Audio

Apple QuickTime Audio (`.qta`), including Voice Memos AAC/APAC representations, is decoded locally through AVFoundation to a temporary 16 kHz mono PCM WAV before recognition. The original stays intact. The decoder chooses the AAC presentation track when available and falls back to a native-decodable track, including APAC; it does not combine alternate representations or independently transcribe stems. Unsupported codecs on an older Apple OS produce an explicit error. QTA stays selectable in the picker and Mac drag and drop.

Native test helpers in `tests/apple/` generate genuine QTA containers through AVAssetWriter and exercise the production decoder header; they are separate from the in-memory Node tests. Synthetic QTA fixtures are not a real Voice Memos export or physical iPhone proof.

## Models

On iPhone, FastConformer Deutsch and Whisper Base are recommended for smaller downloads and lower resource use. Every other speech, segmentation and speaker model remains selectable. Large models show resource guidance; slow execution is not treated as incompatibility. Windows EXE runtimes are omitted.

Whisper uses whisper.rn on iPhone; NeMo, Canary and Cohere use native sherpa-onnx; experimental Nemotron uses local ONNX Runtime. Speaker diarization calls the sherpa C API directly, bypassing the wrapper's unimplemented diarization API. Downloads stream to disk and are installed from staging after validation.

On Mac, React Native renders the interface. A bundled Node sidecar runs the existing local engine with sherpa-onnx, FFmpeg and CPU/Metal whisper.cpp. There is no Electron or Chromium UI, and users need no Node or Homebrew installation.

Phone dictation is controlled inside the app, with text copied or shared afterward. iOS does not permit the desktop global keyboard hook or a floating system-wide recording window. Mac retains global shortcuts, Command-V insertion and its floating control, subject to OS privacy grants.

## Build

Use an Apple Silicon Mac, Node 24, Xcode, CocoaPods and CMake. Configured minimums are iOS 15.1 and macOS 14. Android and Intel Mac packaging are not included.

```sh
# Repository root
npm ci
cd native
npm ci
npm run typecheck
npm run test:core
pod install --project-directory=ios
FLUSSTEXT_PLATFORM=macos pod install --project-directory=macos
npm run engine:mac
```

The Mac engine build copies the arm64 Node executable and root speech dependencies, then bundles whisper.cpp b5454 built from a pinned, SHA-256-verified archive. The runtime is statically linked with embedded Metal kernels. Heavy builds run at nice level 10 with at most half the host cores.

React Native 0.83 requires the pinned filesystem version. `scripts/patch-native.cjs` applies three AppKit compatibility fixes to react-native-svg 15.15.0. The local npm configuration skips the filesystem package's irrelevant Windows peer constraint.

The sherpa CocoaPod downloads its XCFrameworks. Verify that `lipo -info` recognizes its simulator library as arm64/x86_64. A partial cache must be replaced before building. If the package downloader fails, retrieve `sherpa_onnx.xcframework.zip` from the `sherpa-onnx-ios-v1.12.35-1` release of `XDcobra/react-native-sherpa-onnx` with `gh release download`, verify the ZIP, and extract it over that dependency's `ios/Frameworks/` directory.

```sh
nice -n 10 xcodebuild -workspace ios/FlusstextNative.xcworkspace \
  -scheme FlusstextNative -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/ios \
  -jobs 4 ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build

FLUSSTEXT_PLATFORM=macos nice -n 10 xcodebuild \
  -workspace macos/FlusstextNative.xcworkspace -scheme FlusstextNative-macOS \
  -configuration Release -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath build/macos -jobs 4 ARCHS=arm64 ONLY_ACTIVE_ARCH=YES \
  CODE_SIGN_IDENTITY=- build
```

Release builds bundle JavaScript and run without Metro. `npm start` uses port 8097 for development; set `FLUSSTEXT_PLATFORM=macos` for Mac. Debug clients need the same port configured.

### Signed releases

The requested iPhone delivery is TestFlight. Sign into the paid developer team in Xcode and create an Apple Distribution identity. Register `de.flusstext.native.ios` and an iOS app record in App Store Connect, then run:

```sh
node scripts/testflight.cjs --team YOURTEAMID
```

This archives for a physical iPhone, uses automatic provisioning and uploads to App Store Connect. It can alternatively accept `--api-key-path`, `--api-key-id` and `--api-issuer` for a team API key stored outside the repository. Verify Apple's processing result and tester access separately. A simulator app cannot be installed on an iPhone.

The direct Mac release needs a Developer ID Application identity, including its private key in Keychain, and a notarytool Keychain credentials profile:

```sh
node scripts/package-mac.cjs --identity 'Developer ID Application: Your Name (YOURTEAMID)' \
  --notary-profile flusstext-notary
```

The packager signs nested native executables and frameworks before the app, notarizes and staples the app, then creates, signs, notarizes and staples the DMG. Both app and DMG must pass Gatekeeper checks. Credentials and private keys must stay outside this repository. `--local` produces an explicitly UNNOTARIZED package for local verification only.

`--sign-only --identity 'Developer ID Application: …'` prepares and verifies the signed app while Apple account authentication is being configured. That artifact is not notarized and is not a completed trusted download.

The iOS Podfile pins ONNX Runtime 1.24.2 to match the implementation embedded in sherpa's prebuilt library. An unconstrained newer header requests an unsupported C API and crashes before launch. The iPhone target also adopts UIScene, required by iOS 27.

## Storage and permissions

Mac uses `~/Library/Application Support/Flusstext`, including existing JSON transcripts and model files. iPhone data stays in the app's Documents directory. Import copies files into owned storage; export opens the native save dialog or share sheet.

Allow Microphone for recording. Mac's Diktat screen and app menu can open Accessibility settings; return to the app after granting access. Some macOS versions also require Input Monitoring. The app never grants privacy permissions automatically.

`FLUSSTEXT_DATA_DIR` selects an isolated data directory for native smoke tests. Tests must never use the user's real transcripts. Domain/service tests use in-memory adapters and do not prove native execution. The Mac UI test exercises real screens and a speech-file fixture. iPhone walkthroughs use the shared mobile-capture queue. Physical microphone, background execution, every individual model and OS permission grants need separate evidence.
