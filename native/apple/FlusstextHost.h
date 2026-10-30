// Nativer Flusstext-Dienst für iOS und macOS (NativeModules.FlusstextHost).
// ABI: native/src/core/host.ts. Events: "FlusstextHostEvent".
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

NS_ASSUME_NONNULL_BEGIN

@interface FlusstextHost : RCTEventEmitter <RCTBridgeModule>
@end

NS_ASSUME_NONNULL_END
