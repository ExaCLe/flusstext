import AVFoundation
import CoreMedia

// usage: gen <out.qta> <aac|apac|both|both-nogroup|aac51> [seconds] [source.wav]
let args = CommandLine.arguments
let outURL = URL(fileURLWithPath: args[1])
let mode = args[2]
var seconds = args.count > 3 ? Double(args[3])! : 3.0
try? FileManager.default.removeItem(at: outURL)
let rate = 48000.0
var source: [Float]? = nil
var sourceRate = 16000.0
if args.count > 4 {
  let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[4]))
  let pcm = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))!
  try file.read(into: pcm)
  source = Array(UnsafeBufferPointer(start: pcm.floatChannelData![0], count: Int(pcm.frameLength)))
  sourceRate = pcm.format.sampleRate
  seconds = Double(pcm.frameLength) / sourceRate
}


func makeBuffers(channels: Int, layoutTag: AudioChannelLayoutTag) -> [CMSampleBuffer] {
  var asbd = AudioStreamBasicDescription(mSampleRate: rate, mFormatID: kAudioFormatLinearPCM,
    mFormatFlags: kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked, mBytesPerPacket: UInt32(4*channels),
    mFramesPerPacket: 1, mBytesPerFrame: UInt32(4*channels), mChannelsPerFrame: UInt32(channels), mBitsPerChannel: 32, mReserved: 0)
  var layout = AudioChannelLayout(); layout.mChannelLayoutTag = layoutTag
  var fmt: CMAudioFormatDescription?
  CMAudioFormatDescriptionCreate(allocator: nil, asbd: &asbd, layoutSize: MemoryLayout<AudioChannelLayout>.size, layout: &layout, magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &fmt)
  var out: [CMSampleBuffer] = []
  let total = Int(seconds * rate), chunk = 4800
  var pos = 0
  while pos < total {
    let n = min(chunk, total - pos)
    var data = [Float](repeating: 0, count: n * channels)
    for i in 0..<n {
      let t = Double(pos + i) / rate
      // 440 Hz tone, first half; 880 Hz second half -> distinguishes content
      let f = t < seconds/2 ? 440.0 : 880.0
      let s = source.map { $0[min($0.count - 1, Int(t * sourceRate))] } ?? Float(0.5 * sin(2 * .pi * f * t))
      for c in 0..<channels { data[i*channels + c] = (c == 0 || channels <= 2) ? s : s * 0.2 }
    }
    var block: CMBlockBuffer?
    let bytes = n * channels * 4
    CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: bytes, blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: 0, blockBufferOut: &block)
    data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block!, offsetIntoDestination: 0, dataLength: bytes) }
    var sb: CMSampleBuffer?
    CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: nil, dataBuffer: block!, formatDescription: fmt!, sampleCount: n, presentationTimeStamp: CMTime(value: CMTimeValue(pos), timescale: CMTimeScale(rate)), packetDescriptions: nil, sampleBufferOut: &sb)
    out.append(sb!)
    pos += n
  }
  return out
}

let writer = try AVAssetWriter(outputURL: outURL, fileType: AVFileType(rawValue: "com.apple.quicktime-audio"))
var inputs: [(AVAssetWriterInput, [CMSampleBuffer])] = []
func addAAC(channels: Int = 2, tag: AudioChannelLayoutTag = kAudioChannelLayoutTag_Stereo) {
  var layout = AudioChannelLayout(); layout.mChannelLayoutTag = tag
  let ld = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
  let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: channels, AVChannelLayoutKey: ld, AVEncoderBitRateKey: 64000 * channels])
  i.expectsMediaDataInRealTime = false
  precondition(writer.canAdd(i), "cannot add AAC"); writer.add(i)
  inputs.append((i, makeBuffers(channels: channels, layoutTag: tag)))
}
func addAPAC() {
  let tag = kAudioChannelLayoutTag_HOA_ACN_SN3D | 4
  var layout = AudioChannelLayout(); layout.mChannelLayoutTag = tag
  let ld = Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
  let i = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatAPAC, AVSampleRateKey: rate, AVNumberOfChannelsKey: 4, AVChannelLayoutKey: ld])
  i.expectsMediaDataInRealTime = false
  precondition(writer.canAdd(i), "cannot add APAC"); writer.add(i)
  inputs.append((i, makeBuffers(channels: 4, layoutTag: tag)))
}
switch mode {
case "aac": addAAC()
case "aac51": addAAC(channels: 6, tag: kAudioChannelLayoutTag_MPEG_5_1_D)
case "apac": addAPAC()
case "both", "both-nogroup": addAAC(); addAPAC()
default: fatalError("mode")
}
if mode == "both" {
  let g = AVAssetWriterInputGroup(inputs: inputs.map { $0.0 }, defaultInput: inputs[0].0)
  precondition(writer.canAdd(g), "cannot add group"); writer.add(g)
}
precondition(writer.startWriting(), "start: \(String(describing: writer.error))")
writer.startSession(atSourceTime: .zero)
let q = DispatchQueue(label: "w")
let group = DispatchGroup()
for (input, bufs) in inputs {
  group.enter()
  var idx = 0
  input.requestMediaDataWhenReady(on: q) {
    while input.isReadyForMoreMediaData {
      if idx >= bufs.count { input.markAsFinished(); group.leave(); return }
      if !input.append(bufs[idx]) { print("append failed", writer.error as Any); input.markAsFinished(); group.leave(); return }
      idx += 1
    }
  }
}
group.wait()
let sem = DispatchSemaphore(value: 0)
writer.finishWriting { sem.signal() }
sem.wait()
print("status", writer.status.rawValue, writer.error as Any)
