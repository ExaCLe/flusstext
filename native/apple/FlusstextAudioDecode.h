// Dekodiert Audiodateien (u. a. Apple QuickTime Audio, .qta) mit AVFoundation in 16-kHz-Mono-WAV
// (16 Bit PCM). Wird nur von FlusstextHost.mm direkt eingebunden; keine eigene Übersetzungseinheit.
//
// Spurwahl: genau eine Audiospur, nie eine Mischung mehrerer Darstellungen. Sprachmemos-QTA enthält
// typischerweise eine AAC-Präsentationsspur und eine APAC-Spur (Spatial/Ambisonics) desselben Inhalts.
// Reihenfolge: AAC (aktiv vor inaktiv) > sonstige Codecs (z. B. LPCM, ALAC) > APAC; bei Gleichstand die
// kleinste Track-ID.
#pragma once

#import <AVFoundation/AVFoundation.h>

#include <stdio.h>
#include <unistd.h>

static NSString *const FTDecodeCodeKey = @"FTDecodeCode";

static NSError *FTDecodeError(NSString *code, NSString *message, NSError *underlying) {
  NSMutableDictionary *info = [@{NSLocalizedDescriptionKey : message, FTDecodeCodeKey : code} mutableCopy];
  if (underlying) info[NSUnderlyingErrorKey] = underlying;
  return [NSError errorWithDomain:@"FlusstextDecode" code:1 userInfo:info];
}

static NSString *FTFourCC(FourCharCode c) {
  char s[5] = {(char)(c >> 24), (char)(c >> 16), (char)(c >> 8), (char)c, 0};
  for (int i = 0; i < 4; i++) if (s[i] < 32 || s[i] > 126) return [NSString stringWithFormat:@"0x%08x", (unsigned)c];
  return [NSString stringWithUTF8String:s];
}

static BOOL FTIsAAC(FourCharCode c) {
  return c == kAudioFormatMPEG4AAC || c == kAudioFormatMPEG4AAC_HE || c == kAudioFormatMPEG4AAC_HE_V2 ||
         c == kAudioFormatMPEG4AAC_LD || c == kAudioFormatMPEG4AAC_ELD || c == kAudioFormatMPEG4AAC_ELD_SBR ||
         c == kAudioFormatMPEG4AAC_ELD_V2;
}

// 'apac' als Literal: kAudioFormatAPAC steht erst ab neueren SDKs im Header.
static const FourCharCode FTFormatAPAC = 'apac';

static BOOL FTWaitFor(void (^start)(dispatch_block_t done), double seconds) {
  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  start(^{ dispatch_semaphore_signal(sem); });
  return dispatch_semaphore_wait(sem, dispatch_time(DISPATCH_TIME_NOW, (int64_t)(seconds * NSEC_PER_SEC))) == 0;
}

static void FTPutU32(uint8_t *p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
static void FTPutU16(uint8_t *p, uint16_t v) { p[0] = v; p[1] = v >> 8; }

static void FTDecodeWavHeader(uint8_t h[44], uint32_t dataBytes) {
  memcpy(h, "RIFF", 4); FTPutU32(h + 4, 36 + dataBytes);
  memcpy(h + 8, "WAVEfmt ", 8); FTPutU32(h + 16, 16);
  FTPutU16(h + 20, 1); FTPutU16(h + 22, 1); FTPutU32(h + 24, 16000); FTPutU32(h + 28, 32000);
  FTPutU16(h + 32, 2); FTPutU16(h + 34, 16);
  memcpy(h + 36, "data", 4); FTPutU32(h + 40, dataBytes);
}

/// Dekodiert `input` nach `output` (16 kHz, mono, s16le). Die Ausgabe entsteht als `<output>.<uuid>.part`
/// im Zielordner und wird erst nach vollständigem Schreiben per rename(2) atomar sichtbar. `commit` wird
/// unmittelbar vor dem Umbenennen aufgerufen; liefert es NO (z. B. abgebrochen), bleibt nichts liegen.
/// `cancelled` wird regelmäßig abgefragt. Fehler tragen userInfo[FTDecodeCodeKey].
static NSDictionary *FTDecodeAudioFileImpl(NSString *input, NSString *output, BOOL (^cancelled)(void), BOOL (^commit)(void), NSError *__strong *error) {
  NSFileManager *fm = NSFileManager.defaultManager;
  auto fail = ^NSDictionary *(NSString *code, NSString *message, NSError *underlying) {
    if (error) *error = FTDecodeError(code, message, underlying);
    return nil;
  };
  NSError *cancelError = FTDecodeError(@"E_CANCELLED", @"Abgebrochen", nil);

  NSString *inPath = input.stringByStandardizingPath.stringByResolvingSymlinksInPath;
  NSString *outPath = output.stringByStandardizingPath;
  BOOL isDir = NO;
  if (![fm fileExistsAtPath:inPath isDirectory:&isDir] || isDir) return fail(@"E_NOT_FOUND", [@"Datei nicht gefunden: " stringByAppendingString:input], nil);
  if (![outPath.pathExtension.lowercaseString isEqualToString:@"wav"]) return fail(@"E_PARAMS", @"outputPath muss auf .wav enden", nil);
  if ([outPath.stringByResolvingSymlinksInPath isEqualToString:inPath]) return fail(@"E_PARAMS", @"outputPath darf nicht die Eingabedatei sein", nil);
  NSString *dir = outPath.stringByDeletingLastPathComponent;
  NSError *dirError = nil;
  if (![fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:&dirError]) {
    return fail(@"E_DECODE_WRITE", [@"Zielordner konnte nicht angelegt werden: " stringByAppendingString:dirError.localizedDescription ?: dir], dirError);
  }

  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:inPath] options:@{AVURLAssetPreferPreciseDurationAndTimingKey : @YES}];
  __block NSArray<AVAssetTrack *> *tracks = nil;
  __block NSError *loadError = nil;
  BOOL loaded = FTWaitFor(^(dispatch_block_t done) {
    [asset loadTracksWithMediaType:AVMediaTypeAudio completionHandler:^(NSArray<AVAssetTrack *> *t, NSError *e) { tracks = t; loadError = e; done(); }];
  }, 60);
  if (cancelled()) { if (error) *error = cancelError; return nil; }
  if (!loaded) return fail(@"E_DECODE", @"Audiodatei konnte nicht rechtzeitig gelesen werden", nil);
  if (!tracks) return fail(@"E_DECODE_UNSUPPORTED", [@"Datei wird von AVFoundation nicht als Audio erkannt: " stringByAppendingString:loadError.localizedDescription ?: inPath.lastPathComponent], loadError);
  if (tracks.count == 0) return fail(@"E_DECODE_NO_AUDIO", @"Die Datei enthält keine Audiospur", nil);

  // Spureigenschaften laden und Kandidaten bewerten.
  NSMutableArray<NSDictionary *> *described = [NSMutableArray new];
  AVAssetTrack *best = nil;
  NSInteger bestRank = NSIntegerMax;
  FourCharCode bestCodec = 0;
  for (AVAssetTrack *track in tracks) {
    FTWaitFor(^(dispatch_block_t done) { [track loadValuesAsynchronouslyForKeys:@[ @"formatDescriptions", @"enabled" ] completionHandler:done]; }, 30);
    CMAudioFormatDescriptionRef fd = (__bridge CMAudioFormatDescriptionRef)track.formatDescriptions.firstObject;
    const AudioStreamBasicDescription *asbd = fd ? CMAudioFormatDescriptionGetStreamBasicDescription(fd) : NULL;
    FourCharCode codec = asbd ? asbd->mFormatID : 0;
    BOOL enabled = track.enabled;
    NSInteger rank = FTIsAAC(codec) ? 0 : codec == FTFormatAPAC ? 4 : codec ? 2 : 6;
    if (!enabled) rank += 1;
    [described addObject:@{
      @"trackId" : @(track.trackID),
      @"codec" : FTFourCC(codec),
      @"channels" : @(asbd ? asbd->mChannelsPerFrame : 0),
      @"sampleRate" : @(asbd ? asbd->mSampleRate : 0),
      @"enabled" : @(enabled),
    }];
    if (rank < bestRank || (rank == bestRank && track.trackID < best.trackID)) {
      best = track;
      bestRank = rank;
      bestCodec = codec;
    }
  }

  if (bestCodec == FTFormatAPAC) {
    // APAC dekodiert AVFoundation erst ab iOS 17 / macOS 14.
    BOOL apacOS = NO;
    if (@available(iOS 17.0, macOS 14.0, *)) apacOS = YES;
    if (!apacOS) {
      return fail(@"E_DECODE_UNSUPPORTED",
                  @"Die Datei enthält nur eine APAC-Spur (Apple Spatial Audio). Diese lässt sich erst ab iOS 17 dekodieren. "
                  @"Bitte iOS aktualisieren oder die Aufnahme in Sprachmemos als M4A/AAC teilen.", nil);
    }
  }

  // Ausgabe-Teildatei im Zielordner, damit rename(2) atomar bleibt.
  NSString *part = [NSString stringWithFormat:@"%@.%@.part", outPath, NSUUID.UUID.UUIDString];
  __block FILE *fp = fopen(part.fileSystemRepresentation, "wb");
  if (!fp) return fail(@"E_DECODE_WRITE", [NSString stringWithFormat:@"Ausgabe konnte nicht angelegt werden: %s", strerror(errno)], nil);
  auto discard = ^NSDictionary *(NSString *code, NSString *message, NSError *underlying) {
    if (fp) { fclose(fp); fp = NULL; }
    unlink(part.fileSystemRepresentation);
    if ([code isEqualToString:@"E_CANCELLED"]) { if (error) *error = cancelError; return nil; }
    return fail(code, message, underlying);
  };
  uint8_t header[44];
  FTDecodeWavHeader(header, 0);
  if (fwrite(header, 1, 44, fp) != 44) return discard(@"E_DECODE_WRITE", @"Ausgabe konnte nicht geschrieben werden", nil);

  NSError *readerError = nil;
  AVAssetReader *reader = [AVAssetReader assetReaderWithAsset:asset error:&readerError];
  if (!reader) return discard(@"E_DECODE", [@"Audiodatei konnte nicht geöffnet werden: " stringByAppendingString:readerError.localizedDescription ?: @""], readerError);
  AudioChannelLayout mono = {};
  mono.mChannelLayoutTag = kAudioChannelLayoutTag_Mono;
  NSDictionary *settings = @{
    AVFormatIDKey : @(kAudioFormatLinearPCM),
    AVSampleRateKey : @16000,
    AVNumberOfChannelsKey : @1,
    AVChannelLayoutKey : [NSData dataWithBytes:&mono length:sizeof(mono)],
    AVLinearPCMBitDepthKey : @16,
    AVLinearPCMIsFloatKey : @NO,
    AVLinearPCMIsBigEndianKey : @NO,
    AVLinearPCMIsNonInterleaved : @NO,
  };
  AVAssetReaderTrackOutput *trackOutput = nil;
  @try {
    trackOutput = [AVAssetReaderTrackOutput assetReaderTrackOutputWithTrack:best outputSettings:settings];
  } @catch (NSException *e) {
    return discard(@"E_DECODE_UNSUPPORTED", [NSString stringWithFormat:@"Codec %@ lässt sich hier nicht in PCM umwandeln: %@", FTFourCC(bestCodec), e.reason], nil);
  }
  trackOutput.alwaysCopiesSampleData = NO;
  if (![reader canAddOutput:trackOutput]) return discard(@"E_DECODE_UNSUPPORTED", [NSString stringWithFormat:@"Codec %@ wird auf diesem Gerät nicht unterstützt", FTFourCC(bestCodec)], nil);
  [reader addOutput:trackOutput];
  if (![reader startReading]) {
    NSString *why = reader.error.localizedDescription ?: @"";
    return discard(@"E_DECODE_UNSUPPORTED", [NSString stringWithFormat:@"Codec %@ lässt sich auf diesem Gerät nicht dekodieren%@%@", FTFourCC(bestCodec), why.length ? @": " : @"", why], reader.error);
  }

  uint64_t dataBytes = 0;
  const uint64_t maxBytes = UINT32_MAX - 36;
  for (;;) {
    if (cancelled()) { [reader cancelReading]; return discard(@"E_CANCELLED", @"", nil); }
    BOOL stop = NO;
    NSDictionary *(^problem)(void) = nil;
    @autoreleasepool {
      CMSampleBufferRef sample = [trackOutput copyNextSampleBuffer];
      if (!sample) {
        stop = YES;
      } else {
        CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
        size_t length = block ? CMBlockBufferGetDataLength(block) : 0;
        size_t offset = 0;
        while (offset < length) {
          size_t chunk = 0;
          char *ptr = NULL;
          if (CMBlockBufferGetDataPointer(block, offset, &chunk, NULL, &ptr) != kCMBlockBufferNoErr || !ptr || chunk == 0) break;
          chunk = MIN(chunk, length - offset);
          if (dataBytes + chunk > maxBytes) {
            problem = ^{ return discard(@"E_DECODE_TOO_LONG", @"Audio ist zu lang für eine WAV-Datei (über 37 Stunden)", nil); };
            break;
          }
          if (fwrite(ptr, 1, chunk, fp) != chunk) {
            problem = ^{ return discard(@"E_DECODE_WRITE", [NSString stringWithFormat:@"Ausgabe konnte nicht geschrieben werden: %s", strerror(errno)], nil); };
            break;
          }
          dataBytes += chunk;
          offset += chunk;
        }
        CFRelease(sample);
      }
    }
    if (problem) { [reader cancelReading]; return problem(); }
    if (stop) break;
  }
  if (reader.status != AVAssetReaderStatusCompleted) {
    if (cancelled()) return discard(@"E_CANCELLED", @"", nil);
    NSString *why = reader.error.localizedDescription ?: @"unbekannter Fehler";
    return discard(@"E_DECODE", [NSString stringWithFormat:@"Dekodieren von %@ fehlgeschlagen: %@", FTFourCC(bestCodec), why], reader.error);
  }
  if (dataBytes & 1) dataBytes -= 1;  // nur ganze 16-Bit-Frames
  FTDecodeWavHeader(header, (uint32_t)dataBytes);
  BOOL wrote = fseeko(fp, 0, SEEK_SET) == 0 && fwrite(header, 1, 44, fp) == 44 && ftruncate(fileno(fp), 44 + (off_t)dataBytes) == 0 &&
               fflush(fp) == 0 && fsync(fileno(fp)) == 0;
  int closed = fclose(fp);
  fp = NULL;
  if (!wrote || closed != 0) return discard(@"E_DECODE_WRITE", [NSString stringWithFormat:@"Ausgabe konnte nicht abgeschlossen werden: %s", strerror(errno)], nil);
  if (!commit()) return discard(@"E_CANCELLED", @"", nil);
  if (rename(part.fileSystemRepresentation, outPath.fileSystemRepresentation) != 0) {
    return discard(@"E_DECODE_WRITE", [NSString stringWithFormat:@"Ausgabe konnte nicht übernommen werden: %s", strerror(errno)], nil);
  }

  // aac-presentation: AAC aus mehreren Spuren gewählt; apac: keine AAC-/sonstige Spur vorhanden.
  NSString *reason = FTIsAAC(bestCodec) ? (described.count > 1 ? @"aac-presentation" : @"aac") : bestCodec == FTFormatAPAC ? @"apac" : @"other";
  return @{
    @"path" : outPath,
    @"durationSeconds" : @(dataBytes / 32000.0),
    @"sampleRate" : @16000,
    @"channels" : @1,
    @"bitsPerSample" : @16,
    @"sourceTrackId" : @(best.trackID),
    @"sourceCodec" : FTFourCC(bestCodec),
    @"selection" : reason,
    @"audioTracks" : described,
  };
}

static NSDictionary *FTDecodeAudioFile(NSString *input, NSString *output, BOOL (^cancelled)(void), BOOL (^commit)(void), NSError **error) {
  NSError *failure = nil;
  NSDictionary *result = FTDecodeAudioFileImpl(input, output, cancelled, commit, &failure);
  if (!result && error) *error = failure;
  return result;
}
