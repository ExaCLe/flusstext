#import "../../apple/FlusstextAudioDecode.h"
#include <math.h>
#include <atomic>
#include <memory>
// usage: cli <in> <out.wav> [cancelAfterMs]
int main(int argc, char **argv) {
  @autoreleasepool {
    NSString *in = @(argv[1]), *out = @(argv[2]);
    auto stopPtr = std::make_shared<std::atomic<bool>>(false); std::atomic<bool> &stop = *stopPtr;
    if (argc > 3) {
      int ms = atoi(argv[3]);
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)ms * NSEC_PER_MSEC), dispatch_get_global_queue(0, 0), ^{ *stopPtr = true; });
    }
    NSError *err = nil;
    CFAbsoluteTime t0 = CFAbsoluteTimeGetCurrent();
    NSDictionary *r = FTDecodeAudioFile(in, out, ^BOOL { return stopPtr->load(); }, ^BOOL { return !stopPtr->load(); }, &err);
    double dt = CFAbsoluteTimeGetCurrent() - t0;
    if (!r) { printf("ERROR %s: %s (%.3fs)\n", [err.userInfo[FTDecodeCodeKey] UTF8String], err.localizedDescription.UTF8String, dt); return 1; }
    NSData *d = [NSData dataWithContentsOfFile:out];
    const int16_t *s = (const int16_t *)((const uint8_t *)d.bytes + 44);
    size_t n = (d.length - 44) / 2;
    // RMS and zero-crossing frequency in first and second half
    auto stats = [&](size_t a, size_t b, double *rms, double *freq) {
      double sum = 0; size_t zc = 0;
      for (size_t i = a; i < b; i++) { sum += (double)s[i] * s[i]; if (i > a && ((s[i-1] < 0) != (s[i] < 0))) zc++; }
      *rms = sqrt(sum / MAX(1, b - a)) / 32768.0; *freq = zc / 2.0 / ((b - a) / 16000.0);
    };
    double r1, f1, r2, f2; stats(n/10, n/2 - n/10, &r1, &f1); stats(n/2 + n/10, n - n/10, &r2, &f2);
    NSData *json = [NSJSONSerialization dataWithJSONObject:r options:NSJSONWritingSortedKeys error:nil];
    printf("OK %s\n  bytes=%lu header=%.4s rms1=%.3f f1=%.0fHz rms2=%.3f f2=%.0fHz (%.3fs)\n", [[NSString alloc] initWithData:json encoding:4].UTF8String, (unsigned long)d.length, (const char *)d.bytes, r1, f1, r2, f2, dt);
  }
  return 0;
}
