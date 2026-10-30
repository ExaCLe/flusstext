require 'xcodeproj'
root = File.expand_path('..', __dir__)
%w[ios macos].each do |platform|
  project = Xcodeproj::Project.open(File.join(root, platform, 'FlusstextNative.xcodeproj'))
  target = project.targets.find { |t| t.name == (platform == 'ios' ? 'FlusstextNative' : 'FlusstextNative-macOS') }
  group = project.main_group.groups.find { |g| g.name == 'Flusstext host' } || project.main_group.new_group('Flusstext host', '../apple')
  files = %w[FlusstextHost.h FlusstextHost.mm FlusstextAudioDecode.h]
  files += %w[FlusstextDiarize.h FlusstextDiarize.cpp] if platform == 'ios'
  files.each do |file|
    ref = group.files.find { |f| f.path == file } || group.new_file(file)
    target.source_build_phase.add_file_reference(ref, true) if %w[.mm .cpp].include?(File.extname(file))
  end
  fontgroup = project.main_group.groups.find { |g| g.name == 'Flusstext fonts' } || project.main_group.new_group('Flusstext fonts', '../assets/fonts')
  Dir.glob(File.join(root, 'assets/fonts/*.ttf')).each do |path|
    name = File.basename(path)
    ref = fontgroup.files.find { |f| f.path == name } || fontgroup.new_file(name)
    target.resources_build_phase.add_file_reference(ref, true)
  end
  target.build_configurations.each do |config|
    s = config.build_settings
    s['PRODUCT_NAME'] = 'Flusstext'
    s['PRODUCT_BUNDLE_IDENTIFIER'] = platform == 'ios' ? 'de.flusstext.native.ios' : 'de.flusstext.native.macos'
    s['MARKETING_VERSION'] = '0.1.3'
    s['CURRENT_PROJECT_VERSION'] = '1'
    s['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
    if platform == 'ios'
      s['TARGETED_DEVICE_FAMILY'] = '1'
      s['HEADER_SEARCH_PATHS'] = ['$(inherited)', '$(SRCROOT)/../node_modules/react-native-sherpa-onnx/ios/Frameworks/sherpa_onnx.xcframework/ios-arm64/Headers', '$(SRCROOT)/../node_modules/react-native-sherpa-onnx/ios/Frameworks/sherpa_onnx.xcframework/ios-arm64_x86_64-simulator/Headers']
    else
      s['ENABLE_APP_SANDBOX'] = 'NO'
      s['CODE_SIGN_IDENTITY'] = '-'
      s['ENABLE_HARDENED_RUNTIME'] = 'YES'
      s['CODE_SIGN_ENTITLEMENTS'] = 'FlusstextNative-macOS/FlusstextNative.entitlements'
    end
  end
  project.save
end
