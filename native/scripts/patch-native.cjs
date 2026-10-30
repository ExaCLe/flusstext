const {readFileSync,writeFileSync,existsSync}=require('node:fs')
const {resolve}=require('node:path')
// RN macOS 0.83 no longer exposes RCTAssert transitively to this SVG implementation.
const svg=resolve(__dirname,'../node_modules/react-native-svg/apple/RNSVGUIKit.macos.mm')
if(existsSync(svg)) {
 const source=readFileSync(svg,'utf8')
 if(!source.includes('#import <React/RCTAssert.h>')) writeFileSync(svg,'#import <React/RCTAssert.h>\n'+source)
}
// ImageResponseDelegate uses AppKit images on macOS rather than UIKit images.
const image=resolve(__dirname,'../node_modules/react-native-svg/apple/Elements/RNSVGImage.mm')
if(existsSync(image)) {
 const source=readFileSync(image,'utf8')
 if(source.includes('didReceiveImage:(UIImage *)')) writeFileSync(image, '#include <TargetConditionals.h>\n#if TARGET_OS_OSX\n#define RNSVGResponseImage NSImage\n#else\n#define RNSVGResponseImage UIImage\n#endif\n'+source.replace('didReceiveImage:(UIImage *)','didReceiveImage:(RNSVGResponseImage *)'))
}

if(existsSync(image)){const source=readFileSync(image,'utf8');if(source.startsWith('#if TARGET_OS_OSX'))writeFileSync(image,'#include <TargetConditionals.h>\n'+source)}

// Fabric's AppKit base view uses updateLayer; SVG paints with drawRect instead.
const canvas=resolve(__dirname,'../node_modules/react-native-svg/apple/Elements/RNSVGSvgView.mm')
if(existsSync(canvas)) {
 const source=readFileSync(canvas,'utf8')
 if(!source.includes('- (BOOL)wantsUpdateLayer')) writeFileSync(canvas,source.replace('- (void)drawRect:(CGRect)rect', '#if TARGET_OS_OSX\n- (BOOL)wantsUpdateLayer { return NO; }\n#endif\n\n- (void)drawRect:(CGRect)rect'))
}
