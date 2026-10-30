#include "FlusstextDiarize.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>

#include "sherpa-onnx/c-api/c-api.h"

namespace flusstext {
namespace {

constexpr int kModelSampleRate = 16000;

struct DiarizationDeleter {
  void operator()(const SherpaOnnxOfflineSpeakerDiarization *p) const {
    if (p) SherpaOnnxDestroyOfflineSpeakerDiarization(p);
  }
};
struct ResultDeleter {
  void operator()(const SherpaOnnxOfflineSpeakerDiarizationResult *p) const {
    if (p) SherpaOnnxOfflineSpeakerDiarizationDestroyResult(p);
  }
};
struct SegmentDeleter {
  void operator()(const SherpaOnnxOfflineSpeakerDiarizationSegment *p) const {
    if (p) SherpaOnnxOfflineSpeakerDiarizationDestroySegment(p);
  }
};

using DiarizationPtr = std::unique_ptr<const SherpaOnnxOfflineSpeakerDiarization, DiarizationDeleter>;
using ResultPtr = std::unique_ptr<const SherpaOnnxOfflineSpeakerDiarizationResult, ResultDeleter>;
using SegmentPtr = std::unique_ptr<const SherpaOnnxOfflineSpeakerDiarizationSegment, SegmentDeleter>;

uint16_t U16(const unsigned char *p) { return static_cast<uint16_t>(p[0] | (p[1] << 8)); }
uint32_t U32(const unsigned char *p) {
  return static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) | (static_cast<uint32_t>(p[2]) << 16) |
         (static_cast<uint32_t>(p[3]) << 24);
}

bool FileExists(const std::string &path) {
  std::ifstream f(path, std::ios::binary);
  return f.good();
}

std::vector<float> Resample(const std::vector<float> &in, int from, int to) {
  if (from == to || in.empty()) return in;
  const double ratio = static_cast<double>(from) / to;
  const size_t n = static_cast<size_t>(std::floor(in.size() / ratio));
  std::vector<float> out(n);
  for (size_t i = 0; i < n; ++i) {
    const double pos = i * ratio;
    const size_t i0 = static_cast<size_t>(pos);
    const size_t i1 = std::min(i0 + 1, in.size() - 1);
    const float t = static_cast<float>(pos - i0);
    out[i] = in[i0] * (1.0f - t) + in[i1] * t;
  }
  return out;
}

}  // namespace

bool ReadWaveMono(const std::string &path, int targetRate, std::vector<float> *samples, std::string *error) {
  std::ifstream f(path, std::ios::binary | std::ios::ate);
  if (!f) {
    *error = "Audiodatei nicht lesbar: " + path;
    return false;
  }
  const std::streamoff fileSize = f.tellg();
  f.seekg(0);
  unsigned char riff[12];
  if (fileSize < 12 || !f.read(reinterpret_cast<char *>(riff), 12) || std::memcmp(riff, "RIFF", 4) != 0 ||
      std::memcmp(riff + 8, "WAVE", 4) != 0) {
    *error = "Keine WAV-Datei (RIFF/WAVE erwartet): " + path;
    return false;
  }

  uint16_t format = 0, channels = 0, bits = 0;
  uint32_t rate = 0;
  bool haveFmt = false;
  std::streamoff dataOffset = -1;
  uint64_t dataSize = 0;
  std::streamoff pos = 12;
  while (pos + 8 <= fileSize) {
    unsigned char hdr[8];
    f.seekg(pos);
    if (!f.read(reinterpret_cast<char *>(hdr), 8)) break;
    const uint32_t size = U32(hdr + 4);
    const std::streamoff body = pos + 8;
    if (std::memcmp(hdr, "fmt ", 4) == 0) {
      unsigned char fmt[40] = {0};
      const uint32_t n = std::min<uint32_t>(size, sizeof(fmt));
      if (n < 16 || !f.read(reinterpret_cast<char *>(fmt), n)) break;
      format = U16(fmt);
      channels = U16(fmt + 2);
      rate = U32(fmt + 4);
      bits = U16(fmt + 14);
      if (format == 0xFFFE && n >= 26) format = U16(fmt + 24);  // WAVE_FORMAT_EXTENSIBLE: SubFormat-GUID
      haveFmt = true;
    } else if (std::memcmp(hdr, "data", 4) == 0) {
      dataOffset = body;
      const uint64_t remaining = static_cast<uint64_t>(fileSize - body);
      // Laufende/abgebrochene Aufnahmen tragen oft 0 oder 0xFFFFFFFF als Größe.
      dataSize = (size == 0 || size == 0xFFFFFFFFu || size > remaining) ? remaining : size;
      break;
    }
    pos = body + size + (size & 1);
  }
  if (!haveFmt || dataOffset < 0) {
    *error = "WAV-Datei ohne fmt- oder data-Abschnitt: " + path;
    return false;
  }
  const bool isFloat = format == 3 && bits == 32;
  const bool isPcm = format == 1 && (bits == 8 || bits == 16 || bits == 24 || bits == 32);
  if ((!isFloat && !isPcm) || channels == 0 || rate == 0) {
    *error = "Nicht unterstütztes WAV-Format (erwartet PCM oder Float32): " + path;
    return false;
  }

  const size_t bytesPerSample = bits / 8;
  const size_t frameBytes = bytesPerSample * channels;
  const size_t frames = static_cast<size_t>(dataSize / frameBytes);
  std::vector<unsigned char> raw(frames * frameBytes);
  f.seekg(dataOffset);
  if (!raw.empty() && !f.read(reinterpret_cast<char *>(raw.data()), static_cast<std::streamsize>(raw.size()))) {
    *error = "WAV-Daten unvollständig: " + path;
    return false;
  }

  std::vector<float> mono(frames);
  for (size_t i = 0; i < frames; ++i) {
    double sum = 0;
    for (size_t c = 0; c < channels; ++c) {
      const unsigned char *p = raw.data() + i * frameBytes + c * bytesPerSample;
      float v = 0;
      if (isFloat) {
        std::memcpy(&v, p, 4);
      } else if (bits == 8) {
        v = (static_cast<int>(p[0]) - 128) / 128.0f;
      } else if (bits == 16) {
        v = static_cast<int16_t>(U16(p)) / 32768.0f;
      } else if (bits == 24) {
        int32_t s = (p[0] | (p[1] << 8) | (p[2] << 16));
        if (s & 0x800000) s |= ~0xFFFFFF;
        v = s / 8388608.0f;
      } else {
        v = static_cast<int32_t>(U32(p)) / 2147483648.0f;
      }
      sum += v;
    }
    mono[i] = static_cast<float>(sum / channels);
  }
  *samples = Resample(mono, static_cast<int>(rate), targetRate);
  return true;
}

bool Diarize(const DiarizeOptions &options, const std::vector<float> &samples, std::vector<DiarizeSegment> *segments,
             std::string *error) {
  segments->clear();
  if (!FileExists(options.segmentation)) {
    *error = "Segmentierungsmodell fehlt: " + options.segmentation;
    return false;
  }
  if (!FileExists(options.embedding)) {
    *error = "Sprechermodell fehlt: " + options.embedding;
    return false;
  }

  SherpaOnnxOfflineSpeakerDiarizationConfig config;
  std::memset(&config, 0, sizeof(config));
  config.segmentation.pyannote.model = options.segmentation.c_str();
  config.segmentation.num_threads = std::max(1, options.threads);
  config.segmentation.debug = 0;
  config.segmentation.provider = "cpu";
  config.embedding.model = options.embedding.c_str();
  config.embedding.num_threads = std::max(1, options.threads);
  config.embedding.debug = 0;
  config.embedding.provider = "cpu";
  config.clustering.num_clusters = options.numSpeakers > 0 ? options.numSpeakers : -1;
  config.clustering.threshold = options.threshold;
  config.min_duration_on = options.minDurationOn;
  config.min_duration_off = options.minDurationOff;

  DiarizationPtr sd(SherpaOnnxCreateOfflineSpeakerDiarization(&config));
  if (!sd) {
    *error = "Sprechertrennung konnte nicht initialisiert werden (Modelle prüfen)";
    return false;
  }
  const int rate = SherpaOnnxOfflineSpeakerDiarizationGetSampleRate(sd.get());
  if (rate != kModelSampleRate) {
    *error = "Unerwartete Modell-Abtastrate: " + std::to_string(rate);
    return false;
  }
  if (samples.empty()) return true;

  ResultPtr result(
      SherpaOnnxOfflineSpeakerDiarizationProcess(sd.get(), samples.data(), static_cast<int32_t>(samples.size())));
  if (!result) {
    *error = "Sprechertrennung fehlgeschlagen";
    return false;
  }
  const int n = SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments(result.get());
  if (n <= 0) return true;
  SegmentPtr sorted(SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime(result.get()));
  if (!sorted) {
    *error = "Sprechertrennung lieferte keine Segmente";
    return false;
  }
  std::map<int, int> renumber;
  segments->reserve(static_cast<size_t>(n));
  for (int i = 0; i < n; ++i) {
    const auto &s = sorted.get()[i];
    auto it = renumber.find(s.speaker);
    if (it == renumber.end()) it = renumber.emplace(s.speaker, static_cast<int>(renumber.size())).first;
    segments->push_back({s.start, s.end, it->second});
  }
  return true;
}

bool DiarizeFile(const std::string &path, const DiarizeOptions &options, std::vector<DiarizeSegment> *segments,
                 std::string *error) {
  std::vector<float> samples;
  if (!ReadWaveMono(path, kModelSampleRate, &samples, error)) return false;
  return Diarize(options, samples, segments, error);
}

}  // namespace flusstext
