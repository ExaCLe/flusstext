// Nativer Flusstext-Dienst, gemeinsam für iOS und macOS (TARGET_OS_OSX).
// Alle exportierten Methoden laufen auf dem Main-Thread; Dateikopien, WAV-Ausschnitte,
// Engine-Prozesse und Sprechertrennung laufen auf Hintergrund-Queues. Events gehen über den Main-Thread.
#import "FlusstextHost.h"
#import "FlusstextAudioDecode.h"

#import <AVFoundation/AVFoundation.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#import <React/RCTUtils.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

#include <signal.h>
#include <string>
#include <vector>

#if TARGET_OS_OSX
#import <AppKit/AppKit.h>
#import <ServiceManagement/ServiceManagement.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Carbon/Carbon.h>
#else
#import <UIKit/UIKit.h>
#if __has_include("sherpa-onnx/c-api/c-api.h")
#define FLUSSTEXT_HAS_SHERPA 1
#include "FlusstextDiarize.h"
#endif
#endif

static NSString *const kEvent = @"FlusstextHostEvent";

#pragma mark - WAV-Hilfen

typedef struct {
  uint16_t channels;
  uint32_t rate;
  uint16_t bits;
  uint64_t dataOffset;
  uint64_t dataBytes;  // tatsächlich vorhandene, auf ganze Frames gekürzte Bytes
} FTWavInfo;

static uint32_t FTU32(const uint8_t *p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
static uint16_t FTU16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }

/// Liest fmt/data aus einer (evtl. noch wachsenden) WAV-Datei. Während der Aufnahme ist das
/// data-Größenfeld veraltet, daher zählt die Dateigröße.
static BOOL FTReadWavInfo(NSString *path, FTWavInfo *info) {
  NSFileHandle *fh = [NSFileHandle fileHandleForReadingAtPath:path];
  if (!fh) return NO;
  unsigned long long size = [fh seekToEndOfFile];
  BOOL haveFmt = NO;
  uint64_t pos = 12;
  [fh seekToFileOffset:0];
  NSData *riff = [fh readDataOfLength:12];
  if (riff.length < 12 || memcmp(riff.bytes, "RIFF", 4) != 0 || memcmp((const uint8_t *)riff.bytes + 8, "WAVE", 4) != 0) {
    [fh closeFile];
    return NO;
  }
  while (pos + 8 <= size) {
    [fh seekToFileOffset:pos];
    NSData *hdr = [fh readDataOfLength:8];
    if (hdr.length < 8) break;
    const uint8_t *h = (const uint8_t *)hdr.bytes;
    uint32_t chunk = FTU32(h + 4);
    if (memcmp(h, "fmt ", 4) == 0) {
      NSData *fmt = [fh readDataOfLength:MIN(chunk, 40u)];
      if (fmt.length < 16) break;
      const uint8_t *f = (const uint8_t *)fmt.bytes;
      info->channels = FTU16(f + 2);
      info->rate = FTU32(f + 4);
      info->bits = FTU16(f + 14);
      haveFmt = YES;
    } else if (memcmp(h, "data", 4) == 0) {
      info->dataOffset = pos + 8;
      uint64_t available = size - info->dataOffset;
      uint64_t frame = MAX(1u, (unsigned)info->channels * info->bits / 8);
      info->dataBytes = available - available % frame;
      [fh closeFile];
      return haveFmt && info->rate > 0 && info->channels > 0;
    }
    pos += 8 + chunk + (chunk & 1);
  }
  [fh closeFile];
  return NO;
}

static NSData *FTWavHeader(uint64_t dataBytes, uint32_t rate, uint16_t channels, uint16_t bits) {
  uint8_t h[44];
  uint16_t block = channels * bits / 8;
  uint32_t v;
  memcpy(h, "RIFF", 4);
  v = (uint32_t)(36 + dataBytes); memcpy(h + 4, &v, 4);
  memcpy(h + 8, "WAVEfmt ", 8);
  v = 16; memcpy(h + 16, &v, 4);
  uint16_t pcm = 1; memcpy(h + 20, &pcm, 2);
  memcpy(h + 22, &channels, 2);
  memcpy(h + 24, &rate, 4);
  v = rate * block; memcpy(h + 28, &v, 4);
  memcpy(h + 32, &block, 2);
  memcpy(h + 34, &bits, 2);
  memcpy(h + 36, "data", 4);
  v = (uint32_t)dataBytes; memcpy(h + 40, &v, 4);
  return [NSData dataWithBytes:h length:44];
}

static double FTWavDuration(const FTWavInfo &info) {
  double bytesPerSecond = (double)info.rate * info.channels * info.bits / 8.0;
  return bytesPerSecond > 0 ? info.dataBytes / bytesPerSecond : 0;
}

/// Kopiert die PCM-Daten ab `since` Sekunden in eine eigenständige WAV-Datei (erst .part, dann atomar umbenannt).
static NSString *FTWriteSnapshot(NSString *source, double since, NSString *dir, double *duration, NSError **error) {
  FTWavInfo info = {};
  NSFileManager *fm = NSFileManager.defaultManager;
  [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *name = [NSString stringWithFormat:@"snapshot-%@", NSUUID.UUID.UUIDString];
  NSString *part = [dir stringByAppendingPathComponent:[name stringByAppendingString:@".wav.part"]];
  NSString *target = [dir stringByAppendingPathComponent:[name stringByAppendingString:@".wav"]];
  BOOL ok = FTReadWavInfo(source, &info);
  if (!ok) {
    // Noch kein data-Abschnitt auf der Platte: gültige, leere WAV liefern.
    info = (FTWavInfo){1, 16000, 16, 0, 0};
  }
  uint64_t frame = (uint64_t)info.channels * info.bits / 8;
  uint64_t start = (uint64_t)(MAX(0.0, since) * info.rate) * frame;
  if (start > info.dataBytes) start = info.dataBytes;
  uint64_t length = info.dataBytes - start;

  [fm createFileAtPath:part contents:FTWavHeader(length, info.rate, info.channels, info.bits) attributes:nil];
  NSFileHandle *out = [NSFileHandle fileHandleForWritingAtPath:part];
  if (!out) {
    if (error) *error = [NSError errorWithDomain:@"Flusstext" code:1 userInfo:@{NSLocalizedDescriptionKey : @"Ausschnitt konnte nicht angelegt werden"}];
    return nil;
  }
  [out seekToEndOfFile];
  if (length > 0) {
    NSFileHandle *in = [NSFileHandle fileHandleForReadingAtPath:source];
    [in seekToFileOffset:info.dataOffset + start];
    uint64_t left = length;
    while (left > 0) {
      @autoreleasepool {
        NSData *chunk = [in readDataOfLength:(NSUInteger)MIN(left, (uint64_t)(256 * 1024))];
        if (chunk.length == 0) break;
        [out writeData:chunk];
        left -= chunk.length;
      }
    }
    [in closeFile];
    if (left > 0) {
      [out closeFile];
      [fm removeItemAtPath:part error:nil];
      if (error) *error = [NSError errorWithDomain:@"Flusstext" code:2 userInfo:@{NSLocalizedDescriptionKey : @"Aufnahme konnte nicht gelesen werden"}];
      return nil;
    }
  }
  [out synchronizeFile];
  [out closeFile];
  if (![fm moveItemAtPath:part toPath:target error:error]) {
    [fm removeItemAtPath:part error:nil];
    return nil;
  }
  info.dataBytes = length;
  *duration = FTWavDuration(info);
  return target;
}

#if TARGET_OS_OSX
static const double kTapSeconds = 0.28;

#pragma mark - Tastencodes (macOS kVK -> geteilte uiohook-Codes aus src/shared/keys.ts)

static int FTUiohookCode(CGKeyCode k) {
  static const int map[128] = {
      /*0x00*/ 30, 31, 32, 33, 35, 34, 44, 45, 46, 47, 0, 48, 16, 17, 18, 19,
      /*0x10*/ 21, 20, 2, 3, 4, 5, 7, 6, 13, 10, 8, 12, 9, 11, 27, 24,
      /*0x20*/ 22, 26, 23, 25, 28, 38, 36, 40, 37, 39, 43, 51, 53, 49, 50, 52,
      /*0x30*/ 15, 57, 41, 14, 0, 1, 3676, 3675, 42, 58, 56, 29, 54, 3640, 3613, 0,
      /*0x40*/ 100, 83, 0, 55, 0, 78, 0, 69, 0, 0, 0, 3637, 3612, 0, 74, 101,
      /*0x50*/ 102, 0, 82, 79, 80, 81, 75, 76, 77, 71, 103, 72, 73, 0, 0, 0,
      /*0x60*/ 63, 64, 65, 61, 66, 67, 0, 87, 0, 91, 99, 92, 0, 68, 0, 88,
      /*0x70*/ 0, 93, 3666, 3655, 3657, 3667, 62, 3663, 60, 3665, 59, 57419, 57421, 57424, 57416, 0,
  };
  return k < 128 ? map[k] : 0;
}

/// Linke/rechte Modifier gleich behandeln (wie normalizeKey in src/shared/keys.ts).
static int FTNormalize(int code) {
  switch (code) {
    case 3613: return 29;
    case 54: return 42;
    case 3676: return 3675;
    default: return code;
  }
}

/// Geräteabhängige Modifier-Bits (IOLLEvent.h, NX_DEVICE*KEYMASK).
static uint64_t FTModifierBit(int code) {
  switch (code) {
    case 29: return 0x01;      // Ctrl links
    case 3613: return 0x2000;  // Ctrl rechts
    case 42: return 0x02;      // Shift links
    case 54: return 0x04;      // Shift rechts
    case 3675: return 0x08;    // Cmd links
    case 3676: return 0x10;    // Cmd rechts
    case 56: return 0x20;      // Option links
    case 3640: return 0x40;    // Option rechts
    default: return 0;
  }
}

/// Ist der Modifier `code` laut Flags gedrückt? Fehlen geräteabhängige Bits (manche virtuellen
/// Tastaturen), zählt die geräteunabhängige Maske.
static BOOL FTModifierDown(int code, CGEventFlags flags) {
  CGEventFlags family;
  int other;
  switch (code) {
    case 29: family = kCGEventFlagMaskControl; other = 3613; break;
    case 3613: family = kCGEventFlagMaskControl; other = 29; break;
    case 42: family = kCGEventFlagMaskShift; other = 54; break;
    case 54: family = kCGEventFlagMaskShift; other = 42; break;
    case 3675: family = kCGEventFlagMaskCommand; other = 3676; break;
    case 3676: family = kCGEventFlagMaskCommand; other = 3675; break;
    case 56: family = kCGEventFlagMaskAlternate; other = 3640; break;
    case 3640: family = kCGEventFlagMaskAlternate; other = 56; break;
    default: return NO;
  }
  if (!(flags & family)) return NO;
  uint64_t bit = FTModifierBit(code), otherBit = FTModifierBit(other);
  if (!(flags & (bit | otherBit))) return YES;
  return (flags & bit) != 0;
}

static CGEventRef FTTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon);
#endif

#pragma mark - Modul

/// Ein laufender decodeAudio-Aufruf. Genau eines von resolve/reject feuert: Abbruch lehnt sofort ab;
/// nach `commit` (unmittelbar vor dem atomaren Umbenennen) ist kein Abbruch mehr möglich.
@interface FTDecodeJob : NSObject
@property(atomic) BOOL cancelled;
@end

@implementation FTDecodeJob {
  RCTPromiseResolveBlock _resolve;
  RCTPromiseRejectBlock _reject;
  BOOL _settled;
  BOOL _committed;
}

- (instancetype)initWithResolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  if ((self = [super init])) {
    _resolve = [resolve copy];
    _reject = [reject copy];
  }
  return self;
}

- (BOOL)cancel {
  RCTPromiseRejectBlock reject;
  @synchronized(self) {
    if (_settled) return NO;
    _settled = YES;
    self.cancelled = YES;
    reject = _reject;
    _resolve = nil;
    _reject = nil;
  }
  reject(@"E_CANCELLED", @"Abgebrochen", nil);
  return YES;
}

- (BOOL)commit {
  @synchronized(self) {
    if (_settled) return NO;
    _settled = _committed = YES;
    return YES;
  }
}

- (void)finishWithResult:(NSDictionary *)result error:(NSError *)error {
  RCTPromiseResolveBlock resolve;
  RCTPromiseRejectBlock reject;
  @synchronized(self) {
    if (_settled && !_committed) return;  // abgebrochen, schon abgelehnt
    _settled = YES;
    resolve = _resolve;
    reject = _reject;
    _resolve = nil;
    _reject = nil;
  }
  if (result) return resolve(result);
  reject(error.userInfo[FTDecodeCodeKey] ?: @"E_DECODE", error.localizedDescription ?: @"Audio konnte nicht dekodiert werden", error);
}

@end

@interface FlusstextHost () <AVAudioRecorderDelegate
#if !TARGET_OS_OSX
                             , UIDocumentPickerDelegate, UIDocumentInteractionControllerDelegate
#endif
                             >
@end

@implementation FlusstextHost {
  BOOL _hasListeners;
  dispatch_queue_t _io;
  dispatch_queue_t _engineQueue;

  // Aufnahme
  AVAudioRecorder *_recorder;
  NSString *_recordPath;
  CFTimeInterval _segmentStart;
  NSTimeInterval _accumulated;
  BOOL _stopping;
  dispatch_source_t _levelTimer;

  // Wiedergabe
  AVPlayer *_player;
  NSString *_playerPath;
  id _timeObserver;
  id _endObserver;
  id _failObserver;

  // Engine
  NSMutableDictionary<NSString *, id> *_engineCalls;  // macOS: NSTask, iOS: Reject-Block
  NSMutableSet<NSString *> *_cancelledCalls;
  NSMutableDictionary<NSString *, FTDecodeJob *> *_decodeCalls;  // beide Plattformen, getrennt von _engineCalls
  dispatch_queue_t _decodeQueue;

#if TARGET_OS_OSX
  NSPanel *_pill;
  NSButton *_pillButton;
  NSStatusItem *_statusItem;
  BOOL _capturingKeys;
  BOOL _pillEnabled;
  BOOL _dictationSounds;
  NSString *_dictationPhase;
  CFMachPortRef _tap;
  CFRunLoopSourceRef _tapSource;
  NSMutableSet<NSNumber *> *_pressed;
  BOOL _hkEnabled;
  NSString *_hkMode;
  NSArray<NSNumber *> *_hkKeys;
  NSArray<NSNumber *> *_hkPasteKeys;
  BOOL _hkActive;
  BOOL _hkHandsFree;
  CFTimeInterval _hkPressedAt;
#else
  RCTPromiseResolveBlock _pickResolve;
  RCTPromiseRejectBlock _pickReject;
  UIDocumentInteractionController *_docController;
#endif
}

RCT_EXPORT_MODULE(FlusstextHost)

+ (BOOL)requiresMainQueueSetup { return YES; }

- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (instancetype)init {
  if ((self = [super init])) {
    _io = dispatch_queue_create("de.flusstext.host.io", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_CONCURRENT, QOS_CLASS_USER_INITIATED, 0));
    _engineQueue = dispatch_queue_create("de.flusstext.host.engine", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0));
    _engineCalls = [NSMutableDictionary new];
    _cancelledCalls = [NSMutableSet new];
    _decodeCalls = [NSMutableDictionary new];
    _decodeQueue = dispatch_queue_create("de.flusstext.host.decode", dispatch_queue_attr_make_with_qos_class(DISPATCH_QUEUE_SERIAL, QOS_CLASS_UTILITY, 0));
#if TARGET_OS_OSX
    _pressed = [NSMutableSet new];
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(onFileDrop:) name:@"FlusstextFileDrop" object:nil];
    _dictationPhase = @"idle";
    _statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
    _statusItem.button.image = [NSImage imageWithSystemSymbolName:@"waveform" accessibilityDescription:@"Flusstext"];
    _statusItem.button.toolTip = @"Flusstext";
    NSMenu *menu = [NSMenu new];
    NSMenuItem *open = [[NSMenuItem alloc] initWithTitle:@"Flusstext öffnen" action:@selector(openMain:) keyEquivalent:@""]; open.target = self; [menu addItem:open];
    NSMenuItem *access = [[NSMenuItem alloc] initWithTitle:@"Diktat-Zugriff erlauben …" action:@selector(openAccess:) keyEquivalent:@""]; access.target = self; [menu addItem:access];
    [menu addItem:NSMenuItem.separatorItem];
    [menu addItemWithTitle:@"Beenden" action:@selector(terminate:) keyEquivalent:@""];
    _statusItem.menu = menu;
    _hkMode = @"hybrid";
    _hkKeys = @[];
    _hkPasteKeys = @[];
#else
    [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(onInterruption:) name:AVAudioSessionInterruptionNotification object:nil];
#endif
  }
  return self;
}

- (void)invalidate {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self stopLevelTimer];
    if (self->_recorder) {
      self->_stopping = YES;
      [self->_recorder stop];
      self->_recorder = nil;
    }
    [self teardownPlayer];
#if TARGET_OS_OSX
    [self removeTap];
    [self->_pill close]; self->_pill = nil;
    if (self->_statusItem) [NSStatusBar.systemStatusBar removeStatusItem:self->_statusItem];
#endif
  });
  @synchronized(_engineCalls) {
#if TARGET_OS_OSX
    for (NSTask *task in _engineCalls.allValues) if (task.running) [task terminate];
#endif
    [_engineCalls removeAllObjects];
  }
  NSArray<FTDecodeJob *> *decodes;
  @synchronized(_decodeCalls) {
    decodes = _decodeCalls.allValues;
    [_decodeCalls removeAllObjects];
  }
  for (FTDecodeJob *job in decodes) [job cancel];
  [NSNotificationCenter.defaultCenter removeObserver:self];
  [super invalidate];
}

- (NSArray<NSString *> *)supportedEvents { return @[ kEvent ]; }
- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving { _hasListeners = NO; }

- (void)emit:(NSDictionary *)body {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_hasListeners) [self sendEventWithName:kEvent body:body];
  });
}

#pragma mark Pfade

- (NSString *)dataDir {
  NSString *override = NSProcessInfo.processInfo.environment[@"FLUSSTEXT_DATA_DIR"];
  if (override.length) return override;
#if TARGET_OS_OSX
  NSURL *base = [NSFileManager.defaultManager URLsForDirectory:NSApplicationSupportDirectory inDomains:NSUserDomainMask].firstObject;
  return [base URLByAppendingPathComponent:@"Flusstext" isDirectory:YES].path;
#else
  return [NSFileManager.defaultManager URLsForDirectory:NSDocumentDirectory inDomains:NSUserDomainMask].firstObject.path;
#endif
}

- (NSString *)modelsDir { return [[self dataDir] stringByAppendingPathComponent:@"models"]; }
- (NSString *)tempDir { return [NSTemporaryDirectory() stringByAppendingPathComponent:@"flusstext"]; }

- (NSString *)uniqueDir:(NSString *)kind {
  NSString *dir = [[[self tempDir] stringByAppendingPathComponent:kind] stringByAppendingPathComponent:NSUUID.UUID.UUIDString];
  [NSFileManager.defaultManager createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  return dir;
}

/// Kopiert gewählte Dateien in einen app-eigenen Ordner und gibt die neuen Pfade zurück.
- (NSArray<NSString *> *)copyIn:(NSArray<NSURL *> *)urls error:(NSError **)error {
  NSString *dir = [self uniqueDir:@"imports"];
  NSMutableArray *paths = [NSMutableArray new];
  NSFileManager *fm = NSFileManager.defaultManager;
  for (NSURL *url in urls) {
    BOOL scoped = [url startAccessingSecurityScopedResource];
    NSString *name = url.lastPathComponent.length ? url.lastPathComponent : @"datei";
    NSString *target = [dir stringByAppendingPathComponent:name];
    for (int n = 1; [fm fileExistsAtPath:target]; n++) {
      NSString *stem = [name stringByDeletingPathExtension], *ext = name.pathExtension;
      target = [dir stringByAppendingPathComponent:[NSString stringWithFormat:@"%@-%d%@%@", stem, n, ext.length ? @"." : @"", ext]];
    }
    BOOL ok = [fm copyItemAtURL:url toURL:[NSURL fileURLWithPath:target] error:error];
    if (scoped) [url stopAccessingSecurityScopedResource];
    if (!ok) return nil;
    [paths addObject:target];
  }
  return paths;
}

#pragma mark Info & Rechte

RCT_EXPORT_METHOD(info : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  dispatch_async(_io, ^{
    NSFileManager *fm = NSFileManager.defaultManager;
    for (NSString *dir in @[ [self dataDir], [self modelsDir], [self tempDir] ]) {
      [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
    }
    NSNumber *free = nil;
    [[NSURL fileURLWithPath:[self dataDir]] getResourceValue:&free forKey:NSURLVolumeAvailableCapacityForImportantUsageKey error:nil];
    if (!free) free = [fm attributesOfFileSystemForPath:[self dataDir] error:nil][NSFileSystemFreeSize];
    NSMutableDictionary *info = [@{
      @"version" : [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"0",
      @"dataDir" : [self dataDir],
      @"modelsDir" : [self modelsDir],
      @"tempDir" : [self tempDir],
      @"freeDiskBytes" : free ?: @0,
      @"cpuThreads" : @(NSProcessInfo.processInfo.activeProcessorCount),
      @"memoryBytes" : @(NSProcessInfo.processInfo.physicalMemory),
    } mutableCopy];
    id<MTLDevice> gpu = MTLCreateSystemDefaultDevice();
    if (gpu.name.length) info[@"gpuName"] = gpu.name;
    resolve(info);
  });
}

RCT_EXPORT_METHOD(requestMicrophone : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  if (status == AVAuthorizationStatusAuthorized) return resolve(@YES);
  if (status != AVAuthorizationStatusNotDetermined) return resolve(@NO);
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio completionHandler:^(BOOL granted) { resolve(@(granted)); }];
}

#pragma mark Dateien

#if TARGET_OS_OSX
- (void)onFileDrop:(NSNotification *)notification {
  NSArray<NSURL *> *urls = notification.object;
  dispatch_async(_io, ^{
    NSError *error = nil;
    NSArray *paths = [self copyIn:urls error:&error];
    if (paths) [self emit:@{@"type": @"files", @"paths": paths}];
    else [self emit:@{@"type": @"fileError", @"message": error.localizedDescription ?: @"Datei konnte nicht übernommen werden"}];
  });
}
#endif

- (NSArray<UTType *> *)pickTypes {
  NSMutableArray<UTType *> *types = [@[ UTTypeAudio, UTTypeMovie, UTTypeAudiovisualContent ] mutableCopy];
  // QuickTime Audio (.qta, z. B. Sprachmemos): ältere Systeme kennen den Typ nicht als public.audio.
  // Ohne Deklaration liefert die Endung einen dynamischen Typ, der nur .qta-Dateien zulässt.
  UTType *qta = [UTType typeWithIdentifier:@"com.apple.quicktime-audio"];
  if (qta) [types addObject:qta];
  UTType *qtaByExtension = [UTType typeWithFilenameExtension:@"qta"];
  if (qtaByExtension && ![qtaByExtension isEqual:qta]) [types addObject:qtaByExtension];
  return types;
}

RCT_EXPORT_METHOD(pickFiles : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseFiles = YES;
  panel.canChooseDirectories = NO;
  panel.allowsMultipleSelection = YES;
  panel.allowedContentTypes = [self pickTypes];
  void (^done)(NSModalResponse) = ^(NSModalResponse response) {
    if (response != NSModalResponseOK) return resolve(@[]);
    NSArray<NSURL *> *urls = panel.URLs;
    dispatch_async(self->_io, ^{
      NSError *error = nil;
      NSArray *paths = [self copyIn:urls error:&error];
      paths ? resolve(paths) : reject(@"E_PICK", [NSString stringWithFormat:@"Datei konnte nicht übernommen werden: %@", error.localizedDescription], error);
    });
  };
  NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow;
  if (window) [panel beginSheetModalForWindow:window completionHandler:done];
  else [panel beginWithCompletionHandler:done];
#else
  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter) return reject(@"E_NO_VIEW", @"Keine sichtbare App-Ansicht", nil);
  if (_pickResolve) return reject(@"E_BUSY", @"Dateiauswahl ist bereits offen", nil);
  UIDocumentPickerViewController *picker = [[UIDocumentPickerViewController alloc] initForOpeningContentTypes:[self pickTypes] asCopy:YES];
  picker.allowsMultipleSelection = YES;
  picker.delegate = self;
  _pickResolve = resolve;
  _pickReject = reject;
  [presenter presentViewController:picker animated:YES completion:nil];
#endif
}

#if !TARGET_OS_OSX
- (void)documentPicker:(UIDocumentPickerViewController *)controller didPickDocumentsAtURLs:(NSArray<NSURL *> *)urls {
  RCTPromiseResolveBlock resolve = _pickResolve;
  RCTPromiseRejectBlock reject = _pickReject;
  _pickResolve = nil;
  _pickReject = nil;
  if (!resolve) return;
  dispatch_async(_io, ^{
    NSError *error = nil;
    NSArray *paths = [self copyIn:urls error:&error];
    // asCopy:YES legt temporäre Kopien in Inbox/tmp an; die eigenen Kopien bleiben.
    for (NSURL *url in urls) [NSFileManager.defaultManager removeItemAtURL:url error:nil];
    if (paths) resolve(paths);
    else if (reject) reject(@"E_PICK", [NSString stringWithFormat:@"Datei konnte nicht übernommen werden: %@", error.localizedDescription], error);
    else resolve(@[]);
  });
}

- (void)documentPickerWasCancelled:(UIDocumentPickerViewController *)controller {
  RCTPromiseResolveBlock resolve = _pickResolve;
  _pickResolve = nil;
  _pickReject = nil;
  if (resolve) resolve(@[]);
}
#endif

RCT_EXPORT_METHOD(shareFile : (NSString *)path name : (NSString *)name resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) return reject(@"E_NOT_FOUND", [@"Datei nicht gefunden: " stringByAppendingString:path], nil);
  NSString *fileName = name.length ? name.lastPathComponent : path.lastPathComponent;
#if TARGET_OS_OSX
  NSSavePanel *panel = [NSSavePanel savePanel];
  panel.nameFieldStringValue = fileName;
  panel.canCreateDirectories = YES;
  void (^done)(NSModalResponse) = ^(NSModalResponse response) {
    if (response != NSModalResponseOK || !panel.URL) return resolve(@NO);
    NSURL *target = panel.URL;
    dispatch_async(self->_io, ^{
      NSFileManager *fm = NSFileManager.defaultManager;
      NSError *error = nil;
      NSString *tmp = [[self uniqueDir:@"save"] stringByAppendingPathComponent:fileName];
      BOOL ok = [fm copyItemAtPath:path toPath:tmp error:&error];
      if (ok) {
        if ([fm fileExistsAtPath:target.path]) ok = [fm replaceItemAtURL:target withItemAtURL:[NSURL fileURLWithPath:tmp] backupItemName:nil options:0 resultingItemURL:nil error:&error];
        else ok = [fm moveItemAtURL:[NSURL fileURLWithPath:tmp] toURL:target error:&error];
      }
      ok ? resolve(@YES) : reject(@"E_SAVE", [NSString stringWithFormat:@"Datei konnte nicht gespeichert werden: %@", error.localizedDescription], error);
    });
  };
  NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow;
  if (window) [panel beginSheetModalForWindow:window completionHandler:done];
  else [panel beginWithCompletionHandler:done];
#else
  dispatch_async(_io, ^{
    // Kopie unter dem gewünschten Namen, damit das Teilen-Menü ihn anzeigt.
    NSString *shared = [[self uniqueDir:@"share"] stringByAppendingPathComponent:fileName];
    NSError *error = nil;
    if (![NSFileManager.defaultManager copyItemAtPath:path toPath:shared error:&error]) {
      return reject(@"E_SHARE", error.localizedDescription, error);
    }
    dispatch_async(dispatch_get_main_queue(), ^{
      UIViewController *presenter = RCTPresentedViewController();
      if (!presenter) return reject(@"E_NO_VIEW", @"Keine sichtbare App-Ansicht", nil);
      UIActivityViewController *vc = [[UIActivityViewController alloc] initWithActivityItems:@[ [NSURL fileURLWithPath:shared] ] applicationActivities:nil];
      vc.completionWithItemsHandler = ^(UIActivityType type, BOOL completed, NSArray *items, NSError *activityError) {
        if (activityError) return reject(@"E_SHARE", activityError.localizedDescription, activityError);
        resolve(@(completed));
      };
      UIPopoverPresentationController *pop = vc.popoverPresentationController;
      if (pop) {
        pop.sourceView = presenter.view;
        pop.sourceRect = CGRectMake(CGRectGetMidX(presenter.view.bounds), CGRectGetMidY(presenter.view.bounds), 1, 1);
        pop.permittedArrowDirections = 0;
      }
      [presenter presentViewController:vc animated:YES completion:nil];
    });
  });
#endif
}

#pragma mark Zwischenablage

- (void)setClipboard:(NSString *)text {
#if TARGET_OS_OSX
  NSPasteboard *pb = NSPasteboard.generalPasteboard;
  [pb clearContents];
  [pb setString:text forType:NSPasteboardTypeString];
#else
  UIPasteboard.generalPasteboard.string = text;
#endif
}

RCT_EXPORT_METHOD(copyText : (NSString *)text resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [self setClipboard:text];
  resolve(nil);
}

#if TARGET_OS_OSX
static const CGEventFlags kFTModifierFlags = kCGEventFlagMaskCommand | kCGEventFlagMaskControl | kCGEventFlagMaskAlternate | kCGEventFlagMaskShift;

- (void)whenModifiersReleased:(int)attempts then:(dispatch_block_t)block {
  BOOL held = (CGEventSourceFlagsState(kCGEventSourceStateHIDSystemState) & kFTModifierFlags) != 0;
  if (!held || attempts <= 0) return block();
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    [self whenModifiersReleased:attempts - 1 then:block];
  });
}

static void FTPostCommandV(void) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  CGEventRef down = CGEventCreateKeyboardEvent(source, (CGKeyCode)kVK_ANSI_V, true);
  CGEventRef up = CGEventCreateKeyboardEvent(source, (CGKeyCode)kVK_ANSI_V, false);
  CGEventSetFlags(down, kCGEventFlagMaskCommand);
  CGEventSetFlags(up, kCGEventFlagMaskCommand);
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  if (source) CFRelease(source);
}
#endif

/// macOS: Text über die Zwischenablage + Cmd+V einfügen, danach die vorherige Zwischenablage wiederherstellen.
/// Ohne Bedienungshilfen-Freigabe sowie auf iOS: nur kopieren und false zurückgeben.
RCT_EXPORT_METHOD(pasteText : (NSString *)text restore : (BOOL)restore resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  if (!AXIsProcessTrusted()) {
    [self setClipboard:text];
    return resolve(@NO);
  }
  NSPasteboard *pb = NSPasteboard.generalPasteboard;
  NSMutableArray<NSPasteboardItem *> *saved = nil;
  if (restore) {
    saved = [NSMutableArray new];
    for (NSPasteboardItem *item in pb.pasteboardItems) {
      NSPasteboardItem *copy = [NSPasteboardItem new];
      for (NSPasteboardType type in item.types) {
        NSData *data = [item dataForType:type];
        if (data) [copy setData:data forType:type];
      }
      if (copy.types.count) [saved addObject:copy];
    }
  }
  [self setClipboard:text];
  NSInteger ours = pb.changeCount;
  // Warten, bis der Nutzer die Kurzbefehl-Tasten losgelassen hat (sonst käme z. B. Ctrl+Cmd+V an).
  [self whenModifiersReleased:40 then:^{
    FTPostCommandV();
    resolve(@YES);
    if (!saved) return;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 700 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      if (pb.changeCount != ours) return;  // inzwischen etwas anderes kopiert
      [pb clearContents];
      if (saved.count) [pb writeObjects:saved];
    });
  }];
#else
  [self setClipboard:text];
  resolve(@NO);
#endif
}

#pragma mark Öffnen

RCT_EXPORT_METHOD(openPath : (NSString *)path resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) return reject(@"E_NOT_FOUND", [@"Pfad nicht gefunden: " stringByAppendingString:path], nil);
  NSURL *url = [NSURL fileURLWithPath:path];
#if TARGET_OS_OSX
  [NSWorkspace.sharedWorkspace openURL:url configuration:[NSWorkspaceOpenConfiguration configuration] completionHandler:^(NSRunningApplication *app, NSError *error) {
    error ? reject(@"E_OPEN", error.localizedDescription, error) : resolve(nil);
  }];
#else
  BOOL isDir = NO;
  [NSFileManager.defaultManager fileExistsAtPath:path isDirectory:&isDir];
  if (isDir) return reject(@"E_OPEN", @"Ordner können auf iOS nicht geöffnet werden", nil);
  UIViewController *presenter = RCTPresentedViewController();
  if (!presenter) return reject(@"E_NO_VIEW", @"Keine sichtbare App-Ansicht", nil);
  _docController = [UIDocumentInteractionController interactionControllerWithURL:url];
  _docController.delegate = self;
  if (![_docController presentPreviewAnimated:YES]) {
    CGRect rect = CGRectMake(CGRectGetMidX(presenter.view.bounds), CGRectGetMidY(presenter.view.bounds), 1, 1);
    if (![_docController presentOptionsMenuFromRect:rect inView:presenter.view animated:YES]) {
      return reject(@"E_OPEN", @"Keine App zum Öffnen dieser Datei gefunden", nil);
    }
  }
  resolve(nil);
#endif
}

#if !TARGET_OS_OSX
- (UIViewController *)documentInteractionControllerViewControllerForPreview:(UIDocumentInteractionController *)controller {
  return RCTPresentedViewController();
}
#endif

RCT_EXPORT_METHOD(openExternal : (NSString *)urlString resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  NSURL *url = [NSURL URLWithString:urlString];
  NSString *scheme = url.scheme.lowercaseString;
  NSArray *allowed = @[ @"http", @"https", @"mailto"
#if TARGET_OS_OSX
                        , @"x-apple.systempreferences"
#endif
  ];
  if (!url || ![allowed containsObject:scheme ?: @""]) return reject(@"E_URL", @"Nur http(s)- und mailto-Links werden geöffnet", nil);
#if TARGET_OS_OSX
  [NSWorkspace.sharedWorkspace openURL:url configuration:[NSWorkspaceOpenConfiguration configuration] completionHandler:^(NSRunningApplication *app, NSError *error) {
    error ? reject(@"E_OPEN", error.localizedDescription, error) : resolve(nil);
  }];
#else
  [UIApplication.sharedApplication openURL:url options:@{} completionHandler:^(BOOL ok) {
    ok ? resolve(nil) : reject(@"E_OPEN", @"Link konnte nicht geöffnet werden", nil);
  }];
#endif
}

#pragma mark Aufnahme

- (NSTimeInterval)recordElapsed {
  return _accumulated + (_segmentStart > 0 ? CACurrentMediaTime() - _segmentStart : 0);
}

- (void)stopLevelTimer {
  if (_levelTimer) dispatch_source_cancel(_levelTimer);
  _levelTimer = nil;
}

- (void)startLevelTimer {
  [self stopLevelTimer];
  _levelTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
  dispatch_source_set_timer(_levelTimer, dispatch_time(DISPATCH_TIME_NOW, 0), 80 * NSEC_PER_MSEC, 10 * NSEC_PER_MSEC);
  __weak FlusstextHost *weakSelf = self;
  dispatch_source_set_event_handler(_levelTimer, ^{
    FlusstextHost *s = weakSelf;
    if (!s || !s->_recorder || s->_segmentStart <= 0) return;
    [s->_recorder updateMeters];
    float db = [s->_recorder averagePowerForChannel:0];
    double level = MIN(1.0, MAX(0.0, (db + 50.0) / 50.0));
    [s emit:@{@"type" : @"audio", @"elapsed" : @([s recordElapsed]), @"level" : @(level)}];
  });
  dispatch_resume(_levelTimer);
}

- (void)finishRecorderState {
  [self stopLevelTimer];
  _recorder.delegate = nil;
  _recorder = nil;
  _recordPath = nil;
  _segmentStart = 0;
  _accumulated = 0;
#if TARGET_OS_OSX
  _hkActive = NO;
  _hkHandsFree = NO;
#else
  if (!_player) [AVAudioSession.sharedInstance setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
#endif
}

RCT_EXPORT_METHOD(audioStart : (NSString *)path deviceId : (NSString *)deviceId resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if ([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio] != AVAuthorizationStatusAuthorized) {
    return reject(@"E_MIC_PERMISSION", @"Mikrofonzugriff ist nicht erlaubt", nil);
  }
  if (_recorder) return reject(@"E_BUSY", @"Es läuft bereits eine Aufnahme", nil);
  NSString *target = path.length ? path : [[self tempDir] stringByAppendingPathComponent:[NSString stringWithFormat:@"recording-%@.wav", NSUUID.UUID.UUIDString]];
  if (![target.pathExtension.lowercaseString isEqualToString:@"wav"]) return reject(@"E_PATH", @"Aufnahmepfad muss auf .wav enden", nil);
  NSFileManager *fm = NSFileManager.defaultManager;
  [fm createDirectoryAtPath:target.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
  [fm removeItemAtPath:target error:nil];

  NSError *error = nil;
#if !TARGET_OS_OSX
  AVAudioSession *session = AVAudioSession.sharedInstance;
  if (![session setCategory:AVAudioSessionCategoryPlayAndRecord mode:AVAudioSessionModeDefault
                    options:AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetoothHFP error:&error] ||
      ![session setActive:YES error:&error]) {
    return reject(@"E_RECORD", [@"Audiositzung nicht verfügbar: " stringByAppendingString:error.localizedDescription ?: @""], error);
  }
  if (deviceId.length) {
    for (AVAudioSessionPortDescription *port in session.availableInputs) {
      if ([port.UID isEqualToString:deviceId]) [session setPreferredInput:port error:nil];
    }
  }
#endif
  // macOS: AVAudioRecorder nutzt immer das Standard-Eingabegerät des Systems; deviceId wird dort ignoriert.
  NSDictionary *settings = @{
    AVFormatIDKey : @(kAudioFormatLinearPCM),
    AVSampleRateKey : @16000.0,
    AVNumberOfChannelsKey : @1,
    AVLinearPCMBitDepthKey : @16,
    AVLinearPCMIsFloatKey : @NO,
    AVLinearPCMIsBigEndianKey : @NO,
    AVLinearPCMIsNonInterleaved : @NO,
  };
  AVAudioRecorder *recorder = [[AVAudioRecorder alloc] initWithURL:[NSURL fileURLWithPath:target] settings:settings error:&error];
  if (!recorder) return reject(@"E_RECORD", error.localizedDescription ?: @"Aufnahme konnte nicht vorbereitet werden", error);
  recorder.delegate = self;
  recorder.meteringEnabled = YES;
  if (![recorder prepareToRecord] || ![recorder record]) {
    return reject(@"E_RECORD", @"Mikrofon ist belegt oder nicht verfügbar", nil);
  }
  _recorder = recorder;
  _recordPath = target;
  _stopping = NO;
  _accumulated = 0;
  _segmentStart = CACurrentMediaTime();
  [self startLevelTimer];
  resolve(nil);
}

RCT_EXPORT_METHOD(audioPause : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (_recorder && _segmentStart > 0) {
    [_recorder pause];
    _accumulated += CACurrentMediaTime() - _segmentStart;
    _segmentStart = 0;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(audioResume : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (_recorder && _segmentStart <= 0) {
#if !TARGET_OS_OSX
    [AVAudioSession.sharedInstance setActive:YES error:nil];
#endif
    if (![_recorder record]) return reject(@"E_RECORD", @"Aufnahme konnte nicht fortgesetzt werden", nil);
    _segmentStart = CACurrentMediaTime();
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(audioStop : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (!_recorder) return reject(@"E_NO_RECORDING", @"Keine aktive Aufnahme", nil);
  NSString *path = _recordPath;
  _stopping = YES;
  [_recorder stop];  // schreibt den endgültigen WAV-Kopf
  [self finishRecorderState];
  dispatch_async(_io, ^{
    FTWavInfo info = {};
    if (!FTReadWavInfo(path, &info)) return reject(@"E_RECORD", @"Aufnahme ist leer oder beschädigt", nil);
    resolve(@{@"path" : path, @"duration" : @(FTWavDuration(info))});
  });
}

RCT_EXPORT_METHOD(audioSnapshot : (double)sinceSeconds resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (!_recorder) return reject(@"E_NO_RECORDING", @"Keine aktive Aufnahme", nil);
  NSString *source = _recordPath;
  NSString *dir = [[self tempDir] stringByAppendingPathComponent:@"snapshots"];
  dispatch_async(_io, ^{
    NSError *error = nil;
    double duration = 0;
    NSString *path = FTWriteSnapshot(source, sinceSeconds, dir, &duration, &error);
    path ? resolve(@{@"path" : path, @"duration" : @(duration)}) : reject(@"E_SNAPSHOT", error.localizedDescription ?: @"Ausschnitt fehlgeschlagen", error);
  });
}

RCT_EXPORT_METHOD(audioCancel : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (_recorder) {
    NSString *path = _recordPath;
    _stopping = YES;
    [_recorder stop];
    [_recorder deleteRecording];
    [self finishRecorderState];
    [NSFileManager.defaultManager removeItemAtPath:path error:nil];
  }
  resolve(nil);
}

- (void)audioRecorderEncodeErrorDidOccur:(AVAudioRecorder *)recorder error:(NSError *)error {
  [self emit:@{@"type" : @"audioError", @"message" : error.localizedDescription ?: @"Aufnahmefehler"}];
}

- (void)audioRecorderDidFinishRecording:(AVAudioRecorder *)recorder successfully:(BOOL)flag {
  if (recorder != _recorder || _stopping) return;
  [self emit:@{@"type" : @"audioError", @"message" : flag ? @"Aufnahme wurde vom System beendet" : @"Aufnahme fehlgeschlagen"}];
}

#if !TARGET_OS_OSX
- (void)onInterruption:(NSNotification *)note {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_recorder) return;
    if ([note.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue] == AVAudioSessionInterruptionTypeBegan && self->_segmentStart > 0) {
      self->_accumulated += CACurrentMediaTime() - self->_segmentStart;
      self->_segmentStart = 0;
      [self emit:@{@"type" : @"audioError", @"message" : @"Aufnahme unterbrochen (z. B. durch einen Anruf)"}];
    }
  });
}
#endif

#pragma mark Wiedergabe

- (void)teardownPlayer {
  if (_timeObserver) [_player removeTimeObserver:_timeObserver];
  if (_endObserver) [NSNotificationCenter.defaultCenter removeObserver:_endObserver];
  if (_failObserver) [NSNotificationCenter.defaultCenter removeObserver:_failObserver];
  [_player pause];
  _timeObserver = nil;
  _endObserver = nil;
  _failObserver = nil;
  _player = nil;
  _playerPath = nil;
}

- (double)playerDuration {
  CMTime d = _player.currentItem.duration;
  return CMTIME_IS_NUMERIC(d) ? CMTimeGetSeconds(d) : 0;
}

- (void)emitPlayback:(BOOL)atEnd {
  if (!_player || !_playerPath) return;
  double duration = [self playerDuration];
  double time = atEnd ? duration : MAX(0, CMTimeGetSeconds(_player.currentTime));
  BOOL playing = !atEnd && _player.rate != 0;
  [self emit:@{@"type" : @"playback", @"path" : _playerPath, @"time" : @(time), @"duration" : @(duration), @"playing" : @(playing)}];
}

- (void)startPlayer:(AVPlayer *)player at:(double)at rate:(double)rate attempts:(int)attempts resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  if (player != _player) return reject(@"E_PLAYBACK", @"Wiedergabe wurde ersetzt", nil);
  AVPlayerItem *item = player.currentItem;
  if (item.status == AVPlayerItemStatusFailed) {
    [self teardownPlayer];
    return reject(@"E_PLAYBACK", item.error.localizedDescription ?: @"Datei kann nicht abgespielt werden", item.error);
  }
  if (item.status != AVPlayerItemStatusReadyToPlay) {
    if (attempts <= 0) return reject(@"E_PLAYBACK", @"Datei konnte nicht geladen werden", nil);
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 40 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [self startPlayer:player at:at rate:rate attempts:attempts - 1 resolve:resolve reject:reject];
    });
    return;
  }
  [player seekToTime:CMTimeMakeWithSeconds(MAX(0, at), 48000) toleranceBefore:kCMTimeZero toleranceAfter:kCMTimeZero completionHandler:^(BOOL finished) {
    dispatch_async(dispatch_get_main_queue(), ^{
      if (player != self->_player) return resolve(nil);
      [player playImmediatelyAtRate:rate > 0 ? (float)rate : 1.0f];
      [self emitPlayback:NO];
      resolve(nil);
    });
  }];
}

RCT_EXPORT_METHOD(play : (NSString *)path at : (double)at rate : (double)rate resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) return reject(@"E_NOT_FOUND", [@"Datei nicht gefunden: " stringByAppendingString:path], nil);
#if !TARGET_OS_OSX
  if (!_recorder) {
    [AVAudioSession.sharedInstance setCategory:AVAudioSessionCategoryPlayback mode:AVAudioSessionModeSpokenAudio options:0 error:nil];
    [AVAudioSession.sharedInstance setActive:YES error:nil];
  }
#endif
  if (!_player || ![_playerPath isEqualToString:path]) {
    [self teardownPlayer];
    AVPlayerItem *item = [AVPlayerItem playerItemWithURL:[NSURL fileURLWithPath:path]];
    item.audioTimePitchAlgorithm = AVAudioTimePitchAlgorithmTimeDomain;
    _player = [AVPlayer playerWithPlayerItem:item];
    _player.actionAtItemEnd = AVPlayerActionAtItemEndPause;
    _playerPath = path;
    __weak FlusstextHost *weakSelf = self;
    _timeObserver = [_player addPeriodicTimeObserverForInterval:CMTimeMakeWithSeconds(0.15, 600) queue:dispatch_get_main_queue() usingBlock:^(CMTime time) {
      [weakSelf emitPlayback:NO];
    }];
    _endObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemDidPlayToEndTimeNotification object:item queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
      [weakSelf emitPlayback:YES];
    }];
    _failObserver = [NSNotificationCenter.defaultCenter addObserverForName:AVPlayerItemFailedToPlayToEndTimeNotification object:item queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
      NSError *error = note.userInfo[AVPlayerItemFailedToPlayToEndTimeErrorKey];
      [weakSelf emit:@{@"type" : @"audioError", @"message" : error.localizedDescription ?: @"Wiedergabe abgebrochen"}];
      [weakSelf emitPlayback:NO];
    }];
  }
  [self startPlayer:_player at:at rate:rate attempts:250 resolve:resolve reject:reject];
}

RCT_EXPORT_METHOD(pausePlayback : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  [_player pause];
  [self emitPlayback:NO];
  resolve(nil);
}

#pragma mark Systemweite Kurzbefehle

#if TARGET_OS_OSX
- (BOOL)canListenToKeys {
  return AXIsProcessTrusted() || CGPreflightListenEventAccess();
}

- (void)removeTap {
  if (_tapSource) {
    CFRunLoopRemoveSource(CFRunLoopGetMain(), _tapSource, kCFRunLoopCommonModes);
    CFRelease(_tapSource);
    _tapSource = NULL;
  }
  if (_tap) {
    CGEventTapEnable(_tap, false);
    CFMachPortInvalidate(_tap);
    CFRelease(_tap);
    _tap = NULL;
  }
  [_pressed removeAllObjects];
}

- (BOOL)installTap {
  if (_tap) return YES;
  CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) | CGEventMaskBit(kCGEventKeyUp) | CGEventMaskBit(kCGEventFlagsChanged);
  _tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, mask, FTTapCallback, (__bridge void *)self);
  if (!_tap) return NO;
  _tapSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, _tap, 0);
  CFRunLoopAddSource(CFRunLoopGetMain(), _tapSource, kCFRunLoopCommonModes);
  CGEventTapEnable(_tap, true);
  return YES;
}

- (void)reenableTap {
  if (_tap) CGEventTapEnable(_tap, true);
}

static NSArray<NSNumber *> *FTKeyList(id value) {
  NSMutableArray *out = [NSMutableArray new];
  if ([value isKindOfClass:NSArray.class]) {
    for (id k in value) if ([k isKindOfClass:NSNumber.class]) [out addObject:@(FTNormalize([k intValue]))];
  }
  return out;
}

- (BOOL)matches:(NSArray<NSNumber *> *)keys {
  if (!keys.count || _pressed.count != keys.count) return NO;
  for (NSNumber *k in keys) if (![_pressed containsObject:k]) return NO;
  return YES;
}

- (void)hotkey:(NSString *)action {
  if ([action isEqualToString:@"start"]) _hkActive = YES;
  if ([action isEqualToString:@"stop"] || [action isEqualToString:@"cancel"]) {
    _hkActive = NO;
    _hkHandsFree = NO;
  }
  [self emit:@{@"type" : @"hotkey", @"action" : action}];
}

- (void)keyDown:(int)raw {
  int k = FTNormalize(raw);
  if (!k || [_pressed containsObject:@(k)]) return;  // Tastenwiederholung
  [_pressed addObject:@(k)];
  if (_capturingKeys) { [self emit:@{@"type":@"key",@"keycode":@(k),@"down":@YES}]; return; }
  if (!_hkEnabled) return;
  if (_hkActive && k == 1) return [self hotkey:@"cancel"];  // Escape
  if ([self matches:_hkKeys]) {
    if (!_hkActive) {
      _hkPressedAt = CACurrentMediaTime();
      _hkHandsFree = [_hkMode isEqualToString:@"toggle"];
      [self hotkey:@"start"];
    } else if (_hkHandsFree) {
      [self hotkey:@"stop"];
    }
    return;
  }
  if (!_hkActive && [self matches:_hkPasteKeys]) [self hotkey:@"pasteLast"];
}

- (void)keyUp:(int)raw {
  int k = FTNormalize(raw);
  if (![_pressed containsObject:@(k)]) return;
  [_pressed removeObject:@(k)];
  if (_capturingKeys) { [self emit:@{@"type":@"key",@"keycode":@(k),@"down":@NO}]; return; }
  if (!_hkEnabled || _hkHandsFree || !_hkActive || ![_hkKeys containsObject:@(k)]) return;
  if ([_hkMode isEqualToString:@"hybrid"] && CACurrentMediaTime() - _hkPressedAt < kTapSeconds) {
    _hkHandsFree = YES;  // kurz angetippt: freihändig bis zum nächsten Druck
    return;
  }
  [self hotkey:@"stop"];
}

- (void)handleKeyEvent:(CGEventType)type event:(CGEventRef)event {
  CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);
  int code = FTUiohookCode(keycode);
  CGEventFlags flags = CGEventGetFlags(event);
  // Verpasste Modifier-Loslass-Events abgleichen (z. B. nach deaktiviertem Tap).
  for (NSNumber *held in _pressed.allObjects) {
    int c = held.intValue;
    if (FTModifierBit(c) && !FTModifierDown(c, flags) && !(c == 29 && FTModifierDown(3613, flags)) &&
        !(c == 42 && FTModifierDown(54, flags)) && !(c == 3675 && FTModifierDown(3676, flags))) {
      [self keyUp:c];
    }
  }
  if (type == kCGEventKeyDown) {
    if (code) [self keyDown:code];
  } else if (type == kCGEventKeyUp) {
    if (code) [self keyUp:code];
  } else if (type == kCGEventFlagsChanged && code) {
    if (code == 58) {  // Feststelltaste rastet: als kurzer Druck behandeln
      [self keyDown:code];
      [self keyUp:code];
      return;
    }
    if (!FTModifierBit(code)) return;
    if (FTModifierDown(code, flags)) [self keyDown:code];
    else [self keyUp:code];
  }
}

static CGEventRef FTTapCallback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *refcon) {
  FlusstextHost *host = (__bridge FlusstextHost *)refcon;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    [host reenableTap];
    return event;
  }
  [host handleKeyEvent:type event:event];
  return event;
}
#endif

#if TARGET_OS_OSX
- (void)openMain:(id)sender {
  [NSApp activateIgnoringOtherApps:YES];
  for (NSWindow *window in NSApp.windows) if (![window isKindOfClass:NSPanel.class]) { [window makeKeyAndOrderFront:nil]; break; }
}
- (void)openAccess:(id)sender {
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt:@YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]];
}
- (void)pillClick:(id)sender {
  if ([_dictationPhase isEqualToString:@"processing"]) return;
  [self hotkey:[_dictationPhase isEqualToString:@"listening"] ? @"stop" : @"start"];
  _hkHandsFree = YES;
}
- (void)refreshPill {
  BOOL active = ![_dictationPhase isEqualToString:@"idle"];
  if (!_pillEnabled && !active) { [_pill orderOut:nil]; return; }
  if (!_pill) {
    _pill = [[NSPanel alloc] initWithContentRect:NSMakeRect(0,0,250,40) styleMask:NSWindowStyleMaskBorderless|NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
    _pill.opaque=NO; _pill.backgroundColor=NSColor.clearColor; _pill.hasShadow=YES;
    _pill.level=NSFloatingWindowLevel; _pill.collectionBehavior=NSWindowCollectionBehaviorCanJoinAllSpaces|NSWindowCollectionBehaviorFullScreenAuxiliary;
    _pillButton=[NSButton buttonWithTitle:@"Diktat starten" target:self action:@selector(pillClick:)];
    _pillButton.frame=NSMakeRect(0,0,250,40); _pillButton.bordered=NO; _pillButton.wantsLayer=YES;
    _pillButton.layer.cornerRadius=20; _pillButton.layer.backgroundColor=[NSColor colorWithSRGBRed:20/255.0 green:21/255.0 blue:23/255.0 alpha:1].CGColor;
    _pillButton.contentTintColor=NSColor.whiteColor; _pillButton.font=[NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
    _pill.contentView=_pillButton;
  }
  _pillButton.title = [_dictationPhase isEqualToString:@"listening"] ? @"Aufnahme beenden" : [_dictationPhase isEqualToString:@"processing"] ? @"Wird erkannt …" : @"Diktat starten";
  _pillButton.enabled=![_dictationPhase isEqualToString:@"processing"];
  NSScreen *screen = NSScreen.mainScreen ?: NSScreen.screens.firstObject;
  NSRect area=screen.visibleFrame; [_pill setFrameOrigin:NSMakePoint(NSMidX(area)-125,NSMinY(area)+16)];
  [_pill orderFrontRegardless];
}
#endif

RCT_EXPORT_METHOD(captureKeys:(BOOL)enabled resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  if (enabled && ![self installTap]) return reject(@"E_HOTKEY_PERMISSION",@"Bitte zuerst Bedienungshilfen für Flusstext erlauben.",nil);
  _capturingKeys=enabled; [_pressed removeAllObjects]; resolve(nil);
#else
  resolve(nil);
#endif
}
RCT_EXPORT_METHOD(updateDictationState:(NSDictionary *)state resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  NSString *phase=state[@"phase"] ?: @"idle";
  if (_dictationSounds && ![_dictationPhase isEqualToString:phase]) {
    if ([phase isEqualToString:@"listening"]) [[NSSound soundNamed:@"Tink"] play];
    else if ([phase isEqualToString:@"processing"]) [[NSSound soundNamed:@"Pop"] play];
  }
  _dictationPhase=phase; if ([phase isEqualToString:@"idle"]) { _hkActive=NO; _hkHandsFree=NO; } [self refreshPill];
#endif
  resolve(nil);
}
RCT_EXPORT_METHOD(setLaunchAtLogin:(BOOL)enabled resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  NSError *error=nil;
  BOOL result=enabled ? [SMAppService.mainAppService registerAndReturnError:&error] : [SMAppService.mainAppService unregisterAndReturnError:&error];
  if (!result) return reject(@"E_LOGIN",error.localizedDescription ?: @"Anmeldestart konnte nicht geändert werden.",error);
#endif
  resolve(nil);
}

/// config: { enabled, mode: 'hybrid'|'hold'|'toggle', hotkey: number[], pasteLastHotkey: number[] }
/// (= Settings.dictation; auch { dictation: {...} } wird akzeptiert). Codes wie src/shared/keys.ts.
RCT_EXPORT_METHOD(setHotkeys : (id)config resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  NSDictionary *c = [config isKindOfClass:NSDictionary.class] ? config : @{};
  if ([c[@"dictation"] isKindOfClass:NSDictionary.class]) c = c[@"dictation"];
  _pillEnabled=[c[@"enabled"] boolValue] && [c[@"idlePill"] boolValue] && [c[@"ready"] boolValue];
  _dictationSounds=[c[@"sounds"] boolValue]; [self refreshPill];
  NSString *mode = [c[@"mode"] isKindOfClass:NSString.class] ? c[@"mode"] : @"hybrid";
  _hkMode = [@[ @"hybrid", @"hold", @"toggle" ] containsObject:mode] ? mode : @"hybrid";
  _hkKeys = FTKeyList(c[@"hotkey"]);
  _hkPasteKeys = FTKeyList(c[@"pasteLastHotkey"]);
  _hkEnabled = [c[@"enabled"] respondsToSelector:@selector(boolValue)] && [c[@"enabled"] boolValue] && (_hkKeys.count || _hkPasteKeys.count);
  if (!_hkEnabled) {
    if (_hkActive) [self hotkey:@"cancel"];
    [self removeTap];
    return resolve(nil);
  }
  if (![self canListenToKeys]) {
    [self removeTap];
    return reject(@"E_HOTKEY_PERMISSION",
                  @"Für systemweite Kurzbefehle braucht Flusstext die Freigabe unter Systemeinstellungen > Datenschutz & Sicherheit > Bedienungshilfen bzw. Eingabeüberwachung.",
                  nil);
  }
  if (![self installTap]) return reject(@"E_HOTKEY", @"Tastatur-Hook konnte nicht gestartet werden", nil);
  resolve(nil);
#else
  resolve(nil);  // iOS: keine systemweiten Kurzbefehle
#endif
}

/// Optional: Stand der Freigaben für Kurzbefehle und Einfügen.
RCT_EXPORT_METHOD(hotkeyStatus : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  resolve(@{@"supported" : @YES, @"accessibility" : @(AXIsProcessTrusted()), @"inputMonitoring" : @(CGPreflightListenEventAccess()), @"active" : @(_tap != NULL)});
#else
  resolve(@{@"supported" : @NO, @"accessibility" : @NO, @"inputMonitoring" : @NO, @"active" : @NO});
#endif
}

/// Optional, nur auf ausdrückliche Nutzeraktion: zeigt die System-Abfrage bzw. öffnet die Einstellungen.
/// Gewährt selbst keine Rechte.
RCT_EXPORT_METHOD(requestHotkeyAccess : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
#if TARGET_OS_OSX
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt : @YES};
  BOOL trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  if (!trusted) {
    [NSWorkspace.sharedWorkspace openURL:[NSURL URLWithString:@"x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]];
  }
  resolve(@(trusted));
#else
  resolve(@NO);
#endif
}

#pragma mark Engine

static NSString *FTCallId(id params) {
  if ([params isKindOfClass:NSDictionary.class] && [params[@"requestId"] isKindOfClass:NSString.class]) return params[@"requestId"];
  return NSUUID.UUID.UUIDString;
}

- (void)cancelEngine:(id)params resolve:(RCTPromiseResolveBlock)resolve {
  NSString *only = [params isKindOfClass:NSDictionary.class] && [params[@"requestId"] isKindOfClass:NSString.class] ? params[@"requestId"] : nil;
  NSMutableArray<FTDecodeJob *> *decodes = [NSMutableArray new];
  @synchronized(_decodeCalls) {
    for (NSString *key in _decodeCalls.allKeys) {
      if (only && ![key isEqualToString:only]) continue;
      [decodes addObject:_decodeCalls[key]];
      [_decodeCalls removeObjectForKey:key];
    }
  }
  NSUInteger decodesCancelled = 0;
  for (FTDecodeJob *job in decodes) if ([job cancel]) decodesCancelled++;
  NSMutableArray *victims = [NSMutableArray new];
  @synchronized(_engineCalls) {
    for (NSString *key in _engineCalls.allKeys) {
      if (only && ![key isEqualToString:only]) continue;
      [_cancelledCalls addObject:key];
      [victims addObject:_engineCalls[key]];
    }
  }
#if TARGET_OS_OSX
  for (NSTask *task in victims) {
    if (!task.running) continue;
    pid_t pid = task.processIdentifier;
    [task terminate];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
      if (task.running) kill(pid, SIGKILL);
    });
  }
#else
  // iOS: sherpa-onnx lässt sich mitten in der Berechnung nicht unterbrechen; der Aufruf wird sofort
  // abgelehnt und sein Ergebnis verworfen.
  @synchronized(_engineCalls) {
    for (NSString *key in _cancelledCalls) {
      RCTPromiseRejectBlock rej = _engineCalls[key];
      if (rej) rej(@"E_CANCELLED", @"Abgebrochen", nil);
      [_engineCalls removeObjectForKey:key];
    }
    [_cancelledCalls removeAllObjects];
  }
#endif
  resolve(@(victims.count + decodesCancelled));
}

/// decodeAudio {path, outputPath, requestId?}: beliebige AVFoundation-Audiodatei (u. a. .qta) nach
/// 16 kHz/mono/16 Bit WAV. Läuft nativ auf macOS und iOS; die Eingabe bleibt unverändert.
- (void)decodeAudio:(id)params resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSDictionary *p = [params isKindOfClass:NSDictionary.class] ? params : @{};
  NSString *path = [p[@"path"] isKindOfClass:NSString.class] ? p[@"path"] : nil;
  NSString *outputPath = [p[@"outputPath"] isKindOfClass:NSString.class] ? p[@"outputPath"] : nil;
  if (!path.length || !outputPath.length) return reject(@"E_PARAMS", @"decodeAudio braucht path und outputPath", nil);
  NSString *callId = FTCallId(p);
  FTDecodeJob *job = [[FTDecodeJob alloc] initWithResolve:resolve reject:reject];
  NSMutableDictionary *calls = _decodeCalls;
  @synchronized(calls) {
    if (calls[callId]) return reject(@"E_BUSY", [@"decodeAudio läuft bereits für requestId " stringByAppendingString:callId], nil);
    calls[callId] = job;
  }
  dispatch_async(_decodeQueue, ^{
    NSError *error = nil;
    NSDictionary *result = nil;
    if (!job.cancelled) {
      result = FTDecodeAudioFile(path, outputPath, ^BOOL { return job.cancelled; }, ^BOOL { return [job commit]; }, &error);
    }
    @synchronized(calls) {
      if (calls[callId] == job) [calls removeObjectForKey:callId];
    }
    [job finishWithResult:result error:error];
  });
}

#if TARGET_OS_OSX
static id FTParseEngineOutput(NSData *data) {
  NSString *text = [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (!text.length) return nil;
  NSData *bytes = [text dataUsingEncoding:NSUTF8StringEncoding];
  id value = [NSJSONSerialization JSONObjectWithData:bytes options:NSJSONReadingFragmentsAllowed error:nil];
  if (value) return value;
  NSString *last = [text componentsSeparatedByCharactersInSet:NSCharacterSet.newlineCharacterSet].lastObject;
  return [NSJSONSerialization JSONObjectWithData:[last dataUsingEncoding:NSUTF8StringEncoding] options:NSJSONReadingFragmentsAllowed error:nil];
}

/// Startet Resources/engine/node Resources/engine/runner.cjs <method> <json>. Bei großen Parametern
/// (> 128 KiB) steht statt JSON "--stdin" in argv und das JSON kommt über stdin.
- (void)runEngine:(NSString *)method params:(id)params resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSString *engineDir = [NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"engine"];
  NSString *node = [engineDir stringByAppendingPathComponent:@"node"];
  NSString *runner = [engineDir stringByAppendingPathComponent:@"runner.cjs"];
  NSFileManager *fm = NSFileManager.defaultManager;
  if (![fm isExecutableFileAtPath:node] || ![fm fileExistsAtPath:runner]) {
    return reject(@"E_ENGINE_MISSING", @"Die Engine fehlt im App-Paket (Resources/engine/node und runner.cjs). Bitte die App neu bauen.", nil);
  }
  NSError *error = nil;
  NSData *json = [NSJSONSerialization dataWithJSONObject:params ?: NSNull.null options:NSJSONWritingFragmentsAllowed error:&error];
  if (!json) return reject(@"E_PARAMS", @"Parameter sind kein gültiges JSON", error);
  BOOL viaStdin = json.length > 128 * 1024;

  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:node];
  task.arguments = @[ runner, method, viaStdin ? @"--stdin" : [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] ];
  task.currentDirectoryURL = [NSURL fileURLWithPath:engineDir];
  task.qualityOfService = NSQualityOfServiceUtility;
  NSPipe *outPipe = [NSPipe pipe], *errPipe = [NSPipe pipe], *inPipe = [NSPipe pipe];
  task.standardOutput = outPipe;
  task.standardError = errPipe;
  task.standardInput = inPipe;

  NSMutableData *stdoutData = [NSMutableData new], *stderrData = [NSMutableData new];
  outPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *h) {
    NSData *d = h.availableData;
    @synchronized(stdoutData) { [stdoutData appendData:d]; }
  };
  errPipe.fileHandleForReading.readabilityHandler = ^(NSFileHandle *h) {
    NSData *d = h.availableData;
    @synchronized(stderrData) {
      [stderrData appendData:d];
      if (stderrData.length > 64 * 1024) [stderrData replaceBytesInRange:NSMakeRange(0, stderrData.length - 64 * 1024) withBytes:NULL length:0];
    }
  };

  NSString *callId = FTCallId(params);
  NSMutableDictionary *calls = _engineCalls;
  NSMutableSet *cancelled = _cancelledCalls;
  task.terminationHandler = ^(NSTask *t) {
    outPipe.fileHandleForReading.readabilityHandler = nil;
    errPipe.fileHandleForReading.readabilityHandler = nil;
    NSData *restOut = [outPipe.fileHandleForReading readDataToEndOfFile];
    NSData *restErr = [errPipe.fileHandleForReading readDataToEndOfFile];
    @synchronized(stdoutData) { [stdoutData appendData:restOut]; }
    @synchronized(stderrData) { [stderrData appendData:restErr]; }
    BOOL wasCancelled;
    @synchronized(calls) {
      [calls removeObjectForKey:callId];
      wasCancelled = [cancelled containsObject:callId];
      [cancelled removeObject:callId];
    }
    if (wasCancelled) return reject(@"E_CANCELLED", @"Abgebrochen", nil);
    if (t.terminationReason == NSTaskTerminationReasonExit && t.terminationStatus == 0) {
      id value = FTParseEngineOutput(stdoutData);
      return value ? resolve(value == NSNull.null ? nil : value) : reject(@"E_ENGINE", @"Engine lieferte kein gültiges JSON", nil);
    }
    NSString *message = [[[NSString alloc] initWithData:stderrData encoding:NSUTF8StringEncoding] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!message.length) message = [NSString stringWithFormat:@"Engine beendet mit Status %d", t.terminationStatus];
    reject(@"E_ENGINE", message, nil);
  };

  @synchronized(_engineCalls) { _engineCalls[callId] = task; }
  if (![task launchAndReturnError:&error]) {
    @synchronized(_engineCalls) { [_engineCalls removeObjectForKey:callId]; }
    return reject(@"E_ENGINE", [@"Engine konnte nicht gestartet werden: " stringByAppendingString:error.localizedDescription ?: @""], error);
  }
  dispatch_async(_io, ^{
    @try {
      if (viaStdin) [inPipe.fileHandleForWriting writeData:json];
      [inPipe.fileHandleForWriting closeFile];
    } @catch (NSException *e) {
      // Prozess hat stdin schon geschlossen; Fehler kommt über terminationHandler.
    }
  });
}
#endif

#if FLUSSTEXT_HAS_SHERPA
- (void)diarize:(NSDictionary *)p resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSString *path = [p[@"path"] isKindOfClass:NSString.class] ? p[@"path"] : nil;
  NSString *seg = [p[@"segmentation"] isKindOfClass:NSString.class] ? p[@"segmentation"] : nil;
  NSString *emb = [p[@"embedding"] isKindOfClass:NSString.class] ? p[@"embedding"] : nil;
  if (!path.length || !seg.length || !emb.length) return reject(@"E_PARAMS", @"diarize braucht path, segmentation und embedding", nil);
  NSUInteger cores = NSProcessInfo.processInfo.activeProcessorCount;
  auto num = ^double(NSString *key, double fallback) {
    id v = p[key];
    return [v isKindOfClass:NSNumber.class] ? [v doubleValue] : fallback;
  };
  flusstext::DiarizeOptions options;
  options.segmentation = seg.UTF8String;
  options.embedding = emb.UTF8String;
  options.threads = (int)MIN((double)cores, MAX(1.0, num(@"threads", MAX(1.0, cores / 2.0))));
  options.numSpeakers = (int)num(@"numSpeakers", 0);
  options.threshold = (float)num(@"threshold", 0.5);
  options.minDurationOn = (float)num(@"minDurationOn", 0.3);
  options.minDurationOff = (float)num(@"minDurationOff", 0.5);
  std::string file = path.UTF8String;

  NSString *callId = FTCallId(p);
  NSMutableDictionary *calls = _engineCalls;
  @synchronized(calls) { calls[callId] = [reject copy]; }
  dispatch_async(_engineQueue, ^{
    std::vector<flusstext::DiarizeSegment> segments;
    std::string error;
    bool ok = flusstext::DiarizeFile(file, options, &segments, &error);
    @synchronized(calls) {
      if (!calls[callId]) return;  // abgebrochen, schon abgelehnt
      [calls removeObjectForKey:callId];
    }
    if (!ok) return reject(@"E_DIARIZE", [NSString stringWithUTF8String:error.c_str()] ?: @"Sprechertrennung fehlgeschlagen", nil);
    NSMutableArray *out = [NSMutableArray arrayWithCapacity:segments.size()];
    for (const auto &s : segments) [out addObject:@{@"start" : @(s.start), @"end" : @(s.end), @"speaker" : @(s.speaker)}];
    resolve(out);
  });
}
#endif

/// Beide Plattformen nativ: `decodeAudio` (AVFoundation). Sonst macOS: gebündelter Node-Runner;
/// iOS: nativ nur `diarize` (sherpa-onnx C-API). `cancel` beendet laufende Aufrufe (optional nur params.requestId).
RCT_EXPORT_METHOD(engineCall : (NSString *)method params : (id)params resolve : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject) {
  if ([method isEqualToString:@"cancel"]) return [self cancelEngine:params resolve:resolve];
  if ([method isEqualToString:@"decodeAudio"]) return [self decodeAudio:params resolve:resolve reject:reject];
#if TARGET_OS_OSX
  [self runEngine:method params:params resolve:resolve reject:reject];
#else
#if FLUSSTEXT_HAS_SHERPA
  if ([method isEqualToString:@"diarize"]) {
    return [self diarize:[params isKindOfClass:NSDictionary.class] ? params : @{} resolve:resolve reject:reject];
  }
#else
  if ([method isEqualToString:@"diarize"]) {
    return reject(@"E_ENGINE_UNSUPPORTED", @"Native Sprechertrennung ist nicht eingebaut (sherpa-onnx C-Header fehlt im Build).", nil);
  }
#endif
  reject(@"E_ENGINE_UNSUPPORTED",
         [NSString stringWithFormat:@"engineCall('%@') ist auf iOS nicht nativ verfügbar. Unterstützt: decodeAudio, diarize, cancel. Transkription läuft hier über whisper.rn bzw. react-native-sherpa-onnx in JavaScript.", method],
         nil);
#endif
}

@end
