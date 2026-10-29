// Offline-Sprechertrennung über die sherpa-onnx C-API.
// Wird von FlusstextHost.mm auf iOS genutzt (nur iOS-Target; die SherpaOnnx-Pod-XCFramework hat keine macOS-Slice).
#pragma once

#include <string>
#include <vector>

namespace flusstext {

struct DiarizeOptions {
  std::string segmentation;  // pyannote-Segmentierungsmodell (.onnx)
  std::string embedding;     // Sprecher-Embedding-Modell (.onnx)
  int threads = 1;
  int numSpeakers = 0;       // > 0: feste Sprecherzahl, sonst Schwellwert-Clustering
  float threshold = 0.5f;
  float minDurationOn = 0.3f;
  float minDurationOff = 0.5f;
};

struct DiarizeSegment {
  float start;
  float end;
  int speaker;
};

/// Liest eine WAV-Datei (PCM 8/16/24/32 bit oder Float32, beliebige Kanäle) als Mono-Float.
/// Ist die Abtastrate nicht `targetRate`, wird linear umgetastet.
bool ReadWaveMono(const std::string &path, int targetRate, std::vector<float> *samples, std::string *error);

/// Führt die Sprechertrennung auf Mono-Samples mit der Abtastrate des Modells (16 kHz) aus.
/// Segmente sind nach Startzeit sortiert, Sprecher nach erstem Auftreten neu nummeriert (0, 1, 2 …).
bool Diarize(const DiarizeOptions &options, const std::vector<float> &samples, std::vector<DiarizeSegment> *segments,
             std::string *error);

/// Lädt `path` (WAV) und trennt die Sprecher.
bool DiarizeFile(const std::string &path, const DiarizeOptions &options, std::vector<DiarizeSegment> *segments,
                 std::string *error);

}  // namespace flusstext
