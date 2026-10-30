require 'xcodeproj'
root=File.expand_path('..',__dir__)
p=Xcodeproj::Project.open(File.join(root,'macos/FlusstextNative.xcodeproj'))
t=p.targets.find{|x|x.name=='FlusstextMacUITests'} || p.new_target(:ui_test_bundle,'FlusstextMacUITests',:osx,'14.0')
g=p.main_group.groups.find{|x|x.name=='Native UI tests'} || p.main_group.new_group('Native UI tests','../e2e')
r=g.files.find{|x|x.path=='MacSmokeTests.swift'} || g.new_file('MacSmokeTests.swift')
t.source_build_phase.add_file_reference(r,true)
t.build_configurations.each do |c|
 c.build_settings['PRODUCT_NAME']='FlusstextMacUITests'
 c.build_settings['PRODUCT_MODULE_NAME']='FlusstextMacUITests'
 c.build_settings['PRODUCT_BUNDLE_IDENTIFIER']='de.flusstext.native.macos.uitests'
 c.build_settings['SWIFT_VERSION']='5.0'
 c.build_settings['GENERATE_INFOPLIST_FILE']='YES'
 c.build_settings['CODE_SIGN_IDENTITY']='-'
 c.build_settings['TEST_TARGET_NAME']='FlusstextNative-macOS'
end
p.save
scheme_path=File.join(root,'macos/FlusstextNative.xcodeproj/xcshareddata/xcschemes/FlusstextNative-macOS.xcscheme')
s=Xcodeproj::XCScheme.new(scheme_path)
s.add_test_target(t)
s.save_as(File.join(root,'macos/FlusstextNative.xcodeproj'),'FlusstextNative-macOS',true)
